import { StyleSheet } from 'react-native'

import { colors, titleTracking } from '../styles/tokens.ts'

export const textStyles = StyleSheet.create({
  title: {
    color: colors.textStrong,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: titleTracking(28),
  },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  error: { color: colors.errorSoft, fontSize: 15, lineHeight: 22 },
  /** A pairing code: monospaced, spaced out. */
  code: { fontFamily: 'Menlo', fontSize: 22, letterSpacing: 4 },
})
