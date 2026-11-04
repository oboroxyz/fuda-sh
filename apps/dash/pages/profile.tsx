import { PasskeySection } from '@fuda/ui'
import { createEffect, createSignal, on, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { claimVoucher, confirmEnsClaim } from '../src/api.ts'
import { cardDraft } from '../src/card-draft.ts'
import type { ClaimState } from '../src/ens-claim.ts'
import { initialClaimState, reconcileClaimState, runClaim } from '../src/ens-claim.ts'
import { readPendingEnsClaim, reconcilePendingEnsClaim, writePendingEnsClaim } from '../src/ens-pending.ts'
import { submitClaim } from '../src/ens-submit.ts'
import { EnsClaim } from '../src/EnsClaim.tsx'
import { operatorPasskeys } from '../src/operator-sign-in.ts'
import {
  useCopy,
  useDash,
  useNavigate,
  useOperator,
  useRefresh,
  useSessionExpired,
} from '../src/page-context.tsx'
import { commitVenueLogo, handleCheck, saveVenue } from '../src/venue-actions.ts'
import { VenuePage } from '../src/VenuePage.tsx'

export default function Profile(): JSX.Element {
  const shared = useDash()
  const copy = useCopy()
  const refresh = useRefresh()
  const navigate = useNavigate()
  const expired = useSessionExpired()
  const { issuer, operator, publicUrl } = useOperator()
  const ens = () => operator()?.ens ?? null
  const [claim, setClaim] = createSignal<ClaimState>(initialClaimState(ens()))

  // A claim submitted before a reload is remembered in the browser until the
  // api confirms it; the server cannot see it, so it joins here.
  createEffect(
    on(ens, (current, previous) => {
      const id = issuer()?.id
      const pending = id === undefined ? null : reconcilePendingEnsClaim(id, current)
      setClaim((state) =>
        previous === undefined && pending !== null
          ? { failure: 'unconfirmed', kind: 'failed', ...pending }
          : reconcileClaimState(state, current, pending, previous?.name),
      )
    }),
  )

  const onClaim = (): void => {
    const id = issuer()?.id
    const claimOnce = async (): Promise<void> => {
      let pending = id === undefined ? undefined : (readPendingEnsClaim(id) ?? undefined)
      const current = claim()
      if (current.kind === 'failed' && current.txHash !== undefined && current.name !== undefined) {
        pending = { name: current.name, txHash: current.txHash }
      }
      const result = await runClaim(
        {
          confirmClaim: async (txHash) => await confirmEnsClaim(txHash),
          requestVoucher: async () => await claimVoucher(),
          submitClaim,
        },
        (next) => {
          setClaim(next)
        },
        pending,
        (next) => {
          if (id !== undefined) {
            writePendingEnsClaim(id, next)
          }
        },
      )
      if (result.kind === 'claimed') {
        await refresh()
      }
    }
    const run = async (): Promise<void> => {
      try {
        await claimOnce()
      } catch {
        // A rejected claim leaves the last emitted state on screen.
      }
    }
    void run()
  }

  const ensSection = (
    <Show when={ens() !== null && issuer() !== null}>
      <EnsClaim
        copy={copy().ens}
        name={ens()?.name ?? ''}
        onClaim={onClaim}
        ownerAddress={issuer()?.operatorAddress ?? null}
        state={claim()}
      />
    </Show>
  )

  const refreshed = async (saved: boolean): Promise<boolean> => {
    if (saved) {
      await refresh()
    }
    return saved
  }

  return (
    <VenuePage
      busy={false}
      copy={copy()}
      ens={ens() === null ? null : ensSection}
      failure={null}
      hasCardDraft={cardDraft() !== null}
      issuer={issuer()}
      onCheckHandle={handleCheck(expired)}
      onCommitLogo={async (variants) => await refreshed(await commitVenueLogo(variants, expired))}
      onCreate={() => {
        // A registered venue is never created again; /start owns creation.
      }}
      onNavigate={navigate}
      onUpdate={async (body) => await refreshed(await saveVenue(body, expired))}
      passkeys={
        <Show when={issuer()?.operatorAddress === null}>
          <div class="card px-6 py-8">
            <PasskeySection
              copy={copy().passkeys}
              formatDate={(unix) =>
                new Date(unix * 1000).toLocaleDateString(shared.locale === 'ja' ? 'ja-JP' : 'en-US')
              }
              io={operatorPasskeys}
            />
          </div>
        </Show>
      }
      publicUrl={publicUrl()}
    />
  )
}
