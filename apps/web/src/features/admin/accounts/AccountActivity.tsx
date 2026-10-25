import { useTranslation } from 'react-i18next'

import type { AdminAccountDto } from '@projo/shared/api/accounts'

import { formatRelative } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { useNow } from '../../../shared/ui/use-now.ts'

/** "En lecture" (green dot) or the last activity, then the last device (artboard `AdminAccounts`). */
export const AccountActivity = ({ account }: { account: AdminAccountDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  return (
    <span className="acc-activity">
      <span className="acc-activity__when">
        {account.playing ? <span className="dot dot--ok" aria-hidden="true" /> : undefined}
        {account.playing
          ? t('admin.accounts.playing')
          : account.lastSeenAt === undefined
            ? t('admin.accounts.neverSeen')
            : formatRelative(account.lastSeenAt, locale, now)}
      </span>
      {account.lastDeviceName === undefined ? undefined : (
        <span className="acc-activity__device">{account.lastDeviceName}</span>
      )}
    </span>
  )
}
