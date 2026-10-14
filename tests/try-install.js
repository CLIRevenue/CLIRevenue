import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const child = spawn('node', ['.\\node_modules\\npm\\bin\\npm-cli.js', 'install', 'esbuild@0.28.2'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''

child.stdout.on('data', (data) => { stdout += data })
child.stderr.on('data', (data) => { stderr += data })

child.on('close', (code) => {
  writeFileSync('.\\tmp\\npm-install.out', stdout)
  writeFileSync('.\\tmp\\npm-install.err', stderr)
  console.log('EXIT:', code)
  console.log('OUT:', stdout.substring(0, 2000))
  console.log('ERR:', stderr.substring(0, 2000))
})

child.on('error', (e) => {
  writeFileSync('.\\tmp\\npm-install.err', 'SPAWN FAIL: ' + e.message)
  console.error('SPAWN FAIL:', e.message)
})