# Transcript Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search the whole talk by meaning via one LLM call over the timestamped transcript; preview each hit's original audio and grab it into the existing place mode.

**Architecture:** Mock-first per `wire-studio-stage`: MSW handler → pure `src/lib/search.ts` (request shaping reusing `timedTranscript`, tolerant `toSearchHits` coercion) → sync RTK Query mutation → search bar + results list inside `TranscriptDiff`'s toolbar (reusing `pendingClip` place mode and the hidden original-audio element) → live BFFless rule (Gemini 3.1 Pro, text-only) swapped in last. Nothing persists to the Redux slice.

**Tech Stack:** React 19 + TS, RTK Query, MSW, Vitest + Testing Library, BFFless pipeline (`replicate` handler, `google/gemini-3.1-pro`).

**Spec:** `docs/superpowers/specs/2026-06-10-transcript-search-design.md` · **Story:** `stories/inprogress/studio/08-transcript-search.md`

---

### Task 1: Pure lib — `src/lib/search.ts` (TDD)

**Files:**
- Create: `src/lib/search.ts`
- Create: `src/lib/search.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/search.test.ts
import { describe, expect, it } from 'vitest'
import { buildSearchRequest, toSearchHits, MAX_HITS } from './search'

const words = [
  { text: 'hello', start: 0, end: 0.4 },
  { text: 'world', start: 0.5, end: 0.9 },
  { text: 'bike', start: 9, end: 9.4 },
]

describe('buildSearchRequest', () => {
  it('shapes the timed transcript and trims the query', () => {
    const req = buildSearchRequest('  bike ride ', words, 12)
    expect(req.query).toBe('bike ride')
    expect(req.duration).toBe(12)
    expect(req.transcript).toBe('[0:00] hello world\n[0:08] bike')
  })
})

describe('toSearchHits', () => {
  it('returns [] for garbage', () => {
    expect(toSearchHits(null, 10)).toEqual([])
    expect(toSearchHits('nope', 10)).toEqual([])
    expect(toSearchHits({ results: 'nope' }, 10)).toEqual([])
  })

  it('accepts both a bare array and a { results } envelope', () => {
    const hit = { start: 1, end: 3, snippet: 's', reason: 'r' }
    expect(toSearchHits([hit], 10)).toHaveLength(1)
    expect(toSearchHits({ results: [hit] }, 10)).toHaveLength(1)
  })

  it('clamps spans into [0, duration]', () => {
    const [h] = toSearchHits([{ start: -5, end: 99, snippet: '', reason: '' }], 10)
    expect(h).toMatchObject({ start: 0, end: 10 })
  })

  it('drops reversed and sliver spans and non-object entries', () => {
    expect(
      toSearchHits([{ start: 5, end: 4 }, { start: 1, end: 1.1 }, 'junk', null], 10),
    ).toEqual([])
  })

  it('sorts ascending and caps the count', () => {
    const raw = Array.from({ length: 30 }, (_, i) => ({
      start: 29 - i, end: 29 - i + 1, snippet: '', reason: '',
    }))
    const hits = toSearchHits(raw, 60)
    expect(hits).toHaveLength(MAX_HITS)
    expect(hits[0].start).toBeLessThan(hits[1].start)
  })

  it('defaults snippet/reason to empty strings', () => {
    const [h] = toSearchHits([{ start: 0, end: 2 }], 10)
    expect(h.snippet).toBe('')
    expect(h.reason).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/search.test.ts`
Expected: FAIL — `Cannot find module './search'`

- [ ] **Step 3: Implement**

