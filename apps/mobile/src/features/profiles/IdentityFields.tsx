import { SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'

import {
  type AvatarColor,
  avatarColorSchema,
  pinSchema,
  type ProfileDto,
  profileNameSchema,
  type UpdateProfileBody,
} from '@projo/shared/api/profiles'

import { avatarColors, colors, fonts } from '../../shared/styles/tokens.ts'
import { TextField } from '../../shared/ui/TextField.tsx'

/** Draft of a profile's name, colour and PIN, as the web's editor and settings keep it. */
export const useIdentityDraft = (profile: ProfileDto | undefined) => {
  const [name, setName] = useState(profile?.name ?? '')
  const [color, setColor] = useState<AvatarColor | undefined>(profile?.avatarColor)
  const [pinOn, setPinOn] = useState(profile?.hasPin ?? false)
  const [changingPin, setChangingPin] = useState(false)
  const [pin, setPin] = useState('')
  const nameValid = profileNameSchema.safeParse(name).success
  const needsNewPin = pinOn && (profile?.hasPin !== true || changingPin)
  const pinValid = !needsNewPin || pinSchema.safeParse(pin).success
  const removesPin = profile?.hasPin === true && !pinOn
  /** What `PATCH /profiles/:id` must change (`pin: ""` removes it). */
  const changes = (editing: ProfileDto): UpdateProfileBody => ({
    ...(name.trim() === editing.name ? {} : { name: name.trim() }),
    ...(color === undefined || color === editing.avatarColor ? {} : { avatarColor: color }),
    ...(needsNewPin ? { pin } : removesPin ? { pin: '' } : {}),
  })
  return {
    name,
    setName,
    color,
    setColor,
    pinOn,
    togglePin: (on: boolean) => {
      setPinOn(on)
      setPin('')
    },
    changingPin,
    changePin: () => setChangingPin(true),
    pin,
    setPin: (value: string) => setPin(value.replace(/\D/g, '').slice(0, 4)),
    nameValid,
    needsNewPin,
    pinValid,
    valid: nameValid && pinValid,
    changes,
    reset: (saved: ProfileDto) => {
      setName(saved.name)
      setColor(saved.avatarColor)
      setPinOn(saved.hasPin)
      setChangingPin(false)
      setPin('')
    },
  }
}

export type IdentityDraft = ReturnType<typeof useIdentityDraft>

/**
 * Name, colour among six and optional 4-digit PIN of a profile (§13.6). `canEditPin`: a restricted
 * profile does not set or remove a PIN (§14).
 */
export const IdentityFields = ({
  draft,
  hasPin,
  canEditPin,
}: {
  draft: IdentityDraft
  hasPin: boolean
  canEditPin: boolean
}) => {
  const { t } = useTranslation()
  return (
    <>
      <TextField
        autoCapitalize="words"
        invalid={draft.name.length > 0 && !draft.nameValid}
        label={t('profiles.editor.name')}
        maxLength={32}
        onChangeText={draft.setName}
        value={draft.name}
      />
      <View accessibilityLabel={t('profiles.editor.color')} accessibilityRole="radiogroup">
        <Text style={styles.legend}>{t('profiles.editor.color')}</Text>
        <View style={styles.swatches}>
          {avatarColorSchema.options.map((color) => (
            <Pressable
              key={color}
              accessibilityLabel={t(`profiles.colors.${color}`)}
              accessibilityRole="radio"
              accessibilityState={{ checked: draft.color === color }}
              onPress={() => draft.setColor(color)}
              style={[
                styles.swatch,
                { backgroundColor: avatarColors[color] },
                draft.color === color && styles.chosen,
              ]}
            >
              {draft.color === color ? (
                <SymbolView name="checkmark" size={16} tintColor="#ffffff" weight="bold" />
              ) : undefined}
            </Pressable>
          ))}
        </View>
      </View>
      {canEditPin ? (
        <>
          <View style={styles.pinRow}>
            <View style={styles.pinText}>
              <Text style={styles.pinLabel}>{t('profiles.editor.pin')}</Text>
              {hasPin && draft.pinOn && !draft.changingPin ? (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={draft.changePin}>
                  <Text style={styles.link}>{t('profiles.editor.changePin')}</Text>
                </Pressable>
              ) : undefined}
            </View>
            <Switch
              accessibilityLabel={t('profiles.editor.pin')}
              ios_backgroundColor={colors.glassButton}
              onValueChange={draft.togglePin}
              thumbColor={draft.pinOn ? colors.onAccent : colors.text}
              trackColor={{ false: colors.glassButton, true: colors.accent }}
              value={draft.pinOn}
            />
          </View>
          {/* Always there, off until a new PIN is needed: the form keeps its size (AGENTS.md). */}
          <TextField
            autoComplete="off"
            editable={draft.needsNewPin}
            invalid={draft.pin.length === 4 && !draft.pinValid}
            keyboardType="number-pad"
            label={t('profiles.editor.newPin')}
            maxLength={4}
            onChangeText={draft.setPin}
            placeholder={draft.pinOn && !draft.needsNewPin ? '••••' : ''}
            secureTextEntry
            style={styles.mono}
            textContentType="oneTimeCode"
            value={draft.pin}
          />
        </>
      ) : undefined}
    </>
  )
}

const styles = StyleSheet.create({
  legend: {
    color: colors.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chosen: { borderWidth: 2, borderColor: '#ffffff' },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  pinText: { flex: 1, gap: 2 },
  pinLabel: { color: colors.text, fontFamily: fonts.medium, fontSize: 16 },
  link: {
    color: colors.textSoft,
    fontFamily: fonts.medium,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  mono: { fontFamily: fonts.mono, letterSpacing: 6 },
})
