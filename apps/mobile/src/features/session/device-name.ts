/** What `expo-device` reports, injected so the rule stays testable without React Native. */
export type DeviceFacts = {
  /** "iPhone 15 Pro"; the raw identifier ("iPhone18,2") for a model newer than expo-device. */
  readonly modelName?: string | undefined
  readonly isTablet: boolean
  /** `false` in the iOS Simulator, whose model name is "Simulator iOS". */
  readonly isDevice: boolean
}

const rawIdentifier = /^(iPhone|iPad|iPod)\d+,\d+$/

/**
 * `deviceName` of the sign-in and of the pairing claim (§26.3): the model ("iPhone 15 Pro", "iPad
 * Air"). An app cannot read the name the user gave the device since iOS 16. A model expo-device does
 * not know yet, or the Simulator, falls back to the family.
 */
export const deviceNameOf = ({ modelName, isTablet, isDevice }: DeviceFacts): string => {
  const family = isTablet ? 'iPad' : 'iPhone'
  const model = modelName?.trim() ?? ''
  if (!isDevice || model === '') return family
  return rawIdentifier.exec(model)?.[1] ?? model.slice(0, 64)
}
