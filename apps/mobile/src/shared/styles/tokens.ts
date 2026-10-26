import type { AvatarColor } from '@projo/shared/api/profiles'

/**
 * Design tokens of the web (`apps/web/src/shared/styles/tokens.css`, §19) as React Native
 * constants. Dark theme only. Same values: change them in both places.
 */
export const colors = {
  bg: '#0a0a0b',
  surface: '#111113',
  surface2: '#141416',
  field: 'rgba(255, 255, 255, 0.045)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderField: 'rgba(255, 255, 255, 0.09)',
  borderFocus: 'rgba(255, 255, 255, 0.6)',
  text: '#f4f4f5',
  textStrong: '#ffffff',
  textSecondary: '#a1a1aa',
  textMuted: '#8b8b94',
  textPlaceholder: '#5f5f68',
  accent: '#f4f4f5',
  onAccent: '#0a0a0b',
  glass: 'rgba(255, 255, 255, 0.06)',
  glassButton: 'rgba(255, 255, 255, 0.08)',
  glassBorder: 'rgba(255, 255, 255, 0.1)',
  /** The kit's `.panel`: dark glass over the blur. */
  panel: 'rgba(18, 18, 21, 0.58)',
  /** A sheet's rows (`.well`). */
  well: 'rgba(255, 255, 255, 0.04)',
  textSoft: '#c4c4cc',
  textMutedStrong: '#d4d4d8',
  errorTint: 'rgba(248, 113, 113, 0.08)',
  errorBorder: 'rgba(248, 113, 113, 0.18)',
  success: '#3dd68c',
  error: '#ff5a5f',
  errorSoft: '#fca5a5',
  warning: '#e5b567',
} as const

/** Avatar tiles (§13.6), the web's `--avatar-<color>`. */
export const avatarColors = {
  slate: '#5f6670',
  blue: '#5b7fa6',
  honey: '#b08a3e',
  sage: '#5e8c72',
  terracotta: '#a86a55',
  violet: '#7d6aa6',
} as const satisfies Record<AvatarColor, string>

/**
 * Geist and Geist Mono (§19, §26.5), bundled and loaded at launch (`_layout.tsx`). One family per
 * weight: iOS does not derive weights of a font loaded at runtime from `fontWeight`.
 */
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_400Regular',
} as const

export const radii = {
  panel: 28,
  well: 18,
  buttonLg: 16,
  field: 15,
  button: 14,
  card: 12,
  buttonSm: 11,
  pill: 999,
} as const

export const sizes = {
  control: 48,
  controlLg: 56,
  controlSm: 36,
  field: 58,
  touchTarget: 44,
  gutter: 16,
} as const

/** Letter spacing of titles: the web's `-0.03em`, at the title's font size. */
export const titleTracking = (fontSize: number): number => fontSize * -0.03
