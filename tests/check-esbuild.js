import { readFileSync } from 'node:fs'

const c = readFileSync('.\\tmp\\package\\lib\\main.js', 'utf8')
const i = c.indexOf('node-platform')
console.log('node-platform found at:', i)
if (i >= 0) {
  console.log(c.substring(i, i + 3000))
}

// Find binary path resolution
const j = c.indexOf('bin')
console.log('bin occurrences:', c.split('bin').length - 1)