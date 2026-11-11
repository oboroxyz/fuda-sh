import type { RequirementKind } from '@fuda/sdk'

import type { RequirementAdapter } from './adapter.ts'
import { erc8432Agreement } from './erc8432-agreement.ts'

export const requirementAdapters = {
  'erc8432-agreement': erc8432Agreement,
} satisfies Record<RequirementKind, RequirementAdapter>
