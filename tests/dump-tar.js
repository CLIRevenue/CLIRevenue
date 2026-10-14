import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const data = readFileSync('.\\tmp\\w64.tgz')
const uncompressed = gunzipSync(data)
console.log('uncompressed size:', uncompressed.length)

let offset = 0
let count = 0
while (offset < uncompressed.length && count < 8) {
  if (offset + 512 > uncompressed.length) break
  const header = uncompressed.slice(offset, offset + 512)
  const name = header.slice(0, 100).toString('utf8').replace(/\0.*$/, '').trim()
  const sizeRaw = header.slice(124, 136).toString('ascii').trim()
  const size = parseInt(sizeRaw, 8) || 0
  console.log(`entry ${count}: offset=${offset} name="${name}" sizeRaw="${sizeRaw}" size=${size}`)
  const nblocks = Math.max(1, Math.ceil(size / 512))
  offset += 512 + nblocks * 512
  count++
}