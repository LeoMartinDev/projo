import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Failure } from '../../shared/api/failure.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { EntryScreen } from '../../shared/ui/EntryScreen.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { TextField } from '../../shared/ui/TextField.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useServerConnection } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'
import { parseTypedPairing } from './pairing-input.ts'

/**
 * The code of "Connect a device" typed by hand, for the server already chosen (§14, §26.3). A
 * pasted pairing link works too, and then names its server.
 */
export const PairCodeScreen = () => {
  const { t } = useTranslation()
  const { gate } = useServerConnection()
  const { pair } = useSession()
  const [input, setInput] = useState('')
  const [invalid, setInvalid] = useState<Failure>()
  const serverUrl = gate.kind === 'connected' ? gate.url : undefined

  const submit = () => {
    const parsed = parseTypedPairing(input)
    if (!parsed.ok) {
      pair.reset()
      setInvalid(parsed.error)
      return
    }
    const target = parsed.value.serverUrl ?? serverUrl
    if (target === undefined) return
    setInvalid(undefined)
    pair.run({ serverUrl: target, code: parsed.value.code })
  }

  return (
    <EntryScreen image="forest" pushed title={t('mobile.pair.title')}>
      <TextField
        autoCapitalize="characters"
        autoComplete="one-time-code"
        autoFocus
        editable={!pair.pending}
        label={t('mobile.pair.codeLabel')}
        onChangeText={setInput}
        onSubmitEditing={submit}
        placeholder={t('mobile.pair.codePlaceholder')}
        returnKeyType="go"
        spellCheck={false}
        style={textStyles.code}
        textContentType="oneTimeCode"
        value={input}
      />
      <ErrorLine error={invalid ?? pair.error} />
      <Button busy={pair.pending} label={t('mobile.pair.submit')} onPress={submit} size="large" />
    </EntryScreen>
  )
}
