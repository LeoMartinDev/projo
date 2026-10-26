import { SymbolView } from 'expo-symbols'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'

import { colors, fonts, radii, sizes } from '../styles/tokens.ts'
import { textStyles } from './text.ts'

/** A settings page under a native header: scrolls with the page, grouped rows (iOS settings). */
export const SettingsPage = ({ children }: { children: ReactNode }) => (
  <ScrollView
    contentContainerStyle={styles.page}
    contentInsetAdjustmentBehavior="automatic"
    keyboardDismissMode="interactive"
    keyboardShouldPersistTaps="handled"
    style={styles.scroll}
  >
    {children}
  </ScrollView>
)

/** A group of rows on a well (`.well`), with its heading. */
export const Section = ({
  title,
  footer,
  children,
}: {
  title?: string
  footer?: string
  children: ReactNode
}) => (
  <View style={styles.section}>
    {title === undefined ? undefined : (
      <Text accessibilityRole="header" style={[textStyles.section, styles.sectionTitle]}>
        {title}
      </Text>
    )}
    <View style={styles.well}>{children}</View>
    {footer === undefined ? undefined : <Text style={styles.footer}>{footer}</Text>}
  </View>
)

/** A row: label, value, and a chevron when it opens something (`onPress`). */
export const Row = ({
  label,
  value,
  onPress,
  destructive = false,
  external = false,
}: {
  label: string
  value?: string
  onPress?: () => void
  destructive?: boolean
  /** Opens outside the app (the browser): an arrow instead of the chevron. */
  external?: boolean
}) => (
  <Pressable
    accessibilityRole={onPress === undefined ? 'text' : 'button'}
    disabled={onPress === undefined}
    onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
  >
    <Text numberOfLines={1} style={[styles.label, destructive && styles.destructive]}>
      {label}
    </Text>
    {value === undefined ? undefined : (
      <Text numberOfLines={1} style={styles.value}>
        {value}
      </Text>
    )}
    {onPress === undefined || destructive ? undefined : (
      <SymbolView
        name={external ? 'arrow.up.right' : 'chevron.right'}
        size={14}
        tintColor={colors.textMuted}
        weight="semibold"
      />
    )}
  </Pressable>
)

/** A row with a switch (kit `.setting`): white track when on. */
export const SwitchRow = ({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: boolean
  onChange: (value: boolean) => void
}) => (
  <View style={styles.row}>
    <View style={styles.switchText}>
      <Text style={[styles.label, styles.stacked]}>{label}</Text>
      {description === undefined ? undefined : (
        <Text style={styles.description}>{description}</Text>
      )}
    </View>
    <Switch
      accessibilityLabel={label}
      ios_backgroundColor={colors.glassButton}
      onValueChange={onChange}
      thumbColor={value ? colors.onAccent : colors.text}
      trackColor={{ false: colors.glassButton, true: colors.accent }}
      value={value}
    />
  </View>
)

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  page: {
    gap: 28,
    paddingHorizontal: sizes.gutter,
    paddingTop: 16,
    paddingBottom: 48,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  section: { gap: 8 },
  sectionTitle: { paddingHorizontal: 4 },
  well: {
    borderRadius: radii.well,
    backgroundColor: colors.well,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  footer: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { backgroundColor: colors.glass },
  label: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 16 },
  destructive: { color: colors.errorSoft },
  value: {
    maxWidth: '60%',
    textAlign: 'right',
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  switchText: { flex: 1, gap: 2 },
  stacked: { flex: 0 },
  description: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
})
