import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const jobs = sqliteTable(
  'jobs',
  {
    id: text().primaryKey(),
    type: text().notNull(),
    payload: text({ mode: 'json' }).$type<unknown>().notNull(),
    dedupeKey: text(),
    priority: integer().notNull(),
    state: text({ enum: ['queued', 'running', 'done', 'failed', 'cancelled'] }).notNull(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull(),
    runAfter: text().notNull(),
    startedAt: text(),
    finishedAt: text(),
    progress: integer(),
    error: text({ mode: 'json' }).$type<unknown>(),
  },
  (t) => [
    index('jobs_state_priority_idx').on(t.state, t.priority, t.runAfter),
    index('jobs_dedupe_key_idx').on(t.dedupeKey, t.state),
    index('jobs_state_finished_at_idx').on(t.state, t.finishedAt),
  ],
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    severity: text({ enum: ['info', 'warning', 'error'] }).notNull(),
    titleKey: text().notNull(),
    context: text({ mode: 'json' }).$type<unknown>().notNull().default({}),
    createdAt: text().notNull(),
    readAt: text(),
    resolvedAt: text(),
  },
  (t) => [
    index('notifications_created_at_idx').on(t.createdAt),
    index('notifications_unread_idx').on(t.readAt, t.resolvedAt),
    index('notifications_kind_resolved_idx').on(t.kind, t.resolvedAt),
  ],
)

export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text().notNull(),
})

export const appVersions = sqliteTable('app_versions', {
  version: text().primaryKey(),
  installedAt: text().notNull(),
  state: text({ enum: ['current', 'previous', 'failed', 'staged'] }).notNull(),
  runtimeMin: text().notNull(),
})

export const updateRuns = sqliteTable(
  'update_runs',
  {
    id: text().primaryKey(),
    kind: text({ enum: ['update', 'rollback'] }).notNull(),
    fromVersion: text().notNull(),
    toVersion: text().notNull(),
    requestedAt: text().notNull(),
    finishedAt: text(),
    outcome: text({ enum: ['pending', 'succeeded', 'failed', 'rolled_back'] }).notNull(),
    error: text({ mode: 'json' }).$type<unknown>(),
  },
  (t) => [index('update_runs_requested_at_idx').on(t.requestedAt)],
)
