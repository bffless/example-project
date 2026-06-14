import { test, expect } from 'vitest'
import {
  uniqueSpeakers, resolvePerson, resolveSpeakerVoice, seedAssignmentsByLabel, dominantSpeaker,
} from './speakers'
import type { Person } from '../store/studioSlice'
import type { TWord } from './transcriptGrid'

const words = (...labels: string[]): TWord[] =>
  labels.map((s, i) => ({ text: 'w', start: i, end: i + 0.5, speaker: s }))

test('uniqueSpeakers returns labels in first-seen order, ignoring undefined', () => {
  expect(uniqueSpeakers(words('SPEAKER_01', 'SPEAKER_00', 'SPEAKER_01'))).toEqual([
    'SPEAKER_01', 'SPEAKER_00',
  ])
  expect(uniqueSpeakers([{ text: 'x', start: 0, end: 1 }])).toEqual([])
})

test('resolvePerson: explicit assignment wins; single-person cast is the fallback', () => {
  const cast: Person[] = [{ id: 'p1', name: 'Me', voice: null }]
  expect(resolvePerson('v1', 'SPEAKER_00', cast, {})?.id).toBe('p1')
  const two: Person[] = [...cast, { id: 'p2', name: 'Guest', voice: null }]
  expect(resolvePerson('v1', 'SPEAKER_00', two, {})).toBeNull()
  const asg = { v1: { SPEAKER_00: 'p2' } }
  expect(resolvePerson('v1', 'SPEAKER_00', two, asg)?.id).toBe('p2')
})

test('resolveSpeakerVoice returns the resolved person voice or null', () => {
  const voice = { voiceId: 'v', source: 'preset' as const, label: 'x' }
  const cast: Person[] = [{ id: 'p1', name: 'Me', voice }]
  expect(resolveSpeakerVoice('v1', 'SPEAKER_00', cast, {})).toEqual(voice)
})

test('seedAssignmentsByLabel maps the Nth label to the Nth person', () => {
  const cast: Person[] = [
    { id: 'p1', name: 'Me', voice: null },
    { id: 'p2', name: 'Guest', voice: null },
  ]
  const seeded = seedAssignmentsByLabel('v1', ['SPEAKER_00', 'SPEAKER_01'], cast, {})
  expect(seeded).toEqual({ SPEAKER_00: 'p1', SPEAKER_01: 'p2' })
})

test('dominantSpeaker picks the label covering the most of the window', () => {
  const ws = [
    { text: 'a', start: 0, end: 2, speaker: 'SPEAKER_00' },
    { text: 'b', start: 2, end: 2.4, speaker: 'SPEAKER_01' },
  ]
  expect(dominantSpeaker(ws, 0, 3)).toBe('SPEAKER_00')
  expect(dominantSpeaker(ws, 1.9, 2.5)).toBe('SPEAKER_01')
  expect(dominantSpeaker(ws, 10, 12)).toBeNull()
})
