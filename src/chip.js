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
export function resolveInputBinding(ctx, sessionId, note) {
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
    return { facade, actx }
  } catch (error) {
    say(`chip skipped: ${String(error)}`)
    return null
  }
}

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

/** Width of the chip's right-hand remove hit region. */
export const REMOVE_ZONE_PX = 20

/** CSS selector naming the chips this plugin inserted. */
export const CHIP_SELECTOR = `[data-composer-chip="${CHIP_SOURCE}"]`

/** Every chip in the composer, in document order. */
const ALL_CHIPS = '[data-composer-chip]'

/**
 * @param {Document} doc - Owning document.
 * @param {Element} chip - One chip element.
 * @returns {number} Its index in the composer's chip order, or -1.
 */
export function chipIndexOf(doc, chip) {
  return [...doc.querySelectorAll(ALL_CHIPS)].indexOf(chip)
}

/**
 * The detect-coordinate span of one chip.
 *
 * `occurrences` are published in clipboard coordinates and every chip counts as
 * a single detect character (`U+FFFC`), so a chip's detect start is its clipboard
 * offset minus the excess length of every chip before it.
 *
 * @param {readonly object[]} occurrences - `InputState.occurrences`.
 * @param {number} index - Chip index in document order.
 * @param {number} draftRev - Current editor revision.
 * @returns {{ start: number, end: number, draftRev: number } | null} The span.
 */
export function chipSpan(occurrences, index, draftRev) {
  if (!Array.isArray(occurrences) || index < 0 || index >= occurrences.length) return null
  if (typeof draftRev !== 'number') return null
  let start = occurrences[index].offset
  for (let i = 0; i < index; i += 1) {
    start -= Math.max(0, (occurrences[i].length ?? 1) - 1)
  }
  return { start, end: start + 1, draftRev }
}

/**
 * Watch for clicks on a picker chip's remove region.
 *
 * The glyph is drawn by the stylesheet (`::after`) rather than injected as a
 * child: the chip's span is React's portal container, so a foreign child is
 * outside React's managed tree and can be dropped or reordered by any
 * re-render — a pseudo-element cannot be. The hit region is therefore computed
 * from the chip's own box, and the event is swallowed so the editor never moves
 * its caret.
 *
 * @param {object} options - Watch request.
 * @param {Document} options.doc - Owning document.
 * @param {Window} options.win - Owning window.
 * @param {(chip: Element) => void} options.onRemove - Invoked for a chip click.
 * @param {() => boolean} [options.isPickerActive] - Skip while selecting.
 * @returns {() => void} Teardown.
 */
export function watchChipRemoval({ doc, win, onRemove, isPickerActive }) {
  const handle = (event) => {
    if (typeof isPickerActive === 'function' && isPickerActive()) return
    const target = event.target
    if (target === null || typeof target.closest !== 'function') return
    const chip = target.closest(CHIP_SELECTOR)
    if (chip === null) return
    const box = chip.getBoundingClientRect()
    if (event.clientX < box.right - REMOVE_ZONE_PX) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    onRemove(chip)
  }

  const target = typeof win.addEventListener === 'function' ? win : doc
  target.addEventListener('mousedown', handle, true)
  target.addEventListener('pointerdown', handle, true)
  return () => {
    target.removeEventListener('mousedown', handle, true)
    target.removeEventListener('pointerdown', handle, true)
  }
}

/**
 * Remove one picked element's chip.
 *
 * `consumeToken` with a span is the honest verb — it is what the composer itself
 * uses to drop a token without inserting a replacement — and it deletes exactly
 * that chip node, leaving every other chip (a user's `@file` mentions included)
 * intact. `setDraft` is deliberately NOT a fallback here: it rebuilds the draft
 * as plain text and would flatten the user's own chips.
 *
 * @param {object} options - Removal request.
 * @param {Document} options.doc - Owning document.
 * @param {Element} options.chip - The chip to remove.
 * @param {object | null} [options.facade] - Session input facade, when reachable.
 * @param {object | null} [options.actx] - Session scope, for the event fallback.
 * @param {(message: string) => void} [options.onEvent] - Diagnostics sink.
 * @returns {string | null} The route that worked, else null.
 */
