export interface SessionGeneration {
  capture: () => number
  invalidate: () => void
  isCurrent: (ticket: number) => boolean
}

export const createSessionGeneration = (): SessionGeneration => {
  let value = 0
  return {
    capture: () => value,
    invalidate: () => {
      value += 1
    },
    isCurrent: (ticket) => ticket === value,
  }
}
