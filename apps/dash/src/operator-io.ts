import {
  checkCardSlug,
  checkHandle,
  claimVoucher,
  confirmEnsClaim,
  issuerMe,
  signInChallenge,
  signInVerify,
  signOut,
} from './api.ts'
import { DEFAULT_DESIGN_IO } from './app-actions.ts'
import type { DesignIo } from './app-actions.ts'
import { ENS_PAYMASTER_URL } from './config.ts'
import type { ClaimIo } from './ens-claim.ts'
import { submitClaim } from './ens-submit.ts'
import { signInWithPasskey } from './operator-sign-in.ts'
import type { SignInOutcome } from './operator-sign-in.ts'
import { baseAccountProvider, personalSign, requestAccount } from './wallet.ts'

export interface OperatorIo {
  checkHandle: typeof checkHandle
  checkSlug: typeof checkCardSlug
  claim: (token: string) => ClaimIo
  design: DesignIo
  signIn: () => Promise<SignInOutcome>
  signOut: typeof signOut
}

export const DEFAULT_OPERATOR_IO: OperatorIo = {
  checkHandle,
  checkSlug: checkCardSlug,
  claim: (token) => ({
    confirmClaim: async (txHash) => await confirmEnsClaim(token, txHash),
    requestVoucher: async () => await claimVoucher(token),
    submitClaim,
  }),
  design: DEFAULT_DESIGN_IO,
  signIn: async () =>
    await signInWithPasskey({
      challenge: signInChallenge,
      issuerMe,
      personalSign,
      provider: async () => await baseAccountProvider(ENS_PAYMASTER_URL),
      requestAccount,
      verify: signInVerify,
    }),
  signOut,
}
