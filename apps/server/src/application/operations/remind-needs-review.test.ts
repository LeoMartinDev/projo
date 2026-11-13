import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { day, recordingNotifier, t0 } from '../../../test/support/operations-fakes.ts'
import { remindNeedsReviewFactory } from './remind-needs-review.ts'

describe('periodic checks (§15 notifications)', () => {
  test('scan/needs_review_count once a day while the queue is not empty', () => {
    let count = 3
    let last: Date | undefined
    const clock = createManualClock(t0)
    const { notifier, open, log } = recordingNotifier()
    const remind = remindNeedsReviewFactory({
      countNeedsReview: () => count,
      reminders: { read: () => last, write: (at) => (last = at) },
      notifier,
      clock,
    })
    remind()
    clock.advance(day / 2)
    remind()
    expect(log).toEqual(['notify scan/needs_review_count {"count":3}'])
    clock.advance(day / 2)
    count = 5
    remind()
    expect(open.get('scan/needs_review_count|needs_review')).toEqual({ count: 5 })
    count = 0
    remind()
    expect(open.size).toBe(0)
    expect(log).toEqual([
      'notify scan/needs_review_count {"count":3}',
      'resolve scan/needs_review_count',
      'notify scan/needs_review_count {"count":5}',
      'resolve scan/needs_review_count',
    ])
  })
})
