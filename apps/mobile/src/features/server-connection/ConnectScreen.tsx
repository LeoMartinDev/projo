import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, TextInput } from 'react-native'

import { errorKey } from '../../shared/i18n/errors.ts'
import { colors, radii, sizes } from '../../shared/styles/tokens.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Screen } from '../../shared/ui/Screen.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useServerConnection } from './ServerConnection.tsx'

/** Type the server URL; connecting checks its `/health` before keeping it (§26.3). */
export const ConnectScreen = () => {
  const { t } = useTranslation()
  const { gate, connect, connecting, connectError } = useServerConnection()
  const [input, setInput] = useState(gate.kind === 'disconnected' ? (gate.url ?? '') : '')
  const error = connectError ?? (gate.kind === 'disconnected' ? gate.error : undefined)
  const submit = () => connect(input)

  return (
    <Screen>
      <Text accessibilityRole="header" style={textStyles.title}>
        {t('connect.title')}
      </Text>
      <TextInput
        accessibilityLabel={t('connect.urlLabel')}
        autoCapitalize="none"
        autoComplete="url"
        autoCorrect={false}
        editable={!connecting}
        inputMode="url"
        keyboardAppearance="dark"
        onChangeText={setInput}
        onSubmitEditing={submit}
        placeholder={t('connect.urlPlaceholder')}
        placeholderTextColor={colors.textPlaceholder}
        returnKeyType="go"
        style={styles.field}
        textContentType="URL"
        value={input}
      />
      {/* Reserved line: the form does not jump when an error shows (AGENTS.md). */}
      <Text accessibilityLiveRegion="polite" style={[textStyles.error, styles.error]}>
        {error === undefined ? '' : t(errorKey(error.code))}
      </Text>
      <Button busy={connecting} label={t('connect.submit')} onPress={submit} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  field: {
    minHeight: sizes.control,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.borderField,
    backgroundColor: colors.field,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
  },
  error: { minHeight: 44 },
})
