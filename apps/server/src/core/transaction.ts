/** Any value but a promise (or another thenable). */
export type Synchronous =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | undefined
  | void
  | (object & { readonly then?: never })

/**
 * Runs `run` in one database transaction. `run` is synchronous: SQLite would commit before an
 * awaited step ran, so a promise does not compile (and is refused at run time).
 */
export type Transaction = <T extends Synchronous>(run: () => T) => T
