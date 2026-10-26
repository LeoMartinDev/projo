import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'

import type { ProfileDto } from '@projo/shared/api/profiles'

import type { Failure } from '../../shared/api/failure.ts'
import { colors, fonts, radii } from '../../shared/styles/tokens.ts'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { Sheet } from '../../shared/ui/Sheet.tsx'
import { Avatar } from './Avatar.tsx'

const pinLength = 4

/**
 * The 4-digit PIN of a profile (§13.6, §14), as on the web: four boxes over one numeric field,
 * sent at the fourth digit; a refused PIN empties them for the next try.
 */
export const PinSheet = ({
  profile,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  profile: ProfileDto | undefined
  pending: boolean
  error: Failure | undefined
  onSubmit: (pin: string) => void
  onClose: () => void
}) => (
  <Sheet onClose={onClose} open={profile !== undefined} title={profile?.name ?? ''}>
    {profile === undefined ? undefined : (
      <PinForm
        key={profile.id}
        error={error}
        onSubmit={onSubmit}
        pending={pending}
        profile={profile}
      />
    )}
  </Sheet>
)

const PinForm = ({
  profile,
  pending,
  error,
  onSubmit,
}: {
  profile: ProfileDto
  pending: boolean
  error: Failure | undefined
  onSubmit: (pin: string) => void
}) => {
  const { t } = useTranslation()
  const [pin, setPin] = useState('')
  const failed = error !== undefined && !pending && pin.length === 0

  return (
    <View style={styles.form}>
      <Avatar color={profile.avatarColor} name={profile.name} size={96} />
      <Text style={styles.label}>{t('profiles.pin.label', { name: profile.name })}</Text>
      <View style={styles.boxes}>
        <TextInput
          accessibilityLabel={t('profiles.pin.label', { name: profile.name })}
          autoFocus
          caretHidden
          keyboardAppearance="dark"
          keyboardType="number-pad"
          maxLength={pinLength}
          onChangeText={(text) => {
            // Not `editable={false}`: that drops the focus, and the keypad, for the next try.
            if (pending) return
            const digits = text.replace(/\D/g, '').slice(0, pinLength)
            if (digits.length === pinLength) {
              setPin('')
              onSubmit(digits)
            } else setPin(digits)
          }}
          secureTextEntry
          style={styles.input}
          textContentType="oneTimeCode"
          value={pin}
        />
        {Array.from({ length: pinLength }, (_, index) => (
          <View
            key={index}
            pointerEvents="none"
            style={[styles.box, index === pin.length && styles.current, failed && styles.failed]}
          >
            {index < pin.length ? <View style={styles.dot} /> : undefined}
          </View>
        ))}
      </View>
      <View style={styles.feedback}>
        {pending ? <ActivityIndicator color={colors.textMuted} /> : undefined}
        <ErrorLine error={failed ? error : undefined} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  form: { alignItems: 'center', gap: 20, paddingTop: 24 },
  label: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 16 },
  boxes: { flexDirection: 'row', gap: 12 },
  // The field covers the boxes, transparent: a tap anywhere on them brings the keypad back.
  input: { ...StyleSheet.absoluteFill, zIndex: 1, color: 'transparent', opacity: 0.02 },
  box: {
    width: 56,
    height: 64,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.borderField,
    backgroundColor: colors.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  current: { borderColor: colors.borderFocus },
  failed: { borderColor: 'rgba(252, 165, 165, 0.7)' },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.text },
  feedback: { alignItems: 'center', minHeight: 72, gap: 8 },
})
