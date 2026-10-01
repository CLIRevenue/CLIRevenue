// Correct inline CLIRevenue script: track opening vs closing backticks so we
// only flag an unbalanced template literal once we finish a complete pair.
import { readFileSync } from 'node:fs'

const files = [
  'src/components/developer/DeveloperLanding.jsx',
]

let problems = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  let open = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '`') continue
    const isEscaped = i > 0 && s[i - 1] === '\\'
    if (isEscaped) continue
    if (open === 0) {
      open += 1 // first backtick of a template literal
    } else {
      open -= 1 // closing backtick of a template literal
    }
  }
  if (open === 0) {
    console.log(`ok   ${f} (template literals balanced)`)
  } else {
    console.log(`ERROR ${f}: ${open} unclosed backtick(s)`)
    problems += 1
  }
}
process.exit(problems ? 1 : 0)
