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

import { findComposerInput } from './insert.js'

/** Reference source name our chips belong to; also the registered codec name. */
export const CHIP_SOURCE = 'element-picker'

/** Longest chip label kept in the composer. */
const LABEL_LIMIT = 48

/**
 * Build the chip's short label from an element.
 *
 * @param {Element} element - Picked element.
 * @returns {string} A one-line label.
 */
export function chipLabel(element) {
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
export function registerChipSource(ctx) {
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
 * Resolve the per-session input facade, or null when it is not reachable.
 *
 * @param {object | undefined} ctx - Plugin (root) context.
 * @param {string | undefined} sessionId - Session the composer belongs to.
 * @param {(message: string) => void} [note] - Diagnostics sink.
 * @returns {object | null} The facade, or null.
 */
export function resolveFacade(ctx, sessionId, note) {
  const say = typeof note === 'function' ? note : () => {}
  if (ctx === undefined || sessionId === undefined) {
    say('chip skipped: no session-bound context yet')
    return null
  }
  try {
    const actx = ctx.sessions?.scope?.(sessionId)
    if (actx === undefined || actx === null) {
      say('chip skipped: no session scope for this session')
      return null
    }
    const facade = ctx.conversation?.input?.for?.(actx)
    if (facade === undefined) {
      say('chip skipped: the input facade is unavailable')
      return null
    }
    return facade
  } catch (error) {
    say(`chip skipped: ${String(error)}`)
    return null
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
export function insertElementChip({ ctx, sessionId, text, label, onEvent }) {
  const note = (message) => {
    if (typeof onEvent === 'function') onEvent(message)
  }
  const facade = resolveFacade(ctx, sessionId, note)
  if (facade === null || typeof facade.insertReference !== 'function') return null

  try {
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

/** Attribute carrying the locating block a chip stands for. */
export const CHIP_BLOCK_ATTR = 'data-dsh-picker-block'

/** Marker attribute on the injected remove affordance. */
export const CHIP_REMOVE_MARKER = 'data-dsh-picker-remove'

/** Block text per chip element, so a removal can find its line in the draft. */
const BLOCK_BY_CHIP = new WeakMap()

/**
 * Remember which block a chip stands for.
 *
 * @param {Element} chip - The chip element.
 * @param {string} block - The locating block it inserts.
 * @returns {void}
 */
export function rememberChip(chip, block) {
  BLOCK_BY_CHIP.set(chip, block)
}

/**
 * @param {Element} chip - A chip element.
 * @returns {string | undefined} The block it stands for, when known.
 */
export function rememberedBlock(chip) {
  return BLOCK_BY_CHIP.get(chip)
}

/**
 * @param {Document} doc - Owning document.
 * @returns {number} How many of the picker's chips are in the composer.
 */
function countChips(doc) {
  return doc.querySelectorAll(`[data-composer-chip="${CHIP_SOURCE}"]`).length
}

/**
 * Add a small × to every picker chip that lacks one.
 *
 * The affordance is injected into the chip's own element so it reads as part of
 * the chip (ZCode's picked-element pill carries one too), and it is idempotent so
 * a re-render that drops it is repaired by the next pass.
 *
 * @param {object} options - Decoration request.
 * @param {Document} options.doc - Owning document.
 * @param {(chip: Element) => void} options.onRemove - Invoked when a × is clicked.
 * @returns {number} How many chips were decorated.
 */
export function decorateChips({ doc, onRemove }) {
  let decorated = 0
  for (const chip of doc.querySelectorAll(`[data-composer-chip="${CHIP_SOURCE}"]`)) {
    if (chip.querySelector(`[${CHIP_REMOVE_MARKER}]`) !== null) continue
    const remove = doc.createElement('span')
    remove.setAttribute(CHIP_REMOVE_MARKER, '1')
    remove.setAttribute('contenteditable', 'false')
    remove.setAttribute('role', 'button')
    remove.setAttribute('aria-label', '移除该元素')
    remove.setAttribute('title', '移除该元素')
    remove.textContent = '×'

    const stop = (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    // Swallowed so the editor never moves its caret or selects the chip; only the
    // picker reacts.
    remove.addEventListener('pointerdown', stop, true)
    remove.addEventListener('mousedown', stop, true)
    remove.addEventListener('click', (event) => {
      stop(event)
      onRemove(chip)
    }, true)

    chip.appendChild(remove)
    decorated += 1
  }
  return decorated
}

/**
 * Keep chips decorated across editor updates.
 *
 * @param {object} options - Watch request.
 * @param {Document} options.doc - Owning document.
 * @param {Window} options.win - Owning window.
 * @param {(chip: Element) => void} options.onRemove - Invoked when a × is clicked.
 * @returns {() => void} Teardown.
 */
export function watchChips({ doc, win, onRemove }) {
  decorateChips({ doc, onRemove })
  if (typeof win.MutationObserver !== 'function') return () => {}
  let queued = false
  const flush = () => {
    queued = false
    decorateChips({ doc, onRemove })
  }
  const observer = new win.MutationObserver(() => {
    if (queued) return
    queued = true
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(flush)
    else setTimeout(flush, 16)
  })
  observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
  return () => observer.disconnect()
}

/**
 * Remove one picked element's chip.
 *
 * Two routes, both verified by counting the picker's chips afterwards:
 *
 * 1. the user's own gesture — put the caret after the chip and send Backspace,
 *    which is exactly what a person would do, and which leaves the rest of the
 *    draft (including a user's own `@file` chips) untouched;
 * 2. the input facade — `setDraft` with the chip's line removed. Deterministic,
 *    but it rebuilds the draft as plain text, so other chips flatten.
 *
 * @param {object} options - Removal request.
 * @param {Document} options.doc - Owning document.
 * @param {Window} options.win - Owning window.
 * @param {Element} options.chip - The chip to remove.
 * @param {object | null} [options.facade] - Session input facade, when reachable.
 * @param {string} [options.blockText] - The block the chip stands for.
 * @param {(message: string) => void} [options.onEvent] - Diagnostics sink.
 * @returns {string | null} The route that worked, else null.
 */
export function removeChipElement({ doc, win, chip, facade, blockText, onEvent }) {
  const note = (message) => {
    if (typeof onEvent === 'function') onEvent(message)
  }
  const before = countChips(doc)
  if (before === 0) {
    note('remove skipped: no picker chip is present')
    return null
  }

  const editor = findComposerInput(doc)
  if (editor !== null && typeof doc.createRange === 'function' && typeof win.KeyboardEvent === 'function') {
    try {
      if (typeof editor.focus === 'function') editor.focus({ preventScroll: true })
      const range = doc.createRange()
      range.selectNode(chip)
      range.collapse(false)
      const selection = doc.getSelection()
      if (selection !== null && selection !== undefined) {
        selection.removeAllRanges()
        selection.addRange(range)
      }
      editor.dispatchEvent(
        new win.KeyboardEvent('keydown', {
          key: 'Backspace',
          code: 'Backspace',
          keyCode: 8,
          which: 8,
          bubbles: true,
          cancelable: true,
        }),
      )
      if (countChips(doc) < before) return 'backspace'
      note('the editor ignored a synthetic Backspace')
    } catch (error) {
      note(`native removal failed: ${String(error)}`)
    }
  }

  const block = blockText ?? rememberedBlock(chip)
  if (facade !== null && facade !== undefined && typeof facade.setDraft === 'function' && typeof block === 'string' && block !== '') {
    try {
      const snapshot = typeof facade.state?.getSnapshot === 'function' ? facade.state.getSnapshot() : undefined
      const draft = typeof snapshot?.draft === 'string' ? snapshot.draft : undefined
      const line = block.replace(/
+$/, '')
      if (draft !== undefined && draft.includes(line)) {
        facade.setDraft(draft.replace(line, ''))
        if (countChips(doc) < before) return 'setDraft'
        note('setDraft did not change the chip list')
      }
    } catch (error) {
      note(`fallback removal failed: ${String(error)}`)
    }
  }

  note('the chip could not be removed')
  return null
}
