import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const data = readFileSync('.\\tmp\\w64.tgz')
const u = gunzipSync(data)

console.log('total:', u.length)
// Dump header at offset 0, bytes 100-136
const h = u.slice(0, 256)
console.log('name bytes (0-100):', h.slice(0, 100).map(b => String.fromCharCode(b)).join(''))
console.log('size field (124-136):', [...h.slice(124, 136)].map(b => b.toString(16).padStart(2, '0')).join(' '))
console.log('size string:', h.slice(124, 136).toString('ascii'))
console.log('offsets around 512-520:', [...u.slice(512, 520)].map(b => b.toString(16).padStart(2, '0')).join(' '))
// Check magic of the file at offset 512
console.log('at 512:', [...u.slice(512, 516)].map(b => b.toString(16).padStart(2, '0')).join(' '))