import { formatMediaKey, type MediaKeySigner, mediaKeyMessage } from '../../core/auth/media-key.ts'

type Deps = { mediaKeySigner: Pick<MediaKeySigner, 'sign'> }

/** The media key of a bearer session (§20), handed to its client by `GET /auth/me`. */
export const issueMediaKeyFactory =
  ({ mediaKeySigner }: Deps) =>
  ({ sessionId }: { sessionId: string }): string =>
    formatMediaKey({ sessionId, signature: mediaKeySigner.sign(mediaKeyMessage(sessionId)) })

export type IssueMediaKey = ReturnType<typeof issueMediaKeyFactory>
