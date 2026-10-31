import { qrSvg } from '@fuda/sdk'
import type { JSX } from 'solid-js'

export interface QrBlockProps {
  label: string
  qr: string
}

export const QrBlock = (props: QrBlockProps): JSX.Element => (
  <div class="flex flex-col items-center gap-2">
    <div
      role="img"
      aria-label={props.label}
      class="rounded-box bg-white p-2"
      // The markup is built locally by qrSvg from the right's uid — no remote or
      // operator-entered content reaches it.
      innerHTML={qrSvg(props.qr, { modulePx: 160 })}
    />
    <code class="text-xs break-all">{props.qr}</code>
  </div>
)
