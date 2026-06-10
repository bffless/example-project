# Transcript search (find-by-meaning, grab-then-place)

**Date:** 2026-06-10
**Status:** Approved

## What

Let the producer search the whole talk by meaning — "where am I excited", "where
do I say it's time for a bike ride" — and get back timestamped spans of the
original transcript. Each result can be **previewed** (play the original audio
for that span) and **grabbed**: grabbing loads the span as a pending clip,
exactly like finishing a drag-select on the Original pane today, then a click on
a New-pane gap drops it (routed to whichever scene owns the drop time).

## Why

The Build diff is windowed to one scene; content you half-remember may live
anywhere in a 45-minute talk. The transcript with word timestamps is already in
the browser, and the pipeline + LLM plumbing already exists — no index, no
vector store. One prompt over the text is enough at this size.

## Design (approach A: sync LLM pipeline, director plumbing)

### API — `POST /api/search-transcript`

Request (browser → BFFless pipeline):

```jsonc
{
  "query": "where I'm excited",
  "transcript": "[0:00] words …\n[0:08] more words …",  // timedTranscript() lines
  "duration": 312.4
}
```

The transcript is the same compact `[m:ss] words` shaping `timedTranscript()`
in `src/lib/director.ts` already builds for the director — segment-level lines,
not word-level JSON, so a 45-minute talk stays far under the 1 MB edge body cap.

Response:

```jsonc
{ "results": [ { "start": 84, "end": 97, "snippet": "it's time to go for a bike ride…", "reason": "literal match" } ] }
```

The pipeline calls **Gemini 3.1 Pro on Replicate, text-only** (no contact
sheets). System prompt: no fancy search — read the transcript, return matches
for the user's query as strict JSON `[{start, end, snippet, reason}]`, times in
original-video seconds, empty array if nothing matches. **Sync**, not the 03f
fire-and-poll jobs flow: text-only prompts return in seconds; fall back to the
job pattern only if live testing shows timeouts.

### Pure logic — `src/lib/search.ts` (+ `search.test.ts`)

Mirrors the `director.ts` split, shared by mock and real (the golden rule):

- `buildSearchRequest(query, words, duration)` — reuses `timedTranscript()`.
- `toSearchHits(raw, duration)` — tolerant JSON coercion: clamp every
  `start`/`end` into `[0, duration]`, force `end > start`, drop slivers
  (< ~0.3 s) and malformed entries, sort ascending, cap the count (~20).
- `SearchHit = { start, end, snippet, reason }`. The page annotates each hit
  with the owning scene's title for display.

### MSW mock first — `src/mocks/handlers.ts`

`POST /api/search-transcript` under `MOCK_STUDIO`: a deterministic fixture —
naive case-insensitive keyword match of the query words against the transcript
lines, emitting each matching line's window as a hit — so the whole UI is
exercisable offline in the real response shape.

### RTK Query — `src/store/studioApi.ts`

`searchTranscript: builder.mutation<SearchResponse, SearchRequest>` — plain
JSON POST, `credentials: 'include'`, same as `narrate`/`voiceSay` (the sync
mutations). **Nothing persists**: query, results, and loading state are
transient UI. No `studioSlice` changes — search is cheap to re-run and stored
results would go stale as cuts change.

### UI — `TranscriptDiff.tsx` toolbar (same pattern as "＋ Add snippet")

- A **"⌕ Search"** toolbar button, shown when the viewer is editable and an
  `onSearch` callback is wired (the Build workspace).
- Opens a sticky bar: query input + **Search** (disabled while blank) + Cancel
  (Esc). Submitting calls `onSearch(query)` (the page wires it to the mutation
  with the full-talk words from Redux) and renders a **results list** under the
  bar.
- Each result row: time range (`clockLabel`), owning scene title, the matched
  snippet, the model's one-line reason, and two actions:
  - **▶ Play** — plays the original audio for the span through the existing
    hidden `<audio>` + `claimPlayback`, stopping at the hit's `end` (its own
    stop bound — not clamped to the current scene window, since hits are
    whole-talk).
  - **Grab** — sets the existing `pendingClip` to the hit's span: the New pane
    enters today's place mode (gaps glow, footprint preview, click drops, Esc
    cancels). Dropping routes through `onAdoptOriginal` → the scene owning the
    drop time. Zero new insert machinery.
- One placement gesture at a time: grabbing a result cancels a pending snippet
  and vice versa, same as the existing rules.

### Live pipeline (BFFless)

New proxy rule for `/api/search-transcript`: `replicate` handler running
`google/gemini-3.1-pro` with the system prompt + `input.query` +
`input.transcript` (Replicate string inputs are expressions — quote literals),
then coerce/clamp server-side mirroring `toSearchHits`. No `auth_required` /
`rate_limit` (deferred to story 07, like the other studio rules). Needs the
project Replicate token (already set). Note the rule id in the story when
built.

### Tests

- `src/lib/search.test.ts` — request shaping; coercion edges: out-of-bounds,
  reversed spans, slivers, non-array/garbage JSON, cap.
- `TranscriptDiff.test.tsx` — open bar → submit query → results render →
  Grab → New-pane click fires `onAdoptOriginal` with the hit's span; Esc
  cancels; grab cancels a pending snippet.

## Iteration 2 — result sets (same day, after first take)

The one-line result rows weren't visual enough. Each hit is now a **set**: a
full-width block above both panes (spanning the combined width — the panes are
out of room) showing the hit's `start`–`end` stamp, scene title, reason, ▶ Play,
and the **actual transcript words for the span** laid out as selectable word
chips. The producer **drag-selects words inside the set** — the same gesture as
the Original pane — and on release the selected words' span is grabbed into the
existing `pendingClip` place mode (snapped to word boundaries:
`firstWord.start → lastWord.end`). The Grab button is gone; the selection *is*
the grab. No thumbnails in sets.

Wiring: the page annotates each hit with its `words` (the slice of the full
transcript overlapping the hit), since the diff viewer only holds the scene
slice. Selection starting in a set cancels a pending snippet (one placement
gesture at a time), and a plain selection while a clip is already grabbed
starts over — mirroring the Original pane's semantics.

## Out of scope

- Persisting search history/results.
- Client-side fuzzy text matching (possible later additive fast path).
- Searching the visuals (contact sheets) or the New-pane narration.
- Auth/rate-limiting on the new rule (story 07).
- Shift-click extension of a set selection (drag covers it; revisit if missed).
