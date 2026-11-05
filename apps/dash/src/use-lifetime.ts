import { useEffect, useRef } from 'preact/hooks'

// A component's lifetime for work that outlives a render. `mounted` is true until
// unmount, and `revision` moves on at unmount, so a ticket taken earlier reads as
// stale and its answer is dropped.
export const useLifetime = () => {
  const mounted = useRef(true)
  const revision = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      revision.current += 1
    }
  }, [])
  return { mounted, revision }
}
