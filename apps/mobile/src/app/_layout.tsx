import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist'
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono'
import { QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import {
  ServerConnectionProvider,
  useServerConnection,
} from '../features/server-connection/ServerConnection.tsx'
import { SessionProvider, useSession } from '../features/session/Session.tsx'
import { createAppQueryClient } from '../shared/api/query-client.ts'
import { setupI18n } from '../shared/i18n/index.ts'
import { colors, fonts } from '../shared/styles/tokens.ts'

setupI18n()
const queryClient = createAppQueryClient()

/** The screen each state lands on (§26.4, §26.3, §13.6). */
const landing = {
  disconnected: '/connect',
  outdated: '/server-outdated',
  signed_out: '/sign-in',
  error: '/session-error',
  choosing: '/profiles',
  ready: '/',
} as const

/**
 * One set of screens per state: the server connection (§26.4), then the session (§26.3, §13.6).
 * A route whose guard is false is unreachable and redirects to the state's landing screen.
 */
const AppStack = () => {
  const { t } = useTranslation()
  const connection = useServerConnection()
  const session = useSession()
  const gate = connection.gate.kind === 'connected' ? session.gate : connection.gate
  if (gate.kind === 'loading')
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    )
  const redirectTo = landing[gate.kind]
  const signedOut = gate.kind === 'signed_out'
  // Pushed over the connection or sign-in screen: a native back button and swipe.
  const pushed = {
    headerShown: true,
    headerTransparent: true,
    headerTitle: '',
    headerTintColor: colors.text,
    headerBackTitle: t('common.back'),
  } as const
  // The settings behind the avatar: native header, back swipe (§26.5).
  const settings = {
    headerShown: true,
    headerTintColor: colors.text,
    headerStyle: { backgroundColor: colors.bg },
    headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text },
    headerBackTitleStyle: { fontFamily: fonts.regular },
    headerShadowVisible: false,
  } as const

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={gate.kind === 'ready'} redirectTo={redirectTo}>
        {/* Its title is the back button of the settings. */}
        <Stack.Screen name="(tabs)" options={{ title: t('common.home') }} />
        <Stack.Screen
          name="settings/index"
          options={{ ...settings, title: t('mobile.settings.title') }}
        />
        <Stack.Screen
          name="settings/profile"
          options={{ ...settings, title: t('shell.profileSettings') }}
        />
        <Stack.Screen
          name="settings/account"
          options={{ ...settings, title: t('shell.account') }}
        />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'choosing'} redirectTo={redirectTo}>
        <Stack.Screen name="profiles" />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'error'} redirectTo={redirectTo}>
        <Stack.Screen name="session-error" />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'outdated'} redirectTo={redirectTo}>
        <Stack.Screen name="server-outdated" />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'disconnected'} redirectTo={redirectTo}>
        <Stack.Screen name="connect" />
      </Stack.Protected>
      <Stack.Protected guard={signedOut} redirectTo={redirectTo}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="pair" options={pushed} />
      </Stack.Protected>
      <Stack.Protected guard={signedOut || gate.kind === 'disconnected'} redirectTo={redirectTo}>
        <Stack.Screen name="scan" options={pushed} />
      </Stack.Protected>
    </Stack>
  )
}

/** Geist and Geist Mono, bundled with the app (§26.5): the names of `fonts`. */
const fontFiles = {
  [fonts.regular]: Geist_400Regular,
  [fonts.medium]: Geist_500Medium,
  [fonts.semibold]: Geist_600SemiBold,
  [fonts.bold]: Geist_700Bold,
  [fonts.mono]: GeistMono_400Regular,
}

const RootLayout = () => {
  // Local files: ready in a few frames. A font that fails to load falls back to the system's.
  const [loaded, error] = useFonts(fontFiles)
  return (
    <SafeAreaProvider style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <ServerConnectionProvider>
          <SessionProvider>
            {loaded || Boolean(error) ? <AppStack /> : <View style={styles.root} />}
          </SessionProvider>
        </ServerConnectionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}

export default RootLayout

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
})
