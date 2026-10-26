import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import {
  ServerConnectionProvider,
  useServerConnection,
} from '../features/server-connection/ServerConnection.tsx'
import { createAppQueryClient } from '../shared/api/query-client.ts'
import { setupI18n } from '../shared/i18n/index.ts'
import { colors } from '../shared/styles/tokens.ts'

setupI18n()
const queryClient = createAppQueryClient()

/** One screen per connection state (§26.4); a route whose guard is false is unreachable. */
const ConnectionStack = () => {
  const { gate } = useServerConnection()
  if (gate.kind === 'loading')
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    )
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={gate.kind === 'connected'}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'outdated'}>
        <Stack.Screen name="server-outdated" />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'disconnected'}>
        <Stack.Screen name="connect" />
      </Stack.Protected>
    </Stack>
  )
}

const RootLayout = () => (
  <SafeAreaProvider style={styles.root}>
    <QueryClientProvider client={queryClient}>
      <ServerConnectionProvider>
        <ConnectionStack />
      </ServerConnectionProvider>
    </QueryClientProvider>
  </SafeAreaProvider>
)

export default RootLayout

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
})
