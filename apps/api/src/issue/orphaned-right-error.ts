import { ChainError } from '../chain/client.ts'

// The right exists on chain but fuda has no row for it. Callers that do not care
// answer it like any other ChainError.
export class OrphanedRightError extends ChainError {
  override readonly name: string = 'OrphanedRightError'
}
