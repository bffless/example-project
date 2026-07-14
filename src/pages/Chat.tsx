import { useCallback, useState } from 'react'
import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { VideoEmbed } from '../components/VideoEmbed'
import { ChatPanel } from '../components/ChatPopup/ChatPanel'
import { CodeFile } from '../components/CodeFile'
import { Endpoints, type EndpointSpec } from '../components/Endpoint'
import { RulesAsCode } from '../components/RulesAsCode'
import { CHAT_GET_RULE, CHAT_POST_RULE, CHAT_SKILL } from '../lib/ruleFiles'
import { EPISODES } from '../lib/episodes'

const STORAGE_KEY = 'chat_conversation_id'

const ENDPOINTS: EndpointSpec[] = [
  {
    method: 'POST',
    path: '/api/chat',
    summary: 'Calls the model, streams tokens back, and persists both sides of the exchange.',
    tag: 'streaming',
  },
  {
    method: 'GET',
    path: '/api/chat?conversationId=…',
    summary: 'Replays a thread after a reload, oldest message first.',
  },
]

const FEATURES = [
  {
    title: 'Streaming',
    body: 'Built on the Vercel AI SDK (useChat). Tokens stream in over /api/chat, proxied through BFFless to your model provider.',
  },
  {
    title: 'Persistence',
    body: 'Each conversation gets an id stored client-side; history is loaded back from the backend so the thread survives reloads.',
  },
  {
    title: 'Skills',
    body: 'The assistant can be taught skills on the BFFless side — answering questions about this very site, for instance.',
  },
]

const INLINE_PANEL_CLASS =
  'flex h-[600px] max-h-[75vh] flex-col overflow-hidden rounded-xl border border-paper-line bg-white text-left shadow-[0_20px_60px_-25px_rgba(23,21,19,0.45)]'

export function Chat() {
  const [minimized, setMinimized] = useState(false)
  const [chatKey, setChatKey] = useState(0)

  const handleNewChat = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setChatKey((k) => k + 1)
  }, [])

  return (
    <>
      <PageHero
        eyebrow="Walkthrough — AI chat"
        title={
          <>
            A streaming assistant, wired in minutes<Dot />
          </>
        }
        lead="The same chat widget that floats in the corner of this site, embedded inline. It streams responses through BFFless and remembers the conversation — no chat backend to build."
      />

      <Section eyebrow="— What's underneath" title={<>Chat, the AI SDK, and BFFless<Dot /></>}>
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

      <Section eyebrow="— Live demo" title={<>Talk to the assistant<Dot /></>}>
        <div className="mx-auto max-w-2xl">
          {minimized ? (
            <div className="flex flex-col items-center gap-4 border border-paper-line bg-paper-deep/30 p-10 text-center">
              <p className="text-[15px] text-ink-soft">The assistant is minimized.</p>
              <button type="button" className="pill-cta" onClick={() => setMinimized(false)}>
                Open the assistant
              </button>
            </div>
          ) : (
            <ChatPanel
              key={chatKey}
              containerClassName={INLINE_PANEL_CLASS}
              onClose={() => setMinimized(true)}
              onNewChat={handleNewChat}
            />
          )}
        </div>
      </Section>

      <Section eyebrow="— The implementation" title={<>One handler, one file<Dot /></>}>
        <p className="mb-8 max-w-3xl text-[16px] leading-relaxed text-ink-soft">
          Everything the assistant does — calling the model, streaming the reply, remembering the
          thread — is one <code className="font-mono text-[15px] text-ink">ai_handler</code> step.
          Streaming and persistence are settings on it, not code you write.
        </p>

        <Endpoints endpoints={ENDPOINTS} />

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <CodeFile
            file={CHAT_POST_RULE}
            caption="persistMessages turns a stateless model call into a durable conversation: BFFless opens the thread on the first message and appends every turn to the chat_messages table after it."
          />
          <div className="flex flex-col gap-6">
            <CodeFile
              file={CHAT_GET_RULE}
              caption="History replay. The browser keeps the conversation id in localStorage and asks for its messages on load."
            />
            <CodeFile
              file={CHAT_SKILL}
              collapseAfter={10}
              caption="A Skill: plain markdown, deployed with the site. It's what the assistant knows about this page — versioned per deployment, so a rollback takes its knowledge back with it."
            />
          </div>
        </div>

        <RulesAsCode setName="chat_pipelines" />
      </Section>

      <Section eyebrow="— Watch" title={<>Chat AI SDK and BFFless<Dot /></>} divider={false}>
        <VideoEmbed episodes={EPISODES.chat} />
      </Section>
    </>
  )
}
