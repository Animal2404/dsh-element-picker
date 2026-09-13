/**
 * CSS selector generation for a picked DOM element.
 *
 * Strategy: prefer a short, stable, unique selector; fall back to an
 * ancestor-anchored path, then to a positional path. The generator never
 * returns a selector that fails `querySelectorAll(...).length === 1` unless the
 * document is genuinely ambiguous, in which case the positional path wins by
 * construction.
 *
 * Pure functions only (element in, string out) so the suite runs under plain
 * `node --test` against a DOM stub, and the same code runs unchanged inside the
 * DSH page.
 */

/**
 * Attributes whose values are stable enough to build a readable selector from.
 *
 * Used only when generating a selector for an element that has already been
 * chosen. `data-phase` is deliberately absent: DSH puts it on whole panels
 * (a session root, the composer) with values that change at runtime, so it is
 * neither a unique nor a stable selector anchor.
 */
const STABLE_ATTRIBUTES = [
  'data-composer-card',
  'data-input-scroll',
  'data-composer-input',
  'data-composer-seat',
  'data-composer-placeholder',
  'data-shell-overlay',
  'data-testid',
  'data-test-id',
  'data-id',
  'name',
  'aria-label',
  'role',
  'type',
]

/** Elements that may carry an `id` worth using verbatim. */
const ID_SAFE = /^[A-Za-z_][\w-]*$/

/**
 * Hooks that identify a component the picker is willing to target.
 *
 * This list is deliberately narrow, and separate from the selector attributes
 * above. Resolving "what did the user point at?" by climbing to any element
 * carrying a generic marker is what made a click inside a session header select
 * the entire session panel: the panel root carries `data-phase="active"`. Only
 * markers that name a component count here.
 */
const TARGET_HOOKS = [
  'data-composer-card',
  'data-input-scroll',
  'data-composer-input',
  'data-composer-seat',
  'data-composer-placeholder',
  'data-shell-overlay',
  'data-composer-chip',
  'data-composer-text-ref',
]

/** Tags that are controls on their own. */
const INTERACTIVE_TAGS = new Set([
  'BUTTON',
  'A',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'SUMMARY',
  'OPTION',
])

/** ARIA roles that make an element a control regardless of its tag. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'checkbox',
  'radio',
  'switch',
  'textbox',
  'searchbox',
  'combobox',
  'slider',
  'spinbutton',
  'treeitem',
  'gridcell',
])

/**
 * @param {string} value - Raw attribute value.
 * @returns {string} The value with quotes and backslashes escaped.
 */
function escapeAttrValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * @param {string} value - Raw identifier text.
 * @returns {string} A CSS-escaped identifier.
 */
function escapeIdent(value) {
  return value.replace(/([^\w-])/g, '\\$1')
}

/**
 * Test whether a selector matches exactly one element in its document.
 *
 * @param {Element} element - The element the selector should resolve to.
 * @param {string} selector - Candidate selector.
 * @returns {boolean} True when `selector` resolves to exactly `element`.
 */
export function isUniqueSelector(element, selector) {
  try {
    const found = element.ownerDocument.querySelectorAll(selector)
    return found.length === 1 && found[0] === element
  } catch {
    return false
  }
}

/**
 * Build a `tag > tag:nth-of-type(n)` path from the document root down to the
 * element, optionally stopping above an exclusive ancestor.
 *
 * @param {Element} element - Target element.
 * @param {Element | null} stopAbove - Ancestor to stop above, exclusive.
 * @returns {string} A CSS selector resolving to `element`.
 */
function positionalSteps(element, stopAbove) {
  const steps = []
  let node = element
  while (node !== null && node.nodeType === 1 && node !== stopAbove) {
    const tag = node.tagName.toLowerCase()
    const parent = node.parentElement
    if (parent === null || parent === stopAbove) {
      steps.unshift(tag)
      break
    }
    const sameTag = Array.from(parent.children).filter(
      (child) => child.tagName === node.tagName,
    )
    const index = sameTag.indexOf(node) + 1
    steps.unshift(sameTag.length === 1 ? tag : `${tag}:nth-of-type(${index})`)
    node = parent
  }
  return steps.join(' > ')
}

/**
 * Collect short candidate selectors, ordered from most to least readable. Each
 * candidate is validated for uniqueness by the caller.
 *
 * @param {Element} element - Target element.
 * @returns {string[]} Candidate selectors, possibly empty.
 */
function shortCandidates(element) {
  const candidates = []
  const tag = element.tagName.toLowerCase()

  const id = element.getAttribute('id')
  if (id !== null && ID_SAFE.test(id)) candidates.push(`#${id}`)

  for (const attr of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(attr)
    if (value === null) continue
    // Presence flags carry no value (`data-composer-card`), so an empty value
    // must yield the bare attribute form instead of being skipped.
    candidates.push(
      value === ''
        ? `${tag}[${attr}]`
        : `${tag}[${attr}="${escapeAttrValue(value)}"]`,
    )
  }

  const classes = Array.from(element.classList).filter((name) => name !== '')
  if (classes.length > 0) {
    candidates.push(`${tag}.${classes.map(escapeIdent).join('.')}`)
    candidates.push(`.${escapeIdent(classes[0])}`)
  }

  return candidates
}

