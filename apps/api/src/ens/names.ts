import { isIssuerHandle, isMemberNumber } from '@fuda/sdk'

// The Handle and member-number rules live in @fuda/sdk (docs/specs/ens-naming.md)
// so the dashboard validates what the api enforces; re-exported for callers here.
export { isIssuerHandle, isMemberNumber } from '@fuda/sdk'

const PARENT_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u

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
