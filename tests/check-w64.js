import { readFileSync } from 'node:fs'
const b = readFileSync('.\\tmp\\w64.tgz')
console.log('first 12 bytes:', b.slice(0, 12).join(' '))
console.log('length:', b.length)