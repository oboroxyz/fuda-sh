import { defineHandler, defineHead } from 'void'
import type { InferProps } from 'void'

import { APP_ORIGIN } from '../../../src/config.ts'
import { loadVenue } from '../../../src/server/venue.ts'

export type Props = InferProps<typeof loader>

// Every `/@<handle>` page: the venue's entry, its store display, or a card.
// The public URL is `/@<handle>/…`; void.config.ts rewrites it here.
export const loader = defineHandler(
  async (c) => await loadVenue(c, c.get('requestUrl'), c.env.API_BASE_URL, APP_ORIGIN),
)

// A shared venue link previews with the venue's own name.
export const head = defineHead<Props>((_c, props) =>
  props.venue.ok
    ? {
        meta: [
          { content: `${props.venue.body.name} - fuda`, property: 'og:title' },
          ...(props.venue.body.tagline === ''
            ? []
            : [{ content: props.venue.body.tagline, name: 'description' }]),
        ],
        title: `${props.venue.body.name} - fuda`,
      }
    : {},
)
