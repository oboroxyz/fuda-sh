// A software authenticator, so the tests drive the real WebAuthn verifier with real
// signatures rather than stubbing it. Attestation is 'none', as in production.

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/[=]+$/u, '')

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// Just the CBOR the two structures below need.
const cborHead = (major: number, length: number): Uint8Array => {
  if (length < 24) {
    return Uint8Array.of(major * 32 + length)
  }
  if (length < 256) {
    return Uint8Array.of(major * 32 + 24, length)
  }
  return Uint8Array.of(major * 32 + 25, Math.floor(length / 256), length % 256)
}
const cborBytes = (bytes: Uint8Array): Uint8Array => concat(cborHead(2, bytes.length), bytes)
const cborText = (text: string): Uint8Array => concat(cborHead(3, utf8(text).length), utf8(text))
const cborInt = (value: number): Uint8Array => (value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value))

// user present, user verified, backup eligible, backed up
const ASSERTION_FLAGS = 0x1d
// the same, with attested credential data
const ATTESTATION_FLAGS = 0x5d

const derOf = (p1363: Uint8Array): Uint8Array => {
  const integer = (part: Uint8Array): Uint8Array => {
    let start = 0
    while (start < part.length - 1 && part[start] === 0) {
      start += 1
    }
    const trimmed = part.slice(start)
    const padded = (trimmed[0] ?? 0) >= 0x80 ? concat(Uint8Array.of(0), trimmed) : trimmed
    return concat(Uint8Array.of(0x02, padded.length), padded)
  }
  const body = concat(integer(p1363.slice(0, 32)), integer(p1363.slice(32)))
  return concat(Uint8Array.of(0x30, body.length), body)
}

const clientData = (type: string, challenge: string, origin: string): Uint8Array<ArrayBuffer> =>
  utf8(JSON.stringify({ challenge, crossOrigin: false, origin, type }))

export interface SoftwarePasskeyOptions {
  rpId: string
  origin: string
}

export class SoftwarePasskey {
  readonly id = crypto.getRandomValues(new Uint8Array(16))
  private counter = 0
  private keys: CryptoKeyPair | null = null

  private readonly opts: SoftwarePasskeyOptions

  constructor(opts: SoftwarePasskeyOptions) {
    this.opts = opts
  }

  get credentialId(): string {
    return b64url(this.id)
  }

  private async keyPair(): Promise<CryptoKeyPair> {
    this.keys ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])
    return this.keys
  }

  async attest(
    challenge: string,
    overrides: { flags?: number; origin?: string; rpId?: string } = {},
  ): Promise<unknown> {
    const { publicKey } = await this.keyPair()
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
    const cose = concat(
      cborHead(5, 5),
      cborInt(1),
      cborInt(2),
      cborInt(3),
      cborInt(-7),
      cborInt(-1),
      cborInt(1),
      cborInt(-2),
      cborBytes(raw.slice(1, 33)),
      cborInt(-3),
      cborBytes(raw.slice(33)),
    )
    const authData = concat(
      await sha256(utf8(overrides.rpId ?? this.opts.rpId)),
      Uint8Array.of(overrides.flags ?? ATTESTATION_FLAGS),
      new Uint8Array(4),
      new Uint8Array(16),
      Uint8Array.of(0, this.id.length),
      this.id,
      cose,
    )
    const attestationObject = concat(
      cborHead(5, 3),
      cborText('fmt'),
      cborText('none'),
      cborText('attStmt'),
      cborHead(5, 0),
      cborText('authData'),
      cborBytes(authData),
    )
    const clientDataJSON = clientData('webauthn.create', challenge, overrides.origin ?? this.opts.origin)
    return {
      clientExtensionResults: {},
      id: this.credentialId,
      rawId: this.credentialId,
      response: {
        attestationObject: b64url(attestationObject),
        clientDataJSON: b64url(clientDataJSON),
        transports: ['internal'],
      },
      type: 'public-key',
    }
  }

  async assert(
    challenge: string,
    overrides: { flags?: number; origin?: string; signWith?: SoftwarePasskey } = {},
  ): Promise<unknown> {
    this.counter += 1
    const authenticatorData = concat(
      await sha256(utf8(this.opts.rpId)),
      Uint8Array.of(overrides.flags ?? ASSERTION_FLAGS),
      Uint8Array.of(0, 0, 0, this.counter),
    )
    const clientDataJSON = clientData('webauthn.get', challenge, overrides.origin ?? this.opts.origin)
    const signer = overrides.signWith ?? this
    const { privateKey } = await signer.keyPair()
    const signature = await crypto.subtle.sign(
      { hash: 'SHA-256', name: 'ECDSA' },
      privateKey,
      concat(authenticatorData, await sha256(clientDataJSON)),
    )
    return {
      clientExtensionResults: {},
      id: this.credentialId,
      rawId: this.credentialId,
      response: {
        authenticatorData: b64url(authenticatorData),
        clientDataJSON: b64url(clientDataJSON),
        signature: b64url(derOf(new Uint8Array(signature))),
      },
      type: 'public-key',
    }
  }
}
