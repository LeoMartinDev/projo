import { SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { canManageAccount } from '@projo/shared/api/auth'
import type { ProfileDto } from '@projo/shared/api/profiles'

import { toFailure } from '../../shared/api/failure.ts'
import { colors, fonts, radii, sizes } from '../../shared/styles/tokens.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Logo } from '../../shared/ui/EntryScreen.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { useSession } from '../session/Session.tsx'
import { Avatar } from './Avatar.tsx'
import { PinSheet } from './PinSheet.tsx'
import { type EditorTarget, ProfileEditorSheet } from './ProfileEditorSheet.tsx'
import { useVerifyPin } from './queries.ts'

const tileSize = 104
const maxProfiles = 5

/**
 * "Who's watching?" (§13.6, artboard `Main`): one tile per profile, a padlock on the protected
 * ones (PIN asked at each switch), "Add" up to five and "Manage profiles" to rename, recolour,
 * protect or delete them; neither from a restricted profile (or, before choosing, on an account
 * that has one, §14).
 */
export const WhoIsWatchingScreen = () => {
  const { t } = useTranslation()
  const { gate, selectProfile, cancelSwitch, signOut, signingOut } = useSession()
  const verify = useVerifyPin()
  const [managing, setManaging] = useState(false)
  const [pinFor, setPinFor] = useState<{ profile: ProfileDto; purpose: 'select' | 'edit' }>()
  const [editor, setEditor] = useState<EditorTarget>()
  if (gate.kind !== 'choosing') return undefined
  const { me } = gate
  const canManage = canManageAccount(me)
  const manage = managing && canManage
  const activeProfileId = gate.switching ? me.activeProfileId : undefined

  const open = (profile: ProfileDto) => {
    if (manage) {
      // Changing a protected profile other than the active one needs its PIN (§14).
      if (profile.hasPin && profile.id !== me.activeProfileId) {
        verify.reset()
        setPinFor({ profile, purpose: 'edit' })
      } else setEditor({ mode: 'edit', profile })
      return
    }
    selectProfile.reset()
    if (profile.hasPin) setPinFor({ profile, purpose: 'select' })
    else selectProfile.run({ id: profile.id })
  }

  const submitPin = (pin: string) => {
    if (pinFor === undefined) return
    const { profile, purpose } = pinFor
    if (purpose === 'select') {
      selectProfile.run({ id: profile.id, pin })
      return
    }
    verify.mutate(
      { id: profile.id, pin },
      {
        onSuccess: () => {
          setPinFor(undefined)
          setEditor({ mode: 'edit', profile, currentPin: pin })
        },
      },
    )
  }

  const pinPending = pinFor?.purpose === 'edit' ? verify.isPending : selectProfile.pending
  const verifyError = verify.error ?? undefined
  const pinError =
    pinFor?.purpose === 'edit'
      ? verifyError === undefined
        ? undefined
        : toFailure(verifyError)
      : selectProfile.error

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Logo />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          {manage ? t('profiles.manageTitle') : t('profiles.whoTitle')}
        </Text>
        <View accessibilityLabel={t('profiles.list')} accessibilityRole="list" style={styles.grid}>
          {me.profiles.map((profile) => (
            <Pressable
              key={profile.id}
              accessibilityLabel={
                manage
                  ? t('profiles.editProfile', { name: profile.name })
                  : profile.hasPin
                    ? t('profiles.lockedProfile', { name: profile.name })
                    : profile.name
              }
              accessibilityRole="button"
              accessibilityState={{
                selected: profile.id === activeProfileId,
                busy: selectProfile.pending,
              }}
              disabled={selectProfile.pending}
              onPress={() => open(profile)}
              style={({ pressed }) => [styles.profile, pressed && styles.pressed]}
            >
              <View>
                <Avatar
                  color={profile.avatarColor}
                  locked={profile.hasPin && !manage}
                  name={profile.name}
                  size={tileSize}
                />
                {manage ? (
                  <View style={styles.edit}>
                    <SymbolView name="pencil" size={26} tintColor="#ffffff" />
                  </View>
                ) : undefined}
              </View>
              <Text numberOfLines={1} style={styles.name}>
                {profile.name}
              </Text>
            </Pressable>
          ))}
          {canManage && me.profiles.length < maxProfiles ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setEditor({ mode: 'create' })}
              style={({ pressed }) => [styles.profile, pressed && styles.pressed]}
            >
              <View style={styles.add}>
                <SymbolView name="plus" size={30} tintColor={colors.textSecondary} />
              </View>
              <Text style={styles.name}>{t('profiles.add')}</Text>
            </Pressable>
          ) : undefined}
        </View>
        <ErrorLine error={pinFor === undefined ? selectProfile.error : undefined} />
        <View style={styles.actions}>
          {canManage ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setManaging(!manage)}
              style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
            >
              <Text style={styles.ghostLabel}>
                {manage ? t('profiles.done') : t('profiles.manage')}
              </Text>
            </Pressable>
          ) : undefined}
          {gate.switching ? (
            <Button label={t('common.back')} onPress={cancelSwitch} variant="plain" />
          ) : (
            <Button busy={signingOut} label={t('shell.logout')} onPress={signOut} variant="plain" />
          )}
        </View>
      </ScrollView>

      <PinSheet
        error={pinError}
        onClose={() => setPinFor(undefined)}
        onSubmit={submitPin}
        pending={pinPending}
        profile={pinFor?.profile}
      />
      <ProfileEditorSheet
        canDelete={me.profiles.length > 1}
        onClose={() => setEditor(undefined)}
        target={editor}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: sizes.gutter, paddingTop: 12 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 40,
    paddingHorizontal: sizes.gutter,
    paddingVertical: 32,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 32,
    letterSpacing: 32 * -0.03,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 24,
    maxWidth: 4 * tileSize + 3 * 24,
  },
  profile: { alignItems: 'center', gap: 14, width: tileSize },
  pressed: { opacity: 0.6 },
  name: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 16 },
  edit: {
    ...StyleSheet.absoluteFill,
    borderRadius: tileSize * 0.23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 10, 11, 0.45)',
  },
  add: {
    width: tileSize,
    height: tileSize,
    borderRadius: tileSize * 0.23,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { alignItems: 'center', gap: 8 },
  ghost: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  ghostLabel: { color: colors.textSoft, fontFamily: fonts.medium, fontSize: 14 },
})
