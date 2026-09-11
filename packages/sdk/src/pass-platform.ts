export type PassPlatform = 'apple' | 'google' | 'web'

// Presentation preference only, never an authorization or capability check.
// Unknown and desktop UAs use the browser pass, including iPads that omit all
// mobile markers in desktop mode.
export const passPlatform = (userAgent: string): PassPlatform => {
  if (/iPhone|iPad|iPod|Macintosh.*Mobile/iu.test(userAgent)) {
    return 'apple'
  }
  if (/Android/iu.test(userAgent)) {
    return 'google'
  }
  return 'web'
}
