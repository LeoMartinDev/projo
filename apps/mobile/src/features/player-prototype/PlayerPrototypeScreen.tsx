import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { nativePlayer } from '../../../modules/native-player/index.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { TextField } from '../../shared/ui/TextField.tsx'
import { colors, fonts, sizes } from '../../shared/styles/tokens.ts'

/**
 * The §26.6 player prototype, reached only by `projo://dev-player?url=…` (dev build).
 * English only: it goes away with the decision.
 */
export const PlayerPrototypeScreen = () => {
  const params = useLocalSearchParams<{ url?: string }>()
  const [url, setUrl] = useState(params.url ?? '')
  const [error, setError] = useState('')

  const play = () => {
    if (nativePlayer === undefined) return
    setError('')
    nativePlayer
      .present({ url: url.trim(), title: 'Player prototype' })
      .catch((cause: unknown) => setError(String(cause)))
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Player prototype</Text>
        <TextField
          label="Master playlist URL"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
        <Button
          label={nativePlayer === undefined ? 'Needs the dev build' : 'Play'}
          onPress={play}
          disabled={nativePlayer === undefined || url.trim() === ''}
        />
        <Text style={styles.error}>{error}</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: sizes.gutter, gap: 12 },
  title: { fontFamily: fonts.semibold, fontSize: 22, color: colors.text },
  error: { fontFamily: fonts.regular, color: colors.error, minHeight: 40 },
})
