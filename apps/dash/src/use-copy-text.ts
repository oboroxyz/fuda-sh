import { useEffect, useRef, useState } from 'hono/jsx/dom'

const COPIED_MS = 2000

interface CopyController {
  copied: string | null
  failed: string | null
  copy: (value: string) => void
}

export const useCopyText = (): CopyController => {
  const [copied, setCopied] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const revision = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      revision.current += 1
      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
    },
    [],
  )
  return {
    copied,
    copy: (value) => {
      revision.current += 1
      const ticket = revision.current
      setFailed(null)
      const run = async (): Promise<void> => {
        try {
          await navigator.clipboard.writeText(value)
          if (ticket !== revision.current) {
            return
          }
          setCopied(value)
          if (timer.current !== null) {
            clearTimeout(timer.current)
          }
          timer.current = setTimeout(() => {
            setCopied(null)
            timer.current = null
          }, COPIED_MS)
        } catch {
          if (ticket === revision.current) {
            setCopied(null)
            setFailed(value)
          }
        }
      }
      void run()
    },
    failed,
  }
}
