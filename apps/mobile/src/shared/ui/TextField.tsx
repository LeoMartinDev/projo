import type { ComponentRef, Ref } from 'react'
import { StyleSheet, TextInput, type TextInputProps } from 'react-native'

import { colors, radii, sizes } from '../styles/tokens.ts'

export type TextFieldInstance = ComponentRef<typeof TextInput>

/** A text input in the web's field style (§19), dark keyboard. */
export const TextField = ({
  ref,
  style,
  ...props
}: TextInputProps & { ref?: Ref<TextFieldInstance> }) => (
  <TextInput
    ref={ref}
    autoCorrect={false}
    keyboardAppearance="dark"
    placeholderTextColor={colors.textPlaceholder}
    style={[styles.field, style]}
    {...props}
  />
)

const styles = StyleSheet.create({
  field: {
    minHeight: sizes.control,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.borderField,
    backgroundColor: colors.field,
    color: colors.text,
    fontSize: 16,
    // Explicit: a recycled native input keeps the letter spacing of a code field otherwise.
    letterSpacing: 0,
    paddingHorizontal: 16,
  },
})
