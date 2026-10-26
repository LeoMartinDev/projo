import { requireOptionalNativeModule } from 'expo'

export type PresentOptions = { url: string; title: string }

type NativePlayer = { present: (options: PresentOptions) => Promise<void> }

/** The §26.6 prototype's native module; `undefined` in Expo Go, which cannot load it. */
export const nativePlayer = requireOptionalNativeModule<NativePlayer>('NativePlayer') ?? undefined
