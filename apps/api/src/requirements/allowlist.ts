import { ADDRESS_RE } from '@fuda/sdk'
import type { Requirement } from '@fuda/sdk'

import type { Bindings } from '../env.ts'

// docs/specs/card-requirements.md#rules. The registries this deployment reads, from the
// comma-separated IP_REGISTRIES binding. Unset, or with no valid address, nothing is allowed.
const registryAllowlist = (env: Pick<Bindings, 'IP_REGISTRIES'>): ReadonlySet<string> =>
  new Set(
    (env.IP_REGISTRIES ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => ADDRESS_RE.test(entry)),
  )

// A requirement is already lower-cased by its schema, so it compares as it is.
export const requirementsAllowed = (
  env: Pick<Bindings, 'IP_REGISTRIES'>,
  requirements: readonly Requirement[],
): boolean => {
  const allowed = registryAllowlist(env)
  return requirements.every((requirement) => allowed.has(requirement.registry))
}
