import { SymbolView } from 'expo-symbols'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radii } from '../styles/tokens.ts'
import { Sheet } from './Sheet.tsx'

export type Option<Value extends string> = { value: Value; label: string }

/** The web's `<select>`: a sheet listing the options, the current one ticked; picking closes it. */
export const OptionsSheet = <Value extends string>({
  open,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  open: boolean
  title: string
  options: readonly Option<Value>[]
  value: Value
  onSelect: (value: Value) => void
  onClose: () => void
}) => (
  <Sheet onClose={onClose} open={open} title={title}>
    <View accessibilityRole="radiogroup" style={styles.list}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityState={{ checked: option.value === value }}
          onPress={() => {
            onSelect(option.value)
            onClose()
          }}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
        >
          <Text style={styles.label}>{option.label}</Text>
          {option.value === value ? (
            <SymbolView name="checkmark" size={16} tintColor={colors.text} weight="semibold" />
          ) : undefined}
        </Pressable>
      ))}
    </View>
  </Sheet>
)

const styles = StyleSheet.create({
  list: {
    borderRadius: radii.well,
    backgroundColor: colors.well,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { backgroundColor: colors.glass },
  label: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 16 },
})
