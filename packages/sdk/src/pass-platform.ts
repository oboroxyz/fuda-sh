export type PassPlatform = 'apple' | 'google' | 'web'

// Presentation preference only, never an authorization or capability check.
// Unknown and desktop UAs use the browser pass, including iPads that omit all
// mobile markers in desktop mode.
export const passPlatform = (userAgent: string): PassPlatform => {
  const ua = userAgent.toLowerCase()
  const mac = ua.indexOf('macintosh')
  if (/iphone|ipad|ipod/u.test(ua) || (mac !== -1 && ua.includes('mobile', mac))) {
    return 'apple'
  }
  if (/Android/iu.test(userAgent)) {
    return 'google'
  }
  return 'web'
}
