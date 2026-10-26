import { useTranslation } from 'react-i18next'
import { Text } from 'react-native'

import { Button } from '../../shared/ui/Button.tsx'
import { Screen } from '../../shared/ui/Screen.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useServerConnection } from './ServerConnection.tsx'

/** Placeholder until sign-in and pairing (M6 slice 1): which server, which version. */
export const ConnectedScreen = () => {
  const { t } = useTranslation()
  const { gate, forget } = useServerConnection()
  if (gate.kind !== 'connected') return undefined

  return (
    <Screen>
      <Text accessibilityRole="header" style={textStyles.title}>
        {t('connected.title')}
      </Text>
      <Text style={textStyles.body}>
        {t('connected.server', { url: gate.url, version: gate.version })}
      </Text>
      <Button label={t('connected.changeServer')} onPress={forget} variant="secondary" />
    </Screen>
  )
}
