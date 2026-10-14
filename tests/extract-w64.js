import { readFileSync, createWriteStream } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const data = readFileSync('.\\tmp\\w64.tgz')
const uncompressed = gunzipSync(data)
console.log('uncompressed size:', uncompressed.length)

// Locate 'package/esbuild.exe' via tar entry headers
let offset = 0
let entryStart = -1, entrySize = 0
const target = 'package/esbuild.exe'
while (offset < uncompressed.length) {
  if (offset + 512 > uncompressed.length) break
  const header = uncompressed.slice(offset, offset + 512)
  const name = header.slice(0, 100).toString('utf8').replace(/\0.*$/, '').trim()
  const size = parseInt(header.slice(124, 136).toString('ascii').trim(), 8) || 0
  if (!name || size <= 0) { console.log('END marker at', offset); break }
  if (name === target) { entryStart = offset + 512; entrySize = size; break }
  offset += 512 + Math.ceil(size / 512) * 512
}
if (entryStart < 0) { throw new Error('entry not found') }
console.log('found at', entryStart, 'size', entrySize)
const content = uncompressed.slice(entryStart, entryStart + entrySize)
console.log('written bytes:', content.length)
createWriteStream('.\\tmp\\w64\\esbuild.exe').end(content)