export type DeviceFacts = {
  readonly modelName?: string | undefined
  readonly isTablet: boolean
  readonly isDevice: boolean
}

const rawIdentifier = /^(iPhone|iPad|iPod)\d+,\d+$/

export const deviceNameOf = ({ modelName, isTablet, isDevice }: DeviceFacts): string => {
  const family = isTablet ? 'iPad' : 'iPhone'
  const model = modelName?.trim() ?? ''
  if (!isDevice || model === '') return family
  return rawIdentifier.exec(model)?.[1] ?? model.slice(0, 64)
}
