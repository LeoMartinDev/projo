import { expect, test } from 'bun:test'

import { library } from '../../../test/support/assistant-fakes.ts'
import { getReviewSummaryFactory } from './get-review-summary.ts'

test('names each library and totals the files to review', () => {
  const summary = getReviewSummaryFactory({
    libraries: { list: () => [library('lib-1', 'Shows')] },
    sources: {
      reviewSummary: () => ({
        toReview: [
          { libraryId: 'lib-1', reason: 'no_match', count: 3 },
          { libraryId: 'lib-gone', count: 2 },
        ],
        byState: { pending: 1, ready: 7, missing: 0, rejected: 4 },
      }),
    },
  })

  expect(summary()).toEqual({
    toReview: [
      { libraryId: 'lib-1', reason: 'no_match', count: 3, library: 'Shows' },
      { libraryId: 'lib-gone', count: 2, library: undefined },
    ],
    totalToReview: 5,
    byState: { pending: 1, ready: 7, missing: 0, rejected: 4 },
  })
})
