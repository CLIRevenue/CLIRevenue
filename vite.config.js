import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/* The SDK is consumed from source inside this app so the frontend boundary
   is the same code the published package ships, without adding a workspace
   dependency to the root package.json. Production consumers install
   @clirevenue/sdk from npm and drop this alias entirely. */
const sdk = fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@clirevenue/sdk': sdk,
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
