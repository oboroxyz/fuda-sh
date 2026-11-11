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
  images: { logo?: AppleLogo | null; strip?: AppleStrip | null } = {},
): Promise<Uint8Array<ArrayBuffer>> => {
  const { logo = null, strip = null } = images
  const files = new Map<string, Uint8Array<ArrayBuffer>>([
    ['pass.json', utf8(JSON.stringify(passJson(cfg, { ...input, hasStrip: strip !== null })))],
    ['icon.png', iconPng()],
  ])
  if (logo !== null) {
    files.set('logo.png', logo.logo1x)
    files.set('logo@2x.png', logo.logo2x)
    files.set('logo@3x.png', logo.logo3x)
  }
  if (strip !== null) {
    files.set('strip.png', strip.strip1x)
    files.set('strip@2x.png', strip.strip2x)
    files.set('strip@3x.png', strip.strip3x)
  }
  const manifest = utf8(await manifestOf(files))
  const signature = await buildDetachedCms(cfg, manifest, now)
  return buildZip([
    ...[...files].map(([name, data]) => ({ data, name })),
    { data: manifest, name: 'manifest.json' },
    { data: signature, name: 'signature' },
  ])
}

export interface AppleStrip {
  strip1x: Uint8Array<ArrayBuffer>
  strip2x: Uint8Array<ArrayBuffer>
  strip3x: Uint8Array<ArrayBuffer>
}
