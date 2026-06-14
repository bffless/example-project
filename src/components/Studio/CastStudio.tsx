/**
 * Cast-aware voice panel (story 10b).
 *
 * For the common single-narrator project this is exactly one name + one
 * VoiceStudio picker — no extra complexity. When the producer bumps the count
 * to 2+ a per-video speaker→person assignment grid appears below.
 */
import { useState } from 'react'
import type { Person, SavedVoice, VideoSource } from '../../store/studioSlice'
import type { SpeakerAssignments } from '../../lib/speakers'
import { uniqueSpeakers } from '../../lib/speakers'
import { VoiceStudio } from './VoiceStudio'

type Props = {
  cast: Person[]
  sources: VideoSource[]
  savedVoices: SavedVoice[]
  assignments: SpeakerAssignments
  cloning: boolean
  samplingVoice: boolean
  onPeopleCount: (n: number) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onAssign: (videoId: string, label: string, personId: string) => void
  onCloneForPerson: (personId: string, blob: Blob) => void
  onPickPresetForPerson: (personId: string, voiceId: string) => void
  onReuseForPerson: (personId: string, voiceId: string) => void
  onClearForPerson: (personId: string) => void
  onForgetForPerson: (voiceId: string) => void
  onSampleForPerson: (personId: string) => Promise<string | null>
}

const MAX_PEOPLE = 6

export function CastStudio({
  cast,
  sources,
  savedVoices,
  assignments,
  cloning,
  samplingVoice,
  onPeopleCount,
  onRename,
  onRemove,
  onAssign,
  onCloneForPerson,
  onPickPresetForPerson,
  onReuseForPerson,
  onClearForPerson,
  onForgetForPerson,
  onSampleForPerson,
}: Props) {
  // Videos that have at least one detected speaker label
  const labelledSources = cast.length >= 2
    ? sources.filter((s) => uniqueSpeakers(s.words ?? []).length > 0)
    : []

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header + people count ─────────────────────────────── */}
      <div className="border rule bg-paper p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <p className="meta-label">People across all your videos</p>
          <p className="font-mono text-[11px] text-ink-faint">
            {cast.length === 1 ? '1 person (narrator)' : `${cast.length} people`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="pill-ghost"
            disabled={cast.length <= 1}
            onClick={() => onPeopleCount(cast.length - 1)}
            aria-label="Remove a person"
          >
            −
          </button>
          <span className="w-6 text-center font-mono text-[14px] text-ink">{cast.length}</span>
          <button
            type="button"
            className="pill-ghost"
            disabled={cast.length >= MAX_PEOPLE}
            onClick={() => onPeopleCount(cast.length + 1)}
            aria-label="Add a person"
          >
            +
          </button>
          <span className="ml-2 text-[13px] text-ink-soft">
            {cast.length === 1
              ? 'Just you? Leave it at 1.'
              : 'Name each person, then assign their voice below.'}
          </span>
        </div>
      </div>

      {/* ── One block per cast person ─────────────────────────── */}
      {cast.map((person) => (
        <PersonBlock
          key={person.id}
          person={person}
          savedVoices={savedVoices}
          cloning={cloning}
          samplingVoice={samplingVoice}
          showRemove={cast.length > 1}
          onRename={(name) => onRename(person.id, name)}
          onRemove={() => onRemove(person.id)}
          onClone={(blob) => onCloneForPerson(person.id, blob)}
          onPickPreset={(voiceId) => onPickPresetForPerson(person.id, voiceId)}
          onReuse={(voiceId) => onReuseForPerson(person.id, voiceId)}
          onClear={() => onClearForPerson(person.id)}
          onForget={onForgetForPerson}
          onSample={() => onSampleForPerson(person.id)}
        />
      ))}

      {/* ── Speaker assignment grid (only when cast ≥ 2) ────────── */}
      {cast.length >= 2 && labelledSources.length > 0 && (
        <div className="border rule bg-paper p-5">
          <p className="meta-label mb-4">Map detected speakers to people</p>
          <div className="flex flex-col gap-6">
            {labelledSources.map((source) => (
              <SourceAssignment
                key={source.id}
                source={source}
                cast={cast}
                assignments={assignments}
                onAssign={onAssign}
              />
            ))}
          </div>
        </div>
      )}

      {cast.length >= 2 && labelledSources.length === 0 && (
        <div className="border rule bg-paper px-5 py-4">
          <p className="text-[13px] text-ink-mute">
            No speaker labels detected yet — transcribe your videos first and the
            assignment grid will appear here.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PersonBlock({
  person,
  savedVoices,
  cloning,
  samplingVoice,
  showRemove,
  onRename,
  onRemove,
  onClone,
  onPickPreset,
  onReuse,
  onClear,
  onForget,
  onSample,
}: {
  person: Person
  savedVoices: SavedVoice[]
  cloning: boolean
  samplingVoice: boolean
  showRemove: boolean
  onRename: (name: string) => void
  onRemove: () => void
  onClone: (blob: Blob) => void
  onPickPreset: (voiceId: string) => void
  onReuse: (voiceId: string) => void
  onClear: () => void
  onForget: (voiceId: string) => void
  onSample: () => Promise<string | null>
}) {
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState(person.name)

  function commitName() {
    setEditing(false)
    const trimmed = nameInput.trim()
    if (trimmed && trimmed !== person.name) onRename(trimmed)
    else setNameInput(person.name)
  }

  return (
    <div className="border rule bg-paper p-5">
      {/* Person header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {editing ? (
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setEditing(false); setNameInput(person.name) } }}
              className="min-w-0 flex-1 rounded-md border border-paper-line bg-paper p-1.5 font-serif text-[18px] text-ink focus:outline-none"
            />
          ) : (
            <button
              type="button"
              className="min-w-0 truncate font-serif text-[18px] text-ink hover:text-terracotta-ink"
              title="Click to rename"
              onClick={() => { setEditing(true); setNameInput(person.name) }}
            >
              {person.name}
            </button>
          )}
        </div>
        {showRemove && (
          <button
            type="button"
            className="shrink-0 font-mono text-[12px] text-ink-faint hover:text-terracotta-ink"
            onClick={onRemove}
            title="Remove this person"
          >
            Remove
          </button>
        )}
      </div>

      {/* Per-person voice picker — reuses VoiceStudio */}
      <VoiceStudio
        voice={person.voice}
        savedVoices={savedVoices}
        cloning={cloning}
        samplingVoice={samplingVoice}
        onClone={onClone}
        onPickPreset={onPickPreset}
        onReuseVoiceId={onReuse}
        onForgetVoice={onForget}
        onClearVoice={onClear}
        onGenerateSample={onSample}
      />
    </div>
  )
}

function SourceAssignment({
  source,
  cast,
  assignments,
  onAssign,
}: {
  source: VideoSource
  cast: Person[]
  assignments: SpeakerAssignments
  onAssign: (videoId: string, label: string, personId: string) => void
}) {
  const labels = uniqueSpeakers(source.words ?? [])
  return (
    <div>
      <p className="mb-2 font-mono text-[12px] text-ink-soft truncate">{source.fileName}</p>
      <div className="flex flex-col gap-2">
        {labels.map((label) => (
          <label key={label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 font-mono text-[12px] text-ink">{label}</span>
            <select
              value={assignments[source.id]?.[label] ?? ''}
              onChange={(e) => { if (e.target.value) onAssign(source.id, label, e.target.value) }}
              className="flex-1 rounded-md border border-paper-line bg-paper p-2 text-[13.5px] text-ink"
            >
              <option value="">— unassigned —</option>
              {cast.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}
