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
      tried.push({ path })
      return { ok: true, path, tried }
    }
    tried.push({ path, error: result.error })
  }

  return { ok: false, tried }
}
