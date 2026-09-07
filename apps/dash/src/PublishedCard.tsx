/** @jsxImportSource hono/jsx/dom */
import type { CardView, IssuerView } from '@fuda/sdk'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { displayUrl } from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import { QrBlock } from './QrBlock.tsx'

export interface PublishedCardViewProps {
  card: CardView
  copy: DashCopy['published']
  copied: boolean
  issuer: IssuerView
  onCopy: () => void
  onPrint: () => void
  onShare: (() => void) | null
  publicUrl: string
}

export const PublishedCardView = ({
  card,
  copy,
  copied,
  issuer,
  onCopy,
  onPrint,
  onShare,
  publicUrl,
}: PublishedCardViewProps): JSX.Element => (
  <section class="dash-published flex max-w-2xl flex-col gap-5">
    <div class="dash-no-print">
      <h1 class="text-2xl font-bold">{copy.title}</h1>
      <p class="opacity-70">{copy.description}</p>
    </div>

    <div class="dash-card-preview dash-no-print" style={{ background: issuer.brandColor }}>
      <div class="dash-card-preview-top">
        <span>{issuer.name}</span>
        <span>{card.category === 'ticket' ? 'TICKET' : 'MEMBER'}</span>
      </div>
      <strong>{card.title}</strong>
    </div>

    <div class="dash-print-target flex flex-col items-center gap-3">
      <QrBlock label={copy.qrLabel} qr={publicUrl} />
      <code class="text-sm font-semibold">{displayUrl(publicUrl)}</code>
    </div>

    <div class="dash-actions dash-no-print">
      <button class="btn" onClick={onPrint} type="button">
        {copy.print}
      </button>
      {onShare === null ? null : (
        <button class="btn" onClick={onShare} type="button">
          {copy.share}
        </button>
      )}
      <button class="btn" onClick={onCopy} type="button">
        {copied ? copy.copied : copy.copy}
      </button>
    </div>

    <p class="dash-no-print text-sm opacity-70">{copy.hint}</p>
  </section>
)

const COPIED_MS = 2000

export const PublishedCard = (
  props: Omit<PublishedCardViewProps, 'copied' | 'onCopy' | 'onPrint' | 'onShare'>,
): JSX.Element => {
  const [copied, setCopied] = useState(false)
  // `navigator.share` exists only on some browsers, so the action appears only
  // where it works; copy and print are always available.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- feature detection of a browser API, not a domain value
  const canShare = typeof globalThis.navigator?.share === 'function'

  return (
    <PublishedCardView
      {...props}
      copied={copied}
      onCopy={() => {
        const copy = async (): Promise<void> => {
          try {
            await globalThis.navigator.clipboard.writeText(props.publicUrl)
            setCopied(true)
            setTimeout(() => {
              setCopied(false)
            }, COPIED_MS)
          } catch {
            setCopied(false)
          }
        }
        void copy()
      }}
      onPrint={() => {
        globalThis.print()
      }}
      onShare={
        canShare
          ? () => {
              const share = async (): Promise<void> => {
                try {
                  await globalThis.navigator.share({ url: props.publicUrl })
                } catch {
                  // a dismissed share sheet is not an error worth reporting
                }
              }
              void share()
            }
          : null
      }
    />
  )
}
