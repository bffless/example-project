import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SourceQueue } from './SourceQueue'
import type { VideoSource } from '../../store/studioSlice'

const src = (id: string, order: number, fileName: string): VideoSource => ({
  id, order, fileName, duration: 60, sourceUrl: null, audioUrl: null, audioPeaks: [], words: [],
  stageProgress: { upload: { status: 'pending' }, extract: { status: 'pending' }, transcribe: { status: 'pending' } },
})

describe('SourceQueue', () => {
  const sources = [src('v1', 0, 'a.mp4'), src('v2', 1, 'b.mp4')]

  it('lists every source by filename in order', () => {
    render(<SourceQueue sources={sources} onReorder={vi.fn()} onRemove={vi.fn()} onProcess={vi.fn()} onProcessAll={vi.fn()} busyId={null} />)
    const names = screen.getAllByTestId('source-name').map((n) => n.textContent)
    expect(names).toEqual(['a.mp4', 'b.mp4'])
  })

  it('fires onProcess with the source id', () => {
    const onProcess = vi.fn()
    render(<SourceQueue sources={sources} onReorder={vi.fn()} onRemove={vi.fn()} onProcess={onProcess} onProcessAll={vi.fn()} busyId={null} />)
    fireEvent.click(screen.getAllByRole('button', { name: /process this video/i })[0])
    expect(onProcess).toHaveBeenCalledWith('v1')
  })

  it('fires onRemove with the source id', () => {
    const onRemove = vi.fn()
    render(<SourceQueue sources={sources} onReorder={vi.fn()} onRemove={onRemove} onProcess={vi.fn()} onProcessAll={vi.fn()} busyId={null} />)
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[1])
    expect(onRemove).toHaveBeenCalledWith('v2')
  })
})
