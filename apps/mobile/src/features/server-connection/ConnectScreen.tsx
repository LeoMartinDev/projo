import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from 'react-native'

import { Button } from '../../shared/ui/Button.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { Screen } from '../../shared/ui/Screen.tsx'
import { TextField } from '../../shared/ui/TextField.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useServerConnection } from './ServerConnection.tsx'

/**
 * Type the server URL; connecting checks its `/health` before keeping it (§26.3). Or scan the code
 * of "Connect a device", which carries the server URL (§14).
 */
export const ConnectScreen = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { gate, connect, connecting, connectError } = useServerConnection()
  const [input, setInput] = useState(gate.kind === 'disconnected' ? (gate.url ?? '') : '')
  const error = connectError ?? (gate.kind === 'disconnected' ? gate.error : undefined)
  const submit = () => connect(input)

  return (
    <Screen>
      <Text accessibilityRole="header" style={textStyles.title}>
        {t('mobile.connect.title')}
      </Text>
      <TextField
        accessibilityLabel={t('mobile.connect.urlLabel')}
        autoCapitalize="none"
        autoComplete="url"
        editable={!connecting}
        inputMode="url"
        onChangeText={setInput}
        onSubmitEditing={submit}
        placeholder={t('mobile.connect.urlPlaceholder')}
        returnKeyType="go"
        textContentType="URL"
        value={input}
      />
      <ErrorLine error={error} />
      <Button busy={connecting} label={t('mobile.connect.submit')} onPress={submit} />
      <Button
        label={t('mobile.signIn.scan')}
        onPress={() => router.push('/scan')}
        variant="secondary"
      />
    </Screen>
  )
}
