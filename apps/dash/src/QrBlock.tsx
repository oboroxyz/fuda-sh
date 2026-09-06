/** @jsxImportSource hono/jsx/dom */
import { qrSvg } from '@fuda/sdk'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

export interface QrBlockProps {
  label: string
  qr: string
}

export const QrBlock = ({ label, qr }: QrBlockProps): JSX.Element => (
  <div class="flex flex-col items-center gap-2">
    <div
      role="img"
      aria-label={label}
      class="rounded-box bg-white p-2"
      // The markup is built locally by qrSvg from the right's uid — no remote or
      // operator-entered content reaches it.
      dangerouslySetInnerHTML={{ __html: qrSvg(qr, { modulePx: 160 }) }}
    />
    <code class="text-xs break-all">{qr}</code>
  </div>
)
