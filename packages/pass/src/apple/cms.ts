import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'

import { pemToDer } from '../pem.ts'

// pkijs reaches WebCrypto through a global "engine" rather than through
// `globalThis` directly; it registers one from `globalThis.crypto` on import,
// which resolves in both Node 24 and workerd. `true` throws rather than
// returning null if a runtime ever fails to provide it.
const useEngine = (): pkijs.ICryptoEngine => pkijs.getCrypto(true)

const parseCertificate = (pem: string): pkijs.Certificate =>
  pkijs.Certificate.fromBER(pemToDer(pem, 'CERTIFICATE'))

// OIDs from RFC 5652: the payload content type, the SignedData wrapper, and
// the three signed attributes Apple's `signature` file carries.
const ID_DATA = '1.2.840.113549.1.7.1'
const ID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const ID_ATTR_CONTENT_TYPE = '1.2.840.113549.1.9.3'
const ID_ATTR_SIGNING_TIME = '1.2.840.113549.1.9.5'
const ID_ATTR_MESSAGE_DIGEST = '1.2.840.113549.1.9.4'
const ID_SHA256 = '2.16.840.1.101.3.4.2.1'

export interface CmsInput {
  // the Pass Type ID certificate, PEM
  certPem: string
  // its private key, PKCS#8 PEM
  keyPem: string
  // the Apple WWDR intermediate, PEM — shipped inside the SignedData so the
  // device can build the chain without fetching it
  wwdrPem: string
}

// Apple's `signature` file: a detached CMS SignedData over `manifest.json`,
// RSASSA-PKCS1-v1_5 over SHA-256, signed by the Pass Type ID certificate.
// Detached means `eContent` is absent — the manifest travels beside it in the ZIP.
export const buildDetachedCms = async (
  input: CmsInput,
  manifest: Uint8Array<ArrayBuffer>,
  now: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  const engine = useEngine()
  const signerCert = parseCertificate(input.certPem)
  const wwdrCert = parseCertificate(input.wwdrPem)
  const key = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    pemToDer(input.keyPem, 'PRIVATE KEY'),
    { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
    false,
    ['sign'],
  )
  // With signed attributes present the signature covers their DER, not the
  // manifest, so the manifest digest has to be carried as an attribute here —
  // pkijs does not add it.
  const digest = await engine.digest({ name: 'SHA-256' }, manifest)
  const signed = new pkijs.SignedData({
    certificates: [signerCert, wwdrCert],
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: ID_SHA256 })],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: ID_DATA }),
    signerInfos: [
      new pkijs.SignerInfo({
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: signerCert.issuer,
          serialNumber: signerCert.serialNumber,
        }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          attributes: [
            new pkijs.Attribute({
              type: ID_ATTR_CONTENT_TYPE,
              values: [new asn1js.ObjectIdentifier({ value: ID_DATA })],
            }),
            new pkijs.Attribute({
              type: ID_ATTR_SIGNING_TIME,
              values: [new asn1js.UTCTime({ valueDate: new Date(now * 1000) })],
            }),
            new pkijs.Attribute({
              type: ID_ATTR_MESSAGE_DIGEST,
              values: [new asn1js.OctetString({ valueHex: digest })],
            }),
          ],
          type: 0,
        }),
        version: 1,
      }),
    ],
    version: 1,
  })
  await signed.sign(key, 0, 'SHA-256', manifest)
  const wrapped = new pkijs.ContentInfo({ content: signed.toSchema(true), contentType: ID_SIGNED_DATA })
  return new Uint8Array(wrapped.toSchema().toBER(false))
}
