/**
 * Turn a picked element into the block of locating information that gets
 * inserted into the composer.
 *
 * Shape (aligned with ZCode's element block, plus a DSH-specific `[源码]` line):
 *
 *   [元素] button.primary "发送"
 *   [选择器] [data-composer-card] button[aria-label="发送消息"]
 *   [XPath] /div[1]/div[2]/button[1]
 *   [位置] 44x44 @ viewport(1032,688) page(1032,688)
 *   [样式] color #F9FAFB; font 16px -apple-system,…; font-weight 600; display flex
 *   [属性] data-phase="idle"
 *   [源码] packages/client/ui-conversation/src/client/skeleton/InputBar.tsx (data-composer-card)
 *   [HTML] <button aria-label="发送消息">…</button>
 *
 * Pure string assembly: every DOM read is injected or guarded, so the suite can
 * assert the exact output against a stub element.
 */
import { HOOK_SOURCES, sourceFor } from './hooks-map.js'
import { describeElement, generateSelector, generateXPath } from './selector.js'

/** Attributes worth quoting next to the selector. */
const REPORTED_ATTRIBUTES = [
  'id',
  'name',
  'role',
  'type',
  'aria-label',
  'aria-hidden',
  'placeholder',
]

/** Longest HTML excerpt kept in the block. */
const HTML_LIMIT = 200

/** Longest font-family list kept in the style line. */
const FONT_LIMIT = 32

/**
 * @param {string} text - Raw text.
 * @param {number} limit - Maximum length.
 * @returns {string} Whitespace-collapsed, truncated text.
 */
function clip(text, limit) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean
}

/**
 * @param {Element} element - Target element.
 * @returns {string} The `[属性]` payload, or '' when nothing is worth quoting.
 */
function attributeLine(element) {
  const parts = []
  for (const name of REPORTED_ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (value !== null) parts.push(`${name}="${value}"`)
  }
  if (parts.length > 4) parts.length = 4
  return parts.join(' ')
}

/**
 * @param {Element} element - Target element.
 * @param {Window | undefined} win - Window used for computed styles.
 * @returns {string} The `[样式]` payload, or '' when unavailable.
 */
function styleLine(element, win) {
  if (win === undefined || typeof win.getComputedStyle !== 'function') return ''
  let style = null
  try {
    style = win.getComputedStyle(element)
  } catch {
    return ''
  }
  if (style === null) return ''

  const parts = []
  const color = style.color
  if (color !== undefined && color !== '') parts.push(`color ${color}`)
  const size = style.fontSize
  const family = style.fontFamily
  if (size !== undefined && size !== '') {
    parts.push(
      family !== undefined && family !== ''
        ? `font ${size} ${clip(family, FONT_LIMIT)}`
        : `font ${size}`,
    )
  }
  const weight = style.fontWeight
  if (weight !== undefined && weight !== '' && weight !== '400') {
    parts.push(`font-weight ${weight}`)
  }
  const display = style.display
  if (display !== undefined && display !== '') parts.push(`display ${display}`)
  return parts.join('; ')
}

/**
 * @param {Element} element - Target element.
 * @param {DOMRect | undefined} rect - Element bounds in viewport coordinates.
 * @param {{ x?: number, y?: number } | undefined} scroll - Page scroll offset.
 * @returns {string} The `[位置]` payload.
 */
function rectLine(element, rect, scroll) {
  const box = rect ?? element.getBoundingClientRect?.()
  if (box === undefined || box === null) return ''
  const width = Math.round(box.width)
  const height = Math.round(box.height)
  const viewportX = Math.round(box.left)
  const viewportY = Math.round(box.top)
  const scrollX = Math.round(scroll?.x ?? 0)
  const scrollY = Math.round(scroll?.y ?? 0)
  return `${width}x${height} @ viewport(${viewportX},${viewportY}) page(${viewportX + scrollX},${viewportY + scrollY})`
}

/**
 * Build the multi-line locating block for one element.
 *
 * @param {Element} element - Element to describe (already resolved to the
 *   meaningful target by `resolveTarget`).
 * @param {object} [env] - Environment overrides.
 * @param {Window} [env.win] - Window for computed styles.
 * @param {Document} [env.doc] - Document for source lookup.
 * @param {DOMRect} [env.rect] - Pre-measured bounds.
 * @param {{ x: number, y: number }} [env.scroll] - Page scroll offset.
 * @returns {string} The block, newline-terminated.
 */
export function buildElementBlock(element, env = {}) {
  const doc = env.doc ?? element.ownerDocument
  const lines = [`[元素] ${describeElement(element)}`]

  const selector = generateSelector(element)
  if (selector !== '') lines.push(`[选择器] ${selector}`)

  const xpath = generateXPath(element)
  if (xpath !== '') lines.push(`[XPath] ${xpath}`)

  const position = rectLine(element, env.rect, env.scroll)
  if (position !== '') lines.push(`[位置] ${position}`)

  const style = styleLine(element, env.win)
  if (style !== '') lines.push(`[样式] ${style}`)

  const attributes = attributeLine(element)
  if (attributes !== '') lines.push(`[属性] ${attributes}`)

  const source = sourceFor(element, doc)
  if (source !== null) {
    lines.push(`[源码] ${source.path} (${source.hook})`)
  }

  const html = element.outerHTML
  if (typeof html === 'string' && html !== '') {
    lines.push(`[HTML] ${clip(html, HTML_LIMIT)}`)
  }

  return `${lines.join('\n')}\n`
}

/**
 * Hooks known to this build, exposed for diagnostics and tests.
 *
 * @returns {string[]} The mapped hook attribute names.
 */
export function knownHooks() {
  return Object.keys(HOOK_SOURCES)
}
