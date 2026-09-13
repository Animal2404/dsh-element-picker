window.__ModuleLoader__.load({ id: "@dsh-external/dsh-element-picker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

	//#region @dsh-external/dsh-element-picker/src
/**
 * Overlay styles, injected as a single <style> element by the plugin.
 *
 * Namespaced under the picker's own root and its `data-dsh-picker-ui` markers,
 * so nothing here can collide with DSH's CSS-module classes. No `!important`:
 * the overlay is its own stacking layer, not a fight with the app's styles.
 */
const PICKER_CSS = `
#dsh-element-picker-root {
  position: fixed;
  inset: 0;
  width: 0;
  height: 0;
  z-index: 2147483000;
  pointer-events: none;
}

/* Default corner placement; the controller re-anchors this beside the composer
   card (see overlay.js) so it never sits on top of the send button. */
[data-dsh-picker-ui="button"] {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  background: rgba(22, 24, 29, 0.92);
  color: #f9fafb;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  transition: background 120ms ease, border-color 120ms ease;
}

[data-dsh-picker-ui="button"]:hover {
  background: rgba(38, 41, 48, 0.96);
}

[data-dsh-picker-active="true"] [data-dsh-picker-ui="button"] {
  border-color: #4d6bfe;
  background: #4d6bfe;
  color: #ffffff;
}

[data-dsh-picker-ui="highlight"] {
  position: fixed;
  display: none;
  pointer-events: none;
  background: rgba(255, 138, 61, 0.16);
  outline: 2px solid #ff8a3d;
  outline-offset: -1px;
  border-radius: 2px;
}

[data-dsh-picker-ui="highlight"][data-dsh-picker-visible="true"] {
  display: block;
}

[data-dsh-picker-ui="hint"] {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: none;
  max-width: 70vw;
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(22, 24, 29, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #e5e7eb;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  white-space: nowrap;
  pointer-events: none;
}

[data-dsh-picker-active="true"] [data-dsh-picker-ui="hint"] {
  display: block;
}

[data-dsh-picker-active="true"] {
  cursor: crosshair;
}
`

/** Stylesheet element id, used to keep injection idempotent. */
const PICKER_STYLE_ID = 'dsh-element-picker-style'

/**
 * Install the overlay stylesheet once.
 *
 * @param {Document} doc - Owning document.
 * @returns {() => void} Teardown that removes the stylesheet.
 */
function installStyles(doc) {
  if (doc.getElementById(PICKER_STYLE_ID) !== null) return () => {}
  const style = doc.createElement('style')
  // Attribute, not the `id` property: `getElementById` is the idempotence
  // guard, and it reads the attribute.
  style.setAttribute('id', PICKER_STYLE_ID)
  style.textContent = PICKER_CSS
  doc.head.appendChild(style)
  return () => {
    style.remove()
  }
}


	//#region @dsh-external/dsh-element-picker/src
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
 * Lead with DSH's own presence-flag markers: they are the hooks the Web UI
 * exposes on purpose (`data-composer-card`, `data-input-scroll`, ...), so a
 * selector anchored on one survives class-name rebuilds.
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
 * Attributes whose presence marks an element as "interesting" during a pick,
 * used to resolve the element the user means rather than the exact node under
 * the pointer.
 */
const HOOK_ATTRIBUTES = [
  ...STABLE_ATTRIBUTES,
  'id',
  'data-phase',
  'data-composer-chip',
  'data-composer-text-ref',
]

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
function isUniqueSelector(element, selector) {
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
function generateSelector(element) {
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
function generateXPath(element) {
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
 * Whether the element carries a hook the picker treats as meaningful.
 *
 * @param {Element} element - Candidate element.
 * @returns {boolean} True when the element has a stable hook or an id.
 */
function hasStableHook(element) {
  if (element === null || element.nodeType !== 1) return false
  const id = element.getAttribute('id')
  if (id !== null && ID_SAFE.test(id)) return true
  return HOOK_ATTRIBUTES.some((attr) => element.getAttribute(attr) !== null)
}

/**
 * Resolve the element the user means: the pointer-most element that carries a
 * stable hook, else the original node.
 *
 * @param {Element} element - Element under the pointer.
 * @param {Document} doc - Owning document.
 * @returns {Element} The element to describe.
 */
function resolveTarget(element, doc) {
  if (element === null || element.nodeType !== 1) return element
  const root = doc.documentElement
  if (element === root || element === doc.body) return element
  if (hasStableHook(element)) return element

  let node = element.parentElement
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
function describeElement(element) {
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


	//#region @dsh-external/dsh-element-picker/src
/**
 * Stable DOM hook -> DSH source file.
 *
 * This is what makes the picker worth having inside DSH instead of in a generic
 * browser extension: the inserted block tells the agent which source file
 * renders the element it is looking at, so a request like "move this button"
 * starts from a file path instead of a CSS class hash.
 *
 * Scope: hooks the Web UI sets on purpose (`data-*` markers, not CSS-module
 * class names, which are build-time hashes). Paths are repository paths of the
 * DSH source tree; the hook set is verified against the running 0.1.5-rc.2
 * client bundle, and a hook that no longer exists simply stops matching.
 */
const HOOK_SOURCES = {
  'data-composer-card': {
    path: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    note: 'composer card capsule',
  },
  'data-input-scroll': {
    path: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    note: 'composer scrollport',
  },
  'data-composer-placeholder': {
    path: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    note: 'composer placeholder',
  },
  'data-composer-seat': {
    path: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx',
    note: 'composer seat',
  },
  'data-composer-input': {
    path: 'packages/client/ui-conversation/src/client/input/editor/ComposerContentEditable.tsx',
    note: 'the editable input itself',
  },
  'data-composer-chip': {
    path: 'packages/client/ui-conversation/src/client/input/editor/chip-node.tsx',
    note: 'reference chip node',
  },
  'data-composer-text-ref': {
    path: 'packages/client/ui-conversation/src/client/input/editor/text-ref.ts',
    note: 'plain-text reference decoration',
  },
  'data-shell-overlay': {
    path: 'packages/client/ui-layout/src/client/AppFrame.tsx',
    note: 'frame-wide overlay layer',
  },
}

/** Hook attribute names, longest first so a specific hook wins over a prefix. */
const HOOK_NAMES = Object.keys(HOOK_SOURCES).sort((a, b) => b.length - a.length)

/**
 * Resolve the DSH source file responsible for an element by walking up from the
 * element until a known hook is found.
 *
 * @param {Element} element - Target element.
 * @param {Document} doc - Owning document.
 * @returns {{ hook: string, path: string, note: string } | null} The matched
 *   hook and its source file, or null when no hook on the element is known.
 */
function sourceFor(element, doc) {
  let node = element
  const root = doc.documentElement
  while (node !== null && node.nodeType === 1) {
    for (const hook of HOOK_NAMES) {
      if (node.getAttribute(hook) !== null) {
        const entry = HOOK_SOURCES[hook]
        return { hook, path: entry.path, note: entry.note }
      }
    }
    if (node === root) break
    node = node.parentElement
  }
  return null
}


	//#region @dsh-external/dsh-element-picker/src
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
function buildElementBlock(element, env = {}) {
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
function knownHooks() {
  return Object.keys(HOOK_SOURCES)
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Composer insertion: put the locating block into the DSH chat input without
 * destroying the user's draft.
 *
 * The composer is a Lexical `contenteditable` (`[data-composer-input]`), and the
 * public plugin API only exposes "replace the whole draft"
 * (`InputActions.setDraft`). So insertion is a cascade over three paths, best
 * first, each verified before the next is tried:
 *
 *   1. `paste`    - the shell's own `paste(text)`: inserts over the current
 *                   selection, keeps chips, its own undo boundary. It is an
 *                   internal member (absent from the published typings), so it
 *                   is feature-detected and only used when actually present.
 *   2. `dom`      - drive the editable element the way a user keystroke would
 *                   (`execCommand('insertText')`, then a synthetic `beforeinput`
 *                   pair), which Lexical applies to its own document model.
 *   3. `setDraft` - `setDraft(draft + text)`: always available, but it rebuilds
 *                   the document as plain text (reference chips are lost) and
 *                   puts the caret at the end. Last resort, reported as such.
 *
 * The chosen path is returned so callers can surface it and so the cloud e2e
 * can assert which path a real DSH build actually took.
 */

/** Composer input selector: the DSH contenteditable, verified against 0.1.5-rc.2. */
const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

/** Path order tried by default. */
const DEFAULT_PATHS = ['paste', 'dom', 'setDraft']

/**
 * @param {string} message - Diagnostics text.
 * @returns {{ ok: false, error: string }} A failed attempt result.
 */
function fail(message) {
  return { ok: false, error: message }
}

/**
 * Find the composer's editable element.
 *
 * @param {Document} doc - Owning document.
 * @returns {Element | null} The composer input, else null.
 */
function findComposerInput(doc) {
  const found = doc.querySelectorAll(COMPOSER_INPUT_SELECTOR)
  if (found.length === 0) return null
  return found[found.length - 1]
}

/**
 * Insert through the shell's internal `paste(text)`.
 *
 * @param {object} ctx - Attempt context.
 * @param {string} ctx.text - Block to insert.
 * @param {object | undefined} ctx.inputActions - Public input actions face.
 * @returns {{ ok: boolean, error?: string }} The attempt result.
 */
function insertViaPaste({ text, inputActions }) {
  if (inputActions === undefined || typeof inputActions.paste !== 'function') {
    return fail('inputActions.paste is not exposed by this DSH build')
  }
  try {
    inputActions.paste(text)
    return { ok: true }
  } catch (error) {
    return fail(`inputActions.paste threw: ${String(error)}`)
  }
}

/**
 * @param {Element} element - Candidate editable element.
 * @param {string} text - Text to insert.
 * @param {Document} doc - Owning document.
 * @returns {boolean} Whether the attempt returned success.
 */
function runInsertCommands(element, text, doc) {
  let applied = false
  if (typeof doc.execCommand === 'function') {
    try {
      applied = doc.execCommand('insertText', false, text) === true
    } catch {
      applied = false
    }
  }
  if (applied) return true

  // Fallback: hand the edit to whoever listens for `beforeinput` on the editable
  // (Lexical applies it through its own document model).
  try {
    const before = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    })
    element.dispatchEvent(before)
    const input = new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text,
    })
    element.dispatchEvent(input)
    return before.defaultPrevented
  } catch {
    return false
  }
}

/**
 * Insert by driving the contenteditable directly.
 *
 * @param {object} ctx - Attempt context.
 * @param {string} ctx.text - Block to insert.
 * @param {Document} ctx.doc - Owning document.
 * @returns {{ ok: boolean, error?: string }} The attempt result.
 */
function insertViaDom({ text, doc }) {
  const element = findComposerInput(doc)
  if (element === null) return fail('composer input not found')

  const editable = element.getAttribute('contenteditable')
  if (editable === null || editable === 'false') {
    return fail('composer input is not editable')
  }

  try {
    if (typeof element.focus === 'function') element.focus({ preventScroll: true })
  } catch {
    /* focus is best-effort: the insert below is what matters */
  }

  const applied = runInsertCommands(element, text, doc)
  if (!applied) return fail('neither execCommand nor beforeinput applied the edit')

  // Verify against the element itself: a "successful" call that changed nothing
  // must not be reported as an applied insert.
  const probe = text.split('\n')[0]
  const rendered = element.textContent ?? ''
  if (probe !== '' && !rendered.includes(probe)) {
    return fail('edit was dispatched but the editable text did not change')
  }
  return { ok: true }
}

/**
 * Insert by replacing the whole draft (chips are lost; caret moves to the end).
 *
 * @param {object} ctx - Attempt context.
 * @param {string} ctx.text - Block to insert.
 * @param {string} ctx.draft - Current draft text.
 * @param {object | undefined} ctx.inputActions - Public input actions face.
 * @returns {{ ok: boolean, error?: string }} The attempt result.
 */
function insertViaSetDraft({ text, draft, inputActions }) {
  if (inputActions === undefined || typeof inputActions.setDraft !== 'function') {
    return fail('inputActions.setDraft is not available')
  }
  try {
    inputActions.setDraft(`${draft ?? ''}${text}`)
    return { ok: true }
  } catch (error) {
    return fail(`inputActions.setDraft threw: ${String(error)}`)
  }
}

const ATTEMPTS = {
  paste: insertViaPaste,
  dom: insertViaDom,
  setDraft: insertViaSetDraft,
}

/**
 * Insert the block, trying each path in order until one is verified.
 *
 * @param {object} options - Insert request.
 * @param {string} options.text - Block to insert (newline-terminated).
 * @param {Document} options.doc - Owning document.
 * @param {string} [options.draft] - Current draft text.
 * @param {object} [options.inputActions] - Public input actions face.
 * @param {string[]} [options.paths] - Path order override (used by probes).
 * @returns {{ ok: boolean, path?: string, tried: { path: string, error?: string }[] }}
 *   The winning path, or the full attempt trail when every path failed.
 */
function insertBlock(options) {
  const paths = options.paths ?? DEFAULT_PATHS
  const tried = []

  for (const path of paths) {
    const attempt = ATTEMPTS[path]
    if (attempt === undefined) {
      tried.push({ path, error: 'unknown path' })
      continue
    }
    const result = attempt(options)
    if (result.ok) {
      tried.push({ path })
      return { ok: true, path, tried }
    }
    tried.push({ path, error: result.error })
  }

  return { ok: false, tried }
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Selection mode: the floating pointer button, the hover highlight, the hint
 * bar, and the capture-phase event handling that turns a page click into a
 * picked element.
 *
 * Flow (matching ZCode's behaviour):
 *   click the floating button -> selection mode on, hovering outlines the
 *   resolved element -> click an element -> the pick is reported and selection
 *   mode exits -> click the button again (or press Escape) to leave without
 *   picking.
 *
 * While selection mode is on, the click must NOT reach the application: every
 * relevant event is swallowed in the capture phase, and the picker's own nodes
 * are excluded from hit-testing by their `data-dsh-picker-ui` marker.
 *
 * Plain DOM (no framework): the plugin's React entry only calls `toggle()`.
 */

/** Marker attribute on every node this overlay owns. */
const PICKER_MARKER = 'data-dsh-picker-ui'

/** Hint text shown while selection mode is on. */
const HINT_TEXT = '选择模式：点击界面元素插入定位信息 · 再点按钮或 Esc 取消'

/** Event types swallowed in the capture phase while selection mode is on. */
const SWALLOWED_EVENTS = [
  'pointerdown',
  'mousedown',
  'mouseup',
  'pointerup',
  'contextmenu',
  'submit',
]

/**
 * @param {Document} doc - Owning document.
 * @returns {boolean} Whether the marker attribute names one of our nodes.
 */
function isOwnNode(node, doc) {
  if (node === null || node.nodeType !== 1) return false
  if (typeof node.closest !== 'function') return false
  return node.closest(`[${PICKER_MARKER}]`) !== null
}

/**
 * The mouse-pointer glyph, built without JSX so the bundle stays a classic
 * script.
 *
 * @param {Document} doc - Owning document.
 * @returns {Element} An inline SVG icon.
 */
function createIcon(doc) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(ns, 'svg')
  svg.setAttribute('width', '20')
  svg.setAttribute('height', '20')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')

  const path = doc.createElementNS(ns, 'path')
  path.setAttribute('d', 'M5 3l14 8-6 1.6L10.6 19z')
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)

  const rays = doc.createElementNS(ns, 'path')
  rays.setAttribute('d', 'M3 3l2.4 2.4M3 8.4h3M8.4 3v3')
  rays.setAttribute('stroke', 'currentColor')
  rays.setAttribute('stroke-width', '1.6')
  rays.setAttribute('stroke-linecap', 'round')
  svg.appendChild(rays)

  return svg
}

/**
 * Create the picker controller for one document.
 *
 * @param {object} options - Controller options.
 * @param {Document} options.doc - Owning document.
 * @param {Window} options.win - Owning window.
 * @param {(element: Element, event: Event) => void} options.onPick - Called with
 *   the resolved element; selection mode has already been left.
 * @param {(event: { type: string, [key: string]: unknown }) => void} [options.onEvent]
 *   - Diagnostics sink (entering/leaving/undecided picks).
 * @returns {{ toggle: () => boolean, setActive: (next: boolean) => boolean,
 *   isActive: () => boolean, dispose: () => void, element: Element }} The
 *   controller.
 */
function createPicker({ doc, win, onPick, onEvent }) {
  const emit = (event) => {
    if (typeof onEvent === 'function') onEvent(event)
  }

  const root = doc.createElement('div')
  root.id = 'dsh-element-picker-root'
  root.setAttribute(PICKER_MARKER, 'root')
  // Written up front so the overlay's state is readable from the DOM before the
  // first toggle (automation and the stylesheet both key off it).
  root.setAttribute('data-dsh-picker-active', 'false')

  const button = doc.createElement('button')
  button.type = 'button'
  button.setAttribute(PICKER_MARKER, 'button')
  button.setAttribute('aria-label', '选择界面元素加入聊天')
  button.title = '选择界面元素加入聊天'
  button.appendChild(createIcon(doc))

  const highlight = doc.createElement('div')
  highlight.setAttribute(PICKER_MARKER, 'highlight')

  const hint = doc.createElement('div')
  hint.setAttribute(PICKER_MARKER, 'hint')
  hint.textContent = HINT_TEXT

  root.appendChild(button)
  root.appendChild(highlight)
  root.appendChild(hint)

  const host = doc.body ?? doc.documentElement
  host.appendChild(root)
  place()

  let active = false
  let current = null
  let layoutObserver = null

  /**
   * Re-anchor whenever the app's own layout changes.
   *
   * `place()` runs once on mount, but DSH renders its composer *after* plugins
   * apply — a one-shot placement leaves the button in the corner until the user
   * happens to resize or scroll. A coalesced mutation observer keeps it beside
   * the composer without a polling loop.
   *
   * @returns {void}
   */
  function watchLayout() {
    if (typeof win.MutationObserver !== 'function') return
    let queued = false
    const flush = () => {
      queued = false
      place()
      if (active) paint()
    }
    layoutObserver = new win.MutationObserver(() => {
      if (queued) return
      queued = true
      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(flush)
      else setTimeout(flush, 16)
    })
    layoutObserver.observe(host, { childList: true, subtree: true })
  }

  /**
   * Anchor the floating button just above the composer card's right edge.
   *
   * A fixed corner placement collides with the composer on a layout where the
   * card spans the viewport width, which would make the send button unclickable
   * while the picker is idle. Anchoring to the card keeps the button beside the
   * composer (the same neighbourhood as ZCode's control) and moving with it; if
   * no card is present, the CSS corner placement stands.
   *
   * @returns {void}
   */
  function place() {
    const card =
      doc.querySelector('[data-composer-card]') ?? doc.querySelector('[data-composer-seat]')
    if (card === null) {
      button.style.top = 'auto'
      button.style.bottom = '20px'
      button.style.right = '20px'
      return
    }
    const box = card.getBoundingClientRect()
    const gap = 8
    const viewportWidth =
      typeof win.innerWidth === 'number' ? win.innerWidth : box.right + gap
    button.style.bottom = 'auto'
    button.style.top = `${Math.max(gap, Math.round(box.top - 48))}px`
    button.style.right = `${Math.max(gap, Math.round(viewportWidth - box.right + gap))}px`
  }

  /**
   * Reposition the highlight over the current target, in viewport coordinates
   * (the highlight is fixed), so scrolling and nested scrollports both stay
   * accurate as long as a scroll repaints.
   *
   * @returns {void}
   */
  const paint = () => {
    if (current === null) {
      highlight.removeAttribute('data-dsh-picker-visible')
      return
    }
    const box = current.getBoundingClientRect()
    highlight.style.left = `${Math.round(box.left)}px`
    highlight.style.top = `${Math.round(box.top)}px`
    highlight.style.width = `${Math.round(box.width)}px`
    highlight.style.height = `${Math.round(box.height)}px`
    highlight.setAttribute('data-dsh-picker-visible', 'true')
  }

  /**
   * Resolve the element under a viewport point, ignoring the picker's own nodes.
   *
   * @param {number} x - Viewport x.
   * @param {number} y - Viewport y.
   * @returns {Element | null} The resolved target, else null.
   */
  const targetAt = (x, y) => {
    const stack =
      typeof doc.elementsFromPoint === 'function'
        ? doc.elementsFromPoint(x, y)
        : [doc.elementFromPoint(x, y)]
    for (const node of stack) {
      if (node === null || isOwnNode(node, doc)) continue
      return resolveTarget(node, doc)
    }
    return null
  }

  const onPointerMove = (event) => {
    if (!active) return
    const next = targetAt(event.clientX, event.clientY)
    if (next === current) return
    current = next
    paint()
  }

  const swallow = (event) => {
    if (!active) return
    if (isOwnNode(event.target, doc)) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  const onClick = (event) => {
    if (!active) return
    if (isOwnNode(event.target, doc)) return
    swallow(event)

    const element = targetAt(event.clientX, event.clientY)
    setActive(false)
    if (element === null) {
      emit({ type: 'pick-missed' })
      return
    }
    emit({ type: 'pick', selectorReady: true })
    onPick(element, event)
  }

  const onKeyDown = (event) => {
    if (!active) return
    if (event.key !== 'Escape') return
    swallow(event)
    setActive(false)
    emit({ type: 'cancel-escape' })
  }

  const onScrollOrResize = () => {
    place()
    if (active) paint()
  }

  /**
   * Enter or leave selection mode.
   *
   * @param {boolean} next - Desired state.
   * @returns {boolean} The state after the call.
   */
  function setActive(next) {
    if (next === active) return active
    active = next
    root.setAttribute('data-dsh-picker-active', active ? 'true' : 'false')
    button.setAttribute('aria-pressed', active ? 'true' : 'false')

    if (!active) {
      current = null
      highlight.removeAttribute('data-dsh-picker-visible')
    }
    emit({ type: active ? 'enter' : 'leave' })
    return active
  }

  watchLayout()

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    setActive(!active)
  })

  doc.addEventListener('pointermove', onPointerMove, true)
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('keydown', onKeyDown, true)
  for (const type of SWALLOWED_EVENTS) doc.addEventListener(type, swallow, true)
  win.addEventListener('scroll', onScrollOrResize, true)
  win.addEventListener('resize', onScrollOrResize, true)

  return {
    element: root,
    isActive: () => active,
    setActive,
    toggle: () => setActive(!active),
    dispose: () => {
      if (layoutObserver !== null && typeof layoutObserver.disconnect === 'function') {
        layoutObserver.disconnect()
      }
      doc.removeEventListener('pointermove', onPointerMove, true)
      doc.removeEventListener('click', onClick, true)
      doc.removeEventListener('keydown', onKeyDown, true)
      for (const type of SWALLOWED_EVENTS) doc.removeEventListener(type, swallow, true)
      win.removeEventListener('scroll', onScrollOrResize, true)
      win.removeEventListener('resize', onScrollOrResize, true)
      root.remove()
    },
  }
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Plugin entry for the browser half.
 *
 * Registers one compact control in the composer tool row
 * (`conversation.input.left`) and owns the frame-wide overlay: the floating
 * pointer button, the highlight, and selection mode.
 *
 * The overlay is plain DOM; React is only used for the slot component, because
 * slot entries must render React. `react` is a DSH platform module, so the
 * bundle requires it instead of shipping it.
 */
const React = require("react")


/** Composer tool-row slot their entry opts into. */
const SLOT = 'conversation.input.left'

/** Entry id (a fresh id adds a cell beside the shipped entries). */
const ENTRY_ID = 'element-picker'

/** Console prefix for every diagnostic this plugin prints. */
const LOG_PREFIX = '[dsh-element-picker]'

/** Cordis services this plugin needs. */
const inject = ['slots']

/**
 * @param {...unknown} args - Values to log.
 * @returns {void}
 */
function log(...args) {
  // eslint-disable-next-line no-console
  console.log(LOG_PREFIX, ...args)
}

/**
 * The mouse-pointer glyph used by the composer control.
 *
 * @returns {unknown} A React element.
 */
function PointerIcon() {
  return React.createElement(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
    },
    React.createElement('path', {
      d: 'M5 3l14 8-6 1.6L10.6 19z',
      fill: 'currentColor',
    }),
  )
}

/**
 * The composer tool-row control: toggles selection mode and keeps the slot's
 * live input face reachable from the DOM-side picker.
 *
 * @param {object} props - Slot props (session scope standard props).
 * @returns {unknown} A React element.
 */
function PickerButton(props) {
  const inputActions = props.inputActions
  const state = PICKER_STATE
  state.inputActions = inputActions
  state.draft = typeof props.useInput === 'function' ? props.useInput((s) => s.draft) : ''

  const [active, setActive] = React.useState(state.picker === null ? false : state.picker.isActive())
  React.useEffect(() => {
    if (state.picker === null) return undefined
    state.subscribe(setActive)
    return () => state.unsubscribe(setActive)
  }, [])

  const onClick = React.useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    if (state.picker !== null) state.picker.toggle()
  }, [])

  return React.createElement(
    'button',
    {
      type: 'button',
      onClick,
      'data-dsh-picker-ui': 'slot-button',
      'aria-label': '选择界面元素加入聊天',
      'aria-pressed': active ? 'true' : 'false',
      title: '选择界面元素加入聊天',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        border: 'none',
        borderRadius: 6,
        background: active ? '#4d6bfe' : 'transparent',
        color: active ? '#ffffff' : 'inherit',
        cursor: 'pointer',
      },
    },
    React.createElement(PointerIcon, null),
  )
}

/**
 * Shared state between the React slot control and the DOM-side picker: slot
 * props are the only place the live input face exists, and the picker callback
 * is the only place the pick arrives.
 */
const PICKER_STATE = {
  picker: null,
  inputActions: undefined,
  draft: '',
  listeners: new Set(),
  subscribe(listener) {
    PICKER_STATE.listeners.add(listener)
  },
  unsubscribe(listener) {
    PICKER_STATE.listeners.delete(listener)
  },
  publish() {
    if (PICKER_STATE.picker === null) return
    for (const listener of PICKER_STATE.listeners) listener(PICKER_STATE.picker.isActive())
  },
}

/**
 * Insert one picked element's locating block into the composer.
 *
 * @param {Element} element - The resolved element.
 * @returns {void}
 */
function insertPickedElement(element) {
  const doc = element.ownerDocument
  const win = doc.defaultView ?? undefined
  let text = ''
  try {
    text = buildElementBlock(element, {
      doc,
      win,
      scroll: { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 },
    })
  } catch (error) {
    log('failed to describe element:', String(error))
    return
  }

  const result = insertBlock({
    text,
    doc,
    draft: PICKER_STATE.draft,
    inputActions: PICKER_STATE.inputActions,
  })

  if (result.ok) {
    log(`inserted via "${result.path}" (${text.split('\n').length} lines)`)
    return
  }
  log('insert failed; attempt trail:', JSON.stringify(result.tried))
}

/**
 * Mount the overlay and register the composer control.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @returns {void}
 */
function apply(ctx) {
  const win = window
  const doc = win.document
  const teardownStyles = installStyles(doc)

  const picker = createPicker({
    doc,
    win,
    onPick: (element) => {
      insertPickedElement(element)
    },
    onEvent: (event) => {
      if (event.type === 'pick' || event.type === 'cancel-escape' || event.type === 'pick-missed') {
        log('overlay event:', event.type)
      }
      PICKER_STATE.publish()
    },
  })
  PICKER_STATE.picker = picker

  ctx.slots.inject(SLOT, () =>
    ctx.slots.register(
      { name: SLOT, id: ENTRY_ID, order: 100, label: '选择元素' },
      PickerButton,
    ),
  )

  ctx.effect(() => () => {
    picker.dispose()
    PICKER_STATE.picker = null
    PICKER_STATE.listeners.clear()
    teardownStyles()
  }, 'dsh-element-picker: overlay and stylesheet')
}


		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
