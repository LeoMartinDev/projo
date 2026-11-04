import { Image, type ImageContentFit, type ImageContentPosition } from 'expo-image'
import { type ReactNode, useState } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'

import { toneOf } from '@projo/i18n/media'
import { profileIdHeader } from '@projo/shared/api/auth'

import { getCredentials } from '../../shared/api/credentials.ts'
import { tones } from '../../shared/styles/tokens.ts'
import { useReducedMotion } from '../../shared/ui/Backdrop.tsx'
import { useServerConnection } from '../server-connection/ServerConnection.tsx'

export const useServerImage = () => {
  const { gate } = useServerConnection()
  const base = gate.kind === 'connected' ? gate.url : ''
  return (path: string) => {
    const { token, profileId } = getCredentials()
    return {
      uri: `${base}${path}`,
      cacheKey: path,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(profileId === undefined ? {} : { [profileIdHeader]: profileId }),
      },
    }
  }
}

export const Artwork = ({
  path,
  toneId,
  style,
  contentFit = 'cover',
  position,
  fallback,
  tinted = true,
  onRatio,
}: {
  path: string | undefined
  toneId: string
  style?: StyleProp<ViewStyle>
  contentFit?: ImageContentFit
  position?: ImageContentPosition
  fallback?: ReactNode
  tinted?: boolean
  onRatio?: (ratio: number) => void
}) => {
  const image = useServerImage()
  const reduced = useReducedMotion()
  const [failed, setFailed] = useState<string>()
  const shown = path !== undefined && failed !== path
  return (
    <View
      style={[
        styles.box,
        tinted && {
          backgroundColor: tones[toneOf(toneId)],
          backgroundImage: 'linear-gradient(160deg, rgba(0, 0, 0, 0) 0%, #0e1014 100%)',
        },
        style,
      ]}
    >
      {shown ? (
        <Image
          accessible={false}
          contentFit={contentFit}
          {...(position === undefined ? {} : { contentPosition: position })}
          onError={() => setFailed(path)}
          {...(onRatio === undefined
            ? {}
            : { onLoad: ({ source }) => onRatio(source.width / source.height) })}
          source={image(path)}
          style={StyleSheet.absoluteFill}
          transition={reduced ? 0 : 300}
        />
      ) : (
        fallback
      )}
    </View>
  )
}

const styles = StyleSheet.create({ box: { overflow: 'hidden' } })
