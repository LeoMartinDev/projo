import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'

import { colors, radii, sizes } from '../styles/tokens.ts'

type ButtonProps = {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary'
  busy?: boolean
}

export const Button = ({ label, onPress, variant = 'primary', busy = false }: ButtonProps) => {
  const primary = variant === 'primary'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.text} />
      ) : (
        <Text style={[styles.label, { color: primary ? colors.onAccent : colors.text }]}>
          {label}
        </Text>
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
  pressed: { opacity: 0.75 },
  label: { fontSize: 16, fontWeight: '600' },
})
