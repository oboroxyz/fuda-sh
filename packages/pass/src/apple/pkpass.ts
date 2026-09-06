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
export const buildPkpass = async (
  cfg: AppleConfig,
  input: ApplePassInput,
  now: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  const files = new Map<string, Uint8Array<ArrayBuffer>>([
    ['pass.json', utf8(JSON.stringify(passJson(cfg, input)))],
    ['icon.png', iconPng()],
  ])
  const manifest = utf8(await manifestOf(files))
  const signature = await buildDetachedCms(cfg, manifest, now)
  return buildZip([
    ...[...files].map(([name, data]) => ({ data, name })),
    { data: manifest, name: 'manifest.json' },
    { data: signature, name: 'signature' },
  ])
}
