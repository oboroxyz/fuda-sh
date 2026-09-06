const ISSUER_HANDLE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u
const PARENT_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u
const RESERVED_ISSUER_HANDLES = new Set(['admin', 'api', 'app', 'dash', 'fuda', 'gate', 'www'])

const MEMBER_NUMBER_ALPHABET = '23456789acdefghjkmnpqrtuvwxy'
const MEMBER_NUMBER_LENGTH = 13

export type ParsedFudaEnsName =
  | { issuerHandle: string; kind: 'issuer' }
  | { issuerHandle: string; kind: 'member'; memberNumber: string }

export const normalizeParentName = (raw: string): string => {
  const normalized = raw.toLowerCase().replace(/\.$/u, '')
  const labels = normalized.split('.')
  if (labels.length !== 2 || labels.some((label) => label.length > 63 || !PARENT_LABEL.test(label))) {
    throw new Error('invalid ENS parent name')
  }
  return normalized
}

export const isIssuerHandle = (raw: string): boolean =>
  raw.length <= 63 && ISSUER_HANDLE.test(raw) && !RESERVED_ISSUER_HANDLES.has(raw)

const memberCheckIndex = (payload: string): number => {
  let factor = 2
  let sum = 0
  for (let index = payload.length - 1; index >= 0; index -= 1) {
    const codePoint = payload[index]
    if (codePoint === undefined) {
      return -1
    }
    const value = MEMBER_NUMBER_ALPHABET.indexOf(codePoint)
    if (value === -1) {
      return -1
    }
    const product = value * factor
    sum += Math.floor(product / MEMBER_NUMBER_ALPHABET.length) + (product % MEMBER_NUMBER_ALPHABET.length)
    factor = factor === 2 ? 1 : 2
  }
  return (
    (MEMBER_NUMBER_ALPHABET.length - (sum % MEMBER_NUMBER_ALPHABET.length)) % MEMBER_NUMBER_ALPHABET.length
  )
}

export const isMemberNumber = (raw: string): boolean => {
  if (raw.length !== MEMBER_NUMBER_LENGTH) {
    return false
  }
  const payload = raw.slice(0, -1)
  return MEMBER_NUMBER_ALPHABET[memberCheckIndex(payload)] === raw.at(-1)
}

export const issuerEnsName = (handle: string, parentName: string): string => {
  if (!isIssuerHandle(handle)) {
    throw new Error('invalid issuer handle')
  }
  return `${handle}.${normalizeParentName(parentName)}`
}

export const memberEnsName = (memberNumber: string, issuerHandle: string, parentName: string): string => {
  if (!isMemberNumber(memberNumber)) {
    throw new Error('invalid member number')
  }
  return `${memberNumber}.${issuerEnsName(issuerHandle, parentName)}`
}

export const parseFudaEnsName = (name: string, parentName: string): ParsedFudaEnsName | null => {
  let parent: string
  try {
    parent = normalizeParentName(parentName)
  } catch {
    return null
  }

  const normalized = name.toLowerCase().replace(/\.$/u, '')
  const suffix = `.${parent}`
  if (!normalized.endsWith(suffix)) {
    return null
  }

  const labels = normalized.slice(0, -suffix.length).split('.')
  if (labels.length === 1) {
    const [issuerHandle] = labels
    return issuerHandle !== undefined && isIssuerHandle(issuerHandle)
      ? { issuerHandle, kind: 'issuer' }
      : null
  }
  if (labels.length === 2) {
    const [memberNumber, issuerHandle] = labels
    return memberNumber !== undefined &&
      issuerHandle !== undefined &&
      isMemberNumber(memberNumber) &&
      isIssuerHandle(issuerHandle)
      ? { issuerHandle, kind: 'member', memberNumber }
      : null
  }
  return null
}
