import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { ratingBadge } from '@projo/i18n/content-ratings'
import { genreLabels } from '@projo/i18n/genres'
import { itemTitle } from '@projo/i18n/item-titles'
import { qualityLabel, yearsLabel } from '@projo/i18n/media'
import type { ItemDetailDto, PersonDto } from '@projo/shared/api/catalog'

import { colors, fonts } from '../../shared/styles/tokens.ts'
import { Artwork } from '../media/Artwork.tsx'
import { ActionButton, GlassButton } from '../media/buttons.tsx'
import { useLocale } from '../media/card-text.ts'
import { MetaLine, ProgressBar } from '../media/parts.tsx'

const names = (people: readonly PersonDto[], max: number) =>
  people
    .slice(0, max)
    .map((person) => person.name)
    .join(', ')

/** "With A, B, C · Created by X" (artboard `Series`), "Directed by X" for a movie. */
const CreditsLine = ({ item }: { item: ItemDetailDto }) => {
  const { t } = useTranslation()
  const cast = item.cast.filter((person) => person.role === 'cast')
  const makers = item.crew.filter((person) =>
    item.kind === 'series' ? person.role === 'writer' : person.role === 'director',
  )
  if (cast.length === 0 && makers.length === 0) return undefined
  return (
    <Text style={styles.credits}>
      {cast.length === 0 ? undefined : (
        <>
          {t('item.with')} <Text style={styles.names}>{names(cast, 3)}</Text>
        </>
      )}
      {cast.length === 0 || makers.length === 0 ? undefined : ' · '}
      {makers.length === 0 ? undefined : (
        <>
          {item.kind === 'series' ? t('item.createdBy') : t('item.directedBy')}{' '}
          <Text style={styles.names}>{names(makers, 2)}</Text>
        </>
      )}
    </Text>
  )
}

/** One action of the head: icon over label on an iPhone, a glass button on an iPad. */
export const HeadAction = ({
  regular,
  ...action
}: {
  regular: boolean
  label: string
  icon: 'plus' | 'checkmark' | 'eye' | 'eye.slash'
  onPress: () => void
  selected?: boolean
}) => (regular ? <GlassButton {...action} showLabel /> : <ActionButton {...action} />)

/** The "Resume" bar of a title page: progress and time left. */
export const ProgressLine = ({ ratio, remaining }: { ratio: number; remaining: string }) => (
  <View style={styles.progress}>
    <ProgressBar ratio={ratio} style={styles.bar} />
    <Text style={styles.remaining}>{remaining}</Text>
  </View>
)

/**
 * Head of a title page (§13.5): on an iPhone the backdrop above the text (artboard
 * `MobileSeries`), on an iPad the text over the backdrop (artboard `Series`). Logo or title, the
 * metadata line (`extra`: running time or seasons), the main button and its progress, the
 * overview, the credits, the actions.
 */
export const DetailHead = ({
  item,
  backdrop,
  eyebrow,
  extra,
  regular,
  play,
  progress,
  actions,
}: {
  item: ItemDetailDto
  backdrop: string | undefined
  eyebrow?: string | undefined
  extra?: string | undefined
  regular: boolean
  play: ReactNode
  progress: ReactNode
  actions: ReactNode
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const { width, height } = useWindowDimensions()
  const title = itemTitle(t, item)
  const genres = item.genres.length === 0 ? undefined : genreLabels(t, item.genres, 3).join(', ')
  const heading = (
    <>
      {eyebrow === undefined ? undefined : <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <View accessibilityLabel={title} accessibilityRole="header" accessible>
        {item.kind === 'episode' || item.images.logo === undefined ? (
          <Text style={[styles.title, regular && styles.titleLarge]}>{title}</Text>
        ) : (
          <Artwork
            contentFit="contain"
            fallback={<Text style={[styles.title, regular && styles.titleLarge]}>{title}</Text>}
            path={item.images.logo}
            position="left bottom"
            style={regular ? styles.logoLarge : styles.logo}
            tinted={false}
            toneId={item.id}
          />
        )}
      </View>
      <MetaLine
        parts={[yearsLabel(item), extra, genres]}
        quality={qualityLabel(item.bestQuality)}
        rating={ratingBadge(t, locale, item.contentRating)}
      />
    </>
  )
  const overview =
    item.overview === undefined ? undefined : <Text style={styles.overview}>{item.overview}</Text>

  if (regular)
    return (
      <View style={[styles.wide, { height: Math.max(520, Math.min(width * 0.6, height * 0.78)) }]}>
        <Artwork path={backdrop} style={StyleSheet.absoluteFill} toneId={item.id} />
        <View style={[StyleSheet.absoluteFill, styles.shadeLeft]} />
        <View style={[StyleSheet.absoluteFill, styles.shadeBottom]} />
        <View style={styles.wideContent}>
          {heading}
          {overview}
          <CreditsLine item={item} />
          <View style={styles.wideActions}>
            {play}
            {actions}
          </View>
          {progress}
        </View>
      </View>
    )

  return (
    <View>
      <View style={styles.backdrop}>
        <Artwork path={backdrop} style={StyleSheet.absoluteFill} toneId={item.id} />
        <View style={[StyleSheet.absoluteFill, styles.shadeBottom]} />
      </View>
      <View style={styles.content}>
        {heading}
        {play}
        {progress}
        {overview}
        <View style={styles.actions}>{actions}</View>
        <CreditsLine item={item} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { width: '100%', aspectRatio: 16 / 10 },
  content: { gap: 14, paddingHorizontal: 16, paddingTop: 4 },
  eyebrow: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 12 * 0.16,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 32,
    lineHeight: 32,
    letterSpacing: 32 * -0.045,
  },
  titleLarge: { fontSize: 60, lineHeight: 58 },
  logo: { width: '80%', height: 72 },
  logoLarge: { width: 420, height: 110 },
  overview: { color: colors.textSoft, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 8 },
  credits: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21 },
  names: { color: colors.textSoft },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bar: { flex: 1 },
  remaining: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  wide: { width: '100%', overflow: 'hidden' },
  shadeLeft: {
    backgroundImage:
      'linear-gradient(90deg, rgba(10, 10, 11, 0.9) 0%, rgba(10, 10, 11, 0.5) 40%, rgba(10, 10, 11, 0) 70%)',
  },
  shadeBottom: { backgroundImage: 'linear-gradient(0deg, #0a0a0b 0%, rgba(10, 10, 11, 0) 45%)' },
  wideContent: { position: 'absolute', left: 28, right: 28, bottom: 40, maxWidth: 600, gap: 16 },
  wideActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
})
