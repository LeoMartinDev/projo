import { expect, test } from 'bun:test'

import { splashFactory, splashFadeMs } from './splash.ts'

const world = ({ showWindow = async (): Promise<unknown> => undefined } = {}) => {
  const calls: string[] = []
  const painted: (() => void)[] = []
  const timers: { run: () => void; ms: number }[] = []
  const splash = splashFactory({
    element: {
      classList: { add: (name) => calls.push(`class ${name}`) },
      remove: () => calls.push('removed'),
    },
    showWindow: async () => {
      calls.push('desktop_window_ready')
      return showWindow()
    },
    afterPaint: (run) => painted.push(run),
    later: (run, ms) => timers.push({ run, ms }),
    warn: (message) => calls.push(`warn ${message}`),
  })
  return { splash, calls, painted, timers }
}

test('the window is shown once, only after the splash is painted', () => {
  const { splash, calls, painted } = world()
  splash.showWindow()
  splash.showWindow()
  expect(calls).toEqual([])
  for (const run of painted) run()
  expect(calls).toEqual(['desktop_window_ready'])
})

test('an app that refuses to show the window from the page only warns', async () => {
  const { splash, calls, painted } = world({
    showWindow: async () => Promise.reject(new Error('unknown command')),
  })
  splash.showWindow()
  for (const run of painted) run()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).toEqual([
    'desktop_window_ready',
    'warn the window could not be shown by the page (an older app?)',
  ])
})

test('the splash fades out once, then goes away', () => {
  const { splash, calls, timers } = world()
  splash.dismiss()
  splash.dismiss()
  expect(calls).toEqual(['class splash--leaving'])
  expect(timers.map(({ ms }) => ms)).toEqual([splashFadeMs])
  for (const { run } of timers) run()
  expect(calls).toEqual(['class splash--leaving', 'removed'])
})
