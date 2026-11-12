import { buildDetachedCms } from './cms.ts'
import { iconPng } from './icon.ts'
import { manifestOf } from './manifest.ts'
import { passJson } from './pass-json.ts'
import type { AppleConfig, ApplePassInput } from './pass-json.ts'
import { buildZip } from './zip.ts'

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

// A .pkpass is a stored ZIP of four files. `manifest.json` hashes the first
// two; `signature` is a detached CMS SignedData over the manifest — which is
// what makes the pass installable, since Wallet checks that chain to Apple.
// A venue's mark, already sized for Wallet's logo area. Absent for a venue
// with no logo, in which case the pass simply has none.
export interface AppleLogo {
  logo1x: Uint8Array<ArrayBuffer>
  logo2x: Uint8Array<ArrayBuffer>
  logo3x: Uint8Array<ArrayBuffer>
}

export const buildPkpass = async (
  cfg: AppleConfig,
  input: ApplePassInput,
  now: number,
  images: { logo?: AppleLogo | null; strip?: AppleImageSet | null; poster?: AppleImageSet | null } = {},
): Promise<Uint8Array<ArrayBuffer>> => {
  const { logo = null, strip = null } = images
  const poster = input.branding === null || input.branding === undefined ? null : (images.poster ?? null)
  const files = new Map<string, Uint8Array<ArrayBuffer>>([
    [
      'pass.json',
      utf8(JSON.stringify(passJson(cfg, { ...input, hasPoster: poster !== null, hasStrip: strip !== null }))),
    ],
    ['icon.png', iconPng()],
  ])
  if (logo !== null) {
    files.set('logo.png', logo.logo1x)
    files.set('logo@2x.png', logo.logo2x)
    files.set('logo@3x.png', logo.logo3x)
  }
  if (strip !== null) {
    files.set('strip.png', strip.first)
    files.set('strip@2x.png', strip.second)
    files.set('strip@3x.png', strip.third)
  }
  if (poster !== null) {
    files.set('artwork.png', poster.first)
    files.set('artwork@2x.png', poster.second)
    files.set('artwork@3x.png', poster.third)
    if (logo !== null) {
      files.set('primaryLogo.png', logo.logo1x)
      files.set('primaryLogo@2x.png', logo.logo2x)
      files.set('primaryLogo@3x.png', logo.logo3x)
    }
  }
  const manifest = utf8(await manifestOf(files))
  const signature = await buildDetachedCms(cfg, manifest, now)
  return buildZip([
    ...[...files].map(([name, data]) => ({ data, name })),
    { data: manifest, name: 'manifest.json' },
    { data: signature, name: 'signature' },
  ])
}

export interface AppleImageSet {
  first: Uint8Array<ArrayBuffer>
  second: Uint8Array<ArrayBuffer>
  third: Uint8Array<ArrayBuffer>
}
