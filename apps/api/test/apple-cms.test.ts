import { buildDetachedCms } from '@fuda/pass/apple'
import * as pkijs from 'pkijs'
import { describe, expect, it } from 'vitest'

import { testCert } from './apple-cert.ts'

const encode = (text: string): Uint8Array<ArrayBuffer> => {
  const bytes = new TextEncoder().encode(text)
  const out = new Uint8Array(new ArrayBuffer(bytes.length))
  out.set(bytes)
  return out
}

const MANIFEST = encode('{"pass.json":"a9993e36"}')

const NOW = 1_767_225_600

const parseSignedData = (der: Uint8Array<ArrayBuffer>): pkijs.SignedData => {
  const info = pkijs.ContentInfo.fromBER(der)
  return new pkijs.SignedData({ schema: info.content })
}

// The whole Apple path rests on this: pkijs must be able to produce a CMS
// SignedData over WebCrypto inside workerd, where there is no Node crypto.
describe('buildDetachedCms (in workerd)', () => {
  it('produces a detached SignedData that verifies against the signer certificate', async () => {
    const signer = await testCert()
    const cms = await buildDetachedCms(
      { certPem: signer.certPem, keyPem: signer.keyPem, wwdrPem: signer.certPem },
      MANIFEST,
      NOW,
    )
    const signed = parseSignedData(cms)
    expect(signed.encapContentInfo.eContent).toBeUndefined()
    const ok = await signed.verify({ checkChain: false, data: MANIFEST.buffer, signer: 0 })
    expect(ok).toBe(true)
  })

  it('fails to verify against a manifest that was tampered with', async () => {
    const signer = await testCert()
    const cms = await buildDetachedCms(
      { certPem: signer.certPem, keyPem: signer.keyPem, wwdrPem: signer.certPem },
      MANIFEST,
      NOW,
    )
    const tampered = encode('{"pass.json":"deadbeef"}')
    const signed = parseSignedData(cms)
    // pkijs rejects rather than resolving false when the signed messageDigest
    // attribute no longer matches the detached content.
    await expect(signed.verify({ checkChain: false, data: tampered.buffer, signer: 0 })).rejects.toThrow(
      /Message digest/u,
    )
  })

  it('carries the signer certificate and the WWDR intermediate', async () => {
    const signer = await testCert()
    const cms = await buildDetachedCms(
      { certPem: signer.certPem, keyPem: signer.keyPem, wwdrPem: signer.certPem },
      MANIFEST,
      NOW,
    )
    const signed = parseSignedData(cms)
    expect(signed.certificates).toHaveLength(2)
  })
})
