import { createVitest } from 'vitest/node'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const vitest = await createVitest('test', {
  config: resolve(__dirname, '..', 'vitest.config.js'),
  include: ['tests/**/*.test.{js,jsx,ts}'],
  watch: false,
})

console.log('VITEST STARTED')
await vitest.runFiles()
console.log('EXIT:', vitest.exitCode || 0)
console.log('RESULTS:', JSON.stringify(vitest.results, null, 2))