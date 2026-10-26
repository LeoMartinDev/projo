import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Alert, Linking, StyleSheet, Text, View } from 'react-native'

import { canAdminister, canManageAccount } from '@projo/shared/api/auth'

import { colors, fonts, titleTracking } from '../../shared/styles/tokens.ts'
import { Row, Section, SettingsPage } from '../../shared/ui/Settings.tsx'
import { Avatar } from '../profiles/Avatar.tsx'
import { useServerConnection } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'

/**
 * Behind the avatar: the active profile (its settings, switching), the account (§14, hidden from a
 * restricted profile), the administration in the browser for an admin (§26.1), and this device's
 * settings: server, about, sign out (§26.5).
 */
export const SettingsScreen = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { gate: connection } = useServerConnection()
  const { gate, switchProfile, signOut, changeServer } = useSession()
  if (gate.kind !== 'ready' || connection.kind !== 'connected') return undefined
  const { me, profile } = gate
  const { url, version } = connection

  const confirmChangeServer = () =>
    Alert.alert(t('mobile.changeServer'), t('mobile.settings.changeServerText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('mobile.changeServer'), style: 'destructive', onPress: changeServer },
    ])

  return (
    <SettingsPage>
      <View style={styles.who}>
        <Avatar color={profile.avatarColor} name={profile.name} size={72} />
        <View style={styles.whoText}>
          <Text numberOfLines={1} style={styles.name}>
            {profile.name}
          </Text>
          <Text numberOfLines={1} style={styles.account}>
            {me.account.username} ·{' '}
            {me.account.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser')}
          </Text>
        </View>
      </View>

      <Section>
        <Row label={t('shell.profileSettings')} onPress={() => router.push('/settings/profile')} />
        <Row label={t('shell.switchProfile')} onPress={switchProfile} />
        {canManageAccount(me) ? (
          <Row label={t('shell.account')} onPress={() => router.push('/settings/account')} />
        ) : undefined}
        {canAdminister(me) ? (
          <Row
            external
            label={t('shell.admin')}
            onPress={() => void Linking.openURL(`${url}/admin`)}
          />
        ) : undefined}
      </Section>

      <Section title={t('mobile.settings.device')}>
        <Row label={t('mobile.settings.server')} value={url.replace(/^https?:\/\//, '')} />
        <Row destructive label={t('mobile.changeServer')} onPress={confirmChangeServer} />
      </Section>

      <Section title={t('account.about.title')}>
        <Row label={t('mobile.settings.appVersion')} value={Constants.expoConfig?.version ?? '—'} />
        <Row label={t('mobile.settings.serverVersion')} value={version} />
      </Section>

      <Section>
        <Row destructive label={t('shell.logout')} onPress={signOut} />
      </Section>
    </SettingsPage>
  )
}

const styles = StyleSheet.create({
  who: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 4 },
  whoText: { flex: 1, gap: 4 },
  name: {
    color: colors.textStrong,
    fontFamily: fonts.bold,
    fontSize: 26,
    letterSpacing: titleTracking(26),
  },
  account: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 15 },
})
