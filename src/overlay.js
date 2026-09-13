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
 *   selection mode STAYS on, so several elements can be picked in a row ->
 *   click the button again (or press Escape) to finish.
 *
 * While selection mode is on, the click must NOT reach the application: every
 * relevant event is swallowed in the capture phase, and the picker's own nodes
 * are excluded from hit-testing by their `data-dsh-picker-ui` marker.
 *
 * Plain DOM (no framework): the plugin's React entry only calls `toggle()`.
 */

import { CHIP_SELECTOR } from './chip.js'
import { hoverFacts } from './describe.js'

/** Marker attribute on every node this overlay owns. */
export const PICKER_MARKER = 'data-dsh-picker-ui'

/** Hint text shown while selection mode is on. */
export const HINT_TEXT = '连续选择：点元素插入定位信息 · Shift+点击插入完整信息 · Ctrl+Shift+E 进入/退出 · Ctrl+Shift+G 合并为元素组 · Esc 结束'

/**
 * Keyboard toggle. Menus cannot be opened *while* selecting (their opening
 * click is swallowed), so the way to pick inside one is: open the menu, toggle
 * selection mode from the keyboard, then click the item — the picker's
 * window-capture swallow beats the menu's own dismissal.
 */
const TOGGLE_SHORTCUT_KEY = 'e'

/** Keyboard shortcut that groups the picker's chips into one element group. */
const GROUP_SHORTCUT_KEY = 'g'

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
  // The chips this plugin inserted count as ours too: a pick must never land on
  // one, and — because selection mode is usually still on right after picking —
  // their own controls (the × that clears the pile) have to stay clickable.
  if (node.closest(CHIP_SELECTOR) !== null) return true
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
export function createPicker({ doc, win, onPick, onEvent }) {
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

  // The hover card: the same three facts ZCode shows beside the element under
  // the pointer, so a pick can be judged before it is made.
  const card = doc.createElement('div')
  card.setAttribute(PICKER_MARKER, 'info')
  const rows = [
    ['info-title', 'info-size'],
    ['info-color-label', 'info-color'],
    ['info-font-label', 'info-font'],
  ].map(([labelKey, valueKey], index) => {
    const row = doc.createElement('div')
    row.setAttribute('data-dsh-picker-row', String(index))
    const label = doc.createElement('span')
    label.setAttribute('data-dsh-picker-cell', labelKey)
    const value = doc.createElement('span')
    value.setAttribute('data-dsh-picker-cell', valueKey)
    row.appendChild(label)
    row.appendChild(value)
    card.appendChild(row)
    return { label, value }
  })
  rows[1].label.textContent = 'Color'
  rows[2].label.textContent = 'Font'

  root.appendChild(card)
  root.appendChild(highlight)
  root.appendChild(hint)

  /**
   * Fill the hover card and place it beside the element.
   *
   * @param {Element} element - Element under the pointer.
   * @returns {void}
   */
  const paintCard = (element) => {
    const facts = hoverFacts(element, win)
    rows[0].label.textContent = facts.title
    rows[0].value.textContent = facts.size
    rows[1].value.textContent = facts.color
    rows[2].value.textContent = facts.font
    card.setAttribute('data-dsh-picker-visible', 'true')

    const box = element.getBoundingClientRect()
    const height = card.getBoundingClientRect?.().height ?? 0
    const below = box.bottom + 8
    const flip = height > 0 && below + height > (win.innerHeight ?? 0)
    card.style.left = `${Math.max(8, Math.round(box.left))}px`
    card.style.top = `${Math.round(flip ? Math.max(8, box.top - 8 - height) : below)}px`
  }

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
      card.removeAttribute('data-dsh-picker-visible')
      return
    }
    const box = current.getBoundingClientRect()
    highlight.style.left = `${Math.round(box.left)}px`
    highlight.style.top = `${Math.round(box.top)}px`
    highlight.style.width = `${Math.round(box.width)}px`
    highlight.style.height = `${Math.round(box.height)}px`
    highlight.setAttribute('data-dsh-picker-visible', 'true')
    paintCard(current)
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

  const stopEvent = (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  const swallow = (event) => {
    if (!active) return
    if (isOwnNode(event.target, doc)) return
    stopEvent(event)
  }

  const onClick = (event) => {
    if (!active) return
    if (isOwnNode(event.target, doc)) return
    swallow(event)

    const element = targetAt(event.clientX, event.clientY)
    if (element === null) {
      emit({ type: 'pick-missed' })
      return
    }
    // Selection mode deliberately stays on: picking several elements in a row is
    // the normal case, and the mode ends only on the button or Escape.
    emit({ type: 'pick' })
    onPick(element, event)
  }

  const onKeyDown = (event) => {
    // Grouping works whether or not selection mode is on: it acts on the draft.
    if (event.ctrlKey === true && event.shiftKey === true && event.key.toLowerCase() === GROUP_SHORTCUT_KEY) {
      stopEvent(event)
      emit({ type: 'group' })
      return
    }
    if (event.ctrlKey === true && event.shiftKey === true && event.key.toLowerCase() === TOGGLE_SHORTCUT_KEY) {
      // Ours in both directions: the chord must not reach the application even
      // when it is turning selection mode on.
      stopEvent(event)
      setActive(!active)
      emit({ type: 'toggle-shortcut' })
      return
    }
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
      card.removeAttribute('data-dsh-picker-visible')
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
