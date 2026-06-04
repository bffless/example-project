import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { VideoEmbed } from '../components/VideoEmbed'
import { CommentsSection } from '../components/CommentsSection'
import { EPISODES } from '../lib/episodes'

const FEATURES = [
  {
    title: 'useBffState',
    body: 'One hook owns fetch, update, loading, and error state against /api/comments. The component just renders and calls update().',
  },
  {
    title: 'Data Tables',
    body: 'Posts persist to a BFFless Data Table. No schema migrations, no ORM — the table is provisioned for you.',
  },
  {
    title: 'Guest identity',
    body: 'Anonymous visitors get a stable guest ID so their posts are attributed without anyone signing in.',
  },
]

export function Comments() {
  return (
    <>
      <PageHero
        eyebrow="EP 08 — Comments"
        title={
          <>
            A live comment wall, server state and all<Dot />
          </>
        }
        lead="Server-side state from a single hook. useBffState reads and writes a BFFless Data Table, handles loading and errors, and refetches stale data — the component below is the whole thing."
      />

      <Section eyebrow="— What's underneath" title={<>State without a server<Dot /></>}>
        <div className="grid border-l border-t border-paper-line md:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="border-b border-r border-paper-line bg-paper p-7 md:p-8"
            >
              <h3 className="font-serif text-[20px] leading-[1.15] text-ink">{f.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="— Live demo">
        <div className="border border-paper-line bg-paper-deep/20 p-2 md:p-4">
          <CommentsSection />
        </div>
      </Section>

      <Section eyebrow="— Watch" title={<>Ship a comment system<Dot /></>} divider={false}>
        <VideoEmbed episodes={EPISODES.comments} />
      </Section>
    </>
  )
}
