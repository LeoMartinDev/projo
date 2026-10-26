import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from 'react-native'

import { Button } from '../../shared/ui/Button.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { Screen } from '../../shared/ui/Screen.tsx'
import { TextField, type TextFieldInstance } from '../../shared/ui/TextField.tsx'
import { textStyles } from '../../shared/ui/text.ts'
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
  const passwordField = useRef<TextFieldInstance | undefined>(undefined)
  const submit = () => {
    if (username.trim() !== '' && password !== '')
      signIn.run({ username: username.trim(), password })
  }

  return (
    <Screen>
      <Text accessibilityRole="header" style={textStyles.title}>
        {t('login.title')}
      </Text>
      <TextField
        accessibilityLabel={t('login.username')}
        autoCapitalize="none"
        autoComplete="username"
        editable={!signIn.pending}
        onChangeText={setUsername}
        onSubmitEditing={() => passwordField.current?.focus()}
        placeholder={t('login.username')}
        returnKeyType="next"
        submitBehavior="submit"
        textContentType="username"
        value={username}
      />
      <TextField
        ref={(node) => {
          passwordField.current = node ?? undefined
        }}
        accessibilityLabel={t('login.password')}
        autoCapitalize="none"
        autoComplete="current-password"
        editable={!signIn.pending}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        placeholder={t('login.password')}
        returnKeyType="go"
        secureTextEntry
        textContentType="password"
        value={password}
      />
      <ErrorLine error={signIn.error} />
      <Button busy={signIn.pending} label={t('login.submit')} onPress={submit} />
      <Button
        label={t('mobile.signIn.scan')}
        onPress={() => router.push('/scan')}
        variant="secondary"
      />
      <Button
        label={t('mobile.signIn.enterCode')}
        onPress={() => router.push('/pair')}
        variant="secondary"
      />
      <Button label={t('mobile.changeServer')} onPress={forget} variant="plain" />
    </Screen>
  )
}
