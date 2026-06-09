/**
 * The ffmpeg.wasm executor (story 05) — the dumb runtime half of assemble.
 *
 * Everything clever (the timeline walk, the filter graph) is the pure
 * `./assemble.ts`; this module just loads the wasm core and runs the argv it
 * produced. Two deliberate choices:
 *
 *  - **Lazy.** `@ffmpeg/ffmpeg` is dynamically imported on first `assemble()`,
 *    never at module load — so its worker + glue stay out of the initial JS the
 *    page evaluates. The ~32 MB wasm core is a bundled asset (`?url` below) the
 *    browser only fetches when `load()` runs, not on page load.
 *  - **Single-threaded.** We load `@ffmpeg/core` (not `core-mt`), which needs no
 *    cross-origin-isolation (COOP/COEP) headers — so it works on `/studio` today.
 *    The multithreaded core would slot in here (swap to `@ffmpeg/core-mt`, add its
 *    `workerURL`, and set the isolation headers via a BFFless response-header rule).
 *
 * **Why the ESM core, served locally.** `@ffmpeg/ffmpeg` runs in a *module* worker
 * (`type: "module"`), where `importScripts` doesn't exist — so it loads the core
 * via `await import(coreURL)`, which needs the ESM build's `export default`. We
 * resolve both the core JS and the wasm through Vite's `?url` so they're bundled
 * from the npm package as ordinary hashed assets — no CDN fetch at runtime.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg'
// Resolved by Vite from the installed @ffmpeg/core* packages (their `exports` maps
// point `.`/`./wasm`/`./worker` at the ESM build). `?url` emits them as static
// assets and hands back their served URLs — bundled locally, fetched on first
// load only, and only the variant actually chosen below is ever fetched.
import coreUrl from '@ffmpeg/core?url'
import wasmUrl from '@ffmpeg/core/wasm?url'
// Multithreaded core (story 03g follow-up). Parallelizes the encode across CPU
// cores — the slice/assemble speed win — but needs SharedArrayBuffer, hence a
// cross-origin-isolated page (COOP/COEP) and its extra pthread `worker.js`.
import coreMtUrl from '@ffmpeg/core-mt?url'
import wasmMtUrl from '@ffmpeg/core-mt/wasm?url'
import workerMtUrl from '@ffmpeg/core-mt/worker?url'

const abs = (u: string) => new URL(u, window.location.href).href

// One core instance for the session — loading it is expensive, running is reusable.
let instance: FFmpeg | null = null
let loading: Promise<FFmpeg> | null = null
/** Which core actually loaded, for diagnostics. */
export let coreVariant: 'mt' | 'st' | null = null

/**
 * Load the ffmpeg core, preferring the **multithreaded** build when the page is
 * cross-origin isolated (COOP/COEP set → `SharedArrayBuffer` available). The MT
 * core parallelizes encoding across cores, which is the slice/assemble speedup.
 *
 * This is best-effort and **never fatal**: if the page isn't isolated, or the MT
 * core fails to load for any reason (bundling quirk, missing headers, an old
 * browser), we fall back to the single-threaded core — which needs no special
 * headers and is exactly today's behavior. A fresh `FFmpeg` is used for the
 * fallback because a failed `load()` leaves its worker in an unusable state.
 */
async function getFFmpeg(): Promise<FFmpeg> {
  if (instance?.loaded) return instance
  if (loading) return loading
  loading = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')

    if (globalThis.crossOriginIsolated) {
      try {
        const ff = new FFmpeg()
        await ff.load({
          coreURL: abs(coreMtUrl),
          wasmURL: abs(wasmMtUrl),
          workerURL: abs(workerMtUrl),
        })
        instance = ff
        coreVariant = 'mt'
        return ff
      } catch {
        // Fall through to the single-threaded core below.
      }
    }

    const ff = new FFmpeg()
    await ff.load({ coreURL: abs(coreUrl), wasmURL: abs(wasmUrl) })
    instance = ff
    coreVariant = 'st'
    return ff
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
}

