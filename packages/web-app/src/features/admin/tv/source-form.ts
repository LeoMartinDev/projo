import {
  type AdminTvSourceDto,
  type CreateTvSourceBody,
  DEFAULT_FREEBOX_ADDRESS,
  freeboxAddressSchema,
  limitFromAccount,
  type TvSourceKind,
  tvHttpUrlSchema,
  tvMaxConnectionsSchema,
  tvUserAgentSchema,
  type UpdateTvSourceBody,
  xtreamCredentialSchema,
  xtreamServerUrlSchema,
} from '@projo/shared/api/tv'

/**
 * The fields of a TV source's form, every kind's (§29.6). URLs of an `m3u` source come back
 * masked (§29.7): on an existing source a URL field starts empty and, left empty, keeps the
 * stored one; `removeGuide` asks to drop the guide. A Freebox's address holds no secret: it
 * starts with the stored one (the default on a new source). An Xtream source's server URL comes
 * back as its origin (it starts with it); its username and password never come back: their fields
 * start empty and, left empty, keep the stored ones. Its connection limit is its account's.
 */
export type SourceForm = {
  kind: TvSourceKind
  name: string
  playlistUrl: string
  guideUrl: string
  removeGuide: boolean
  userAgent: string
  address: string
  serverUrl: string
  username: string
  password: string
  maxConnections: string
}

export type SourceField =
  | 'name'
  | 'playlistUrl'
  | 'guideUrl'
  | 'userAgent'
  | 'address'
  | 'serverUrl'
  | 'username'
  | 'password'
  | 'maxConnections'

export const emptySourceForm: SourceForm = {
  kind: 'm3u',
  name: '',
  playlistUrl: '',
  guideUrl: '',
  removeGuide: false,
  userAgent: '',
  address: DEFAULT_FREEBOX_ADDRESS,
  serverUrl: '',
  username: '',
  password: '',
  maxConnections: '',
}

const storedSettingsOf = (settings: AdminTvSourceDto['settings']): Partial<SourceForm> => {
  switch (settings.kind) {
    case 'm3u':
      return { userAgent: settings.userAgent ?? '' }
    case 'xtream':
      return { serverUrl: settings.serverUrl }
    case 'freebox':
      return { address: settings.address }
  }
}

/** The form of a stored source: its name, kind, unmasked settings and limit; URLs empty (kept). */
export const sourceFormOf = (source: AdminTvSourceDto): SourceForm => ({
  ...emptySourceForm,
  kind: source.kind,
  name: source.name,
  ...storedSettingsOf(source.settings),
  maxConnections: source.maxConnections === undefined ? '' : String(source.maxConnections),
})

const parseLimit = (text: string): number | undefined => {
  const trimmed = text.trim()
  if (!/^\d+$/u.test(trimmed)) return undefined
  return tvMaxConnectionsSchema.safeParse(Number(trimmed)).data
}

/** Fields of the form's kind whose value cannot be sent; `creating`: the playlist URL is required. */
export const invalidSourceFields = (
  form: SourceForm,
  { creating }: { creating: boolean },
): ReadonlySet<SourceField> => {
  const invalid = new Set<SourceField>()
  const name = form.name.trim()
  if (name === '' || name.length > 100) invalid.add('name')
  if (form.kind === 'freebox') {
    if (!freeboxAddressSchema.safeParse(form.address).success) invalid.add('address')
  } else if (form.kind === 'xtream') {
    if (!xtreamServerUrlSchema.safeParse(form.serverUrl).success) invalid.add('serverUrl')
    for (const field of ['username', 'password'] as const)
      if (
        (creating || form[field] !== '') &&
        !xtreamCredentialSchema.safeParse(form[field]).success
      )
        invalid.add(field)
  } else {
    if (
      (creating || form.playlistUrl.trim() !== '') &&
      !tvHttpUrlSchema.safeParse(form.playlistUrl).success
    )
      invalid.add('playlistUrl')
    if (form.guideUrl.trim() !== '' && !tvHttpUrlSchema.safeParse(form.guideUrl).success)
      invalid.add('guideUrl')
    if (form.userAgent.trim() !== '' && !tvUserAgentSchema.safeParse(form.userAgent).success)
      invalid.add('userAgent')
  }
  if (
    !limitFromAccount(form.kind) &&
    form.maxConnections.trim() !== '' &&
    parseLimit(form.maxConnections) === undefined
  )
    invalid.add('maxConnections')
  return invalid
}

