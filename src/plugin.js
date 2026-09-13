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
import React from 'react'

import { chipLabel, insertElementChip, registerChipSource, removeChipElement, resolveInputBinding, watchChipRemoval } from './chip.js'
import { buildElementBlock } from './describe.js'
import { insertBlock } from './insert.js'
import { createPicker } from './overlay.js'
import { installStyles } from './styles.js'

/**
 * Slot the control opts into: the sidebar foot, beside Settings.
 *
 * This slot is root-scoped, so it renders whether or not a session is open —
 * and its props carry no session id or input actions. Both are therefore
 * resolved from services at pick time (see `resolveSessionId` and the facade),
 * which keeps the picker working from any slot.
 */
export const SLOT = 'sidebar.footer.action'

/**
 * Order within that list; lower sorts first.
 *
 * DSH sorts these entries ascending, and the Bash widget registers at 10 — so
 * this lands immediately after it, which is the line our control is offset from
 * (see POSITION_SELECTORS).
 */
export const ENTRY_ORDER = 11

/**
 * What the control aligns itself beside, in order of preference.
 *
 * The footer is a wrapping flex row, and the Bash widget's wrapper claims the
 * full row width, so an entry that takes part in that flow can only ever end up
 * on the next line. The control is therefore offset out of the flow onto that
 * row's right-hand end, re-measured as the footer changes instead of assumed.
 */
export const POSITION_SELECTORS = ['.sbw-wrap', '[class*="footerActions"]', '[class*="footArea"]']

/** Services this plugin's browser half consumes (declared in package.json too). */

/** Entry id (a fresh id adds a cell beside the shipped entries). */
export const ENTRY_ID = 'element-picker'

/** Console prefix for every diagnostic this plugin prints. */
export const LOG_PREFIX = '[dsh-element-picker]'

/** Edge length of the control, in px. */
export const CONTROL_SIZE = 28

/**
 * Cordis services this plugin needs.
 *
 * Every service property is guarded: reading one that is not declared here
 * throws ("cannot get property X without inject"), and a throw inside apply
 * aborts the host's boot. So each service the picker touches is listed, even the
 * ones only used on the pick path.
 */
