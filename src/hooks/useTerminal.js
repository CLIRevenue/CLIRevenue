import { useMemo } from 'react'
import { sampleTerminal } from '../lib/terminal.js'

/* =============================================================
   React binding for a terminal script
   -------------------------------------------------------------
   A pure derivation with no effects and no local state: all of the
   sequencing lives in lib/terminal.js and progress arrives already
   resolved from useTimelineProgress. Swapping the driver for the
   cinema timeline later changes what feeds this hook, not this hook.
   ============================================================= */

export function useTerminal(script, progress) {
  return useMemo(() => sampleTerminal(script, progress), [progress, script])
}

export default useTerminal
