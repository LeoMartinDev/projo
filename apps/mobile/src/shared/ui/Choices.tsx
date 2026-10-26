import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radii } from '../styles/tokens.ts'

export type Choice<Value> = { value: Value; label: string }

/**
 * A segmented control (artboard `MobileSeries` season tabs, the catalogue sort): pills in a dark
 * track, the chosen one white. Scrolls sideways when its options do not fit.
 */
export const Segmented = <Value,>({
  label,
  choices,
  value,
  onChange,
  role = 'radio',
}: {
  label: string
  choices: readonly Choice<Value>[]
  value: Value | undefined
  onChange: (value: Value) => void
  /** `tab`: season tabs. */
  role?: 'radio' | 'tab'
}) => (
  <ScrollView
    accessibilityLabel={label}
    accessibilityRole={role === 'tab' ? 'tablist' : 'radiogroup'}
    contentContainerStyle={styles.track}
    horizontal
    showsHorizontalScrollIndicator={false}
    style={styles.scroller}
  >
    {choices.map((choice) => {
      const chosen = choice.value === value
      return (
        <Pressable
          key={choice.label}
          accessibilityRole={role}
          accessibilityState={{ selected: chosen, checked: chosen }}
          onPress={() => onChange(choice.value)}
          style={[styles.segment, chosen && styles.chosen]}
        >
          <Text style={[styles.segmentLabel, chosen && styles.chosenLabel]}>{choice.label}</Text>
        </Pressable>
      )
    })}
  </ScrollView>
)

/** Filter chips (kit v2 chips): wrap on several lines, the chosen one white. */
export const Chips = <Value,>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string
  choices: readonly Choice<Value>[]
  value: Value
  onChange: (value: Value) => void
}) => (
  <View accessibilityLabel={label} accessibilityRole="radiogroup" style={styles.chips}>
    {choices.map((choice) => {
      const chosen = choice.value === value
      return (
        <Pressable
          key={choice.label}
          accessibilityRole="radio"
          accessibilityState={{ checked: chosen }}
          onPress={() => onChange(choice.value)}
          style={({ pressed }) => [styles.chip, chosen && styles.chosen, pressed && styles.pressed]}
        >
          <Text style={[styles.chipLabel, chosen && styles.chosenLabel]}>{choice.label}</Text>
        </Pressable>
      )
    })}
  </View>
)

const styles = StyleSheet.create({
  scroller: { flexGrow: 0, alignSelf: 'flex-start', maxWidth: '100%' },
  track: { padding: 3, borderRadius: radii.pill, backgroundColor: '#17171a' },
  segment: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radii.pill,
  },
  segmentLabel: { color: colors.textMutedStrong, fontFamily: fonts.medium, fontSize: 13 },
  chosen: { backgroundColor: colors.accent },
  chosenLabel: { color: colors.onAccent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.glassButton,
  },
  chipLabel: { color: colors.textMutedStrong, fontFamily: fonts.medium, fontSize: 14 },
  pressed: { opacity: 0.7 },
})
