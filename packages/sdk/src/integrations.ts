import * as v from 'valibot'

import { BADGE_KINDS } from './constants.ts'
import type { BadgeKind } from './constants.ts'

// A Card's integrations: the optional services an issuer turns on for that one
// Card (docs/specs/pass-types-and-flows.md#card-integrations). Every
// integration starts off, so a Card behaves as if the service did not exist
// until the operator opts in. `badges` lists the Badge kinds a member may
// attach to a Right issued under the Card; a later integration adds its own key
// here rather than a field on the Card itself, so the Card contract stays a
// description of the Card and this one stays a description of what is wired
// to it.
export const CardIntegrationsBody = v.strictObject({
  badges: v.pipe(
    v.array(v.picklist(BADGE_KINDS)),
    v.check((kinds) => new Set(kinds).size === kinds.length, 'a badge kind is listed once'),
  ),
})

export type CardIntegrations = v.InferOutput<typeof CardIntegrationsBody>

export const NO_INTEGRATIONS: CardIntegrations = { badges: [] }

// The kinds a member may actually attach on a Card: the ones the issuer turned
// on that this deployment can also verify. Ordered as BADGE_KINDS, so two
// callers agree on the list byte for byte.
export const offerableBadgeKinds = (
  enabled: readonly BadgeKind[],
  configured: readonly BadgeKind[],
): BadgeKind[] => BADGE_KINDS.filter((kind) => enabled.includes(kind) && configured.includes(kind))
