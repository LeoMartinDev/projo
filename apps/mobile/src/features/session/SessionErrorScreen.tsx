import { useTranslation } from 'react-i18next'
import { Text } from 'react-native'

import { errorKey } from '../../shared/i18n/errors.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Screen } from '../../shared/ui/Screen.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useSession } from './Session.tsx'

/** The account could not be read (§19 error state): try again, or sign out. */
export const SessionErrorScreen = () => {
  const { t } = useTranslation()
  const { gate, retry, retrying, signOut, signingOut } = useSession()
  if (gate.kind !== 'error') return undefined

  return (
    <Screen>
      <Text accessibilityRole="header" style={textStyles.title}>
        {t('common.errorTitle')}
      </Text>
      <Text style={textStyles.error}>{t(errorKey(gate.error.code))}</Text>
      <Button busy={retrying} label={t('common.retry')} onPress={retry} />
      <Button busy={signingOut} label={t('shell.logout')} onPress={signOut} variant="plain" />
    </Screen>
  )
}
