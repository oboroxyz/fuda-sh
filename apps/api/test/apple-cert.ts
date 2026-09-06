import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'

// A throwaway Pass Type ID certificate: the .pkpass signature is verified
// against its public half in the tests, so they prove a real CMS signature
// rather than a shape. Generated with pkijs itself, inside workerd.
export interface TestCert {
  certPem: string
  keyPem: string
  certificate: pkijs.Certificate
}

const pem = (label: string, der: ArrayBuffer): string => {
  const bytes = new Uint8Array(der)
  const body = btoa(String.fromCodePoint(...bytes)).replaceAll(/(?<line>.{64})/gu, '$<line>\n')
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

const nameWithCommonName = (value: string): pkijs.RelativeDistinguishedNames =>
  new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.PrintableString({ value }) }),
    ],
  })

let once: Promise<TestCert> | null = null

const generate = async (): Promise<TestCert> => {
  const pair = await crypto.subtle.generateKey(
    {
      hash: 'SHA-256',
      modulusLength: 2048,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  )
  const cert = new pkijs.Certificate()
  cert.version = 2
  cert.serialNumber = new asn1js.Integer({ value: 1 })
  cert.issuer = nameWithCommonName('fuda test CA')
  cert.subject = nameWithCommonName('fuda test CA')
  cert.notBefore.value = new Date(Date.now() - 86_400_000)
  cert.notAfter.value = new Date(Date.now() + 86_400_000)
  await cert.subjectPublicKeyInfo.importKey(pair.publicKey)
  await cert.sign(pair.privateKey, 'SHA-256')
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  return {
    certPem: pem('CERTIFICATE', cert.toSchema(true).toBER(false)),
    certificate: cert,
    keyPem: pem('PRIVATE KEY', der.buffer),
  }
}

// Memoized: RSA keygen inside workerd is the slow part of these suites.
export const testCert = async (): Promise<TestCert> => {
  once ??= generate()
  return await once
}
