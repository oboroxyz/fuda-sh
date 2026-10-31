import type { JSX } from 'solid-js'

export const FudaMark = (props: { class: string }): JSX.Element => (
  <svg aria-label="fuda." class={props.class} fill="none" role="img" viewBox="0 0 260 260">
    <path
      d="m130 54 63 50v128h-126v-128z M119 98a11 11 0 1 0 22 0 11 11 0 1 0-22 0 M130 28v20"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="15"
    />
  </svg>
)
