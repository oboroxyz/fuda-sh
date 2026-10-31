import { createSignal, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'

const COPIED_MS = 2000

interface CopyController {
  copied: Accessor<string | null>
  failed: Accessor<string | null>
  copy: (value: string) => void
}

// Copies to the clipboard and remembers which value was copied (or failed) for
// a moment, so a button can say "Copied". A newer copy supersedes an older one
// that is still waiting on the clipboard.
export const createCopyText = (): CopyController => {
  const [copied, setCopied] = createSignal<string | null>(null)
  const [failed, setFailed] = createSignal<string | null>(null)
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    revision += 1
    if (timer !== null) {
      clearTimeout(timer)
    }
  })
  return {
    copied,
    copy: (value) => {
      revision += 1
      const ticket = revision
      setFailed(null)
      const run = async (): Promise<void> => {
        try {
          await navigator.clipboard.writeText(value)
          if (ticket !== revision) {
            return
          }
          setCopied(value)
          if (timer !== null) {
            clearTimeout(timer)
          }
          timer = setTimeout(() => {
            setCopied(null)
            timer = null
          }, COPIED_MS)
        } catch {
          if (ticket === revision) {
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
