import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SceneRefinePanel } from './SceneRefinePanel'
import type { Scene } from '../../lib/scenes'

const noop = () => {}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    index: 0,
    title: 'Opening',
    start: 0,
    end: 10,
    transcript: 'hello there',
    draftText: 'hello there',
    cuts: [],
    sheets: [{ index: 0, dataUrl: '', url: '/api/uploads/thumbnails/sheet-01.jpg', times: [0, 5] }],
    ...overrides,
  } as unknown as Scene
}

function renderPanel(scene: Scene) {
  return render(
    <SceneRefinePanel
      scene={scene}
      slicing={false}
      sheeting={false}
      refining={false}
      onSlice={noop}
      onGenerateSheets={noop}
      onRefine={noop}
      onClear={noop}
    />,
  )
}

describe('SceneRefinePanel refine gate (story 03k)', () => {
  it('disables Refine until the scene is cut, with a hint', () => {
    renderPanel(makeScene({ clipUrl: '/api/uploads/scene-clip/scene-0.mp4' })) // no clipAudioUrl
    const refine = screen.getByRole('button', { name: /refine scene/i })
    expect(refine).toBeDisabled()
    expect(refine).toHaveAttribute('title', 'Cut this scene first')
  })

  it('enables Refine when the scene has audio and sheets', () => {
    renderPanel(
      makeScene({
        clipUrl: '/api/uploads/scene-clip/scene-0.mp4',
        clipAudioUrl: '/api/uploads/audio/scene-0-audio.wav',
      }),
    )
    expect(screen.getByRole('button', { name: /refine scene/i })).toBeEnabled()
  })

  it('still hints about sheets when audio is there but sheets are not', () => {
    renderPanel(
      makeScene({
        clipAudioUrl: '/api/uploads/audio/scene-0-audio.wav',
        sheets: [],
      }),
    )
    const refine = screen.getByRole('button', { name: /refine scene/i })
    expect(refine).toBeDisabled()
    expect(refine).toHaveAttribute('title', 'Generate scene contact sheets first')
  })
})
