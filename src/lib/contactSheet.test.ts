import { describe, it, expect } from 'vitest'
import {
  MAX_INTERVAL_SECONDS,
  MAX_SHEETS,
  TILE_COLUMNS,
  PREFERRED_CELLS_PER_SHEET,
  MAX_CELLS_PER_SHEET,
  MAX_FRAMES,
  frameCount,
  cellsPerSheet,
  sampleTimes,
  chunk,
  gridDimensions,
  planContactSheet,
  clockLabel,
} from './contactSheet'

/** Largest gap between consecutive timestamps (the spacing that matters). */
const maxGap = (times: number[]) =>
  times.slice(1).reduce((m, t, i) => Math.max(m, t - times[i]), 0)

/** How many sheets a plan tiles into. */
const sheetCount = (p: { times: number[]; perSheet: number }) =>
  p.perSheet > 0 ? Math.ceil(p.times.length / p.perSheet) : 0

describe('frameCount (ideal 30s coverage, uncapped)', () => {
  it('scales with clip length at one frame per 30s', () => {
    expect(frameCount(60)).toBe(2)
    expect(frameCount(45 * 60)).toBe(90)
    expect(frameCount(90)).toBe(3)
  })

  it('is uncapped — the cap is applied by the plan, not here', () => {
    expect(frameCount(2 * 60 * 60)).toBe(240)
    expect(frameCount(10 * 60 * 60)).toBeGreaterThan(MAX_FRAMES)
  })

  it('is at least one frame for any real clip, zero for invalid', () => {
    expect(frameCount(15)).toBe(1)
    expect(frameCount(0)).toBe(0)
    expect(frameCount(-10)).toBe(0)
    expect(frameCount(NaN)).toBe(0)
  })
})

describe('cellsPerSheet', () => {
  it('prefers the 3×3 sheet when frames fit in ≤10 of them', () => {
    expect(cellsPerSheet(60)).toBe(PREFERRED_CELLS_PER_SHEET) // 7 sheets of 9
    expect(cellsPerSheet(90)).toBe(PREFERRED_CELLS_PER_SHEET) // exactly 10 sheets of 9
  })

  it('packs more cells (up to the max) to stay within 10 sheets', () => {
    expect(cellsPerSheet(100)).toBe(10) // 10 sheets of 10
    expect(cellsPerSheet(120)).toBe(MAX_CELLS_PER_SHEET) // 10 sheets of 12
  })

  it('never exceeds the per-sheet max, never drops below preferred (unless tiny)', () => {
    expect(cellsPerSheet(1000)).toBe(MAX_CELLS_PER_SHEET)
    expect(cellsPerSheet(6)).toBe(6) // a short clip: one sheet of 6, not 9 empty-ish
  })

  it('always keeps the sheet count within MAX_SHEETS', () => {
    for (let total = 1; total <= MAX_FRAMES; total++) {
      expect(Math.ceil(total / cellsPerSheet(total))).toBeLessThanOrEqual(MAX_SHEETS)
    }
  })

  it('is zero for no frames', () => {
    expect(cellsPerSheet(0)).toBe(0)
  })
})

describe('sampleTimes', () => {
  it('returns evenly spaced, bucket-centred timestamps', () => {
    expect(sampleTimes(100, 5)).toEqual([10, 30, 50, 70, 90])
  })

  it('keeps every timestamp strictly inside the clip', () => {
    const times = sampleTimes(100, 5)
    expect(times[0]).toBeGreaterThan(0)
    expect(times[times.length - 1]).toBeLessThanOrEqual(100 - 0.05)
  })

  it('clamps the final frame just shy of the end on tiny clips', () => {
    expect(sampleTimes(1, 1)).toEqual([0.5])
    expect(sampleTimes(0.05, 1)).toEqual([0])
  })

  it('returns empty for invalid input', () => {
    expect(sampleTimes(0, 5)).toEqual([])
    expect(sampleTimes(100, 0)).toEqual([])
    expect(sampleTimes(NaN, 5)).toEqual([])
  })
})

describe('chunk', () => {
  it('splits into runs of at most size, last one short', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk(Array.from({ length: 20 }, (_, i) => i), 9).map((c) => c.length)).toEqual([
      9, 9, 2,
    ])
  })

  it('handles empty and oversized sizes', () => {
    expect(chunk([], 9)).toEqual([])
    expect(chunk([1, 2], 9)).toEqual([[1, 2]])
    expect(chunk([1, 2], 0)).toEqual([[1, 2]])
  })
})

