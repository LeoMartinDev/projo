import { StyleSheet } from 'react-native'

import { colors, fonts, titleTracking } from '../styles/tokens.ts'

export const textStyles = StyleSheet.create({
  title: {
    color: colors.textStrong,
    fontFamily: fonts.bold,
    fontSize: 28,
    letterSpacing: titleTracking(28),
  },
  body: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  error: { color: colors.errorSoft, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  /** A pairing code: monospaced, spaced out. */
  code: { fontFamily: fonts.mono, fontSize: 22, letterSpacing: 4 },
  /** Small uppercase heading of a settings group. */
  section: {
    color: colors.textMuted,
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
})
