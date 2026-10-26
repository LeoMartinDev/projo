import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '../../shared/ui/Button.tsx'
import { EntryScreen } from '../../shared/ui/EntryScreen.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { RevealButton } from '../../shared/ui/RevealButton.tsx'
import { TextField, type TextFieldInstance } from '../../shared/ui/TextField.tsx'
import { useServerConnection } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'

/**
 * The two ways in (§26.3) once the server is known: username and password, or a code of "Connect a
 * device" (scanned or typed, §14).
 */
export const SignInScreen = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { forget } = useServerConnection()
  const { signIn } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const passwordField = useRef<TextFieldInstance | undefined>(undefined)
  const ready = username.trim() !== '' && password !== ''
  const submit = () => {
    if (ready) signIn.run({ username: username.trim(), password })
  }

  return (
    <EntryScreen image="ocean" title={t('login.title')}>
      <TextField
        autoCapitalize="none"
        autoComplete="username"
        editable={!signIn.pending}
        label={t('login.username')}
        onChangeText={setUsername}
        onSubmitEditing={() => passwordField.current?.focus()}
        returnKeyType="next"
        submitBehavior="submit"
        textContentType="username"
        value={username}
      />
      <TextField
        ref={(node) => {
          passwordField.current = node ?? undefined
        }}
        autoCapitalize="none"
        autoComplete="current-password"
        editable={!signIn.pending}
        label={t('login.password')}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        returnKeyType="go"
        secureTextEntry={!shown}
        textContentType="password"
        trail={<RevealButton onToggle={() => setShown(!shown)} shown={shown} />}
        value={password}
      />
      <ErrorLine error={signIn.error} />
      <Button
        busy={signIn.pending}
        disabled={!ready}
        label={t('login.submit')}
        onPress={submit}
        size="large"
      />
      <View style={styles.codes}>
        <View style={styles.code}>
          <Button
            label={t('mobile.signIn.scan')}
            onPress={() => router.push('/scan')}
            variant="secondary"
          />
        </View>
        <View style={styles.code}>
          <Button
            label={t('mobile.signIn.enterCode')}
            onPress={() => router.push('/pair')}
            variant="secondary"
          />
        </View>
      </View>
      <Button label={t('mobile.changeServer')} onPress={forget} variant="plain" />
    </EntryScreen>
  )
}

const styles = StyleSheet.create({
  codes: { flexDirection: 'row', gap: 10 },
  code: { flex: 1 },
})