export const inject = ['slots', 'inputTriggers', 'conversation', 'sessions']

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
  const anchorRef = React.useRef(null)
  const [offset, setOffset] = React.useState({ dx: 0, dy: 0 })
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

  React.useLayoutEffect(() => {
    let queued = false
    const measure = () => {
      queued = false
      const anchor = anchorRef.current
      if (anchor === null) return
      // Only a box with real size can anchor anything: an empty slot host or a
      // row with no entries measures 0 and would place the control at a guess.
      let target = null
      for (const selector of POSITION_SELECTORS) {
        const candidate = anchor.ownerDocument.querySelector(selector)
        if (candidate === null) continue
        const box = candidate.getBoundingClientRect()
        if (box.width > 0 && box.height > 0) {
          target = candidate
          break
        }
      }
      if (target === null) {
        setOffset({ dx: 0, dy: 0 })
        return
      }
      const row = target.getBoundingClientRect()
      const here = anchor.getBoundingClientRect()
      const size = CONTROL_SIZE

      // The row already holds DSH's own footer widget (full width when expanded,
      // a rail when collapsed). Sit after it only when that leaves room; in a
      // collapsed sidebar there is none, and offsetting anyway is what made the
      // control overlap that widget. No room means no offset: the wrapping flex
      // row then stacks the entries, which is the top/middle/bottom the narrow
      // sidebar should have.
      let neighbour = null
      for (const child of target.children) {
        const childBox = child.getBoundingClientRect()
        if (childBox.width === 0 || childBox.height === 0) continue
        neighbour = childBox
        break
      }

      const desired = neighbour === null ? row.right - 6 - size : neighbour.right + 8
      const fits = desired >= row.left && desired + size <= row.right - 6
      if (!fits) {
        setOffset({ dx: 0, dy: 0 })
        return
      }

      setOffset({
        dx: Math.round(desired - here.left),
        dy: Math.round(row.top + (row.height - size) / 2 - here.top),
      })
    }
    const schedule = () => {
      if (queued) return
      queued = true
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(measure)
      else setTimeout(measure, 16)
    }

    measure()
    window.addEventListener('resize', schedule)
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.removeEventListener('resize', schedule)
      observer.disconnect()
    }
  }, [])

  return React.createElement(
    'div',
    { ref: anchorRef, 'data-dsh-picker-ui': 'slot-anchor' },
    React.createElement(
      'button',
      {
      type: 'button',
      onClick,
      'data-dsh-picker-ui': 'slot-button',
      'aria-label': '选择界面元素加入聊天',
      'aria-pressed': active ? 'true' : 'false',
      title: '选择界面元素加入聊天（Ctrl+Shift+E 切换，菜单内选择请用快捷键进入选择模式）',
      // The control keeps exactly one look in every state: the ring carries the
      // feedback, and a background swap on press was reading as a different
      // button. State still rides `aria-pressed` for assistive tech.
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        transform: `translate(${offset.dx}px, ${offset.dy}px)`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
        padding: 0,
        border: 'none',
        borderRadius: 6,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
    },
      React.createElement(PointerIcon, null),
    ),
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
/**
 * The session a pick should land in.
 *
 * A root-scoped entry has no `sessionId` prop, so the current selection is read
 * from the session list service instead.
 *
 * @param {object | undefined} ctx - Plugin (root) context.
 * @param {string | undefined} fromProps - A session-scoped prop, when present.
 * @returns {string | undefined} A session id, when one is known.
 */
function resolveSessionId(ctx, fromProps) {
  if (typeof fromProps === 'string' && fromProps !== '') return fromProps
  try {
    const current = ctx?.sessions?.list?.getSnapshot?.()?.current
    if (typeof current === 'string' && current !== '') return current
  } catch (error) {
    log('could not read the current session:', String(error))
  }
  return undefined
}


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

  // A root-scoped entry gets no session or input face through props, so both are
  // resolved from services here — per pick, not per render, so a session switch
  // is picked up without any subscription.
  const ctx = PICKER_STATE.ctx
  const sessionId = resolveSessionId(ctx, PICKER_STATE.sessionId)
  const binding = resolveInputBinding(ctx, sessionId, (message) => log(message))
  const facade = binding === null ? null : binding.facade

  // A chip is the DSH-native shape for this: compact in the composer, expanded
  // into the block above by the chip's codec when the message is sent.
  if (detailed !== true) {
    // The trigger registry may not have been up when the plugin applied
    // (service ordering), so registration is retried before the first chip use.
    if (PICKER_STATE.chipReady !== true) {
      PICKER_STATE.chipReady = registerChipSource(ctx)
      if (PICKER_STATE.chipReady) log('chip codec registered on retry')
    }
  }

  if (detailed !== true && PICKER_STATE.chipReady === true) {
    const chip = insertElementChip({
      ctx,
      sessionId,
      text,
      label: chipLabel(element),
      onEvent: (message) => log(message),
    })
    if (chip !== null) {
      log(`inserted a ${chip} for ${element.tagName.toLowerCase()}`)
      return
    }
  }

  // The text fallback needs a draft and a way to write one; both come from the
  // facade when the slot props do not carry them.
  let draft = PICKER_STATE.draft
  let inputActions = PICKER_STATE.inputActions
  if (facade !== null) {
    try {
      const snapshot = facade.state?.getSnapshot?.()
      if (typeof snapshot?.draft === 'string') draft = snapshot.draft
    } catch {
      /* the prop-derived draft stands */
    }
    if (inputActions === undefined && typeof facade.setDraft === 'function') {
      inputActions = { setDraft: (next) => facade.setDraft(next) }
    }
  }

  const result = insertBlock({ text, doc, win, draft, inputActions })

  if (result.ok) {
    const earlier = result.tried.slice(0, -1)
    const trail = earlier.length === 0 ? '' : ` after ${JSON.stringify(earlier)}`
    log(`inserted via "${result.path}" (${result.note ?? 'no note'})${trail}`)
    return
  }
  log('insert failed; attempt trail:', JSON.stringify(result.tried))
}

/**
 * Remove the chip a click landed on.
 *
 * @param {Element} chip - The chip to drop.
 * @returns {void}
 */
function removePickedChip(chip) {
  const doc = chip.ownerDocument
  const binding = resolveInputBinding(PICKER_STATE.ctx, PICKER_STATE.sessionId, (message) => log(message))
  const path = removeChipElement({
    doc,
    chip,
    facade: binding === null ? null : binding.facade,
    actx: binding === null ? null : binding.actx,
    onEvent: (message) => log(message),
  })
  log(path === null ? 'the chip was not removed' : `removed a chip via "${path}"`)
}

/**
 * Mount the overlay and register the composer control.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @returns {void}
 */
export function apply(ctx) {
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
      { name: SLOT, id: ENTRY_ID, order: ENTRY_ORDER, label: '选择元素' },
      PickerButton,
    ),
  )

  const stopWatchingChips = watchChipRemoval({
    doc,
    win,
    onRemove: removePickedChip,
    isPickerActive: () => picker.isActive(),
  })

  ctx.effect(() => () => {
    stopWatchingChips()
    picker.dispose()
    PICKER_STATE.picker = null
    PICKER_STATE.listeners.clear()
    teardownStyles()
  }, 'dsh-element-picker: overlay and stylesheet')
}
