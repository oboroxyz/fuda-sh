import type { PortlessApp } from './model.ts'

export interface ServiceEnvironment {
  apiOrigin: string
  host: '127.0.0.1' | '::1'
  hostname: string
  port: number
  publicOrigin: string
}

interface PublicUrl {
  apiOrigin: string
  hostname: string
  origin: string
}

const invalidPublicUrl = (detail: string): Error => new Error(`Invalid PORTLESS_URL: ${detail}`)

const explicitPort = (publicUrl: string, protocol: string): string => {
  const authorityStart = `${protocol}//`.length
  const authorityEnd = publicUrl.slice(authorityStart).search(/[/?#]/u)
  const authority = publicUrl.slice(
    authorityStart,
    authorityEnd === -1 ? undefined : authorityStart + authorityEnd,
  )
  const separator = authority.lastIndexOf(':')

  if (separator === -1) {
    return ''
  }

  const port = authority.slice(separator + 1)
  if (!/^\d+$/u.test(port)) {
    throw invalidPublicUrl('port must contain digits only')
  }
  return String(Number(port))
}

const parsePublicUrl = (publicUrl: string, appName: string): PublicUrl => {
  let url: URL
  try {
    url = new URL(publicUrl)
  } catch {
    throw invalidPublicUrl('must be a valid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalidPublicUrl('must use http or https')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw invalidPublicUrl('must not include credentials')
  }
  if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) {
    throw invalidPublicUrl('must be an origin without path, search, or hash')
  }

  const labels = url.hostname.split('.')
  const appLabel = labels.length - 2
  const isDirectApp = labels.length === 2
  const isWorktreeApp = labels.length === 3
  if (
    labels.some((label) => label.length === 0) ||
    (!isDirectApp && !isWorktreeApp) ||
    labels.at(-1) !== 'localhost' ||
    labels[appLabel] !== appName
  ) {
    throw invalidPublicUrl(`must match ${appName}.localhost or <worktree>.${appName}.localhost`)
  }

  const port = explicitPort(publicUrl, url.protocol)
  const origin = `${url.protocol}//${url.hostname}${port.length > 0 ? `:${port}` : ''}`
  labels[appLabel] = 'api'
  return {
    apiOrigin: `${url.protocol}//${labels.join('.')}${port.length > 0 ? `:${port}` : ''}`,
    hostname: url.hostname,
    origin,
  }
}

export const deriveApiOrigin = (publicUrl: string, appName: string): string =>
  parsePublicUrl(publicUrl, appName).apiOrigin

export const parseServiceEnvironment = (
  app: PortlessApp,
  env: Readonly<Record<string, string | undefined>>,
): ServiceEnvironment => {
  const host = env.HOST
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Invalid HOST: must be 127.0.0.1 or ::1')
  }

  const portValue = env.PORT
  if (portValue === undefined || !/^\d+$/u.test(portValue)) {
    throw new Error('Invalid PORT: must be an integer from 1 to 65535')
  }
  const port = Number(portValue)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid PORT: must be an integer from 1 to 65535')
  }

  const publicUrl = env.PORTLESS_URL
  if (publicUrl === undefined) {
    throw invalidPublicUrl('is required')
  }
  const parsedUrl = parsePublicUrl(publicUrl, app.name)
  return {
    apiOrigin: parsedUrl.apiOrigin,
    host,
    hostname: parsedUrl.hostname,
    port,
    publicOrigin: parsedUrl.origin,
  }
}
