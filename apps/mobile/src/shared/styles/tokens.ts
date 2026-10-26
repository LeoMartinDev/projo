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
  success: '#3dd68c',
  error: '#ff5a5f',
  errorSoft: '#fca5a5',
  warning: '#e5b567',
} as const

export const radii = {
  panel: 28,
  buttonLg: 16,
  field: 15,
  button: 14,
  card: 12,
} as const

export const sizes = {
  control: 48,
  controlLg: 56,
  touchTarget: 44,
  gutter: 16,
} as const

/** Letter spacing of titles: the web's `-0.03em`, at the title's font size. */
export const titleTracking = (fontSize: number): number => fontSize * -0.03
