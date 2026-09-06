import type { Hex } from './constants.ts'
import type { PassUrls } from './types.ts'

// Always all three keys, even when a platform is unconfigured (that endpoint 501s).
export const passUrls = (baseUrl: string, uid: Hex): PassUrls => {
  const base = baseUrl.replace(/\/$/u, '')
  return {
    apple: `${base}/pass/${uid}/apple.pkpass`,
    google: `${base}/pass/${uid}/google`,
    web: `${base}/pass/${uid}`,
  }
}