export function removeChipElement({ doc, facade, actx, chip, onEvent }) {
  const note = (message) => {
    if (typeof onEvent === 'function') onEvent(message)
  }
  const before = doc.querySelectorAll(CHIP_SELECTOR).length
  if (before === 0) {
    note('remove skipped: no picker chip is present')
    return null
  }
  const index = chipIndexOf(doc, chip)
  if (index < 0) {
    note('remove skipped: that chip is not in the composer')
    return null
  }

  const attempts = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let snapshot = undefined
    try {
      snapshot = typeof facade?.state?.getSnapshot === 'function' ? facade.state.getSnapshot() : undefined
    } catch (error) {
      note(`could not read the input state: ${String(error)}`)
      return null
    }
    const span = chipSpan(snapshot?.occurrences ?? [], index, snapshot?.draftRev)
    if (span === null) {
      note('remove skipped: the chip has no published occurrence to target')
      return null
    }

    let applied = false
    try {
      if (typeof facade?.consumeToken === 'function') {
        applied = facade.consumeToken({ kind: 'span', span }) === true
        attempts.push(`consumeToken:${applied ? 'ok' : 'refused'}`)
      } else if (actx !== undefined && actx !== null && typeof actx.bail === 'function') {
        applied =
          actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span } }) === true
        attempts.push(`event:${applied ? 'ok' : 'refused'}`)
      } else {
        note('remove skipped: neither consumeToken nor the scoped event is reachable')
        return null
      }
    } catch (error) {
      note(`removal threw: ${String(error)}`)
      return null
    }

    if (applied && doc.querySelectorAll(CHIP_SELECTOR).length < before) {
      return attempts.join(', ')
    }
    // The revision guard is an exact CAS: a keystroke between the read and the
    // call makes it refuse, so one retry with a fresh snapshot is worthwhile.
  }

  note(`the chip was not removed (${attempts.join(', ') || 'no attempt'})`)
  return null
}

/** Label of the chip that stands for a group of picked elements. */
export const GROUP_LABEL_PREFIX = '元素组'

/**
 * Fold every picked element's chip in the draft into ONE group chip.
 *
 * The chips are removed from the end backwards (so the earlier spans stay valid)
 * through the same `consumeToken` the × uses, then a single chip carrying all
 * their blocks is inserted — the model reads one grouped block instead of N
 * separate ones, and the composer keeps one pill.
 *
 * @param {object} options - Grouping request.
 * @param {object | undefined} options.ctx - Plugin (root) context.
 * @param {string | undefined} options.sessionId - Session the composer belongs to.
 * @param {(message: string) => void} [options.onEvent] - Diagnostics sink.
 * @returns {{ grouped: number } | null} How many chips were grouped, else null.
 */
