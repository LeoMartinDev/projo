import {
  type AdminTvSourceDto,
  type CreateTvSourceBody,
  tvHttpUrlSchema,
  tvMaxConnectionsSchema,
  tvUserAgentSchema,
  type UpdateTvSourceBody,
} from '@projo/shared/api/tv'

/**
 * The fields of a TV source's form. URLs come back masked (§29.7): on an existing source a URL
 * field starts empty and, left empty, keeps the stored one; `removeGuide` asks to drop the guide.
 */
export type SourceForm = {
  name: string
  playlistUrl: string
  guideUrl: string
  removeGuide: boolean
  userAgent: string
  maxConnections: string
}

export type SourceField = 'name' | 'playlistUrl' | 'guideUrl' | 'userAgent' | 'maxConnections'

export const emptySourceForm: SourceForm = {
  name: '',
  playlistUrl: '',
  guideUrl: '',
  removeGuide: false,
  userAgent: '',
  maxConnections: '',
}

/** The form of a stored source: its name, `User-Agent` and limit; URL fields empty (kept). */
export const sourceFormOf = (source: AdminTvSourceDto): SourceForm => ({
  ...emptySourceForm,
  name: source.name,
  userAgent: source.settings.userAgent ?? '',
  maxConnections: source.maxConnections === undefined ? '' : String(source.maxConnections),
})

const parseLimit = (text: string): number | undefined => {
  const trimmed = text.trim()
  if (!/^\d+$/u.test(trimmed)) return undefined
  return tvMaxConnectionsSchema.safeParse(Number(trimmed)).data
}

/** Fields whose value cannot be sent; `creating`: the playlist URL is required. */
export const invalidSourceFields = (
  form: SourceForm,
  { creating }: { creating: boolean },
): ReadonlySet<SourceField> => {
  const invalid = new Set<SourceField>()
  const name = form.name.trim()
  if (name === '' || name.length > 100) invalid.add('name')
  if (
    (creating || form.playlistUrl.trim() !== '') &&
    !tvHttpUrlSchema.safeParse(form.playlistUrl).success
  )
    invalid.add('playlistUrl')
  if (form.guideUrl.trim() !== '' && !tvHttpUrlSchema.safeParse(form.guideUrl).success)
    invalid.add('guideUrl')
  if (form.userAgent.trim() !== '' && !tvUserAgentSchema.safeParse(form.userAgent).success)
    invalid.add('userAgent')
  if (form.maxConnections.trim() !== '' && parseLimit(form.maxConnections) === undefined)
    invalid.add('maxConnections')
  return invalid
}

const optional = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** `POST /admin/tv/sources` of a valid form. */
export const toCreateBody = (form: SourceForm): CreateTvSourceBody => {
  const guideUrl = optional(form.guideUrl)
  const userAgent = optional(form.userAgent)
  const maxConnections = parseLimit(form.maxConnections)
  return {
    name: form.name.trim(),
    settings: {
      kind: 'm3u',
      playlistUrl: form.playlistUrl.trim(),
      ...(guideUrl === undefined ? {} : { guideUrl }),
      ...(userAgent === undefined ? {} : { userAgent }),
    },
    ...(maxConnections === undefined ? {} : { maxConnections }),
  }
}

/** `PATCH /admin/tv/sources/:id` of a valid form: only what changed (`{}` when nothing did). */
export const toPatchBody = (source: AdminTvSourceDto, form: SourceForm): UpdateTvSourceBody => {
  const name = form.name.trim()
  const playlistUrl = optional(form.playlistUrl)
  const guideUrl = optional(form.guideUrl)
  const userAgent = form.userAgent.trim()
  const storedAgent = source.settings.userAgent ?? ''
  const limit = form.maxConnections.trim() === '' ? undefined : parseLimit(form.maxConnections)
  const settings = {
    ...(playlistUrl === undefined ? {} : { playlistUrl }),
    ...(guideUrl !== undefined
      ? { guideUrl }
      : form.removeGuide && source.settings.guideUrl !== undefined
        ? { guideUrl: '' as const }
        : {}),
    ...(userAgent === storedAgent ? {} : { userAgent }),
  }
  return {
    ...(name === source.name ? {} : { name }),
    ...(Object.keys(settings).length === 0 ? {} : { settings: { kind: 'm3u', ...settings } }),
    ...(limit === source.maxConnections ? {} : { maxConnections: limit ?? ('' as const) }),
  }
}

export const isEmptyPatch = (body: UpdateTvSourceBody): boolean => Object.keys(body).length === 0
