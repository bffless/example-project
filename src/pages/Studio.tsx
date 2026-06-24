import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { StudioVideo } from '../components/StudioVideo'

const REPO_URL = 'https://github.com/bffless/apps/tree/main/apps/studio'

/** The top-level stepper a creator walks through, end to end. */
type Phase = {
  step: string
  title: string
  body: string
}

const PHASES: Phase[] = [
  {
    step: '01',
    title: 'Import',
    body: 'Drop in a long, rambly screen recording. The source uploads straight to a storage bucket — never streamed through a server — and its audio is extracted to a 16 kHz mono track.',
  },
  {
    step: '02',
    title: 'Prep',
    body: 'Six stages run one at a time: transcribe, build a contact sheet, clone or pick a voice, then let the master director cut the script into scenes.',
  },
  {
    step: '03',
    title: 'Build',
    body: 'Work scene by scene in a diff viewer. Refine each cut, hand-edit the segments, re-voice the script in your cloned voice, and mark it built.',
  },
  {
    step: '04',
    title: 'Export',
    body: 'Assemble the finished scenes in the browser with ffmpeg.wasm, then generate a title, synopsis, and YouTube thumbnail for the upload.',
  },
]

/** The six Prep stages — the "locked pipeline." */
type Stage = {
  n: string
  title: string
  body: string
  tech: string
}

const PREP_STAGES: Stage[] = [
  {
    n: '1',
    title: 'Upload source',
    body: 'The raw recording goes direct-to-bucket via a presigned URL, sidestepping the 1 MB edge body cap.',
    tech: 'Presigned upload',
  },
  {
    n: '2',
    title: 'Extract audio',
    body: 'A 16 kHz mono WAV is pulled from the video client-side and uploaded alongside it for transcription.',
    tech: 'Web Audio',
  },
  {
    n: '3',
    title: 'Transcribe',
    body: 'WhisperX returns a transcript with word-level timestamps — the spine every later cut snaps to.',
    tech: 'WhisperX',
  },
  {
    n: '4',
    title: 'Contact sheet',
    body: 'Interval-sampled frames are composed into one timestamped image so the director can see the footage.',
    tech: 'Browser canvas',
  },
  {
    n: '5',
    title: 'Choose your voice',
    body: 'Record a short sample to clone your own voice, reuse a saved voice_id, or pick a MiniMax preset.',
    tech: 'MiniMax cloning',
  },
  {
    n: '6',
    title: 'Master director',
    body: 'Transcript plus contact sheets go to Gemini 3.1 Pro, which returns a synopsis and scenes with draft cuts.',
    tech: 'Gemini 3.1 Pro',
  },
]

/** The backend /api/* pipelines that power Studio — all BFFless rules, no app server. */
type Pipeline = {
  endpoint: string
  title: string
  body: string
}

const PIPELINES: Pipeline[] = [
  {
    endpoint: 'POST /api/uploads/*',
    title: 'Presigned uploads & signing',
    body: 'Mints presigned URLs so big files land directly in a bucket, and signs bucket objects so Replicate models can read them.',
  },
  {
    endpoint: 'POST /api/transcribe',
    title: 'Transcription',
    body: 'Runs victor-upmeet/whisperx over the extracted audio and returns word-timestamped transcript JSON.',
  },
  {
    endpoint: 'POST /api/scenes',
    title: 'Master director',
    body: 'Feeds the transcript and signed contact sheets to google/gemini-3.1-pro to shorten and split into scenes.',
  },
  {
    endpoint: 'POST /api/refine-scene',
    title: 'Per-scene refiner',
    body: 'Re-cuts a single scene into anchored segments with flow-aware cuts, written to a non-destructive layer.',
  },
  {
    endpoint: 'POST /api/voice/clone · say · narrate',
    title: 'Voice clone & TTS',
    body: 'Clones the creator’s voice with minimax/voice-cloning, then narrates each segment via speech-2.8-turbo.',
  },
  {
    endpoint: 'POST /api/describe',
    title: 'Title & synopsis',
    body: 'Turns the final cut script into a publish-ready title and summary for the export page.',
  },
  {
    endpoint: 'POST /api/thumbnail/draft · render',
    title: 'Thumbnail generator',
    body: 'Claude Sonnet 4.6 drafts the image prompt, then google/nano-banana-2 renders the YouTube thumbnail.',
  },
  {
    endpoint: 'POST /api/search-transcript',
    title: 'Transcript search',
    body: 'A sync, text-only Gemini call that finds moments in the transcript and drops them into place.',
  },
]

