import { expect, test } from 'bun:test'

import { choosesOnStep, widgetStepIndex } from './widget-step.ts'

test('widgetStepIndex: along the axis, stopping at the ends; across it, nothing', () => {
  // Season tabs: five across.
  const tabs = { count: 5, across: true }
  expect(widgetStepIndex({ ...tabs, index: 0, direction: 'right' })).toBe(1)
  expect(widgetStepIndex({ ...tabs, index: 3, direction: 'left' })).toBe(2)
  expect(widgetStepIndex({ ...tabs, index: 4, direction: 'right' })).toBeUndefined()
  expect(widgetStepIndex({ ...tabs, index: 0, direction: 'left' })).toBeUndefined()
  expect(widgetStepIndex({ ...tabs, index: 2, direction: 'down' })).toBeUndefined()
  // A menu's options: down.
  const list = { count: 3, across: false }
  expect(widgetStepIndex({ ...list, index: 0, direction: 'down' })).toBe(1)
  expect(widgetStepIndex({ ...list, index: 1, direction: 'up' })).toBe(0)
  expect(widgetStepIndex({ ...list, index: 1, direction: 'right' })).toBeUndefined()
  expect(widgetStepIndex({ ...list, index: -1, direction: 'down' })).toBeUndefined()
})

test('choosesOnStep: tabs wait for activate (a season each step would load), radio inputs follow focus', () => {
  expect(choosesOnStep('tab')).toBe(false)
  expect(choosesOnStep('radio')).toBe(false)
  expect(choosesOnStep('option')).toBe(false)
  expect(choosesOnStep('radio_input')).toBe(true)
})
