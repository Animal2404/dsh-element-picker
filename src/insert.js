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
export const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

/** Path order tried by default. */
export const DEFAULT_PATHS = ['paste', 'dom', 'setDraft']

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
export function findComposerInput(doc) {
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
export function insertBlock(options) {
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
