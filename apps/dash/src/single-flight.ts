export interface SingleFlight<Key> {
  isRunning: (key: Key) => boolean
  run: <Result>(key: Key, action: () => Promise<Result>) => Promise<Result> | null
}

export const createSingleFlight = <Key>(): SingleFlight<Key> => {
  const running = new Set<Key>()
  return {
    isRunning: (key) => running.has(key),
    run: <Result>(key: Key, action: () => Promise<Result>): Promise<Result> | null => {
      if (running.has(key)) {
        return null
      }
      running.add(key)
      try {
        return action().finally(() => {
          running.delete(key)
        })
      } catch (error) {
        running.delete(key)
        throw error
      }
    },
  }
}
