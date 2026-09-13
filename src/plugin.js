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
 * Slot the control opts into: the session header's right-aligned utilities.
 *
 * The entry sits before DSH's own open-in-app control (which registers at
 * order -10), which is the top-right spot beside the session title.
 */
export const SLOT = 'conversation.session.header.utilities'

/** Order within that list; lower sorts further left. */
export const ENTRY_ORDER = -20

/** Services this plugin's browser half consumes (declared in package.json too). */

/** Entry id (a fresh id adds a cell beside the shipped entries). */
export const ENTRY_ID = 'element-picker'

/** Console prefix for every diagnostic this plugin prints. */
export const LOG_PREFIX = '[dsh-element-picker]'

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
      title: '选择界面元素加入聊天（Ctrl+Shift+E 切换，菜单内选择请用快捷键进入选择模式）',
      // The control keeps exactly one look in every state: the ring carries the
      // feedback, and a background swap on press was reading as a different
      // button. State still rides `aria-pressed` for assistive tech.
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        border: 'none',
        borderRadius: 6,
        background: 'transparent',
        color: 'inherit',
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
