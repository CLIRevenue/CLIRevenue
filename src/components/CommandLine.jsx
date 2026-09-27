/* Tokens are re-derived from the text as it is typed, so a
   half-typed flag still renders in flag colour and the full
   `textContent` stays correct at every keystroke. */
function tokenize(command) {
  const trimmed = command.trim()
  if (trimmed === '') return []
  return trimmed.split(/\s+/)
}

function CommandLine({ command = '', showCursor = true, showSigil = true }) {
  const tokens = tokenize(command)

  const spans = tokens.reduce((acc, token) => {
    const isFlag = token.startsWith('-')
    const isValue = Boolean(acc.at(-1)?.isFlag)
    acc.push({
      token,
      isFlag,
      cls: isFlag || isValue ? 'prompt__flag' : 'prompt__cmd',
    })
    return acc
  }, [])

  return (
    <span className="prompt">
      {showSigil && <span className="prompt__sigil">$</span>}
      {tokens.length > 0 ? (
        <span className="prompt__text">
          {spans.map((span, i) => (
            <span key={i}>
              {i > 0 && ' '}
              <span className={span.cls}>{span.token}</span>
            </span>
          ))}
          {showCursor && <span className="cursor" aria-hidden="true" />}
        </span>
      ) : (
        showCursor && <span className="cursor cursor--lead" aria-hidden="true" />
      )}
    </span>
  )
}

export default CommandLine
