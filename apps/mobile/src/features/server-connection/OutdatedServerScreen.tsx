import { useTranslation } from 'react-i18next'
import { Text } from 'react-native'

import { Button } from '../../shared/ui/Button.tsx'
import { EntryScreen } from '../../shared/ui/EntryScreen.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useServerConnection } from './ServerConnection.tsx'

/** Blocking (§26.4): the server is older than this app needs. Re-checked on foreground too. */
export const OutdatedServerScreen = () => {
  const { t } = useTranslation()
  const { gate, recheck, rechecking, forget } = useServerConnection()
  if (gate.kind !== 'outdated') return undefined

  return (
    <EntryScreen image="city" title={t('mobile.outdated.title')}>
      <Text style={textStyles.body}>
        {t('mobile.outdated.body', { version: gate.version, minimumVersion: gate.minimumVersion })}
      </Text>
      <Button busy={rechecking} label={t('mobile.outdated.checkAgain')} onPress={recheck} />
      <Button label={t('mobile.changeServer')} onPress={forget} variant="secondary" />
    </EntryScreen>
  )
}