```ts
// src/lib/search.ts
/**
 * Transcript search (story 08) — find-by-meaning over the whole talk.
 *
 * One text-only LLM call reads the timestamped transcript and returns spans
 * matching the producer's query ("where I sound excited", "the bike ride").
 * No index, no vector store — the transcript is small and already here.
 *
 * This is the pure half — request shaping + response coercion — shared by the
 * MSW mock and the real `/api/search-transcript` pipeline (which clamps
 * server-side too; this is the client mirror, same as `director.ts`).
 */

import { timedTranscript } from './director'
import type { TWord } from './transcriptGrid'

/** One hit: a span of the original, the words matched, and why it matched. */
export type SearchHit = {
  start: number
  end: number
  snippet: string
  reason: string
}

/** The request body the front end POSTs to `/api/search-transcript`. */
export type SearchRequest = {
  query: string
  /** Timestamped transcript text (see `timedTranscript`). */
  transcript: string
  /** Source clip duration, so the model (and clamps) know the bounds. */
  duration: number
}

export const MAX_HITS = 20
/** Hits shorter than this are noise — a span has to hold at least a word. */
const MIN_HIT_SECONDS = 0.3

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function buildSearchRequest(query: string, words: TWord[], duration: number): SearchRequest {
  return { query: query.trim(), transcript: timedTranscript(words), duration }
}

/**
 * Coerce the model's raw output into clean hits: accept a bare array or a
 * `{ results }` envelope, clamp every span into `[0, duration]`, drop slivers
 * and garbage, sort ascending, cap the count. Never trust the model's numbers.
 */
export function toSearchHits(raw: unknown, duration: number): SearchHit[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw as { results?: unknown } | null)?.results
  if (!Array.isArray(list)) return []
  const bound = Number.isFinite(duration) && duration > 0 ? duration : Infinity

  const hits: SearchHit[] = []
  for (const r of list) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const start = Math.min(Math.max(num(o.start), 0), bound)
    const end = Math.min(Math.max(num(o.end), 0), bound)
    if (end - start < MIN_HIT_SECONDS) continue
    hits.push({ start, end, snippet: str(o.snippet).trim(), reason: str(o.reason).trim() })
  }
  hits.sort((a, b) => a.start - b.start)
  return hits.slice(0, MAX_HITS)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/search.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/search.ts src/lib/search.test.ts
git commit -m "feat(studio): search lib — request shaping + tolerant hit coercion (story 08)"
```

---

### Task 2: MSW mock — `POST /api/search-transcript`

**Files:**
- Modify: `src/mocks/handlers.ts` (inside `studioHandlers`, after the `/api/refine-scene` handler at ~line 130)

- [ ] **Step 1: Add the handler**

```ts
  // Transcript search (story 08): deterministic keyword match over the posted
  // timedTranscript lines — each line containing a query word (≥3 chars)
  // becomes a hit spanning that line's 8s window. Real response shape:
  // { results: [{ start, end, snippet, reason }] }.
  http.post('/api/search-transcript', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      query?: string
      transcript?: string
      duration?: number
    }
    const terms = (body.query ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3)
    const results: { start: number; end: number; snippet: string; reason: string }[] = []
    for (const line of (body.transcript ?? '').split('\n')) {
      const m = /^\[(\d+):(\d{2})\]\s*(.*)$/.exec(line)
      if (!m) continue
      const startSec = Number(m[1]) * 60 + Number(m[2])
      const text = m[3]
      const term = terms.find((t) => text.toLowerCase().includes(t))
      if (!term) continue
      results.push({
        start: startSec,
        end: Math.min(startSec + 8, Math.max(body.duration ?? Infinity, startSec + 1)),
        snippet: text,
        reason: `mentions “${term}”`,
      })
    }
    return HttpResponse.json({ results: results.slice(0, 20) })
  }),
```

- [ ] **Step 2: Verify the suite still passes**

Run: `npm run test:run`
Expected: PASS (no behavior change while `MOCK_STUDIO = false`)

- [ ] **Step 3: Commit**

```bash
git add src/mocks/handlers.ts
git commit -m "feat(studio): MSW mock for /api/search-transcript (story 08)"
```

---

### Task 3: RTK Query mutation

**Files:**
- Modify: `src/store/studioApi.ts`

- [ ] **Step 1: Add the endpoint**

Add to the imports:

```ts
import type { SearchRequest } from '../lib/search'
```

Add inside `endpoints`, after `narrate` (~line 112):

```ts
    // Transcript search (story 08): one text-only LLM read of the timestamped
    // transcript → spans matching the producer's query. SYNC — no images, so
    // it returns in seconds (no 03f jobs flow). The raw blob goes through
    // `toSearchHits` at the call site; results are transient UI, never
    // persisted to the slice.
    searchTranscript: builder.mutation<unknown, SearchRequest>({
      query: (body) => ({
        url: 'api/search-transcript',
        method: 'POST',
        body,
      }),
    }),
```