const optional = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const settingsOf = (form: SourceForm): CreateTvSourceBody['settings'] => {
  if (form.kind === 'freebox') return { kind: 'freebox', address: form.address.trim() }
  if (form.kind === 'xtream')
    return {
      kind: 'xtream',
      serverUrl: form.serverUrl.trim(),
      username: form.username,
      password: form.password,
    }
  const guideUrl = optional(form.guideUrl)
  const userAgent = optional(form.userAgent)
  return {
    kind: 'm3u',
    playlistUrl: form.playlistUrl.trim(),
    ...(guideUrl === undefined ? {} : { guideUrl }),
    ...(userAgent === undefined ? {} : { userAgent }),
  }
}

/** `POST /admin/tv/sources` of a valid form. */
export const toCreateBody = (form: SourceForm): CreateTvSourceBody => {
  const maxConnections = limitFromAccount(form.kind) ? undefined : parseLimit(form.maxConnections)
  return {
    name: form.name.trim(),
    settings: settingsOf(form),
    ...(maxConnections === undefined ? {} : { maxConnections }),
  }
}

const settingsPatchOf = (
  source: AdminTvSourceDto,
  form: SourceForm,
): UpdateTvSourceBody['settings'] => {
  if (source.settings.kind === 'freebox') {
    const address = form.address.trim()
    return address === source.settings.address ? undefined : { kind: 'freebox', address }
  }
  if (source.settings.kind === 'xtream') {
    const serverUrl = form.serverUrl.trim()
    const settings = {
      ...(serverUrl === source.settings.serverUrl ? {} : { serverUrl }),
      // Never returned: an empty field keeps the stored value (§29.7).
      ...(form.username === '' ? {} : { username: form.username }),
      ...(form.password === '' ? {} : { password: form.password }),
    }
    return Object.keys(settings).length === 0 ? undefined : { kind: 'xtream', ...settings }
  }
  const playlistUrl = optional(form.playlistUrl)
  const guideUrl = optional(form.guideUrl)
  const userAgent = form.userAgent.trim()
  const storedAgent = source.settings.userAgent ?? ''
  const settings = {
    ...(playlistUrl === undefined ? {} : { playlistUrl }),
    ...(guideUrl !== undefined
      ? { guideUrl }
      : form.removeGuide && source.settings.guideUrl !== undefined
        ? { guideUrl: '' as const }
        : {}),
    ...(userAgent === storedAgent ? {} : { userAgent }),
  }
  return Object.keys(settings).length === 0 ? undefined : { kind: 'm3u', ...settings }
}

/** `PATCH /admin/tv/sources/:id` of a valid form: only what changed (`{}` when nothing did). */
export const toPatchBody = (source: AdminTvSourceDto, form: SourceForm): UpdateTvSourceBody => {
  const name = form.name.trim()
  const settings = settingsPatchOf(source, form)
  const limit = form.maxConnections.trim() === '' ? undefined : parseLimit(form.maxConnections)
  return {
    ...(name === source.name ? {} : { name }),
    ...(settings === undefined ? {} : { settings }),
    ...(limitFromAccount(source.kind) || limit === source.maxConnections
      ? {}
      : { maxConnections: limit ?? ('' as const) }),
  }
}

export const isEmptyPatch = (body: UpdateTvSourceBody): boolean => Object.keys(body).length === 0
