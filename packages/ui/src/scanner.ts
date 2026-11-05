export interface ScannerLabels {
  cameraUnavailable: string
  placeholder: string
  check: string
  ready?: string
}

// In `cameraMode: 'off'` this line is the whole screen, so it is stated as an
// instruction to the person presenting, not as a status.
export const SCANNER_READY = 'present your pass'

export const SCANNER_LABELS: ScannerLabels = {
  cameraUnavailable: 'camera unavailable — paste below',
  check: 'Check',
  placeholder: 'paste fuda:v1:… or 0x…',
  ready: SCANNER_READY,
}

export interface ScannerProps {
  onInput: (text: string) => void
  labels?: ScannerLabels
  autoFocus?: boolean
  cameraMode?: 'auto' | 'off'
}
