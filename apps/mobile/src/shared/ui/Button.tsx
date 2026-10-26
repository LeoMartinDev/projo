import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'

import { colors, radii, sizes } from '../styles/tokens.ts'

type ButtonProps = {
  label: string
  onPress: () => void
  /** `plain`: text only, for a way out next to the main actions. */
  variant?: 'primary' | 'secondary' | 'plain'
  busy?: boolean
}

export const Button = ({ label, onPress, variant = 'primary', busy = false }: ButtonProps) => {
  const primary = variant === 'primary'
  const color = primary ? colors.onAccent : variant === 'plain' ? colors.textSecondary : colors.text
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[variant], pressed && styles.pressed]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.label, { color }]}>{label}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: sizes.control,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.glass },
  plain: {},
  pressed: { opacity: 0.75 },
  label: { fontSize: 16, fontWeight: '600' },
})
