import { createVitest } from 'vitest/node'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = []
const err = []

const oldLog = console.log
const oldErr = console.error

console.log = (...args) => { out.push(args.join(' ')); oldLog(...args) }
console.error = (...args) => { err.push(args.join(' ')); oldErr(...args) }

try {
  const vitest = await createVitest('test', {
    config: resolve(__dirname, 'vitest.db.config.js'),
    include: ['tests/db/**/*.test.js'],
    watch: false,
  })
  console.log('VITEST CREATED')
  await vitest.runFiles()
  console.log('RUNFILES DONE')
  console.log('EXIT:', vitest.exitCode || 0)
  console.log('PROCESSED:', vitest.processedTestFiles?.length || 0)
  for (const f of vitest.results.testFiles) {
    console.log('FILE:', f.filepath.split('/tests/').pop(), 'STATE:', f.result?.state, 'FAILURES:', f.result?.errors?.length)
  }
} catch (e) {
  console.error('CRASH:', e.message)
  console.error(e.stack)
} finally {
  writeFileSync(resolve(__dirname, 'vitest-db-run.out'), out.join('\\n'))
  writeFileSync(resolve(__dirname, 'vitest-db-err.out'), err.join('\\n'))
}