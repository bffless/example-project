/**
 * Patch @ffmpeg/core-mt so its multithreaded core actually loads under Vite.
 *
 * The bug: core-mt's ESM pthread worker (`ffmpeg-core.worker.js`) is written for
 * a MODULE worker — it pulls in the core with dynamic `import()`. But emscripten's
 * `allocateUnusedWorker` spawns it with `new Worker(url)` — no `{type:"module"}` —
 * so the browser loads it as a CLASSIC worker and dies on the `import` with
 * "Cannot use import statement outside a module". This is the long-standing
 * core-mt ↔ @ffmpeg/ffmpeg@0.12.x module-worker incompatibility.
 *
 * The fix is one addition: pass `{type:"module"}` to both `new Worker(...)` calls
 * in the ESM core so the pthread workers load as module workers (matching how the
 * worker file is written). Runs on `postinstall` so it survives `npm ci` in CI /
 * deploy. Idempotent: a no-op once patched; exits non-zero if the target strings
 * are gone (e.g. a core-mt version bump) so the drift is caught, not silently lost.
 *
 * Second patch: raise the heap from 1 GiB to 3 GiB. core-mt creates its shared
 * `WebAssembly.Memory` with `initial === maximum` (pthread memory can't grow), so
 * the build's 1 GiB default is a HARD cap — and `@ffmpeg/ffmpeg`'s loader never
 * passes `INITIAL_MEMORY`, so it can't be raised at load time. That's half what
 * the single-threaded core can grow to (2 GiB), and the per-scene assemble OOMs
 * at x264 init: the MEMFS-staged clip + narration WAVs + decoder + filtergraph
 * already fill most of the gigabyte. 3 GiB clears it while staying under the
 * 4 GiB wasm32 ceiling; if a device refuses a SharedArrayBuffer that large,
 * `getFFmpeg()` (src/lib/export/ffmpeg.ts) already falls back to the ST core.
 *
 * See `stories/inprogress/studio/03g-per-scene-clip-slicing.md` (multithreading).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const FILE = 'node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.js'

const EDITS = [
  {
    from: 'worker=new Worker(new URL("ffmpeg-core.worker.js",import.meta.url))',
    to: 'worker=new Worker(new URL("ffmpeg-core.worker.js",import.meta.url),{type:"module"})',
  },
  {
    from: 'worker=new Worker(pthreadMainJs)',
    to: 'worker=new Worker(pthreadMainJs,{type:"module"})',
  },
  {
    // 1 GiB → 3 GiB. initial === maximum on the shared memory, so this default
    // is the only heap the multithreaded core will ever have.
    from: 'INITIAL_MEMORY=Module["INITIAL_MEMORY"]||1073741824',
    to: 'INITIAL_MEMORY=Module["INITIAL_MEMORY"]||3221225472',
  },
]

if (!existsSync(FILE)) {
  // core-mt not installed (e.g. a checkout that doesn't need it) — nothing to do.
  console.log(`[patch-core-mt] ${FILE} not found; skipping.`)
  process.exit(0)
}

let src = readFileSync(FILE, 'utf8')
let changed = 0
for (const { from, to } of EDITS) {
  if (src.includes(to)) continue // already patched
  if (!src.includes(from)) {
    console.error(
      `[patch-core-mt] target not found:\n  ${from}\n` +
        `core-mt may have changed — re-check the worker-creation fix.`,
    )
    process.exit(1)
  }
  src = src.split(from).join(to)
  changed++
}

if (changed) {
  writeFileSync(FILE, src)
  console.log(`[patch-core-mt] applied ${changed} patch(es).`)
} else {
  console.log('[patch-core-mt] already patched.')
}
