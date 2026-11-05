import { useCallback, useRef } from 'preact/hooks'

// Long-lived listeners and dependencies call the latest render's closure.
export const useStable = <A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) => {
  const latest = useRef(fn)
  latest.current = fn
  return useCallback((...args: A) => latest.current(...args), [])
}
