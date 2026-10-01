import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

const sdk = fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url))

/**
 * Node environment on purpose.
 *
 * These suites cover pure logic (the campaign status machine, budget-unit
 * parsing, the store's balance arithmetic, route resolution, secret
 * comparison), the SQL/route *contracts* the backend relies on, and the
 * static security invariants that a build would not catch (no service-role
 * key in src, no raw error passthrough, no accounting in public delivery
 * responses).
 *
 * The SDK is aliased to its source entry so the frontend boundary suites
 * exercise exactly the code the published package ships — same as
 * vite.config.js. Tests that need a DOM stub the globals they use rather
 * than pulling in a DOM implementation.
 *
 * @vitejs/plugin-react is present so the frontend boundary suites can render
 * the ad components with react-dom/server. Server rendering only — there is
 * still no DOM implementation in this project, so effects are asserted at
 * the module boundary instead of by mounting.
 *
 * Anything that needs a live Supabase project is optional and skips itself
 * unless SUPABASE_TEST_* env vars are supplied — see
 * tests/integration/backend.live.test.js. Nothing here reaches the network.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@clirevenue/sdk': sdk,
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.{js,jsx,ts}',
      'packages/sdk/tests/**/*.test.{js,ts}',
    ],
    testTimeout: 20000,
  },
})
