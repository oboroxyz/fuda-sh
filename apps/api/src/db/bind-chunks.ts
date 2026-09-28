// D1 rejects a statement that binds more than this many values, so a query over
// a variable-length list — a page of uids, a set of ids — cannot be one
// statement. It is split into batches of this size and the results merged
// (AGENTS.md: D1 writes).
export const D1_MAX_BOUND_PARAMS = 100

// The list in order, split into batches of at most `size` values. An empty list
// yields no batches at all, so a caller skips the query rather than building an
// `IN ()` that binds nothing. `size` is the number of values the batch binds,
// which equals the batch length only when the list is the statement's only bound
// parameter; a statement with other placeholders passes a smaller size.
export const bindChunks = <T>(values: readonly T[], size: number = D1_MAX_BOUND_PARAMS): T[][] => {
  const batches: T[][] = []
  for (let start = 0; start < values.length; start += size) {
    batches.push(values.slice(start, start + size))
  }
  return batches
}
