import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { versionLabels } from '@projo/i18n/versions'
import type { ItemDetailDto, PersonDto } from '@projo/shared/api/catalog'

import { languageName } from '../../shared/i18n/intl.ts'
import { colors, fonts } from '../../shared/styles/tokens.ts'
import { Artwork } from '../media/Artwork.tsx'
import { useLocale } from '../media/card-text.ts'

/** A section of a title page under its heading (Episodes, Cast, Tracks). */
export const Section = ({
  title,
  gutter,
  children,
}: {
  title: string
  gutter: number
  children: ReactNode
}) => (
  <View style={styles.section}>
    <Text accessibilityRole="header" style={[styles.heading, { paddingHorizontal: gutter }]}>
      {title}
    </Text>
    {children}
  </View>
)

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join('')

/** Cast with photos (§13.5, §9.1: the first 20 actors), then the creators or directors. */
export const CastRow = ({ item, gutter }: { item: ItemDetailDto; gutter: number }) => {
  const { t } = useTranslation()
  const people: PersonDto[] = [...item.cast, ...item.crew]
  if (people.length === 0) return undefined
  const role = (person: PersonDto) =>
    person.role === 'cast'
      ? (person.character ?? '')
      : person.role === 'director'
        ? t('item.director')
        : item.kind === 'series'
          ? t('item.creator')
          : t('item.writer')
  return (
    <Section gutter={gutter} title={t('item.cast')}>
      <ScrollView
        contentContainerStyle={[styles.cast, { paddingHorizontal: gutter }]}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {people.map((person) => (
          <View
            key={`${person.id}-${person.role}`}
            accessibilityLabel={[person.name, role(person)].filter(Boolean).join(', ')}
            accessible
            style={styles.person}
          >
            <Artwork
              fallback={
                <View style={styles.initials}>
                  <Text style={styles.initialsText}>{initials(person.name)}</Text>
                </View>
              }
              path={person.photo}
              style={styles.photo}
              toneId={person.id}
            />
            <Text numberOfLines={2} style={styles.name}>
              {person.name}
            </Text>
            <Text numberOfLines={1} style={styles.role}>
              {role(person)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Section>
  )
}

/**
 * Available tracks (§13.5): audio and subtitle languages, and the versions when the item has
 * several files (§7.7).
 */
export const Tracks = ({ item, gutter }: { item: ItemDetailDto; gutter: number }) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const list = (codes: readonly string[]) =>
    [
      ...new Set(codes.filter((code) => code !== 'und').map((code) => languageName(code, locale))),
    ].join(', ')
  const rows = [
    { label: t('item.tracks.audio'), value: list(item.audioLanguages) },
    { label: t('item.tracks.subtitles'), value: list(item.subtitleLanguages) },
    {
      label: t('item.tracks.versions'),
      value:
        item.sources.length > 1
          ? versionLabels(
              t,
              item.sources.map((source) => source.version),
            ).join(', ')
          : '',
    },
  ].filter((row) => row.value !== '')
  if (rows.length === 0) return undefined
  return (
    <Section gutter={gutter} title={t('item.tech.title')}>
      <View style={[styles.tracks, { paddingHorizontal: gutter }]}>
        {rows.map((row) => (
          <View key={row.label} style={styles.track}>
            <Text style={styles.trackLabel}>{row.label}</Text>
            <Text style={styles.trackValue}>{row.value}</Text>
          </View>
        ))}
      </View>
    </Section>
  )
}

const styles = StyleSheet.create({
  section: { gap: 14 },
  heading: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 17,
    letterSpacing: 17 * -0.01,
  },
  cast: { gap: 14 },
  person: { width: 84, alignItems: 'center', gap: 4 },
  photo: { width: 72, height: 72, borderRadius: 36, marginBottom: 4 },
  initials: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: colors.textSoft, fontFamily: fonts.semibold, fontSize: 18 },
  name: { color: colors.text, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center' },
  role: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11, textAlign: 'center' },
  tracks: { gap: 10 },
  track: { gap: 2 },
  trackLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  trackValue: { color: colors.textSoft, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
})
