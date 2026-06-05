/**
 * Presigned direct-to-bucket upload.
 *
 * A real video (or its extracted WAV) is far larger than the 1 MB body cap the
 * BFFless edge nginx enforces on every upload route, so streaming the bytes
 * through a pipeline always 413s. Instead we use BFFless's presigned flow:
 *
 *   1. prepare  → POST `${basePath}/prepare`, mint a presigned PUT URL (small
 *                 JSON, goes through the proxy)
 *   2. PUT      → the file bytes go straight to the storage bucket (no proxy,
 *                 no credentials — it's a presigned bucket URL, not our origin)
 *   3. register → POST `${basePath}/register`, verify the object + write the
 *                 upload record; the response is the record flat at top level
 *
 * The same flow serves both the source video (`/api/uploads/source`) and the
 * extracted audio (`/api/uploads/audio`); `basePath` selects the route.
 *
 * NOTE: the bucket must allow PUT from the site origin (CORS) or the browser
 * blocks step 2. auth_required is temporarily off on the studio routes for local
 * dev — restored in story 07's billing gate.
 */

type PrepareResponse = {
  uploadUrl?: string
  storageKey?: string
  originalName?: string
}

/** The register response — the upload record, read flexibly like ContactDialog. */
type RegisterResponse = {
  url?: string
  data?: { url?: string }
  record?: { url?: string }
}

/**
 * Upload `file` to a storage bucket via the presigned flow at `basePath`
 * (e.g. `/api/uploads/source`). Returns the stored URL later stages reference
 * server-side. Throws with a descriptive message if any step fails.
 */
export async function presignedUpload(file: File, basePath: string): Promise<string> {
  const prepRes = await fetch(`${basePath}/prepare`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name }),
  })
  if (!prepRes.ok) throw new Error(`Upload prepare failed (${prepRes.status})`)
  const prep = (await prepRes.json()) as PrepareResponse
  if (!prep.uploadUrl || !prep.storageKey) {
    throw new Error('Prepare response missing uploadUrl/storageKey')
  }

  // Direct PUT to the bucket. No `credentials` — presigned bucket URL.
  const putRes = await fetch(prep.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!putRes.ok) throw new Error(`Bucket upload failed (${putRes.status})`)

  const regRes = await fetch(`${basePath}/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storageKey: prep.storageKey,
      originalName: prep.originalName ?? file.name,
    }),
  })
  if (!regRes.ok) throw new Error(`Upload register failed (${regRes.status})`)
  const reg = (await regRes.json()) as RegisterResponse
  const url = reg.url ?? reg.data?.url ?? reg.record?.url
  if (!url) throw new Error('Register response missing url')
  return url
}
