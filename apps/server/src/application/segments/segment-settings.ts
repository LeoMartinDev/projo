import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { SegmentProviderError } from '../../core/segments/segment.ts'
import type { SegmentSettingsStore } from '../../core/segments/settings-store.ts'
import type { SegmentSettingsAdmin, SegmentSettingsView } from './types.ts'

type Deps = {
  store: SegmentSettingsStore
  /** `createSegmentProviders(...).validateTheintrodbKey`. */
  validateTheintrodbKey: (
    key: string,
  ) => Promise<Result<void, AppError<'segment/theintrodb_key_invalid'> | SegmentProviderError>>
  clock: Clock
  logger: Logger
}

/**
 * §15 "Intros and credits": providers and their order, TheIntroDB key (never sent back: whether it is set
 * and its last 4 characters; a new one is checked against TheIntroDB before it is stored),
 * fingerprinting thresholds, contribution (`manual_only` needs the TheIntroDB key, §12.5).
 */
export const segmentSettingsAdminFactory = ({
  store,
  validateTheintrodbKey,
  clock,
  logger,
}: Deps): SegmentSettingsAdmin => {
  const view = (): SegmentSettingsView => {
    const { theintrodbApiKey, skipdbAnonymousKey: _anonymous, ...rest } = store.read()
    return {
      ...rest,
      theintrodbApiKey:
        theintrodbApiKey === undefined
          ? { configured: false }
          : { configured: true, last4: theintrodbApiKey.slice(-4) },
    }
  }

  return {
    get: view,
    update: async (input) => {
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
      return ok(view())
    },
  }
}
