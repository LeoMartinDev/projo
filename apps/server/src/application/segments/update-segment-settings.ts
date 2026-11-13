import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { SegmentProviderError } from '../../core/segments/segment.ts'
import type { SegmentSettingsStore } from '../../core/segments/settings-store.ts'
import type { SegmentSettings } from '../../core/settings/settings.ts'
import { segmentSettingsView, type SegmentSettingsView } from './shared/segment-settings-view.ts'

export type UpdateSegmentSettingsInput = {
  providers?: SegmentSettings['providers']
  theintrodbApiKey?: string
  fingerprint?: Partial<SegmentSettings['fingerprint']>
  contribution?: SegmentSettings['contribution']
}

export type UpdateSegmentSettingsError =
  | AppError<'segment/theintrodb_key_invalid' | 'segment/contribution_requires_key'>
  | SegmentProviderError

type Deps = {
  store: SegmentSettingsStore
  validateTheintrodbKey: (
    key: string,
  ) => Promise<Result<void, AppError<'segment/theintrodb_key_invalid'> | SegmentProviderError>>
  clock: Clock
  logger: Logger
}

export const updateSegmentSettingsFactory =
  ({ store, validateTheintrodbKey, clock, logger }: Deps) =>
  async (
    input: UpdateSegmentSettingsInput,
  ): Promise<Result<SegmentSettingsView, UpdateSegmentSettingsError>> => {
    const current = store.read()
    const newKey =
      input.theintrodbApiKey === undefined || input.theintrodbApiKey === ''
        ? undefined
        : input.theintrodbApiKey.trim()
    const nextKey = input.theintrodbApiKey === undefined ? current.theintrodbApiKey : newKey
    const contribution = input.contribution ?? current.contribution
    if (contribution === 'manual_only' && nextKey === undefined) {
      return err(
        appError(
          'segment/contribution_requires_key',
          'contributing manual markers needs a TheIntroDB API key',
        ),
      )
    }
    if (newKey !== undefined && newKey !== current.theintrodbApiKey) {
      const checked = await validateTheintrodbKey(newKey)
      if (!checked.ok) return err(checked.error)
    }
    store.write(
      {
        ...(input.providers === undefined ? {} : { providers: input.providers }),
        ...(input.theintrodbApiKey === undefined ? {} : { theintrodbApiKey: newKey }),
        ...(input.fingerprint === undefined ? {} : { fingerprint: input.fingerprint }),
        ...(input.contribution === undefined ? {} : { contribution: input.contribution }),
      },
      clock.now(),
    )
    logger.info('segment settings updated', {
      fields: Object.keys(input),
      ...(input.theintrodbApiKey === undefined
        ? {}
        : { theintrodbApiKey: newKey === undefined ? 'removed' : 'set' }),
    })
    return ok(segmentSettingsView(store))
  }

export type UpdateSegmentSettings = ReturnType<typeof updateSegmentSettingsFactory>