Add `useSearchTranscriptMutation` to the export block at the bottom.

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/studioApi.ts
git commit -m "feat(studio): searchTranscript RTK Query mutation (story 08)"
```

---

### Task 4: Search UI in `TranscriptDiff` (TDD)

**Files:**
- Modify: `src/components/Studio/TranscriptDiff.tsx`
- Modify: `src/components/Studio/TranscriptDiff.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe` block in `TranscriptDiff.test.tsx` (the file's
`words` fixture: alpha@0, beta@2, gamma@4; duration 6; 2s rows):

```tsx
  it('search: query → results → Grab → place calls onAdoptOriginal with the hit span', async () => {
    const onAdoptOriginal = vi.fn()
    const onSearch = vi.fn().mockResolvedValue([
      { start: 2.0, end: 4.0, snippet: 'beta words', reason: 'literal match', sceneTitle: 'Scene 1' },
    ])
    render(
      <TranscriptDiff words={words} duration={6} onAdoptOriginal={onAdoptOriginal} onSearch={onSearch} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /⌕ search/i }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'bike ride' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSearch).toHaveBeenCalledWith('bike ride')
    expect(await screen.findByText(/beta words/)).toBeInTheDocument()
    expect(screen.getByText('Scene 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Grab' }))
    expect(placingBanner()).toContain('2.0s')
    fireEvent.click(screen.getAllByText('beta')[1]) // the New pane is in place mode
    expect(onAdoptOriginal).toHaveBeenCalledWith(2.0, 4.0, 2.0)
  })

  it('search: empty results render a no-matches note', async () => {
    const onSearch = vi.fn().mockResolvedValue([])
    render(<TranscriptDiff words={words} duration={6} onSearch={onSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /⌕ search/i }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText(/No matches/)).toBeInTheDocument()
  })

  it('search: grabbing a hit cancels a pending snippet (one gesture at a time)', async () => {
    const onSearch = vi.fn().mockResolvedValue([
      { start: 0, end: 2, snippet: 'alpha', reason: '' },
    ])
    render(
      <TranscriptDiff words={words} duration={6} onAddSnippet={vi.fn()} onSearch={onSearch} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /⌕ search/i }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'alpha' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByRole('button', { name: 'Grab' })
    fireEvent.click(screen.getByRole('button', { name: /add snippet/i }))
    fireEvent.change(screen.getByLabelText('Snippet text'), { target: { value: 'hello there' } })
    fireEvent.click(screen.getByRole('button', { name: 'Place' }))
    expect(placingBanner()).toContain('snippet')
    fireEvent.click(screen.getByRole('button', { name: 'Grab' }))
    expect(placingBanner()).toContain('of original audio')
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/Studio/TranscriptDiff.test.tsx`
Expected: FAIL — no `⌕ Search` button (`onSearch` prop doesn't exist)

- [ ] **Step 3: Implement in `TranscriptDiff.tsx`**

3a. Import the hit type (top of file):

```ts
import type { SearchHit } from '../../lib/search'
```

3b. Add to `Props` (after `onAddSnippet`):

```ts
  /** Search the whole talk by meaning (story 08). The page runs the query
   *  through `/api/search-transcript` over the FULL transcript (this viewer
   *  only has the scene slice) and resolves hits annotated with the owning
   *  scene's title. Omit to hide the search affordance. */
  onSearch?: (query: string) => Promise<(SearchHit & { sceneTitle?: string })[]>
```

…and `onSearch,` to the destructured props.

3c. Search state + handlers (next to the snippet state, ~line 268):

```ts
  // Transcript search (story 08): `searchOpen` shows the query bar; hits are
  // transient — closing the bar clears them. Grab feeds the hit's span into
  // the SAME pendingClip place mode as an Original-pane drag-select.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchHits, setSearchHits] = useState<(SearchHit & { sceneTitle?: string })[] | null>(null)

  const grabHit = useCallback((hit: SearchHit) => {
    setPendingSnippet(null) // one placement gesture at a time
    setHoverTime(null)
    setPendingClip({ start: hit.start, end: hit.end })
  }, [])
```

3d. Span-bounded playback. Add a stop-bound state next to `playheadSec`
(~line 459) and a `playSpan` sibling of `playFrom`; `playFrom` resets the
bound to the scene default:

```ts
  const [stopAt, setStopAt] = useState<number | null>(null)
```

In `playFrom`, before `claimPlayback(el)`, add `setStopAt(null)`.

```ts
  // Play exactly one hit's span (story 08) — its own stop bound, NOT the scene
  // window: search is whole-talk, so a hit may live in another scene.
  const playSpan = useCallback(
    (startSec: number, endSec: number) => {
      const el = audioRef.current
      if (!el) return
      if (!el.paused && playheadSec != null && playheadSec >= startSec && playheadSec < endSec) {
        el.pause() // toggle: already playing this hit
        return
      }
      claimPlayback(el)
      setStopAt(endSec)
      setPlayheadSec(startSec)
      const start = () => {
        el.currentTime = startSec
        void el.play().catch(() => {})
      }
      if (el.readyState >= 1) start()
      else el.addEventListener('loadedmetadata', start, { once: true })
    },
    [playheadSec],
  )
```

In the `timeupdate` effect (~line 491), replace the `windowEnd` check with the
override-aware bound and add `stopAt` to the deps:

```ts
      const limit = stopAt ?? windowEnd
      if (Number.isFinite(limit) && el.currentTime >= limit) {
        el.pause()
        return
      }
```

3e. Toolbar button (next to “＋ Add snippet”, same classes):

```tsx
          {onSearch && !searchOpen && (
            <button
              type="button"
              className="border rule bg-paper px-2 py-1 text-ink transition-colors hover:bg-paper-deep/40"
              onClick={() => setSearchOpen(true)}
            >
              ⌕ Search
            </button>
          )}
```

3f. Search bar + results list (right after the snippet `<form>` block,
~line 653 — same sticky-bar styling family):

```tsx
      {searchOpen && (
        <div className="border-b rule bg-paper-deep/40">
          <form
            className="flex flex-wrap items-center gap-3 px-5 py-2 text-[12.5px] text-ink-soft"
            onSubmit={(e) => {
              e.preventDefault()
              const q = searchQuery.trim()
              if (!q || !onSearch || searchBusy) return
              setSearchBusy(true)
              onSearch(q)
                .then(setSearchHits)
                .catch(() => setSearchHits([]))
                .finally(() => setSearchBusy(false))
            }}
          >
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search the talk — “where I sound excited”, “the bike ride”…"
              aria-label="Search query"
              className="min-w-48 flex-1 border rule bg-paper px-2 py-1 text-[13px] text-ink outline-none placeholder:text-ink-faint"
            />
            <button
              type="submit"
              disabled={!searchQuery.trim() || searchBusy}
              className="rounded border border-paper-line px-2 py-0.5 text-[11px] text-ink hover:bg-paper disabled:opacity-50"
            >
              {searchBusy ? 'Searching…' : 'Search'}
            </button>
            <button
              type="button"
              className="rounded border border-paper-line px-2 py-0.5 text-[11px] text-ink hover:bg-paper"
              onClick={() => {
                setSearchOpen(false)
                setSearchHits(null)
              }}
            >
              Close
            </button>
          </form>
          {searchHits && (
            <ul className="max-h-64 overflow-y-auto border-t rule">
              {searchHits.length === 0 && (
                <li className="px-5 py-2 text-[12px] text-ink-mute">
                  No matches — try different words.
                </li>
              )}
              {searchHits.map((hit, i) => (
                <li
                  key={`${hit.start}-${i}`}
                  className="flex flex-wrap items-center gap-3 border-b rule px-5 py-2 last:border-b-0"
                >
                  <span className="font-mono text-[11px] text-ink-mute">
                    {formatClock(hit.start)}–{formatClock(hit.end)}
                  </span>
                  {hit.sceneTitle && <span className="meta-label">{hit.sceneTitle}</span>}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={hit.snippet}>
                    “{hit.snippet}”
                  </span>
                  {hit.reason && (
                    <span className="text-[11px] italic text-ink-mute">{hit.reason}</span>
                  )}
                  {originalAudioUrl && (
                    <button
                      type="button"
                      className="rounded border border-paper-line px-2 py-0.5 text-[11px] text-ink hover:bg-paper"
                      onClick={() => playSpan(hit.start, hit.end)}
                    >
                      ▶ Play
                    </button>
                  )}
                  {canAdopt && (
                    <button
                      type="button"
                      className="rounded border border-paper-line px-2 py-0.5 text-[11px] text-ink hover:bg-paper"
                      onClick={() => grabHit(hit)}
                    >
                      Grab
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/components/Studio/TranscriptDiff.test.tsx`
Expected: PASS (existing + 3 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/Studio/TranscriptDiff.tsx src/components/Studio/TranscriptDiff.test.tsx
git commit -m "feat(studio): search bar + results list in the diff viewer (story 08)"
```

---

### Task 5: Wire the page — `Studio.tsx`

**Files:**
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: Add the callback**

Imports: add `buildSearchRequest`, `toSearchHits` from `'../lib/search'` and
`useSearchTranscriptMutation` from `'../store/studioApi'`.

Next to `onAddSnippet` (~line 284):

```ts
  // Transcript search (story 08): whole-talk, so it uses pipe.words (the FULL
  // transcript), not the scene slice the diff renders. Hits come back through
  // the shared coercion and get the owning scene's title for the results list.
  const [searchTranscript] = useSearchTranscriptMutation()
  const onSearch = useCallback(
    async (query: string) => {
      const raw = await searchTranscript(buildSearchRequest(query, pipe.words, duration)).unwrap()
      return toSearchHits(raw, duration).map((h) => ({
        ...h,
        sceneTitle: sceneAtTime(pipe.scenes, h.start)?.title,
      }))
    },
    [searchTranscript, pipe.words, pipe.scenes, duration],
  )
```

Pass `onSearch={onSearch}` to the `<TranscriptDiff …>` render (~line 580).

- [ ] **Step 2: Verify build + full suite**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add src/pages/Studio.tsx
git commit -m "feat(studio): wire transcript search into the Build workspace (story 08)"
```

---

### Task 6: Live BFFless pipeline + verify + docs

**Files:**
- Modify: `stories/inprogress/studio/08-transcript-search.md` (rule id)
- Modify: `stories/inprogress/studio/README.md` (status ✅)
- Memory: new `project_studio_search.md`

- [ ] **Step 1: Invoke the `bffless-pipeline` skill** and build the rule

`POST /api/search-transcript` on the j5s project, mirroring the sync voice
rules (NOT the 03f jobs flow): a `replicate` step running
`google/gemini-3.1-pro` with a prompt expression that combines the system
instruction + `input.query` + `input.transcript` (string inputs are
expressions — quote literals), temperature low. System instruction: *you are a
simple transcript search; read the timestamped transcript; return STRICT JSON
`{"results":[{"start":<sec>,"end":<sec>,"snippet":"…","reason":"…"}]}`, times
in original-video seconds within `[0, duration]`, `[]` when nothing matches,
no prose.* No `auth_required`/`rate_limit` validators (story 07).

- [ ] **Step 2: Verify live** — POST a real query + a short transcript to
`https://j5s.dev/api/search-transcript`, confirm the response parses through
`toSearchHits` (sensible spans, empty array on a nonsense query).

- [ ] **Step 3: Record** the rule id in story 08 (`rule id: ____`), flip the
README row to ✅, save a `project_studio_search.md` memory (rule id + shape).

- [ ] **Step 4: Commit**

```bash
git add stories/inprogress/studio/08-transcript-search.md stories/inprogress/studio/README.md
git commit -m "docs(studio): story 08 live — /api/search-transcript rule id + status"
```

---

### Task 7: Final verification + PR

- [ ] **Step 1:** `npm run build && npm run lint && npm run test:run` — all green.
- [ ] **Step 2:** Push and open the PR with `gh pr create` (base `main`,
title `feat(studio): transcript search — find-by-meaning, grab-then-place`),
body summarizing the spec, ending with the standard generated-with footer.