export type AssembleAssets = {
  /** The source video bytes (written as the command's input 0, e.g. `source.mp4`). */
  source: Uint8Array
  /** One WAV per `command.audioInputs` entry, in that order (`a0.wav`, `a1.wav`…). */
  clips: Uint8Array[]
  command: import('./assemble').FfmpegCommand
  /** 0–1 encode progress from ffmpeg's `progress` event. */
  onProgress?: (progress: number) => void
  /** Raw ffmpeg log lines, for surfacing the real error on failure. */
  onLog?: (line: string) => void
}

/**
 * Run one assemble: stage the source + clips into the wasm FS, exec the command,
 * read back `out.mp4`, and clean up. Returns the finished MP4 as a Blob. Throws
 * with ffmpeg's last log lines attached if the exec fails.
 */
export async function assemble({
  source,
  clips,
  command,
  onProgress,
  onLog,
}: AssembleAssets): Promise<Blob> {
  const ff = await getFFmpeg()

  const tail: string[] = []
  const onLogEvent = ({ message }: { message: string }) => {
    tail.push(message)
    if (tail.length > 40) tail.shift()
    onLog?.(message)
  }
  const onProgressEvent = ({ progress }: { progress: number }) => {
    // ffmpeg can briefly report >1 or <0 near the end; clamp for the bar.
    onProgress?.(Math.min(1, Math.max(0, progress)))
  }
  ff.on('log', onLogEvent)
  ff.on('progress', onProgressEvent)

  const sourceName = command.args[1] // argv is ['-i', source, ...]
  const written: string[] = []
  try {
    await ff.writeFile(sourceName, source)
    written.push(sourceName)
    for (let i = 0; i < clips.length; i++) {
      const name = `a${i}.wav`
      await ff.writeFile(name, clips[i])
      written.push(name)
    }

    const code = await ff.exec(command.args)
    if (code !== 0) {
      throw new Error(`ffmpeg exited ${code}\n${tail.slice(-12).join('\n')}`)
    }

    const output = command.args[command.args.length - 1]
    const data = await ff.readFile(output)
    written.push(output)
    if (typeof data === 'string') throw new Error('ffmpeg returned text, expected binary output')
    // Copy into a fresh buffer — the FS-backed view is invalidated by deleteFile.
    return new Blob([data.slice()], { type: 'video/mp4' })
  } finally {
    ff.off('log', onLogEvent)
    ff.off('progress', onProgressEvent)
    for (const name of written) await ff.deleteFile(name).catch(() => {})
  }
}

export type SliceAssets = {
  /** The source video bytes (written as the command's input). */
  source: Uint8Array
  command: import('./slice').SliceCommand
  /** 0–1 encode progress from ffmpeg's `progress` event. */
  onProgress?: (progress: number) => void
  /** Raw ffmpeg log lines, for surfacing the real error on failure. */
  onLog?: (line: string) => void
}

/**
 * Cut one scene's clip out of the source (story 03g). Stage the source into the
 * wasm FS, exec the trim argv `./slice.ts` produced, read back the clip, clean up.
 * Returns the scene clip as a Blob. Throws with ffmpeg's last log lines on failure.
 * A single short re-encode (per scene), not the whole-timeline assemble.
 */
export async function slice({ source, command, onProgress, onLog }: SliceAssets): Promise<Blob> {
  const ff = await getFFmpeg()

  const tail: string[] = []
  const onLogEvent = ({ message }: { message: string }) => {
    tail.push(message)
    if (tail.length > 40) tail.shift()
    onLog?.(message)
  }
  const onProgressEvent = ({ progress }: { progress: number }) => {
    onProgress?.(Math.min(1, Math.max(0, progress)))
  }
  ff.on('log', onLogEvent)
  ff.on('progress', onProgressEvent)

  const written: string[] = []
  try {
    await ff.writeFile(command.source, source)
    written.push(command.source)

    const code = await ff.exec(command.args)
    if (code !== 0) {
      throw new Error(`ffmpeg exited ${code}\n${tail.slice(-12).join('\n')}`)
    }

    const data = await ff.readFile(command.output)
    written.push(command.output)
    if (typeof data === 'string') throw new Error('ffmpeg returned text, expected binary output')
    return new Blob([data.slice()], { type: 'video/mp4' })
  } finally {
    ff.off('log', onLogEvent)
    ff.off('progress', onProgressEvent)
    for (const name of written) await ff.deleteFile(name).catch(() => {})
  }
}
