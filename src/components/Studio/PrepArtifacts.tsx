import type { Artifact } from '../../lib/prepArtifacts'

/**
 * The "what you've produced" panel: a checklist of the artifacts prep has
 * created and — the part that's easy to lose track of — **where each lives**
 * (a persisted bucket object vs. ephemeral browser state). Derive the list with
 * `buildPrepArtifacts`; this just renders it.
 */
export function PrepArtifacts({ artifacts }: { artifacts: Artifact[] }) {
  const ready = artifacts.filter((a) => a.ready).length

  return (
    <div className="border rule bg-paper-deep/30 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="meta-label">What you've produced</p>
        <p className="font-mono text-[12px] text-ink-mute">
          {ready}/{artifacts.length} ready
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {artifacts.map((a) => (
          <li
            key={a.id}
            className="flex flex-col gap-1.5 border rule bg-paper/60 p-3"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={[
                  'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                  a.ready
                    ? 'bg-terracotta text-paper'
                    : 'border border-paper-line text-ink-faint',
                ].join(' ')}
              >
                {a.ready ? '✓' : ''}
              </span>
              <span className="text-[13.5px] font-medium text-ink">{a.label}</span>
            </div>

            <span className="text-[12px] leading-snug text-ink-soft">{a.detail}</span>

            <StorageBadge artifact={a} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A small badge: where this artifact lives and whether it's persisted. */
function StorageBadge({ artifact }: { artifact: Artifact }) {
  const { storage, ready, saved } = artifact

  // A bucket artifact that's been produced but not yet persisted is the one to
  // call out — its bytes only exist in this tab.
  const unsaved = storage === 'bucket' && ready && !saved
  const label = storage === 'browser' ? 'Browser state' : unsaved ? 'In browser — unsaved' : 'Bucket'
  const tone = !ready
    ? 'border-paper-line text-ink-faint'
    : storage === 'browser' || unsaved
      ? 'border-paper-line text-ink-mute'
      : 'border-terracotta/40 text-terracotta-ink'

  return (
    <span
      className={`mt-0.5 inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${tone}`}
    >
      <span aria-hidden="true">{storage === 'bucket' && ready && saved ? '☁' : '◐'}</span>
      {label}
    </span>
  )
}