export function groupElementChips({ ctx, sessionId, onEvent }) {
  const note = (message) => {
    if (typeof onEvent === 'function') onEvent(message)
  }
  const binding = resolveInputBinding(ctx, sessionId, note)
  if (binding === null) return null
  const facade = binding.facade
  const actx = binding.actx

  const ours = () => {
    const snapshot = typeof facade.state?.getSnapshot === 'function' ? facade.state.getSnapshot() : undefined
    const occurrences = Array.isArray(snapshot?.occurrences) ? snapshot.occurrences : []
    const mine = occurrences
      .map((occurrence, index) => ({ occurrence, index }))
      .filter((entry) => entry.occurrence.source === CHIP_SOURCE)
    return { snapshot, occurrences, mine }
  }

  const first = ours()
  if (first.mine.length < 2) {
    note(`grouping needs at least two picked elements (found ${first.mine.length})`)
    return null
  }
  const blocks = first.mine.map((entry) => entry.occurrence.clipboardText)
  const total = blocks.length

  // Remove from the last chip backwards: deleting the last one cannot shift the
  // coordinates of the ones before it.
  for (let remaining = total; remaining > 0; remaining -= 1) {
    const state = ours()
    if (state.mine.length === 0) break
    const target = state.mine[state.mine.length - 1]
    const span = chipSpan(state.occurrences, target.index, state.snapshot?.draftRev)
    if (span === null) {
      note('grouping stopped: a chip had no published occurrence')
      return null
    }
    let applied = false
    try {
      if (typeof facade.consumeToken === 'function') {
        applied = facade.consumeToken({ kind: 'span', span }) === true
      } else if (actx !== null && actx !== undefined && typeof actx.bail === 'function') {
        applied = actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span } }) === true
      }
    } catch (error) {
      note(`grouping removal threw: ${String(error)}`)
      return null
    }
    if (!applied) {
      note('grouping stopped: a chip refused to be removed')
      return null
    }
  }

  // Insert the group chip where the draft ends.
  const after = ours()
  const occurrences = after.occurrences
  let detectLength = typeof after.snapshot?.draft === 'string' ? after.snapshot.draft.length : 0
  for (const occurrence of occurrences) {
    detectLength -= Math.max(0, (occurrence.length ?? 1) - 1)
  }
  const payload = [`[元素组] ${total} 个界面元素`, '', ...blocks.map((block, index) => `（${index + 1}）${block.trimEnd()}`)].join(String.fromCharCode(10)) + String.fromCharCode(10)

  const inserted = insertElementChip({
    ctx,
    sessionId,
    text: payload,
    label: `${total} 个元素`,
    onEvent: note,
  })
  if (inserted === null) {
    note('grouping removed the chips but could not insert the group chip')
    return null
  }
  note(`grouped ${total} chips into one carrying a ${payload.split(String.fromCharCode(10)).filter((line) => line !== '').length}-line block`)
  return { grouped: total }
}

/** One row of the chip preview: what the user picked, in their words. */
const PREVIEW_SUMMARY_RE = /^\[元素\]\s*/

/**
 * Parse the block a chip stands for into preview rows.
 *
 * The payload is this plugin's own format, so it can be read back without any
 * extra state: a group lists its elements as `（1）…（2）…`, and a single pick is
 * just the block. Each row takes the element summary, its tag and role when the
 * block carries one, and the page it came from.
 *
 * @param {string} text - The chip's payload.
 * @param {string} [origin] - Page title to show on every row.
 * @returns {{ summary: string, meta: string, origin: string }[]} Preview rows.
 */
export function parsePreviewItems(text, origin = '') {
  const blocks = String(text ?? '')
    .split(/（\d+）/)
    .map((part) => part.trim())
    .filter((part) => part !== '')

  const rows = []
  for (const block of blocks) {
    const lines = block.split(String.fromCharCode(10)).map((line) => line.trim())
    const headline = lines.find((line) => PREVIEW_SUMMARY_RE.test(line))
    if (headline === undefined) continue

    const summary = headline.replace(PREVIEW_SUMMARY_RE, '').trim()
    const tag = summary.split(/[\s.:#]/)[0] || 'element'
    const attributes = lines.find((line) => line.startsWith('[属性]')) ?? ''
    const role = /role="([^"]+)"/.exec(attributes)
    const meta = role === null ? tag : `${tag} · role=${role[1]}`
    rows.push({ summary, meta, origin })
  }
  return rows
}

/** Delay before a preview hides, so the pointer can travel into it. */
const PREVIEW_HIDE_DELAY_MS = 160

