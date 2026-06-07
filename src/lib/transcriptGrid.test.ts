import { describe, it, expect } from 'vitest'
import {
  buildTranscriptGrid,
  cutColumns,
  formatClock,
  gridPosition,
  segmentsPerLine,
  DEFAULT_SECONDS_PER_LINE,
  DEFAULT_SEGMENT_SECONDS,
  type TWord,
} from './transcriptGrid'

const w = (text: string, start: number, end = start + 0.2): TWord => ({ text, start, end })

describe('buildTranscriptGrid minSeconds', () => {
  it('extends the grid past the last word to span minSeconds', () => {
    // One word at 0:01, but force the grid to cover 20s at 2s/line → 10 rows.
    const lines = buildTranscriptGrid([w('hi', 1)], 2, 0.25, 20)
    expect(lines.length).toBe(10)
    expect(lines[lines.length - 1].startSec).toBe(18)
  })

  it('does not shrink a grid that already runs longer than minSeconds', () => {
    const lines = buildTranscriptGrid([w('late', 40)], 2, 0.25, 10)
    expect(lines[lines.length - 1].startSec).toBe(40)
  })
})

describe('cutColumns', () => {
  it('flags the columns whose time slice overlaps a cut', () => {
    // row at 0s, 1s cells (5 cols over 5s); cut 2–4s covers cols 2 and 3.
    const cols = cutColumns(0, 5, 1, [{ start: 2, end: 4 }])
    expect(cols).toEqual([false, false, true, true, false])
  })

  it('maps cuts onto the right row by startSec', () => {
    // row starting at 10s; a 12–13s cut hits the 3rd cell (10,11,12,...).
    const cols = cutColumns(10, 5, 1, [{ start: 12, end: 13 }])
    expect(cols).toEqual([false, false, true, false, false])
  })

  it('returns all-false when there are no cuts', () => {
    expect(cutColumns(0, 4, 1, [])).toEqual([false, false, false, false])
  })
})

describe('segmentsPerLine', () => {
  it('divides the line into segment-wide cells', () => {
    expect(segmentsPerLine(5, 1)).toBe(5)
    expect(segmentsPerLine(5, 0.25)).toBe(20)
    expect(segmentsPerLine(10, 0.5)).toBe(20)
    expect(segmentsPerLine(3, 0.25)).toBe(12)
  })
  it('defaults to 5s / 0.25s = 20 cells and guards bad input', () => {
    expect(segmentsPerLine()).toBe(20)
    expect(segmentsPerLine(5, 0)).toBe(20) // falls back to default segment
  })
})

describe('buildTranscriptGrid — quarter-second cells (default)', () => {
  it('places each word in its quarter-second slice', () => {
    // row is 5s -> 20 cells of 0.25s. 0.1->col0, 0.3->col1, 1.6->col6, 4.9->col19
    const grid = buildTranscriptGrid([w('a', 0.1), w('b', 0.3), w('c', 1.6), w('d', 4.9)])
    expect(grid).toHaveLength(1)
    const { cells } = grid[0]
    expect(cells).toHaveLength(20)
    expect(cells[0].map((x) => x.text)).toEqual(['a'])
    expect(cells[1].map((x) => x.text)).toEqual(['b'])
    expect(cells[6].map((x) => x.text)).toEqual(['c'])
    expect(cells[19].map((x) => x.text)).toEqual(['d'])
  })

  it('separates words that share a second but not a quarter', () => {
    // at 1s cells these would pile in one cell; at 0.25s they spread out
    const grid = buildTranscriptGrid([w('two', 6.0), w('words', 6.4), w('here', 6.9)])
    // second 6 is row 1 (5..10), within=1.0/1.4/1.9 -> cols 4, 5, 7
    expect(grid[1].cells[4].map((x) => x.text)).toEqual(['two'])
    expect(grid[1].cells[5].map((x) => x.text)).toEqual(['words'])
    expect(grid[1].cells[7].map((x) => x.text)).toEqual(['here'])
  })

  it('exposes the defaults', () => {
    expect(DEFAULT_SECONDS_PER_LINE).toBe(5)
    expect(DEFAULT_SEGMENT_SECONDS).toBe(0.25)
  })
})

describe('buildTranscriptGrid — configurable sizes', () => {
  it('supports one-second cells', () => {
    const grid = buildTranscriptGrid([w('a', 0.1), w('b', 1.9), w('c', 4.5)], 5, 1)
    expect(grid[0].cells).toHaveLength(5)
    expect(grid[0].cells[0].map((x) => x.text)).toEqual(['a'])
    expect(grid[0].cells[1].map((x) => x.text)).toEqual(['b'])
    expect(grid[0].cells[4].map((x) => x.text)).toEqual(['c'])
  })

  it('wraps to a new row every secondsPerLine seconds', () => {
    const grid = buildTranscriptGrid([w('r0', 2), w('r1', 5), w('r2', 10)], 5, 1)
    expect(grid).toHaveLength(3)
    expect(grid.map((l) => l.startSec)).toEqual([0, 5, 10])
    expect(grid[1].cells[0].map((x) => x.text)).toEqual(['r1'])
    expect(grid[2].cells[0].map((x) => x.text)).toEqual(['r2'])
  })

  it('keeps multiple words in the same slice, in input order', () => {
    const grid = buildTranscriptGrid([w('one', 6.05), w('two', 6.1), w('three', 6.2)], 5, 1)
    expect(grid[1].cells[1].map((x) => x.text)).toEqual(['one', 'two', 'three'])
  })

  it('emits empty rows for gaps so the grid stays continuous', () => {
    const grid = buildTranscriptGrid([w('start', 0), w('later', 12)], 5, 1)
    expect(grid).toHaveLength(3)
    expect(grid[1].cells.every((c) => c.length === 0)).toBe(true)
  })

  it('returns an empty grid for no words', () => {
    expect(buildTranscriptGrid([], 5, 0.25)).toEqual([])
  })

  it('clamps negative starts to 0 and a boundary word into the last cell', () => {
    const grid = buildTranscriptGrid([w('neg', -3), w('edge', 4.999)], 5, 1)
    expect(grid[0].cells[0].map((x) => x.text)).toEqual(['neg'])
    expect(grid[0].cells[4].map((x) => x.text)).toEqual(['edge'])
  })
})

describe('formatClock', () => {
  it('formats whole-second marks as m:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(600)).toBe('10:00')
  })
  it('floors and clamps', () => {
    expect(formatClock(9.9)).toBe('0:09')
    expect(formatClock(-4)).toBe('0:00')
  })
})

describe('gridPosition', () => {
  it('maps a time to its row + quarter-second column', () => {
    expect(gridPosition(0)).toEqual({ line: 0, col: 0 })
    expect(gridPosition(6.6)).toEqual({ line: 1, col: 6 }) // within=1.6 -> col 6
    expect(gridPosition(0.6, 5, 1)).toEqual({ line: 0, col: 0 })
    expect(gridPosition(6.6, 5, 1)).toEqual({ line: 1, col: 1 })
  })
  it('returns null before zero', () => {
    expect(gridPosition(-1)).toBeNull()
  })
})
