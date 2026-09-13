/**
 * Selection mode: the hover highlight, the hint bar, and the capture-phase
 * event handling that turns a page click into a picked element.
 *
 * There is exactly ONE picker control — the entry registered in the composer
 * tool row (`conversation.input.left`) — and it drives `toggle()` here. The
 * overlay deliberately owns no button of its own: an earlier floating button
 * duplicated the control and sat over the composer.
 *
 * Flow (matching ZCode's behaviour):
 *   click the tool-row button -> selection mode on, hovering outlines the
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
import { resolveTarget } from './selector.js'

/** Marker attribute on every node this overlay owns. */
export const PICKER_MARKER = 'data-dsh-picker-ui'

/** Hint text shown while selection mode is on. */
export const HINT_TEXT = '选择模式：点击界面元素插入定位信息 · 再点工具行按钮或 Esc 取消'

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
