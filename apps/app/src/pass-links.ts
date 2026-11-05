import type { Hex } from '@fuda/sdk'
import { passUrls } from '@fuda/sdk'

import { API_BASE_URL } from './config.ts'

// The api's public origin, which the root layout learns from the Worker
// (src/server/session.ts). Module state rather than context: it is one value per
// deployment; the root layout supplies it before any pass link renders.
let publicOrigin = ''

export const setPublicApiOrigin = (origin: string): void => {
  publicOrigin = origin
}

// A pass's links as the member uses them. The wallet links and the probes go
// through the Worker's same-origin /api; the browser pass page must open on the
// api's own origin, because its script fetches `/pass/…` and `/verify/…` from
// wherever it is served.
export const memberPassUrls = (uid: Hex): ReturnType<typeof passUrls> => ({
  ...passUrls(API_BASE_URL, uid),
  web: passUrls(publicOrigin === '' ? API_BASE_URL : publicOrigin, uid).web,
})
