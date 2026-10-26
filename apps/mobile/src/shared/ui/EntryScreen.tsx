import { BlurView } from 'expo-blur'
import type { ReactNode } from 'react'
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors, fonts, radii, sizes } from '../styles/tokens.ts'
import { Backdrop, type BackdropImage } from './Backdrop.tsx'

/** The wordmark of the web's header: "projo." */
export const Logo = () => <Text style={styles.logo}>projo.</Text>

/**
 * An entry screen (§26.5: server connection, sign-in, codes): the web sign-in's composition, an
 * illustration with its Ken Burns and a glass panel holding the title and the form. `pushed`: under
 * a native back button, no wordmark.
 */
export const EntryScreen = ({
  image,
  title,
  pushed = false,
  children,
}: {
  image: BackdropImage
  title: string
  pushed?: boolean
  children: ReactNode
}) => (
  <View style={styles.root}>
    <Backdrop image={image} />
    <SafeAreaView style={styles.fill}>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <ScrollView
          contentContainerStyle={[styles.content, pushed && styles.pushed]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          {pushed ? undefined : <Logo />}
          <View style={styles.center}>
            <BlurView intensity={40} style={styles.panel} tint="dark">
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              {children}
            </BlurView>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </View>
)

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: sizes.gutter, paddingTop: 12, paddingBottom: 24 },
  pushed: { paddingTop: 56 },
  logo: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 24,
    letterSpacing: 24 * -0.04,
  },
  center: { flex: 1, justifyContent: 'center', paddingTop: 24 },
  panel: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: 14,
    padding: 24,
    borderRadius: radii.panel - 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: colors.panel,
    overflow: 'hidden',
  },
  title: {
    color: colors.textStrong,
    fontFamily: fonts.bold,
    fontSize: 28,
    letterSpacing: 28 * -0.04,
    marginBottom: 4,
  },
})
