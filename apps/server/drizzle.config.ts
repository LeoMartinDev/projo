import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infrastructure/sqlite/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
})
