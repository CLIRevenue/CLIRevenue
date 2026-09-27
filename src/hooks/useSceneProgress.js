import { useCallback, useSyncExternalStore } from 'react'

import { getSceneProgress, subscribe } from '../lib/cinemaStore.js'

/* How far through its own chapter a scene currently is, as a 0..1
   value written by the master timeline.

   The getter is memoised per id so `useSyncExternalStore` sees a
   stable snapshot function, and it returns a primitive so React can
   bail out of the re-render whenever that scene's number has not
   moved — which is most frames, once the film is past a chapter. */
export function useSceneProgress(id) {
  const read = useCallback(() => getSceneProgress(id), [id])
  return useSyncExternalStore(subscribe, read, read)
}

export default useSceneProgress
