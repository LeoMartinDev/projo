import { describe, expect, test } from 'bun:test'

import { playerFailure } from './failure.ts'
import { adjacentChannel, creationFailureReaction, heartbeatFailureReaction } from './live.ts'

describe('live rules (§29.5)', () => {
  test('the adjacent channel follows the order and wraps at both ends', () => {
    const order = ['a', 'b', 'c']
    expect(adjacentChannel(order, 'a', 1)).toBe('b')
    expect(adjacentChannel(order, 'c', 1)).toBe('a')
    expect(adjacentChannel(order, 'a', -1)).toBe('c')
    expect(adjacentChannel(order, 'b', -1)).toBe('a')
  })

  test('no adjacent channel for a channel alone or not listed', () => {
    expect(adjacentChannel(['a'], 'a', 1)).toBeUndefined()
    expect(adjacentChannel(['a', 'b'], 'z', 1)).toBeUndefined()
    expect(adjacentChannel([], 'a', -1)).toBeUndefined()
  })

  test('a creation reconnects only when the network is lost', () => {
    expect(creationFailureReaction(playerFailure(0, 'network', 'offline'))).toBe('reconnect')
    for (const code of [
      'tv/stream_unavailable',
      'tv/connection_limit_reached',
      'tv/channel_not_found',
    ] as const)
      expect(creationFailureReaction(playerFailure(503, code, code))).toBe('block')
  })

  test('a heartbeat replaces a session gone, blocks on a failed stream, ignores the rest', () => {
    expect(heartbeatFailureReaction(playerFailure(404, 'tv/session_not_found', ''))).toBe(
      'reconnect',
    )
    expect(heartbeatFailureReaction(playerFailure(502, 'tv/stream_unavailable', ''))).toBe('block')
    expect(heartbeatFailureReaction(playerFailure(404, 'tv/channel_not_found', ''))).toBe('block')
    expect(heartbeatFailureReaction(playerFailure(0, 'network', ''))).toBeUndefined()
  })
})