/**
 * @param {Element} element - Candidate ancestor.
 * @returns {string | null} A unique short selector, or null when none is unique.
 */
function uniqueShortSelector(element) {
  for (const candidate of shortCandidates(element)) {
    if (isUniqueSelector(element, candidate)) return candidate
  }
  return null
}

/**
 * Generate the best available selector for an element.
 *
 * @param {Element} element - Target element.
 * @returns {string} A CSS selector resolving to `element`.
 */
export function generateSelector(element) {
  const direct = uniqueShortSelector(element)
  if (direct !== null) return direct

  // Short candidates were ambiguous or absent: anchor on the closest ancestor
  // that IS uniquely addressable, then walk down positionally.
  let ancestor = element.parentElement
  while (ancestor !== null && ancestor !== element.ownerDocument.documentElement) {
    const prefix = uniqueShortSelector(ancestor)
    if (prefix !== null) {
      const combined = `${prefix} > ${positionalSteps(element, ancestor)}`
      if (isUniqueSelector(element, combined)) return combined
    }
    ancestor = ancestor.parentElement
  }

  return positionalSteps(element, null)
}

/**
 * Build an absolute XPath for an element, as a complement to the CSS selector
 * (useful when the selector is ambiguous, e.g. inside shadow roots).
 *
 * @param {Element} element - Target element.
 * @returns {string} An XPath resolving to `element`.
 */
export function generateXPath(element) {
  const parts = []
  let node = element
  while (node !== null && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase()
    const parent = node.parentElement
    if (parent === null) {
      parts.unshift(tag)
      break
    }
    const sameTag = Array.from(parent.children).filter(
      (child) => child.tagName === node.tagName,
    )
    parts.unshift(
      sameTag.length === 1 ? tag : `${tag}[${sameTag.indexOf(node) + 1}]`,
    )
    node = parent
  }
  return `/${parts.join('/')}`
}

/**
 * Whether the element is a control the user would recognise as "this thing".
 *
 * @param {Element} element - Candidate element.
 * @returns {boolean} True for buttons, links with a target, form controls,
 *   editable regions, and elements whose role makes them interactive.
 */
export function isInteractive(element) {
  if (element === null || element.nodeType !== 1) return false
  const tag = element.tagName
  if (INTERACTIVE_TAGS.has(tag)) {
    // An anchor without an href is a styling hook, not a control.
    if (tag === 'A' && element.getAttribute('href') === null) return false
    return true
  }
  if (element.getAttribute('contenteditable') === 'true') return true
  const role = element.getAttribute('role')
  return role !== null && INTERACTIVE_ROLES.has(role.toLowerCase())
}

/**
 * Whether the element identifies itself well enough to be the pick target.
 *
 * @param {Element} element - Candidate element.
 * @returns {boolean} True for component hooks, ids, and controls.
 */
export function hasStableHook(element) {
  if (element === null || element.nodeType !== 1) return false
  if (TARGET_HOOKS.some((attr) => element.getAttribute(attr) !== null)) return true
  const id = element.getAttribute('id')
  if (id !== null && ID_SAFE.test(id)) return true
  return isInteractive(element)
}

/**
 * Resolve the element the user means.
 *
 * The pointer usually lands on a leaf (an icon's `<path>`, a label `<span>`),
 * so the ancestry is searched for the nearest component hook, id, or control —
 * that is what turns "the arrow glyph" into "the send button". When nothing in
 * the ancestry identifies anything, the element under the pointer IS the
 * answer: climbing further is what made a click inside a panel select the whole
 * panel.
 *
 * @param {Element} element - Element under the pointer.
 * @param {Document} doc - Owning document.
 * @returns {Element} The element to describe.
 */
export function resolveTarget(element, doc) {
  if (element === null || element.nodeType !== 1) return element
  const root = doc.documentElement
  if (element === root || element === doc.body) return element

  let node = element
  while (node !== null && node !== root && node !== doc.body) {
    if (hasStableHook(node)) return node
    node = node.parentElement
  }
  return element
}

/**
 * A short human-readable summary of an element, e.g. `button.primary "Send"`.
 *
 * @param {Element} element - Target element.
 * @returns {string} A one-line summary.
 */
export function describeElement(element) {
  const tag = element.tagName.toLowerCase()
  const id = element.getAttribute('id')
  let head = id !== null && ID_SAFE.test(id) ? `${tag}#${id}` : tag

  const firstClass = element.classList.item(0)
  if (firstClass !== null) head += `.${firstClass}`

  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return head
  const clipped = text.length > 40 ? `${text.slice(0, 40)}…` : text
  return `${head} "${clipped}"`
}
