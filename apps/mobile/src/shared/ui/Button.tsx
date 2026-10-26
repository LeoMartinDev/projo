import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'

import { colors, fonts, radii, sizes } from '../styles/tokens.ts'

type ButtonProps = {
  label: string
  onPress: () => void
  /**
   * Kit v2 (§19): `primary` white, `secondary` glass, `danger` red tint; `plain`: text only, for a
   * way out next to the main actions.
   */
  variant?: 'primary' | 'secondary' | 'plain' | 'danger'
  /** `large`: the main action of an entry screen (56 px). */
  size?: 'regular' | 'large' | 'small'
  busy?: boolean
  disabled?: boolean
  accessibilityLabel?: string
}

const labelColors = {
  primary: colors.onAccent,
  secondary: colors.text,
  plain: colors.textSoft,
  danger: colors.errorSoft,
} as const

export const Button = ({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  busy = false,
  disabled = false,
  accessibilityLabel,
}: ButtonProps) => {
  const color = labelColors[variant]
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[size],
        styles[variant],
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text numberOfLines={1} style={[styles.label, styles[`${size}Label`], { color }]}>
          {label}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
  regular: { minHeight: sizes.control, borderRadius: radii.button, paddingHorizontal: 16 },
  large: { minHeight: sizes.controlLg, borderRadius: radii.buttonLg, paddingHorizontal: 28 },
  small: { minHeight: sizes.controlSm, borderRadius: radii.buttonSm, paddingHorizontal: 14 },
  primary: { backgroundColor: colors.accent },
  secondary: {
    backgroundColor: colors.glassButton,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  plain: {},
  danger: {
    backgroundColor: colors.errorTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.errorBorder,
  },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  label: { fontFamily: fonts.semibold },
  regularLabel: { fontSize: 15 },
  largeLabel: { fontSize: 16 },
  smallLabel: { fontSize: 13 },
})