/**
 * Show a preview of what a picker chip holds when the pointer rests on it.
 *
 * ZCode's picked-element pill does the same: hovering it lists the elements, and
 * the list scrolls when there are many. The panel is ours, marked so the picker
 * ignores it, and it takes pointer events so it can actually be scrolled.
 *
 * @param {object} options - Watch request.
 * @param {Document} options.doc - Owning document.
 * @param {Window} options.win - Owning window.
 * @param {() => string} options.payloadOf - Reads the payload of one chip.
 * @returns {() => void} Teardown.
 */
export function watchChipPreview({ doc, win, payloadOf }) {
  const host = doc.body ?? doc.documentElement
  let panel = null
  let hideTimer = null
  let currentChip = null

  const build = () => {
    const element = doc.createElement('div')
    element.setAttribute('data-dsh-picker-ui', 'chip-preview')
    element.setAttribute('data-dsh-picker-visible', 'false')
    element.setAttribute('role', 'tooltip')
    host.appendChild(element)
    return element
  }

  const show = (chip) => {
    const rows = parsePreviewItems(payloadOf(chip) ?? '', doc.title ?? '')
    if (rows.length === 0) return
    if (panel === null) panel = build()

    panel.textContent = ''
    for (const row of rows) {
      const item = doc.createElement('div')
      item.setAttribute('data-dsh-picker-preview-item', 'true')

      const summary = doc.createElement('div')
      summary.setAttribute('data-dsh-picker-preview-summary', 'true')
      summary.textContent = row.summary

      const meta = doc.createElement('div')
      meta.setAttribute('data-dsh-picker-preview-meta', 'true')
      meta.textContent = row.meta

      const origin = doc.createElement('div')
      origin.setAttribute('data-dsh-picker-preview-origin', 'true')
      origin.textContent = row.origin

      item.appendChild(summary)
      item.appendChild(meta)
      if (row.origin !== '') item.appendChild(origin)
      panel.appendChild(item)
    }

    const box = chip.getBoundingClientRect()
    const above = box.top > (win.innerHeight ?? 0) / 2
    panel.setAttribute('data-dsh-picker-visible', 'true')
    const height = panel.getBoundingClientRect().height
    panel.style.left = `${Math.max(8, Math.round(box.left))}px`
    panel.style.top = `${Math.round(above ? Math.max(8, box.top - 8 - height) : box.bottom + 8)}px`
    currentChip = chip
  }

  const scheduleHide = () => {
    if (hideTimer !== null) win.clearTimeout(hideTimer)
    hideTimer = win.setTimeout(() => {
      if (panel !== null) panel.setAttribute('data-dsh-picker-visible', 'false')
      currentChip = null
    }, PREVIEW_HIDE_DELAY_MS)
  }

  const owns = (node) => {
    if (node === null || typeof node.closest !== 'function') return false
    return node.closest(CHIP_SELECTOR) !== null || node.closest('[data-dsh-picker-ui="chip-preview"]') !== null
  }

  const onOver = (event) => {
    const node = event.target
    if (node === null || typeof node.closest !== 'function') return
    const chip = node.closest(CHIP_SELECTOR)
    if (chip !== null) {
      if (hideTimer !== null) win.clearTimeout(hideTimer)
      if (chip !== currentChip) show(chip)
      return
    }
    if (node.closest('[data-dsh-picker-ui="chip-preview"]') === null) scheduleHide()
  }

  const onOut = (event) => {
    if (!owns(event.target)) return
    scheduleHide()
  }

  const hide = () => {
    if (hideTimer !== null) win.clearTimeout(hideTimer)
    if (panel !== null) panel.setAttribute('data-dsh-picker-visible', 'false')
    currentChip = null
  }

  const target = typeof win.addEventListener === 'function' ? win : doc
  target.addEventListener('pointerover', onOver, true)
  target.addEventListener('pointerout', onOut, true)
  return {
    hide,
    dispose: () => {
      target.removeEventListener('pointerover', onOver, true)
      target.removeEventListener('pointerout', onOut, true)
      if (hideTimer !== null) win.clearTimeout(hideTimer)
      if (panel !== null) panel.remove()
    },
  }
}
