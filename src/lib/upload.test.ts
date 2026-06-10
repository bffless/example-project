import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { presignedUpload } from './upload'

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response
const fail = (status: number) => ({ ok: false, status }) as Response

const file = new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' })

describe('presignedUpload', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs prepare → PUT → register and returns the stored url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ uploadUrl: 'https://bucket/put', storageKey: 'source/clip.mp4' }),
      )
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({ url: 'https://cdn/source/clip.mp4' }))
    vi.stubGlobal('fetch', fetchMock)

    const url = await presignedUpload(file, '/api/uploads/source')
    expect(url).toBe('https://cdn/source/clip.mp4')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/uploads/source/prepare')
    // Step 2 PUTs the bytes straight to the presigned bucket URL.
    expect(fetchMock.mock.calls[1][0]).toBe('https://bucket/put')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT' })
    expect(fetchMock.mock.calls[1][1].credentials).toBeUndefined()
    expect(fetchMock.mock.calls[2][0]).toBe('/api/uploads/source/register')
  })

  it('reads url from nested record/data shapes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ uploadUrl: 'https://bucket/put', storageKey: 'k' }))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({ record: { url: 'https://cdn/nested' } }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await presignedUpload(file, '/api/uploads/audio')).toBe('https://cdn/nested')
  })

  it('throws when prepare fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(fail(403)))
    await expect(presignedUpload(file, '/api/uploads/source')).rejects.toThrow(
      /prepare failed \(403\)/,
    )
  })

  it('throws when prepare omits uploadUrl/storageKey', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ storageKey: 'k' })))
    await expect(presignedUpload(file, '/api/uploads/source')).rejects.toThrow(
      /missing uploadUrl\/storageKey/,
    )
  })

  it('throws when the bucket PUT fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ uploadUrl: 'https://bucket/put', storageKey: 'k' }))
      .mockResolvedValueOnce(fail(413))
    vi.stubGlobal('fetch', fetchMock)
    await expect(presignedUpload(file, '/api/uploads/source')).rejects.toThrow(
      /Bucket upload failed \(413\)/,
    )
  })

  it('throws when register returns no url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ uploadUrl: 'https://bucket/put', storageKey: 'k' }))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({}))
    vi.stubGlobal('fetch', fetchMock)
    await expect(presignedUpload(file, '/api/uploads/source')).rejects.toThrow(
      /missing url/,
    )
  })
})
