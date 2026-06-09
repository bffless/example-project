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
  console.log(`[patch-core-mt] applied {type:"module"} to ${changed} worker call(s).`)
} else {
  console.log('[patch-core-mt] already patched.')
}
