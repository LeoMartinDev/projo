import { useEvent } from 'expo'
import { NetworkStateType, useNetworkState } from 'expo-network'
import { useIsFocused } from 'expo-router'
import { useVideoPlayer, type VideoPlayer, VideoView } from 'expo-video'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { ratingBadge } from '@projo/i18n/content-ratings'
import { genreLabels } from '@projo/i18n/genres'
import { episodeLine, itemTitle } from '@projo/i18n/item-titles'
import { progressRatioOf, yearsLabel } from '@projo/i18n/media'
import type { HomeHeroDto } from '@projo/shared/api/home'

import { colors, fonts, titleTracking } from '../../shared/styles/tokens.ts'
import { useReducedMotion } from '../../shared/ui/Backdrop.tsx'
import { useWatchlistToggle } from '../catalog/actions.ts'
import { Artwork, useServerImage } from '../media/Artwork.tsx'
import { GlassButton, PlayButton } from '../media/buttons.tsx'
import { formatRemaining, playLabelOf, useLocale } from '../media/card-text.ts'
import { useOpenItem } from '../media/navigation.ts'
import { MetaLine, ProgressBar } from '../media/parts.tsx'

/** expo-video's player is driven by assigning its properties, which hook values may not be. */
const setPlayerMuted = (player: VideoPlayer, muted: boolean) => {
  player.muted = muted
}

/** Minimum time without touching the screen before the preview plays (the web's 2 s, §13.3). */
const previewDelayMs = 2000

/**
 * The hero's video preview, iPad only and on Wi-Fi (§26.5), never under reduced motion: the clip
 * (`previewUrl`) loops muted over the backdrop once it plays, paused while the home is not shown.
 */
const HeroPreview = ({ url }: { url: string }) => {
  const { t } = useTranslation()
  const image = useServerImage()
  const focused = useIsFocused()
  const [muted, setMuted] = useState(true)
  const { uri, headers } = image(url)
  const player = useVideoPlayer({ uri, headers }, (created) => {
    created.loop = true
    created.muted = true
  })
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing })
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), previewDelayMs)
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (started && focused) player.play()
    else player.pause()
  }, [player, started, focused])

  return (
    <>
      <VideoView
        contentFit="cover"
        nativeControls={false}
        player={player}
        style={[StyleSheet.absoluteFill, { opacity: isPlaying ? 1 : 0 }]}
      />
      {isPlaying ? (
        <View style={styles.sound}>
          <GlassButton
            icon={muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'}
            label={muted ? t('home.previewUnmute') : t('home.previewMute')}
            onPress={() => {
              setPlayerMuted(player, !muted)
              setMuted(!muted)
            }}
            round
            selected={!muted}
            showLabel={false}
          />
        </View>
      ) : undefined}
    </>
  )
}

/**
 * Hero of the home (§13.3): on an iPhone the 4:5 card of `MobileHome` on a fixed backdrop; on an
 * iPad the landscape hero of `Home`, with the video preview on Wi-Fi. Logo (title when absent),
 * metadata line, "Play" / "Resume S2 · E4", My list, More info.
 */