export function Studio() {
  return (
    <>
      <PageHero
        eyebrow="Companion app · Built on BFFless"
        title={
          <>
            One rambly recording in, a short re-voiced video out
            <Dot />
          </>
        }
        lead="Studio is a self-contained give-away app for the BFFless platform. It turns a long screen recording into a tight short — re-voiced in your own cloned voice — using an AI master director and a chain of backend pipelines with no application server behind them."
      >
        <a href="#demo" className="pill-cta">
          Watch the demo
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="pill-ghost">
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
            />
          </svg>
          View on GitHub
        </a>
      </PageHero>

      {/* The demo video (unpublished — placeholder for now) */}
      <Section eyebrow="— The demo" title={<>See Studio cut a video, start to finish<Dot /></>}>
        <div id="demo" className="scroll-mt-20">
          <StudioVideo />
        </div>
      </Section>

      {/* Top-level phases */}
      <Section
        eyebrow="— The workflow"
        title={
          <>
            Four phases<Dot /> Import to export<Dot />
          </>
        }
      >
        <div className="grid border-l border-t border-paper-line sm:grid-cols-2">
          {PHASES.map((p) => (
            <div
              key={p.step}
              className="flex flex-col border-b border-r border-paper-line bg-paper p-7 md:p-9"
            >
              <div className="mb-5 flex items-baseline gap-3">
                <span className="font-serif text-[40px] leading-none text-terracotta">{p.step}</span>
                <h3 className="font-serif text-[24px] leading-[1.1] text-ink md:text-[26px]">
                  {p.title}
                </h3>
              </div>
              <p className="text-[15px] leading-relaxed text-ink-soft">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* The locked Prep pipeline */}
      <Section
        eyebrow="— The locked pipeline"
        title={
          <>
            Six prep stages, run one at a time<Dot />
          </>
        }
      >
        <ol className="grid gap-px border-l border-t border-paper-line md:grid-cols-3">
          {PREP_STAGES.map((s) => (
            <li
              key={s.n}
              className="flex flex-col border-b border-r border-paper-line bg-paper p-7"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-ink font-mono text-[13px] text-ink">
                  {s.n}
                </span>
                <span className="meta-label">{s.tech}</span>
              </div>
              <h3 className="font-serif text-[20px] leading-[1.1] text-ink">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-2xl text-[14px] leading-relaxed text-ink-mute">
          After prep, the creator works each scene in a diff viewer — refine the cut, hand-edit the
          segments, re-voice in their cloned voice, mark it built — then assembles the short with
          ffmpeg.wasm right in the browser.
        </p>
      </Section>

      {/* Backend pipelines */}
      <Section
        eyebrow="— The backend"
        title={
          <>
            Every feature is a BFFless pipeline<Dot />
          </>
        }
        divider={false}
      >
        <p className="mb-8 max-w-2xl text-[15px] leading-relaxed text-ink-soft md:mb-12 md:text-[17px]">
          There is no application server. Each <code className="font-mono text-[0.9em] text-terracotta-ink">/api/*</code>{' '}
          endpoint is a BFFless proxy rule that chains handlers — calling Replicate, signing bucket
          objects, and shaping responses. All 39 rules export as one set a forker can import.
        </p>
        <div className="grid border-l border-t border-paper-line sm:grid-cols-2">
          {PIPELINES.map((p) => (
            <div
              key={p.endpoint}
              className="flex flex-col border-b border-r border-paper-line bg-paper p-6 md:p-7"
            >
              <code className="mb-3 inline-block w-fit font-mono text-[12px] text-terracotta-ink">
                {p.endpoint}
              </code>
              <h3 className="font-serif text-[19px] leading-[1.15] text-ink">{p.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{p.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="pill-cta">
            Explore the source
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </Section>
    </>
  )
}
