import { brandTextColor, IMAGE_SETS } from '@fuda/sdk'
import type { IssuerView, OperatorCardView } from '@fuda/sdk'
import { useEffect, useId, useRef, useState } from 'preact/hooks'

import { removeArtwork, removePoster, uploadArtwork, uploadPoster } from './api.ts'
import { assetUrlForDisplay } from './config.ts'
import type { DashCopy } from './copy.ts'
import { browserImageTools, generateImageSet, SOURCE_ACCEPT } from './logo.ts'
import type { LogoRejection } from './logo.ts'
import { settled } from './network-result.ts'
import { PreviewQr } from './PreviewQr.tsx'

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

// Wallet formats the issue date in the device's locale, so the sample does too.
const ISSUED_SAMPLE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

const ApplePosterPreview = (props: { card: OperatorCardView; issuer: IssuerView; url: string }) => (
  <figure class="relative aspect-[358/448] w-full max-w-80 overflow-hidden rounded-2xl bg-black text-white">
    <img alt="" class="absolute inset-0 size-full object-cover" src={assetUrlForDisplay(props.url)} />
    <div class="relative flex items-center gap-2 p-4 text-sm">
      {props.issuer.logoUrl === null ? null : (
        <img alt="" class="size-8 object-contain" src={assetUrlForDisplay(props.issuer.logoUrl)} />
      )}
      <span>{props.issuer.name}</span>
    </div>
    <strong class="relative block px-4 text-xl">{props.card.title}</strong>
    <div class="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/50 p-4 backdrop-blur-sm">
      <div class="text-xs">
        <p class="font-mono">ABCD-E123-F5679</p>
        <p>{ISSUED_SAMPLE.format(new Date())}</p>
      </div>
      <div class="[&>svg]:size-16">
        <PreviewQr />
      </div>
    </div>
  </figure>
)

const artworkRejection = (
  copy: DashCopy,
  kind: 'artwork' | 'poster',
  rejection: LogoRejection | null,
): string | null => {
  if (rejection === null) {
    return null
  }
  if (rejection === 'tooSmall') {
    return copy[kind].tooSmall
  }
  if (rejection === 'tooHeavy') {
    return copy.artwork.tooHeavy
  }
  return copy.logo.rejections[rejection]
}

interface ArtworkSectionProps {
  card: OperatorCardView
  issuer: IssuerView
  copy: DashCopy
  onSaved: (card: OperatorCardView) => void
}

const IMAGE_EDITORS = {
  artwork: {
    Preview: WalletArtworkPreview,
    field: 'artworkUrl',
    remove: removeArtwork,
    upload: uploadArtwork,
    variant: 'strip3x',
  },
  poster: {
    Preview: ApplePosterPreview,
    field: 'posterUrl',
    remove: removePoster,
    upload: uploadPoster,
    variant: 'poster3x',
  },
} as const

const CardImageSection = (props: ArtworkSectionProps & { kind: 'artwork' | 'poster' }) => {
  const id = useId()
  const { kind } = props
  const { field, upload, remove: removeImage, variant, Preview } = IMAGE_EDITORS[kind]
  const savedUrl = props.card[field]
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
    const result = await generateImageSet(file, browserImageTools, IMAGE_SETS[kind])
    if (attempt !== generation.current) {
      return
    }
    setBusy(false)
    if (!result.ok) {
      setRejection(result.reason)
      return
    }
    const strip = result.variants[variant]
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
      remove ? await removeImage(props.card.id) : await upload(props.card.id, pick?.variants ?? {}),
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
  const url = pick?.url ?? savedUrl
  const copy = props.copy[kind]
  const rejectionMessage = artworkRejection(props.copy, kind, rejection)
  return (
    <details data-testid={`card-${kind}`} class="rounded-box border border-[var(--fuda-border)]">
      <summary class="cursor-pointer p-4 font-semibold">{copy.label}</summary>
      <fieldset class="flex min-w-0 flex-col gap-3 p-4 pt-0" disabled={busy}>
        <legend class="sr-only">{copy.label}</legend>
        <label for={id}>
          <span class="sr-only">{copy.label}</span>
          <input
            class="file-input w-full"
            id={id}
            name={kind}
            aria-describedby={`${id}-hint`}
            aria-invalid={rejection !== null}
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
        <p id={`${id}-hint`} class="text-sm opacity-70">
          {copy.hint}
        </p>
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
        {url === null ? null : <Preview card={props.card} issuer={props.issuer} url={url} />}
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
            disabled={busy || savedUrl === null}
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

export const ArtworkSection = (props: ArtworkSectionProps) => (
  <>
    <CardImageSection {...props} kind="artwork" />
    <CardImageSection {...props} kind="poster" />
  </>
)