export const Hero = ({
  hero,
  regular,
  under = 0,
}: {
  hero: HomeHeroDto
  regular: boolean
  /** iPad: height of the bars and header drawn over the hero, added to it. */
  under?: number
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const { width, height } = useWindowDimensions()
  const watchlist = useWatchlistToggle()
  const openItem = useOpenItem()
  const network = useNetworkState()
  const reduced = useReducedMotion()
  const { item, episode, play } = hero
  const title = itemTitle(t, item)
  const listed = watchlist.listed(item)
  const playLabel = playLabelOf(t, item, play)
  const rating = ratingBadge(t, locale, item.contentRating)
  const genres = item.genres.length === 0 ? undefined : genreLabels(t, item.genres, 3).join(', ')
  // The box hugs the logo, as the web's `<img>` within its max sizes: no empty band above it.
  const [logoRatio, setLogoRatio] = useState<number>()
  const logoMax = regular ? { width: 420, height: 110 } : { width: width - 64, height: 90 }
  const logoWidth =
    logoRatio === undefined ? undefined : Math.min(logoMax.width, logoMax.height * logoRatio)
  const logo = (
    <Artwork
      contentFit="contain"
      fallback={
        <Text numberOfLines={3} style={[styles.title, regular && styles.titleLarge]}>
          {title}
        </Text>
      }
      path={item.images.logo}
      position={regular ? 'left bottom' : 'bottom center'}
      onRatio={setLogoRatio}
      style={[
        styles.logo,
        regular ? styles.logoLarge : styles.logoCentered,
        logoWidth === undefined || logoRatio === undefined
          ? {}
          : {
              width: logoWidth,
              height: logoWidth / logoRatio,
              alignSelf: regular ? 'flex-start' : 'center',
            },
      ]}
      tinted={false}
      toneId={item.id}
    />
  )
  const listButton = (
    <GlassButton
      icon={listed ? 'checkmark' : 'plus'}
      label={t('card.myList')}
      onPress={() => watchlist.toggle(item, !listed)}
      round={regular}
      selected={listed}
      showLabel={!regular}
    />
  )
  const infoButton = (
    <GlassButton
      icon="info.circle"
      label={t('card.info')}
      onPress={() => openItem(item)}
      showLabel={regular}
    />
  )

  if (!regular)
    return (
      // The card opens the title page (`MobileHome` has no "More info" button).
      <Pressable
        accessibilityHint={t('card.infoOn', { title })}
        onPress={() => openItem(item)}
        style={styles.card}
      >
        <Artwork path={item.images.backdrop} style={StyleSheet.absoluteFill} toneId={item.id} />
        <View style={[StyleSheet.absoluteFill, styles.cardShade]} />
        <View style={styles.cardContent}>
          {logo}
          <MetaLine center parts={[yearsLabel(item), genres]} rating={rating} />
          <View style={styles.actions}>
            <View style={styles.play}>
              <PlayButton label={playLabel} />
            </View>
            <View style={styles.grow}>{listButton}</View>
          </View>
        </View>
      </Pressable>
    )

  const playing = episode ?? item
  const ratio = play?.action === 'resume' ? progressRatioOf(playing) : undefined
  const remainingMs =
    ratio === undefined || playing.progress === undefined
      ? undefined
      : playing.progress.durationMs - playing.progress.positionMs
  const eyebrow =
    item.kind === 'series'
      ? episode?.seasonNumber === undefined
        ? t('card.series')
        : t('home.seriesSeason', { number: episode.seasonNumber })
      : t('card.movie')
  const preview =
    hero.previewUrl !== undefined && network.type === NetworkStateType.WIFI && !reduced
      ? hero.previewUrl
      : undefined

  return (
    <View style={[styles.wide, { height: Math.min(width * 0.62, height * 0.72) + under }]}>
      <Artwork path={item.images.backdrop} style={StyleSheet.absoluteFill} toneId={item.id} />
      {preview === undefined ? undefined : <HeroPreview key={preview} url={preview} />}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wideShadeLeft]} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wideShadeBottom]} />
      <View style={styles.wideContent}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        {logo}
        <MetaLine parts={[yearsLabel(item), genres]} rating={rating} />
        {item.overview === undefined ? undefined : (
          <Text numberOfLines={3} style={styles.overview}>
            {item.overview}
          </Text>
        )}
        <View style={styles.wideActions}>
          <PlayButton label={playLabel} size="large" />
          {infoButton}
          {listButton}
        </View>
        {ratio === undefined ? undefined : (
          <View style={styles.progressLine}>
            {episode === undefined ? undefined : (
              <Text numberOfLines={1} style={styles.episode}>
                {episodeLine(t, episode)}
              </Text>
            )}
            <ProgressBar ratio={ratio} style={styles.bar} track="rgba(255, 255, 255, 0.18)" />
            {remainingMs === undefined ? undefined : (
              <Text style={styles.remaining}>
                {t('item.remaining', { duration: formatRemaining(remainingMs, locale) })}
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  )
}

/** Height of the hero, for its skeleton while the home loads. */
export const heroHeight = (regular: boolean, width: number, height: number): number =>
  regular ? Math.min(width * 0.62, height * 0.72) : ((width - 32) * 5) / 4

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    aspectRatio: 4 / 5,
    borderRadius: 22,
    overflow: 'hidden',
    boxShadow: '0 30px 60px -24px rgba(0, 0, 0, 0.9)',
  },
  cardShade: {
    backgroundImage: 'linear-gradient(0deg, rgba(10, 10, 11, 0.92) 0%, rgba(10, 10, 11, 0) 55%)',
  },
  cardContent: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    alignItems: 'center',
    gap: 12,
  },
  logo: { width: '100%' },
  logoCentered: { height: 90 },
  logoLarge: { height: 110, maxWidth: 420 },
  title: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 36,
    lineHeight: 36,
    letterSpacing: 36 * -0.045,
    textAlign: 'center',
    marginTop: 'auto',
  },
  titleLarge: {
    fontSize: 64,
    lineHeight: 62,
    letterSpacing: titleTracking(64) * 1.5,
    textAlign: 'left',
  },
  actions: { flexDirection: 'row', gap: 10, width: '100%' },
  play: { flex: 3 },
  grow: { flex: 2 },
  wide: { width: '100%', overflow: 'hidden' },
  wideShadeLeft: {
    backgroundImage:
      'linear-gradient(90deg, rgba(10, 10, 11, 0.82) 0%, rgba(10, 10, 11, 0.4) 38%, rgba(10, 10, 11, 0) 68%)',
  },
  wideShadeBottom: {
    backgroundImage: 'linear-gradient(0deg, #0a0a0b 0%, rgba(10, 10, 11, 0) 40%)',
  },
  wideContent: { position: 'absolute', left: 28, right: 28, bottom: 36, maxWidth: 560, gap: 16 },
  eyebrow: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 12 * 0.16,
    textTransform: 'uppercase',
  },
  overview: {
    maxWidth: 480,
    color: colors.textSoft,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  wideActions: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 },
  progressLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  episode: { flexShrink: 1, color: colors.textSoft, fontFamily: fonts.regular, fontSize: 13 },
  bar: { width: 120 },
  remaining: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  sound: { position: 'absolute', right: 28, bottom: 36 },
})
