import type { Database as SqliteClient } from 'bun:sqlite'

import type { Db } from './database.ts'

type CommitState = { depth: number; pending: (() => void)[] }

/** Per connection, like the transaction it tracks. */
const states = new WeakMap<SqliteClient, CommitState>()

const stateOf = (db: Db): CommitState => {
  const existing = states.get(db.$client)
  if (existing !== undefined) return existing
  const created: CommitState = { depth: 0, pending: [] }
  states.set(db.$client, created)
  return created
}

/**
 * Runs `run` in a transaction (a savepoint when nested) that defers `afterCommit` effects: they
 * run once the outermost one commits, and those of a level that rolls back are dropped. Any
 * transaction whose work can publish an event opens it here, not with `db.transaction`.
 */
export const transaction = <T>(db: Db, run: () => T): T => {
  const state = stateOf(db)
  if (state.depth === 0 && db.$client.inTransaction) {
    throw new Error('a deferring transaction cannot open inside a plain db.transaction')
  }
  const mark = state.pending.length
  state.depth += 1
  let result: T
  try {
    result = db.transaction(() => run())
  } catch (error) {
    state.pending.splice(mark)
    throw error
  } finally {
    state.depth -= 1
  }
  if (state.depth === 0) {
    for (const effect of state.pending.splice(0)) effect()
  }
  return result
}

/**
 * The bus's `AfterCommit` on this connection: defers the effect while a `transaction` is open,
 * runs it at once otherwise. Publishing inside a plain `db.transaction` is a bug (its commit is
 * not tracked), so it throws, which rolls that transaction back.
 */
export const afterCommit = (db: Db, effect: () => void): void => {
  const state = states.get(db.$client)
  if (state !== undefined && state.depth > 0) {
    state.pending.push(effect)
    return
  }
  if (db.$client.inTransaction) {
    throw new Error('event published inside a plain db.transaction: open it with transaction()')
  }
  effect()
}
