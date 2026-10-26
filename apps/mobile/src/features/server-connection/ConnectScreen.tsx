import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../shared/ui/Button.tsx'
import { EntryScreen } from '../../shared/ui/EntryScreen.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { TextField } from '../../shared/ui/TextField.tsx'
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
    <EntryScreen image="dunes" title={t('mobile.connect.title')}>
      <TextField
        autoCapitalize="none"
        autoComplete="url"
        editable={!connecting}
        inputMode="url"
        label={t('mobile.connect.urlLabel')}
        onChangeText={setInput}
        onSubmitEditing={submit}
        placeholder={t('mobile.connect.urlPlaceholder')}
        returnKeyType="go"
        textContentType="URL"
        value={input}
      />
      <ErrorLine error={error} />
      <Button busy={connecting} label={t('mobile.connect.submit')} onPress={submit} size="large" />
      <Button
        label={t('mobile.signIn.scan')}
        onPress={() => router.push('/scan')}
        variant="secondary"
      />
    </EntryScreen>
  )
}
