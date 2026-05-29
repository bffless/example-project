import * as React from 'react'
import { useState } from 'react'
import { useBffState } from '@bffless/use-bff-state'
import './CommentsSection.css'

type Comment = {
  id: string
  name: string
  comment: string
  guest_id: string
  createdAt: string
}

type CommentsState = {
  comments: Comment[]
}

const INITIAL: CommentsState = { comments: [] }

export function CommentsSection() {
  const { data, update, error, isUninitialized, isFetching, isUpdating } =
    useBffState<CommentsState>('/api/comments', INITIAL)

  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const sorted = [...(data.comments ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitError(null)
    const trimmedName = name.trim()
    const trimmedComment = comment.trim()
    if (!trimmedName || !trimmedComment) return
    try {
      await update({
        comments: data.comments,
        name: trimmedName,
        comment: trimmedComment,
      } as unknown as CommentsState)
      setName('')
      setComment('')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to post')
    }
  }

  const loading = isUninitialized || isFetching
  const errorMessage = submitError ?? error?.message ?? null

  return (
    <section id="comments">
      <h2>Comments</h2>
      <p className="comments__intro">Leave a public comment below.</p>

      <form className="comments__form" onSubmit={onSubmit}>
        <div className="comments__field">
          <label htmlFor="comments-name">Name</label>
          <input
            id="comments-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </div>
        <div className="comments__field">
          <label htmlFor="comments-body">Comment</label>
          <textarea
            id="comments-body"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            required
            maxLength={1000}
          />
        </div>
        <div className="comments__form-footer">
          <span
            className={
              'comments__status' + (errorMessage ? ' is-error' : '')
            }
            role={errorMessage ? 'alert' : undefined}
          >
            {isUpdating && 'Posting…'}
            {errorMessage && !isUpdating && errorMessage}
          </span>
          <button
            type="submit"
            className="comments__submit"
            disabled={isUpdating}
          >
            Post comment
          </button>
        </div>
      </form>

      <ul className="comments__list" aria-busy={loading}>
        {loading && sorted.length === 0 && (
          <li className="comments__empty">Loading…</li>
        )}
        {!loading && sorted.length === 0 && (
          <li className="comments__empty">No comments yet. Be the first.</li>
        )}
        {sorted.map((c) => (
          <li key={c.id} className="comments__item">
            <div className="comments__item-head">
              <span className="comments__item-name">{c.name}</span>
              <time className="comments__item-time" dateTime={c.createdAt}>
                {formatWhen(c.createdAt)}
              </time>
            </div>
            <p className="comments__item-body">{c.comment}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
