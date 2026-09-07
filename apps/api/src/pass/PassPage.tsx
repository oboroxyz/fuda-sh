/** @jsxImportSource hono/jsx */
import { rgbCss, textOn } from '@fuda/pass'
import { qrSvg } from '@fuda/sdk'
import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

import type { PassView } from './pass-view.ts'

// Self-contained: inline CSS, inline SVG, one inline script that re-reads the
// live status from GET /verify/:uid. No external assets (docs/specs/pass-types-and-flows.md#passes).
const STYLE = `
  :root{color-scheme:light}body{margin:0;font-family:system-ui,sans-serif;background:#141414;color:#fff;display:flex;justify-content:center}
  main{max-width:420px;width:100%;padding:24px;box-sizing:border-box}
  .card{background:#1e1e1e;border-radius:16px;padding:20px;text-align:center}
  .brand{color:var(--brand-text)}
  .brand .card{background:var(--brand)}
  .venue{font-size:13px;opacity:.85;letter-spacing:.08em;text-transform:uppercase}
  .title{font-size:20px;font-weight:700;margin:4px 0 12px}
  .number{font-size:18px;font-weight:700;letter-spacing:.06em;margin:8px 0 0;font-variant-numeric:tabular-nums}
  .qr{background:#fff;border-radius:12px;padding:12px;display:inline-block}
  .status{font-size:22px;font-weight:700;margin:12px 0}.status[data-ok=true]{color:#22c55e}.status[data-ok=false]{color:#ef4444}.status[data-ok=unknown]{color:#eab308}
  .meta{color:#aaa;font-size:14px;line-height:1.6}.hint{color:#888;font-size:12px;margin-top:16px}code{word-break:break-all}
  .btn{display:inline-block;margin-top:12px;padding:10px 16px;border-radius:999px;background:#fff;color:#141414;font-weight:600;text-decoration:none}
`

// `uid` is the regex-validated attestation UID (isUid) — the only value this
// script interpolates, so no untrusted text ever reaches the markup.
// The wallet button is progressive: it stays hidden unless /pass/:uid/google
// answers 200, so an unconfigured deployment simply shows the web pass.
const refreshScript = (uid: string): string => `
  const el=document.getElementById('status');
  const paint=(s,ok)=>{el.textContent=s;el.dataset.ok=ok};
  const tick=async()=>{try{const r=await fetch('/verify/${uid}');if(!r.ok){paint('UNKNOWN','unknown');return}
    const j=await r.json();paint(j.decision==='ADMIT'?'VALID':j.reason,j.decision==='ADMIT'?'true':'false')}catch{paint('UNKNOWN','unknown')}};
  tick();setInterval(tick,30000);
  const gw=document.getElementById('gw');
  fetch('/pass/${uid}/google').then(async r=>{if(!r.ok)return;const j=await r.json();gw.href=j.saveUrl;gw.hidden=false}).catch(()=>{});
`

const okAttr = (status: PassView['status']): string => {
  if (status === 'VALID') {
    return 'true'
  }
  return status === 'UNKNOWN' ? 'unknown' : 'false'
}

// Brand colour and its readable text colour reach the page as CSS custom
// properties on <body>; both come from validated `#RRGGBB` values.
const brandStyle = (view: PassView): string => {
  if (view.branding === null) {
    return ''
  }
  const { text } = textOn(view.branding.brandColor)
  return `--brand:${view.branding.brandColor};--brand-text:${rgbCss(text)}`
}

const heading = (view: PassView): HtmlEscapedString | Promise<HtmlEscapedString> =>
  view.branding === null
    ? html``
    : html`<div class="venue">${view.branding.issuerName}</div>
        <div class="title">${view.branding.cardTitle}</div>`

const memberLine = (view: PassView): HtmlEscapedString | Promise<HtmlEscapedString> =>
  view.branding === null
    ? html`Tier <b>${view.tier}</b> · Member <b>${view.holderShort}</b>`
    : html`<div class="number">${view.branding.memberNumber}</div>
        Tier <b>${view.tier}</b> · Holder <b>${view.holderShort}</b>`

const pageTitle = (view: PassView): string =>
  view.branding === null
    ? `fuda pass · ${view.tier}`
    : `${view.branding.issuerName} · ${view.branding.cardTitle}`

export const PassPage = (
  view: PassView,
): HtmlEscapedString | Promise<HtmlEscapedString> => html`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <title>${pageTitle(view)}</title>
      <style>
        ${raw(STYLE)}
      </style>
    </head>
    <body class="${view.branding === null ? '' : 'brand'}" style="${brandStyle(view)}">
      <main>
        <div class="card">
          ${heading(view)}
          <div class="qr" data-qr="${view.qr}">${raw(qrSvg(view.qr))}</div>
          <div id="status" class="status" data-ok="${okAttr(view.status)}">${view.status}</div>
          <div class="meta">${memberLine(view)}<br />Level ${view.level}<br /><code>${view.uid}</code></div>
          <a id="gw" class="btn" hidden>Add to Google Wallet</a>
          <div class="hint">
            Add this page to your home screen to keep the pass handy. The status re-checks the chain every 30
            s.
          </div>
        </div>
      </main>
      <script>
        ${raw(refreshScript(view.uid))}
      </script>
    </body>
  </html>`
