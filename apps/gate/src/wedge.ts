// A desk scanner is a keyboard: it types the payload and presses Enter into
// whatever holds focus. On the idle screen that is the Scanner's own box, but
// while a verdict fills the screen there is no field at all — and an
// auto-sensing reader fires the moment the next member presents a phone, with
// no operator trigger. Without a document-level catcher that scan is silently
// lost and the staff keep looking at the previous person's verdict.
//
// Keystrokes are accumulated by this pure reducer so the behaviour is testable
// without a DOM; App owns the listener.

// A scanner types its payload in one burst. A longer gap means the keys belong
// to something else — a stray keypress hours ago must not prefix a scan.
const BURST_GAP_MS = 2000

export interface WedgeState {
  text: string
  at: number
}

export const EMPTY_WEDGE: WedgeState = { at: 0, text: '' }

// `done` is the completed payload when Enter closed a non-empty buffer, so the
// caller can both submit it and suppress whatever Enter would otherwise
// activate — the verdict screen is a button, and its click would race the scan.
export interface WedgeStep {
  next: WedgeState
  done: string | null
}

export const wedgeKey = (state: WedgeState, key: string, now: number): WedgeStep => {
  if (key === 'Enter') {
    return { done: state.text === '' ? null : state.text, next: EMPTY_WEDGE }
  }
  if (key === 'Escape') {
    return { done: null, next: EMPTY_WEDGE }
  }
  // Modifiers, arrows and function keys report multi-character names.
  if (key.length !== 1) {
    return { done: null, next: state }
  }
  return { done: null, next: { at: now, text: now - state.at > BURST_GAP_MS ? key : state.text + key } }
}
