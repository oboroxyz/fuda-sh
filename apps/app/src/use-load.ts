import { useStable } from '@fuda/ui/hooks'
import { useEffect, useRef, useState } from 'preact/hooks'

// Metadata reads may race a refetch or finish after the page leaves.
export const useLoad = <T>(load: () => Promise<T>) => {
  const [data, setData] = useState<T>()
  const [loadError, setError] = useState<Error>()
  const generation = useRef(0)
  const latest = useStable(load)
  const refetch = useStable(async () => {
    generation.current += 1
    const ticket = generation.current
    try {
      const result = await latest()
      if (ticket === generation.current) {
        setData(() => result)
        setError(undefined)
      }
    } catch (error) {
      if (ticket === generation.current) {
        setError(error instanceof Error ? error : new Error('Request failed'))
      }
    }
  })
  useEffect(() => {
    void refetch()
    return () => {
      generation.current += 1
    }
  }, [refetch])
  return { data, error: loadError, refetch }
}
