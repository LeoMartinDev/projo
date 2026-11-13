import type { Database as SqliteClient } from 'bun:sqlite'

import type { AfterCommit } from '../../core/events.ts'
import type { Logger } from '../../core/logger.ts'
import type { Synchronous } from '../../core/transaction.ts'
import type { Db } from './database.ts'

type Deferred = { effect: () => void; logger: Logger }
type CommitState = { depth: number; pending: Deferred[] }

/** Per connection, like the transaction it tracks. */
const states = new WeakMap<SqliteClient, CommitState>()

const stateOf = (db: Db): CommitState => {
  const existing = states.get(db.$client)
  if (existing !== undefined) return existing
  const created: CommitState = { depth: 0, pending: [] }
  states.set(db.$client, created)
  return created
}

const isThenable = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  'then' in value &&
  typeof (value as { then: unknown }).then === 'function'

/**
 * Every effect runs, in order: the transaction has committed, so a failing effect is logged
 * instead of failing its caller or the effects after it.
 */
const runCommitted = (effects: Deferred[]): void => {
  for (const { effect, logger } of effects) {
    try {
      effect()
    } catch (error) {
      logger.error('effect after commit failed', { error })
    }
  }
}

/**
 * Runs `run` in a transaction (a savepoint when nested) that defers `afterCommit` effects: they
 * run once the outermost one commits, and those of a level that rolls back are dropped. Any
 * transaction whose work can publish an event or defer an effect opens here, not with
 * `db.transaction`. `run` must be synchronous: a promise would let SQLite commit before its
 * awaited steps, so it is refused (and the transaction rolled back).
 */
export const transaction = <T extends Synchronous>(db: Db, run: () => T): T => {
  const state = stateOf(db)
  if (state.depth === 0 && db.$client.inTransaction) {
    throw new Error('a deferring transaction cannot open inside a plain db.transaction')
  }
  const mark = state.pending.length
  state.depth += 1
  let result: T
  try {
    result = db.transaction(() => {
      const value = run()
      if (isThenable(value)) throw new Error('a transaction callback must not return a promise')
      return value
    })
  } catch (error) {
    state.pending.splice(mark)
    throw error
  } finally {
    state.depth -= 1
  }
  if (state.depth === 0) runCommitted(state.pending.splice(0))
  return result
}

/**
 * The `AfterCommit` of a connection: while a `transaction` is open, the effect waits for the
 * outermost commit (an error it throws then is logged); otherwise it runs at once, its errors
 * reaching the caller as a direct call's would.
 *
 * The guard below only sees the top level: an effect deferred inside a plain `db.transaction`
 * opened outside any `transaction()` throws (its commit cannot be tracked), which rolls it back;
 * a plain `db.transaction` nested inside `transaction()` is only a savepoint whose own rollback
 * is not tracked, so its effects still wait for the enclosing commit.
 */
export const createSqliteAfterCommit =
  ({ db, logger }: { db: Db; logger: Logger }): AfterCommit =>
  (effect) => {
    const state = states.get(db.$client)
    if (state !== undefined && state.depth > 0) {
      state.pending.push({ effect, logger })
      return
    }
    if (db.$client.inTransaction) {
      throw new Error('effect deferred inside a plain db.transaction: open it with transaction()')
    }
    effect()
  }
