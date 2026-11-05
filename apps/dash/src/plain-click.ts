// A link click the page handles itself (client navigation). Modified and non-primary
// clicks keep the browser's own behavior: new tab, new window, download.
export const isPlainClick = (event: MouseEvent): boolean =>
  event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
