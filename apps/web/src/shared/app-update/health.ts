import type { HealthResponse } from '@projo/shared/api/common'

export const readHealth = async (): Promise<HealthResponse | undefined> => {
  try {
    const response = await fetch('/health', { cache: 'no-store' })
    return response.ok ? ((await response.json()) as HealthResponse) : undefined
  } catch {
    return undefined
  }
}
