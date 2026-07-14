import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { VideoEmbed } from '../components/VideoEmbed'
import { CommentsSection } from '../components/CommentsSection'
import { CodeFile } from '../components/CodeFile'
import { Endpoints, HandlerChain, type EndpointSpec, type ChainStep } from '../components/Endpoint'
import { RulesAsCode } from '../components/RulesAsCode'
import { COMMENTS_GET_RULE, COMMENTS_POST_RULE, COMMENTS_SCHEMA } from '../lib/ruleFiles'
import { EPISODES } from '../lib/episodes'

const ENDPOINTS: EndpointSpec[] = [
  {
    method: 'GET',
    path: '/api/comments',
    summary: 'Returns every comment as { comments: [...] } — the shape the hook expects.',
  },
  {
    method: 'POST',
    path: '/api/comments',
    summary: 'Appends a comment and returns the updated list in the same response.',
  },
]

const CHAIN: ChainStep[] = [
  {
    handler: 'form_handler',
    detail: 'Requires a name and a comment. Anything else in the body is ignored.',
  },
  {
    handler: 'data_create',
    detail: (
      <>
        Writes the row — taking <code className="font-mono text-[13px]">guest_id</code> from the
        query string rather than the body, so a visitor can't post as someone else by editing the
        payload.
      </>
    ),
  },
  {
    handler: 'data_query',
    detail: 'Re-reads the table, now including the comment that was just written.',
  },
  {
    handler: 'response_handler',
    detail: 'Returns that list — so posting and refreshing are a single round-trip.',
  },
]

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

      <Section eyebrow="— The implementation" title={<>The rules behind the wall<Dot /></>}>
        <p className="mb-8 max-w-3xl text-[16px] leading-relaxed text-ink-soft">
          <code className="font-mono text-[15px] text-ink">useBffState('/api/comments')</code> is
          the entire client. These two files are the entire server — the real ones, imported from
          the rule set this repo deploys.
        </p>

        <Endpoints endpoints={ENDPOINTS} />

        <h3 className="mt-12 mb-5 font-serif text-[26px] leading-[1.1] text-ink">
          What a new comment runs through
        </h3>
        <HandlerChain
          steps={CHAIN}
          note="The read route is the last two steps of the write route. That symmetry is what lets the hook treat a POST's response as the new state."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <CodeFile
            file={COMMENTS_POST_RULE}
            collapseAfter={22}
            caption="Four handlers, no server code. The response_handler's body is a template — {{{steps.list_comments}}} interpolates the query's rows straight into the JSON."
          />
          <div className="flex flex-col gap-6">
            <CodeFile
              file={COMMENTS_GET_RULE}
              collapseAfter={14}
              caption="The read half: query the table, wrap it in { comments: [...] }."
            />
            <CodeFile
              file={COMMENTS_SCHEMA}
              caption="Three columns. Adding a fourth means editing this file — the table follows on the next deploy."
            />
          </div>
        </div>

        <RulesAsCode setName="api-backend" />
      </Section>

      <Section eyebrow="— Watch" title={<>Ship a comment system<Dot /></>} divider={false}>
        <VideoEmbed episodes={EPISODES.comments} />
      </Section>
    </>
  )
}
