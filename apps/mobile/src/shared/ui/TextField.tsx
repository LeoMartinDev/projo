import { type ComponentRef, type ReactNode, type Ref, useState } from 'react'
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native'

import { colors, fonts, radii, sizes } from '../styles/tokens.ts'

export type TextFieldInstance = ComponentRef<typeof TextInput>

/**
 * The kit v2 field (§19, `Components`): a 58 px box, its label inside above the value, brighter
 * rim on focus, red rim when `invalid`; `trail` at the end (an eye, a check). Dark keyboard.
 */
export const TextField = ({
  ref,
  label,
  invalid = false,
  trail,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & {
  ref?: Ref<TextFieldInstance>
  label: string
  invalid?: boolean
  trail?: ReactNode
}) => {
  const [focused, setFocused] = useState(false)
  return (
    <View
      style={[
        styles.box,
        focused && styles.focused,
        invalid && styles.invalid,
        props.editable === false && styles.disabled,
      ]}
    >
      <View style={styles.stack}>
        <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          autoCorrect={false}
          keyboardAppearance="dark"
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          placeholderTextColor={colors.textPlaceholder}
          style={[styles.input, style]}
          {...props}
        />
      </View>
      {trail}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: sizes.field,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.borderField,
    backgroundColor: colors.field,
    paddingLeft: 16,
    paddingRight: 8,
  },
  focused: { borderColor: colors.borderFocus, backgroundColor: 'rgba(255, 255, 255, 0.075)' },
  invalid: { borderColor: 'rgba(252, 165, 165, 0.7)' },
  disabled: { opacity: 0.5 },
  stack: { flex: 1, gap: 3, paddingVertical: 9 },
  label: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  labelFocused: { color: colors.textMutedStrong },
  input: {
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 16,
    // Explicit: a recycled native input keeps the letter spacing of a code field otherwise.
    letterSpacing: 0,
    padding: 0,
  },
})
