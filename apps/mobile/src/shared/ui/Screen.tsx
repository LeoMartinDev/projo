import type { ReactNode } from 'react'
import { KeyboardAvoidingView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors, sizes } from '../styles/tokens.ts'

/** A full screen, safe areas respected, content centred; lifts above the keyboard. */
export const Screen = ({ children }: { children: ReactNode }) => (
  <SafeAreaView style={styles.safeArea}>
    <KeyboardAvoidingView behavior="padding" style={styles.content}>
      {children}
    </KeyboardAvoidingView>
  </SafeAreaView>
)

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: sizes.gutter,
    gap: 16,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
})
