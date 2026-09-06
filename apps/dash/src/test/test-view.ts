export interface ViewNode {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- VNode props are intentionally opaque test-fixture input.
  props: Record<string, unknown>
  tag: unknown
}

export const isViewNode = (value: unknown): value is ViewNode =>
  typeof value === 'object' && value !== null && 'props' in value && 'tag' in value

export const walkView = (value: unknown): ViewNode[] => {
  // oxlint-disable-next-line eslint/curly -- concise recursive fixture guard.
  if (Array.isArray(value)) return value.flatMap(walkView)
  // oxlint-disable-next-line eslint/curly -- concise recursive fixture guard.
  if (!isViewNode(value)) return []
  return [value, ...walkView(value.props.children)]
}

export const findViewNodes = (value: unknown, tag: unknown): ViewNode[] =>
  walkView(value).filter((node) => node.tag === tag)

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- consumers inspect opaque VNode props in tests.
export const viewProps = (node: ViewNode): Record<string, unknown> => node.props

export const viewText = (value: unknown): string => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- this fixture recursively narrows VNode child primitives.
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }
  // oxlint-disable-next-line eslint/curly -- concise recursive fixture guard.
  if (Array.isArray(value)) return value.map(viewText).join(' ')
  return isViewNode(value) ? viewText(value.props.children) : ''
}
