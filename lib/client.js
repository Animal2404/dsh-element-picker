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
 *
 * The picker owns no button of its own — its one control is the entry in the
 * composer tool row — so this layer is purely the highlight and the hint, and it
 * never intercepts pointer events.
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
 * Shorten a repository path to its last two segments.
 *
 * The compact block is inserted into a chat composer, so a 70-character path
 * costs more than it earns: `…/skeleton/ConversationRoot.tsx` still says which
 * file to open.
 *
 * @param {string} path - Repository path.
 * @returns {string} A shortened path.
 */
function shortPath(path) {
  const parts = path.split('/')
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

/**
 * Build the locating information for one element.
 *
 * Two shapes, because the composer is a chat input:
 *
 * - compact (default) — ONE line, the three things an agent needs to start:
 *   `[元素] button.IXshSW_header "任务 6 已完成" ｜ [选择器] button.IXshSW_header ｜ [源码] …/skeleton/ConversationRoot.tsx`
 * - detailed (`detailed: true`) — the full multi-line block with XPath,
 *   geometry, computed style, attributes, and an HTML excerpt.
 *
 * The verbose shape is what the first shipped version always inserted, and a
 * wall of eight lines per pick is the opposite of how ZCode presents a picked
 * element.
 *
 * @param {Element} element - Element under the pointer.
 * @param {object} [env] - Environment overrides.
 * @param {Window} [env.win] - Window for computed styles.
 * @param {Document} [env.doc] - Document for source lookup.
 * @param {DOMRect} [env.rect] - Pre-measured bounds.
 * @param {{ x: number, y: number }} [env.scroll] - Page scroll offset.
 * @param {boolean} [env.detailed] - Emit the full multi-line block.
 * @returns {string} The block, newline-terminated.
 */
function buildElementBlock(element, env = {}) {
  const doc = env.doc ?? element.ownerDocument
  const selector = generateSelector(element)
  const source = sourceFor(element, doc)

  if (env.detailed !== true) {
    const parts = [`[元素] ${describeElement(element)}`]
    if (selector !== '') parts.push(`[选择器] ${selector}`)
    if (source !== null) parts.push(`[源码] ${shortPath(source.path)}`)
    return `${parts.join(' ｜ ')}\n`
  }

  const lines = [`[元素] ${describeElement(element)}`]

  if (selector !== '') lines.push(`[选择器] ${selector}`)

  const xpath = generateXPath(element)
  if (xpath !== '') lines.push(`[XPath] ${xpath}`)

  const position = rectLine(element, env.rect, env.scroll)
  if (position !== '') lines.push(`[位置] ${position}`)

  const style = styleLine(element, env.win)
  if (style !== '') lines.push(`[样式] ${style}`)

  const attributes = attributeLine(element)
  if (attributes !== '') lines.push(`[属性] ${attributes}`)

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
 * Ensure the document selection sits inside the editor.
 *
 * Chromium only applies `execCommand('insertText')` where the selection is; a
 * programmatic `focus()` does not reliably leave a caret inside a Lexical root,
 * which is why the first real-DSH probe could not insert through the DOM. When
 * the selection is elsewhere, a caret is placed at the end of the editable.
 *
 * @param {Element} element - The editable element.
 * @param {Document} doc - Owning document.
 * @returns {boolean} True when a caret inside the editor is (now) selected.
 */
function ensureCaretInside(element, doc) {
  if (typeof doc.getSelection !== 'function') return false
  let selection = null
  try {
    selection = doc.getSelection()
  } catch {
    return false
  }
  if (selection === null || selection === undefined) return false

  try {
    const anchor = selection.anchorNode ?? null
    if (anchor !== null && typeof element.contains === 'function' && element.contains(anchor)) {
      return true
    }
    if (typeof doc.createRange !== 'function') return false
    const range = doc.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  } catch {
    return false
  }
}

/**
 * @param {Element} element - The editable element.
 * @param {string} text - Text to insert.
 * @param {Document} doc - Owning document.
 * @returns {boolean} Whether the command reported success.
 */
function runExecCommand(element, text, doc) {
  if (typeof doc.execCommand !== 'function') return false
  try {
    return doc.execCommand('insertText', false, text) === true
  } catch {
    return false
  }
}

/**
 * Dispatch a synthetic paste event carrying the text.
 *
 * Lexical handles `paste` itself and turns a multi-line payload into proper
 * paragraphs, which is the closest thing to "the user pasted this".
 *
 * @param {Element} element - The editable element.
 * @param {string} text - Text to insert.
 * @param {Window | undefined} win - Owning window (for the constructors).
 * @returns {boolean} Whether a listener claimed the event.
 */
function dispatchPasteEvent(element, text, win) {
  const DataTransferCtor = win?.DataTransfer ?? globalThis.DataTransfer
  const ClipboardEventCtor = win?.ClipboardEvent ?? globalThis.ClipboardEvent
  if (typeof DataTransferCtor !== 'function' || typeof ClipboardEventCtor !== 'function') {
    return false
  }
  try {
    const transfer = new DataTransferCtor()
    transfer.setData('text/plain', text)
    const event = new ClipboardEventCtor('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    })
    // Chromium has historically ignored `clipboardData` in the init dict, so the
    // payload is forced onto the event when the constructor dropped it.
    if (event.clipboardData === null || event.clipboardData === undefined) {
      try {
        Object.defineProperty(event, 'clipboardData', { value: transfer })
      } catch {
        return false
      }
    }
    element.dispatchEvent(event)
    return event.defaultPrevented === true
  } catch {
    return false
  }
}

/**
 * Hand the edit to whoever listens for `beforeinput` on the editable.
 *
 * @param {Element} element - The editable element.
 * @param {string} text - Text to insert.
 * @param {Window | undefined} win - Owning window (for the event constructor).
 * @returns {boolean} Whether a listener claimed the event.
 */
function dispatchBeforeInput(element, text, win) {
  const InputEventCtor = win?.InputEvent ?? globalThis.InputEvent
  if (typeof InputEventCtor !== 'function') return false
  try {
    const before = new InputEventCtor('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    })
    element.dispatchEvent(before)
    if (before.defaultPrevented !== true) return false
    element.dispatchEvent(
      new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: text }),
    )
    return true
  } catch {
    return false
  }
}

/**
 * @param {Element} element - The editable element.
 * @param {string} text - The text that should now be present.
 * @returns {boolean} Whether the editable shows the block, in order.
 */
function verifyInserted(element, text) {
  const lines = text.split('\n').filter((line) => line !== '')
  if (lines.length === 0) return true
  // `innerText` keeps paragraph breaks that `textContent` drops, so reading both
  // catches an insert that landed but was reflowed into the wrong order.
  const rendered = `${element.textContent ?? ''}\n${element.innerText ?? ''}`

  const first = lines[0]
  const last = lines[lines.length - 1]
  if (!rendered.includes(first) || !rendered.includes(last)) return false
  if (first === last) return true
  return rendered.indexOf(last) > rendered.indexOf(first)
}

/**
 * Insert by driving the contenteditable directly, trying the DOM routes a user
 * edit would take and verifying each one before believing it.
 *
 * Order matters: DSH's composer is Lexical, whose own `paste` handler is what
 * turns a multi-line payload into proper paragraphs — `execCommand` reflows the
 * same text badly there. So the paste event goes first, and the plain
 * contenteditable routes follow for editors without a paste handler.
 *
 * @param {object} ctx - Attempt context.
 * @param {string} ctx.text - Block to insert.
 * @param {Document} ctx.doc - Owning document.
 * @param {Window} [ctx.win] - Owning window.
 * @returns {{ ok: boolean, error?: string, note?: string }} The attempt result.
 */
function insertViaDom({ text, doc, win }) {
  const element = findComposerInput(doc)
  if (element === null) return fail('composer input not found')

  const editable = element.getAttribute('contenteditable')
  if (editable === null || editable === 'false') {
    return fail('composer input is not editable')
  }

  try {
    if (typeof element.focus === 'function') element.focus({ preventScroll: true })
  } catch {
    /* focus is best-effort: the caret below and the insert are what matter */
  }

  const caret = ensureCaretInside(element, doc)
  const routes = [
    ['paste-event', () => dispatchPasteEvent(element, text, win)],
    ['execCommand', () => runExecCommand(element, text, doc)],
    ['beforeinput', () => dispatchBeforeInput(element, text, win)],
  ]

  const trace = []
  for (const [name, apply] of routes) {
    let claimed = false
    try {
      claimed = apply() === true
    } catch (error) {
      trace.push(`${name}:threw(${String(error).slice(0, 40)})`)
      continue
    }
    if (!claimed) {
      trace.push(`${name}:refused`)
      continue
    }
    if (verifyInserted(element, text)) {
      trace.push(`${name}:ok`)
      return { ok: true, note: `caret=${caret ? 'placed' : 'unavailable'} routes[${trace.join(', ')}]` }
    }
    trace.push(`${name}:applied-but-misplaced`)
  }

  return fail(`dom routes exhausted (${trace.join(', ')})`)
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
 * @param {Window} [options.win] - Owning window (for event constructors).
 * @param {string} [options.draft] - Current draft text.
 * @param {object} [options.inputActions] - Public input actions face.
 * @param {string[]} [options.paths] - Path order override (used by probes).
 * @returns {{ ok: boolean, path?: string, note?: string,
 *   tried: { path: string, error?: string, note?: string }[] }}
 *   The winning path and the attempt trail, or the full trail when every path
 *   failed.
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
      tried.push({ path, note: result.note })
      return { ok: true, path, note: result.note, tried }
    }
    tried.push({ path, error: result.error })
  }

  return { ok: false, tried }
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Chip insertion: put a picked element into the composer as a real reference
 * chip (`data-composer-chip`) instead of a wall of text.
 *
 * This is DSH's own mechanism for "compact in the composer, rich for the model":
 * the chip shows a short label, and the owning source's `codec.serialize` expands
 * it into the full text when the message is submitted. Reaching for it is what
 * makes a pick feel like ZCode's element card rather than a paragraph.
 *
 * The published `SessionInput` face carries `insertReference(ref, span)`; the
 * only piece a plugin has to supply itself is the `TokenSpan`, whose `draftRev`
 * is published in `InputState` and whose coordinates come from the shell's
 * `caretSpan()` (a runtime member, feature-detected here).
 *
 * Every step is optional: anything missing, refusing, or throwing returns null
 * and the caller falls back to plain text. The composer must never be left in a
 * worse state than before the pick.
 */

/** Reference source name our chips belong to; also the registered codec name. */
const CHIP_SOURCE = 'element-picker'

/** Longest chip label kept in the composer. */
const LABEL_LIMIT = 48

/**
 * Build the chip's short label from an element.
 *
 * @param {Element} element - Picked element.
 * @returns {string} A one-line label.
 */
function chipLabel(element) {
  const tag = element.tagName.toLowerCase()
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  const head = `元素 ${tag}`
  if (text === '') return head
  const clipped = text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT)}…` : text
  return `${head}「${clipped}」`
}

/**
 * Register the source our chips belong to, so they serialize on submit.
 *
 * `source` on the chip must name a registered trigger source that carries a
 * `codec`; otherwise sending the message fails while serializing the chip. The
 * source itself is inert (empty candidates) — the picker inserts directly.
 *
 * @param {object | undefined} ctx - Plugin (root) context.
 * @returns {boolean} Whether a source was registered.
 */
function registerChipSource(ctx) {
  const registry = ctx?.inputTriggers
  if (registry === undefined || typeof registry.registerSource !== 'function') return false
  try {
    registry.registerSource({
      trigger: '@',
      name: CHIP_SOURCE,
      candidates: async () => [],
      onPick: () => undefined,
      codec: {
        clipboardText: (ref) => ref,
        serialize: (ref) => Promise.resolve(ref),
      },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Insert a picked element as a reference chip.
 *
 * @param {object} options - Insert request.
 * @param {object | undefined} options.ctx - Plugin (root) context.
 * @param {string | undefined} options.sessionId - Session the composer belongs to.
 * @param {string} options.text - The locating block the chip stands for.
 * @param {string} options.label - The chip's visible label.
 * @param {(message: string) => void} [options.onEvent] - Diagnostics sink.
 * @returns {string | null} 'chip' when a chip was inserted, else null.
 */
function insertElementChip({ ctx, sessionId, text, label, onEvent }) {
  const note = (message) => {
    if (typeof onEvent === 'function') onEvent(message)
  }
  if (ctx === undefined || sessionId === undefined) {
    note('chip skipped: no session-bound context yet')
    return null
  }

  try {
    const actx = ctx.sessions?.scope?.(sessionId)
    if (actx === undefined || actx === null) {
      note('chip skipped: no session scope for this session')
      return null
    }
    const facade = ctx.conversation?.input?.for?.(actx)
    if (facade === undefined || typeof facade.insertReference !== 'function') {
      note('chip skipped: the input facade is unavailable')
      return null
    }

    const snapshot = typeof facade.state?.getSnapshot === 'function' ? facade.state.getSnapshot() : undefined
    const draftRev = snapshot?.draftRev
    if (typeof draftRev !== 'number') {
      note('chip skipped: no published draft revision to guard the edit')
      return null
    }

    // `caretSpan()` is the shell's live selection in detect coordinates; without
    // it, the end of the draft is the next best anchor.
    let start = typeof snapshot?.draft === 'string' ? snapshot.draft.length : 0
    let end = start
    if (typeof facade.caretSpan === 'function') {
      const caret = facade.caretSpan()
      if (typeof caret?.start === 'number' && typeof caret?.end === 'number') {
        start = caret.start
        end = caret.end
      }
    }

    const applied = facade.insertReference(
      {
        source: CHIP_SOURCE,
        ref: text,
        label,
        appearance: 'file',
        clipboardText: text,
      },
      { start, end, draftRev },
    )
    if (applied !== true) {
      note('chip refused by the input machine (phase or revision guard)')
      return null
    }
    return 'chip'
  } catch (error) {
    note(`chip insert failed: ${String(error)}`)
    return null
  }
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Selection mode: the hover highlight, the hint bar, and the capture-phase
 * event handling that turns a page click into a picked element.
 *
 * There is exactly ONE picker control — the entry registered in the composer
 * tool row (`conversation.input.left`) — and it drives `toggle()` here. The
 * overlay deliberately owns no button of its own: an earlier floating button
 * duplicated the control and sat over the composer.
 *
 * The pick is exactly the element under the pointer. No climbing: pointing at a
 * row means the row, pointing at an icon means the icon (this is what ZCode
 * does, and climbing to "the nearest control" is what silently handed people an
 * ancestor's `<button>` instead of the thing they outlined).
 *
 * Flow:
 *   click the tool-row button -> selection mode on, hovering outlines the
 *   element under the pointer -> click an element -> the pick is reported and
 *   selection mode exits -> click the button again (or press Escape) to leave
 *   without picking.
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
const HINT_TEXT = '选择模式：点击元素插入定位信息 · Shift+点击插入完整信息 · 再点工具行按钮或 Esc 取消'

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
 * @param {Node | null} node - Candidate node.
 * @param {Document} doc - Owning document.
 * @returns {boolean} Whether the node belongs to the picker's own UI.
 */
function isOwnNode(node, doc) {
  if (node === null || node.nodeType !== 1) return false
  if (typeof node.closest !== 'function') return false
  return node.closest(`[${PICKER_MARKER}]`) !== null
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
 *   - Diagnostics sink (entering/leaving/missed picks).
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

  const highlight = doc.createElement('div')
  highlight.setAttribute(PICKER_MARKER, 'highlight')

  const hint = doc.createElement('div')
  hint.setAttribute(PICKER_MARKER, 'hint')
  hint.textContent = HINT_TEXT

  root.appendChild(highlight)
  root.appendChild(hint)

  const host = doc.body ?? doc.documentElement
  host.appendChild(root)

  let active = false
  let current = null

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
   * Depth of an element in the tree, used to pick the innermost candidate when
   * hit-testing cannot answer.
   *
   * @param {Element} element - Candidate element.
   * @returns {number} Ancestor count.
   */
  const depthOf = (element) => {
    let depth = 0
    let node = element.parentElement
    while (node !== null) {
      depth += 1
      node = node.parentElement
    }
    return depth
  }

  /**
   * Last-resort lookup for points where hit-testing returns nothing.
   *
   * `elementsFromPoint` skips anything with `pointer-events: none` (and any
   * region whose whole stack is the picker's own UI), which is exactly the
   * "some elements cannot be selected" case. This walks the tree instead and
   * takes the deepest element whose box contains the point. It only runs when
   * the cheap path failed, so its cost is paid once per click, not per move.
   *
   * @param {number} x - Viewport x.
   * @param {number} y - Viewport y.
   * @returns {Element | null} The innermost containing element, else null.
   */
  const geometricAt = (x, y) => {
    if (typeof doc.querySelectorAll !== 'function') return null
    let best = null
    let bestDepth = -1
    for (const element of doc.querySelectorAll('*')) {
      if (isOwnNode(element, doc)) continue
      if (element === doc.documentElement || element === doc.body) continue
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue
      const depth = depthOf(element)
      if (depth <= bestDepth) continue
      bestDepth = depth
      best = element
    }
    return best
  }

  /**
   * The element under a viewport point, ignoring the picker's own nodes.
   *
   * @param {number} x - Viewport x.
   * @param {number} y - Viewport y.
   * @returns {Element | null} The element under the pointer, else null.
   */
  const targetAt = (x, y) => {
    const stack =
      typeof doc.elementsFromPoint === 'function'
        ? doc.elementsFromPoint(x, y)
        : [doc.elementFromPoint(x, y)]
    for (const node of stack) {
      if (node === null || node.nodeType !== 1) continue
      if (isOwnNode(node, doc)) continue
      // The page itself is never the answer: picking `html`/`body` is noise.
      if (node === doc.documentElement || node === doc.body) continue
      return node
    }
    return geometricAt(x, y)
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
    emit({ type: 'pick' })
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

    if (!active) {
      current = null
      highlight.removeAttribute('data-dsh-picker-visible')
    }
    emit({ type: active ? 'enter' : 'leave' })
    return active
  }

  // Window capture, not document capture: DSH dismisses its own menus
  // (model/effort, slash and @ menus, command cards) from window-capture
  // pointerdown listeners, which run before any document-level handler. Bound
  // here, the picker sees the event first, swallows it, and the menu survives
  // long enough to be picked instead of vanishing under the pointer.
  const captureTarget = typeof win.addEventListener === 'function' ? win : doc
  captureTarget.addEventListener('pointermove', onPointerMove, true)
  captureTarget.addEventListener('click', onClick, true)
  captureTarget.addEventListener('keydown', onKeyDown, true)
  for (const type of SWALLOWED_EVENTS) captureTarget.addEventListener(type, swallow, true)
  win.addEventListener('scroll', onScrollOrResize, true)
  win.addEventListener('resize', onScrollOrResize, true)

  return {
    element: root,
    isActive: () => active,
    setActive,
    toggle: () => setActive(!active),
    dispose: () => {
      captureTarget.removeEventListener('pointermove', onPointerMove, true)
      captureTarget.removeEventListener('click', onClick, true)
      captureTarget.removeEventListener('keydown', onKeyDown, true)
      for (const type of SWALLOWED_EVENTS) captureTarget.removeEventListener(type, swallow, true)
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

/** Services this plugin's browser half consumes (declared in package.json too). */

/** Entry id (a fresh id adds a cell beside the shipped entries). */
const ENTRY_ID = 'element-picker'

/** Console prefix for every diagnostic this plugin prints. */
const LOG_PREFIX = '[dsh-element-picker]'

/**
 * Cordis services this plugin needs.
 *
 * Every service property is guarded: reading one that is not declared here
 * throws ("cannot get property X without inject"), and a throw inside apply
 * aborts the host's boot. So each service the picker touches is listed, even the
 * ones only used on the pick path.
 */
const inject = ['slots', 'inputTriggers', 'conversation', 'sessions']

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
  state.sessionId = props.sessionId
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
  // A pick inserts a chip (compact in the composer, expanded on send); holding
  // Shift while picking inserts the full text block instead.
  detailed: false,
  sessionId: undefined,
  ctx: undefined,
  // A chip whose source has no registered codec would fail to serialize when the
  // message is sent, so a chip is only inserted once the codec is confirmed.
  chipReady: false,
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
function insertPickedElement(element, detailed = false) {
  const doc = element.ownerDocument
  const win = doc.defaultView ?? undefined
  let text = ''
  try {
    text = buildElementBlock(element, {
      doc,
      win,
      scroll: { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 },
      detailed: detailed === true,
    })
  } catch (error) {
    log('failed to describe element:', String(error))
    return
  }

  // A chip is the DSH-native shape for this: compact in the composer, expanded
  // into the block above by the chip's codec when the message is sent.
  if (detailed !== true) {
    // The trigger registry may not have been up when the plugin applied
    // (service ordering), so registration is retried before the first chip use.
    if (PICKER_STATE.chipReady !== true) {
      PICKER_STATE.chipReady = registerChipSource(PICKER_STATE.ctx)
      if (PICKER_STATE.chipReady) log('chip codec registered on retry')
    }
  }

  if (detailed !== true && PICKER_STATE.chipReady === true) {
    const chip = insertElementChip({
      ctx: PICKER_STATE.ctx,
      sessionId: PICKER_STATE.sessionId,
      text,
      label: chipLabel(element),
      onEvent: (message) => log(message),
    })
    if (chip !== null) {
      log(`inserted a ${chip} for ${element.tagName.toLowerCase()}`)
      return
    }
  }

  const result = insertBlock({
    text,
    doc,
    win,
    draft: PICKER_STATE.draft,
    inputActions: PICKER_STATE.inputActions,
  })

  if (result.ok) {
    const earlier = result.tried.slice(0, -1)
    const trail = earlier.length === 0 ? '' : ` after ${JSON.stringify(earlier)}`
    log(`inserted via "${result.path}" (${result.note ?? 'no note'})${trail}`)
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
  try {
    applyPicker(ctx)
  } catch (error) {
    // A throwing loader entry aborts the host's boot (an empty page, not a
    // missing button), so the picker contains its own failures.
    log('apply failed; the picker stays inert:', String(error))
  }
}

/**
 * Mount the overlay and register the composer control.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @returns {void}
 */
function applyPicker(ctx) {
  const win = window
  const doc = win.document
  PICKER_STATE.ctx = ctx
  const chipsRegistered = registerChipSource(ctx)
  PICKER_STATE.chipReady = chipsRegistered
  const teardownStyles = installStyles(doc)

  const picker = createPicker({
    doc,
    win,
    onPick: (element, event) => {
      // Shift is the escape hatch to the verbose block; no config plumbing.
      insertPickedElement(element, event !== undefined && event.shiftKey === true)
    },
    onEvent: (event) => {
      if (event.type === 'pick' || event.type === 'cancel-escape' || event.type === 'pick-missed') {
        log('overlay event:', event.type)
      }
      PICKER_STATE.publish()
    },
  })
  PICKER_STATE.picker = picker

  log(
    `mode: chip with a text fallback${chipsRegistered ? '' : ' — chip codec not registered yet'}` +
      '; Shift+click inserts the full text block',
  )

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
