/** Counting semaphore. */
export const createLimiter = (max: number) => {
  let active = 0
  const waiting: (() => void)[] = []
  const acquire = async (): Promise<void> => {
    if (active < max) {
      active += 1
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  const release = (): void => {
    const next = waiting.shift()
    if (next === undefined) active -= 1
    else next()
  }
  return async <T>(run: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await run()
    } finally {
      release()
    }
  }
}
