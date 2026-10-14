import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const u = gunzipSync(readFileSync('.\\tmp\\w64.tgz'))
const name = u.slice(0, 100).toString('utf8').replace(/\0.*$/, '').trim()
console.log('name=["' + name + '"]')
console.log('first 20 bytes:', [...u.slice(0, 20)].join(' '))
const sizeRaw = u.slice(124, 136).toString('ascii').trim()
console.log('sizeRaw=["' + sizeRaw + '"]')
console.log('sizeOctal=', parseInt(sizeRaw, 8))