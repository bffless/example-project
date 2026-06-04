import { useState } from 'react'
import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { VideoEmbed } from '../components/VideoEmbed'
import { ContactDialog } from '../components/ContactDialog'
import { EPISODES } from '../lib/episodes'

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

      <Section eyebrow="— Watch" title={<>Build the form, then add uploads<Dot /></>} divider={false}>
        <VideoEmbed episodes={[EPISODES.contactForm, EPISODES.contactUploads]} />
      </Section>

      <ContactDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