describe('gridDimensions', () => {
  it('fixes columns at TILE_COLUMNS and grows rows for height', () => {
    expect(gridDimensions(9)).toEqual({ cols: TILE_COLUMNS, rows: 3 })
    expect(gridDimensions(12)).toEqual({ cols: TILE_COLUMNS, rows: 4 })
    expect(gridDimensions(7)).toEqual({ cols: TILE_COLUMNS, rows: 3 })
    expect(gridDimensions(6)).toEqual({ cols: 3, rows: 2 })
  })

  it('uses fewer columns only when there are fewer frames', () => {
    expect(gridDimensions(2)).toEqual({ cols: 2, rows: 1 })
    expect(gridDimensions(1)).toEqual({ cols: 1, rows: 1 })
  })

  it('always has enough cells and never exceeds the column count', () => {
    for (const n of [1, 5, 7, 9, 12]) {
      const { cols, rows } = gridDimensions(n)
      expect(cols).toBeLessThanOrEqual(TILE_COLUMNS)
      expect(cols * rows).toBeGreaterThanOrEqual(n)
    }
  })

  it('is empty for no frames', () => {
    expect(gridDimensions(0)).toEqual({ cols: 0, rows: 0 })
  })
})

describe('planContactSheet — balancing coverage, detail, and the 10-image cap', () => {
  it('holds 30s spacing and 9-cell sheets up to 45 min', () => {
    const plan = planContactSheet(45 * 60)
    expect(plan.times.length).toBe(90)
    expect(plan.perSheet).toBe(PREFERRED_CELLS_PER_SHEET)
    expect(sheetCount(plan)).toBe(MAX_SHEETS) // exactly 10
    expect(maxGap(plan.times)).toBeLessThanOrEqual(MAX_INTERVAL_SECONDS)
  })

  it('packs cells 9→12 to keep 30s within 10 sheets at 45–60 min', () => {
    const plan = planContactSheet(60 * 60)
    expect(plan.times.length).toBe(120)
    expect(plan.perSheet).toBe(MAX_CELLS_PER_SHEET)
    expect(sheetCount(plan)).toBe(MAX_SHEETS)
    expect(maxGap(plan.times)).toBeLessThanOrEqual(MAX_INTERVAL_SECONDS)
  })

  it('caps the frame budget and relaxes spacing past 60 min', () => {
    const plan = planContactSheet(90 * 60)
    expect(plan.times.length).toBe(MAX_FRAMES) // capped at 120
    expect(sheetCount(plan)).toBe(MAX_SHEETS)
    expect(plan.interval).toBeGreaterThan(MAX_INTERVAL_SECONDS) // 45s
    expect(plan.interval).toBeCloseTo(45, 5)
  })

  it('never exceeds the image cap across a wide range of durations', () => {
    for (const mins of [1, 5, 17, 30, 45, 50, 60, 75, 90, 180]) {
      expect(sheetCount(planContactSheet(mins * 60))).toBeLessThanOrEqual(MAX_SHEETS)
    }
  })

  it('keeps full 30s coverage for any clip up to 60 min', () => {
    for (const mins of [1, 5, 17, 30, 45, 55, 60]) {
      expect(maxGap(planContactSheet(mins * 60).times)).toBeLessThanOrEqual(MAX_INTERVAL_SECONDS)
    }
  })

  it('packs a short clip into a single sheet', () => {
    const plan = planContactSheet(3 * 60)
    expect(plan.times.length).toBe(6)
    expect(plan.perSheet).toBe(6)
    expect(sheetCount(plan)).toBe(1)
  })

  it('degrades gracefully on an invalid duration', () => {
    expect(planContactSheet(0)).toEqual({ interval: 0, times: [], perSheet: 0 })
  })
})

describe('clockLabel', () => {
  it('formats sub-hour times as m:ss', () => {
    expect(clockLabel(0)).toBe('0:00')
    expect(clockLabel(5)).toBe('0:05')
    expect(clockLabel(72)).toBe('1:12')
    expect(clockLabel(600)).toBe('10:00')
  })

  it('promotes to h:mm:ss past an hour', () => {
    expect(clockLabel(3600)).toBe('1:00:00')
    expect(clockLabel(3661)).toBe('1:01:01')
    expect(clockLabel(2 * 3600 + 5 * 60 + 9)).toBe('2:05:09')
  })

  it('floors fractional seconds and guards bad input', () => {
    expect(clockLabel(12.9)).toBe('0:12')
    expect(clockLabel(-3)).toBe('0:00')
    expect(clockLabel(NaN)).toBe('0:00')
  })
})
