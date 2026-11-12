import { brandTextColor, IMAGE_SETS } from '@fuda/sdk'
import type { IssuerView, OperatorCardView } from '@fuda/sdk'
import { useEffect, useRef, useState } from 'preact/hooks'

import { removeArtwork, uploadArtwork } from './api.ts'
import { assetUrlForDisplay } from './config.ts'
import type { DashCopy } from './copy.ts'
import { browserImageTools, generateImageSet, SOURCE_ACCEPT } from './logo.ts'
import type { LogoRejection } from './logo.ts'
import { settled } from './network-result.ts'

const WalletArtworkPreview = (props: { card: OperatorCardView; issuer: IssuerView; url: string }) => {
  const { url } = props
  return (
    <div class="grid gap-4 sm:grid-cols-2">
      {['Apple Wallet', 'Google Wallet'].map((wallet) => (
        <figure class="min-w-0" key={wallet}>
          <figcaption class="mb-2 text-sm">{wallet}</figcaption>
          <div
            class="overflow-hidden rounded-xl"
            style={{
              background: props.issuer.brandColor,
              color: brandTextColor(props.issuer.brandColor),
            }}
          >
            <div class="flex items-center gap-2 p-3 text-sm">
              {props.issuer.logoUrl === null ? null : (
                <img alt="" class="size-8 object-contain" src={assetUrlForDisplay(props.issuer.logoUrl)} />
              )}
              <span>{props.issuer.name}</span>
              {wallet === 'Apple Wallet' ? <strong class="ml-auto">{props.card.title}</strong> : null}
            </div>
            {wallet === 'Apple Wallet' ? (
              <img alt="" class="w-full" src={assetUrlForDisplay(url)} />
            ) : (
              <strong class="block px-3">{props.card.title}</strong>
            )}
            <p class="p-3 font-mono text-xs">ABCD-E123-F5679</p>
            {wallet === 'Google Wallet' ? <img alt="" class="w-full" src={assetUrlForDisplay(url)} /> : null}
          </div>
        </figure>
      ))}
    </div>
  )
}

const artworkRejection = (copy: DashCopy, rejection: LogoRejection | null): string | null => {
  if (rejection === null) {
    return null
  }
  if (rejection === 'tooSmall') {
    return copy.artwork.tooSmall
  }
  if (rejection === 'tooHeavy') {
    return copy.artwork.tooHeavy
  }
  return copy.logo.rejections[rejection]
}

export const ArtworkSection = (props: {
  card: OperatorCardView
  issuer: IssuerView
  copy: DashCopy
  onSaved: (card: OperatorCardView) => void
}) => {
  const [pick, setPick] = useState<{ variants: Record<string, Blob>; url: string } | null>(null)
  const [rejection, setRejection] = useState<LogoRejection | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )
  useEffect(
    () => () => {
      if (pick !== null) {
        URL.revokeObjectURL(pick.url)
      }
    },
    [pick],
  )
  const choose = async (file: File) => {
    generation.current += 1
    const attempt = generation.current
    setBusy(true)
    setPick(null)
    setRejection(null)
    setFailed(false)
    const result = await generateImageSet(file, browserImageTools, IMAGE_SETS.artwork)
    if (attempt !== generation.current) {
      return
    }
    setBusy(false)
    if (!result.ok) {
      setRejection(result.reason)
      return
    }
    const strip = result.variants.strip3x
    if (strip !== undefined) {
      setPick({ url: URL.createObjectURL(strip), variants: result.variants })
    }
  }
  const save = async (remove: boolean) => {
    if (busy) {
      return
    }
    generation.current += 1
    const attempt = generation.current
    setBusy(true)
    setFailed(false)
    const result = await settled(async () =>
      remove ? await removeArtwork(props.card.id) : await uploadArtwork(props.card.id, pick?.variants ?? {}),
    )
    if (attempt !== generation.current) {
      return
    }
    setBusy(false)
    if (result.ok) {
      props.onSaved(result.body.card)
      setPick(null)
    } else {
      setFailed(true)
    }
  }
  const url = pick?.url ?? props.card.artworkUrl
  const copy = props.copy.artwork
  const rejectionMessage = artworkRejection(props.copy, rejection)
  return (
    <details data-testid="card-artwork" class="rounded-box border border-[var(--fuda-border)]">
      <summary class="cursor-pointer p-4 font-semibold">{copy.label}</summary>
      <fieldset class="flex min-w-0 flex-col gap-3 p-4 pt-0" disabled={busy}>
        <label>
          <span class="sr-only">{copy.label}</span>
          <input
            class="file-input w-full"
            type="file"
            accept={SOURCE_ACCEPT}
            onInput={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file !== undefined) {
                void choose(file)
              }
            }}
          />
        </label>
        <p class="text-sm opacity-70">{copy.hint}</p>
        {rejection === null ? null : (
          <p role="alert" class="text-error">
            {rejectionMessage}
          </p>
        )}
        {failed ? (
          <p role="alert" class="text-error">
            {props.copy.management.saveFailed}
          </p>
        ) : null}
        {url === null ? null : <WalletArtworkPreview card={props.card} issuer={props.issuer} url={url} />}
        <div class="flex gap-2">
          <button
            class="btn btn-primary btn-sm"
            type="button"
            disabled={busy || pick === null}
            onClick={() => {
              void save(false)
            }}
          >
            {props.copy.artwork.save}
          </button>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            disabled={busy || props.card.artworkUrl === null}
            onClick={() => {
              void save(true)
            }}
          >
            {props.copy.logo.remove}
          </button>
        </div>
      </fieldset>
    </details>
  )
}
