import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '../../shared/styles/tokens.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { Screen } from '../../shared/ui/Screen.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useSession } from '../session/Session.tsx'
import { Avatar } from './Avatar.tsx'

const tileSize = 104

/**
 * "Who's watching?" (§13.6): one tile per profile of the account. A PIN-protected profile shows its
 * padlock and cannot be picked yet (PIN entry comes with M6 slice 2).
 */
export const WhoIsWatchingScreen = () => {
  const { t } = useTranslation()
  const { gate, selectProfile, cancelSwitch, signOut, signingOut } = useSession()
  if (gate.kind !== 'choosing') return undefined
  const activeProfileId = gate.switching ? gate.me.activeProfileId : undefined

  return (
    <Screen>
      <Text accessibilityRole="header" style={[textStyles.title, styles.title]}>
        {t('profiles.whoTitle')}
      </Text>
      <View accessibilityLabel={t('profiles.list')} accessibilityRole="list" style={styles.grid}>
        {gate.me.profiles.map((profile) => (
          <Pressable
            key={profile.id}
            accessibilityLabel={
              profile.hasPin ? t('profiles.lockedProfile', { name: profile.name }) : profile.name
            }
            accessibilityRole="button"
            accessibilityState={{
              disabled: profile.hasPin,
              selected: profile.id === activeProfileId,
              busy: selectProfile.pending,
            }}
            disabled={profile.hasPin || selectProfile.pending}
            onPress={() => selectProfile.run(profile.id)}
            style={({ pressed }) => [
              styles.profile,
              profile.hasPin && styles.locked,
              pressed && styles.pressed,
            ]}
          >
            <Avatar
              color={profile.avatarColor}
              locked={profile.hasPin}
              name={profile.name}
              size={tileSize}
            />
            <Text numberOfLines={1} style={styles.name}>
              {profile.name}
            </Text>
          </Pressable>
        ))}
      </View>
      <ErrorLine error={selectProfile.error} />
      {gate.switching ? (
        <Button label={t('common.back')} onPress={cancelSwitch} variant="plain" />
      ) : (
        <Button busy={signingOut} label={t('shell.logout')} onPress={signOut} variant="plain" />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { textAlign: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 24,
    paddingTop: 16,
  },
  profile: { alignItems: 'center', gap: 12, width: tileSize },
  locked: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
  name: { color: colors.textSecondary, fontSize: 16, fontWeight: '500' },
})
