import { useState } from 'react'
import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { VideoEmbed } from '../components/VideoEmbed'
import { ContactDialog } from '../components/ContactDialog'
import { CodeFile } from '../components/CodeFile'
import { Endpoints, HandlerChain, type EndpointSpec, type ChainStep } from '../components/Endpoint'
import { RulesAsCode } from '../components/RulesAsCode'
import { CONTACT_RULE, CONTACTS_SCHEMA, UPLOAD_RULE } from '../lib/ruleFiles'
import { EPISODES } from '../lib/episodes'

const ENDPOINTS: EndpointSpec[] = [
  {
    method: 'POST',
    path: '/api/contact',
    summary: 'Validates a submission and stores it as a row in the contacts table.',
  },
  {
    method: 'POST',
    path: '/api/uploads/contact-attachments',
    summary: 'Stores an attachment and returns its URL, which the form then submits.',
    tag: 'auth required',
  },
  {
    method: 'GET',
    path: '/api/uploads/contact-attachments/*',
    summary: 'Serves a stored attachment back. Private — a session is required to read one.',
    tag: 'auth required',
  },
]

const CHAIN: ChainStep[] = [
  {
    handler: 'form_handler',
    detail:
      'Declares the fields and which are required. A submission missing name, email, or comment is rejected before anything else runs.',
  },
  {
    handler: 'data_create',
    detail: (
      <>
        Writes the validated fields to the <code className="font-mono text-[13px]">contacts</code>{' '}
        Data Table. No ORM, no migration — the table is the schema file.
      </>
    ),
  },
]

const STEPS = [
  {
    n: '01',
    title: 'A proxy rule forwards /api/contact',
    body: 'BFFless forwards form posts to a backend route without CORS or a server of your own — just a proxy rule on the deployment.',
  },
  {
    n: '02',
    title: 'A Pipeline handles the submission',
    body: 'A handler chain validates the payload, writes it to a Data Table, and can fan out to email — all configured, not coded.',
  },
  {
    n: '03',
    title: 'Signed-in visitors can attach files',
    body: 'When authenticated, the form uploads to /api/uploads/contact-attachments first, then posts the returned attachment_url with the message.',
  },
]

export function Forms() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <PageHero
        eyebrow="EP 05 · 07 — Forms & uploads"
        title={
          <>
            A contact form with a Pipeline behind it<Dot />
          </>
        }
        lead="No backend, no inbox plumbing. Submissions run through a BFFless Pipeline that validates, stores, and notifies — and authenticated visitors get file uploads."
      >
        <button type="button" className="pill-cta" onClick={() => setOpen(true)}>
          Open the contact form
        </button>
        <a href="https://docs.bffless.app" className="pill-ghost">
          Read the docs
        </a>
      </PageHero>

      <Section eyebrow="— How it works" title={<>From submit to stored<Dot /></>}>
        <ol className="grid border-l border-t border-paper-line md:grid-cols-3">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="border-b border-r border-paper-line bg-paper p-7 md:p-8"
            >
              <span className="font-serif text-[40px] leading-none text-terracotta">{s.n}</span>
              <h3 className="mt-4 font-serif text-[20px] leading-[1.15] text-ink">{s.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">{s.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-col items-start gap-4 border border-paper-line bg-paper-deep/30 p-7 md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <p className="mb-2 meta-label">Live demo</p>
            <p className="max-w-xl text-[15px] leading-relaxed text-ink-soft">
              Open the dialog and submit a message. Log in (top-right) to reveal the file
              attachment field — it uploads before the message posts.
            </p>
          </div>
          <button type="button" className="pill-cta flex-shrink-0" onClick={() => setOpen(true)}>
            Open the contact form
          </button>
        </div>
      </Section>

      <Section eyebrow="— The implementation" title={<>The rules behind this form<Dot /></>}>
        <p className="mb-8 max-w-3xl text-[16px] leading-relaxed text-ink-soft">
          Three routes back this page, and all three are files in this repository. Below is the
          real YAML, imported straight from the rule set — not a snippet someone pasted in and
          forgot to update.
        </p>

        <Endpoints endpoints={ENDPOINTS} />

        <h3 className="mt-12 mb-5 font-serif text-[26px] leading-[1.1] text-ink">
          What a submission runs through
        </h3>
        <HandlerChain
          steps={CHAIN}
          note="Two handlers, in order. Each step's output is addressable by the next one — that's how create_record reads steps.form_validation.email."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <CodeFile
            file={CONTACT_RULE}
            caption="The route's path and method come from where the file sits: rules/api/contact/post.rule.yaml is POST /api/contact."
          />
          <div className="flex flex-col gap-6">
            <CodeFile
              file={CONTACTS_SCHEMA}
              caption="The Data Table it writes to. The rule refers to it by name — $schema:contacts — never by UUID."
            />
            <CodeFile
              file={UPLOAD_RULE}
              collapseAfter={12}
              caption="The auth_required validator is why the attachment field only appears once you sign in: an anonymous upload is refused at the edge, so the UI never has to be the thing enforcing it."
            />
          </div>
        </div>

        <RulesAsCode setName="api-backend" />
      </Section>

      <Section eyebrow="— Watch" title={<>Build the form, then add uploads<Dot /></>} divider={false}>
        <VideoEmbed episodes={[EPISODES.contactForm, EPISODES.contactUploads]} />
      </Section>

      <ContactDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
