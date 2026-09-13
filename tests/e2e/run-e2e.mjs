/**
 * Browser-level acceptance run (cloud only).
 *
 * Serves the built bundle plus the harness page, drives a real Chromium through
 * the whole interaction, and writes screenshots as the evidence artifact:
 *
 *   enter selection mode -> hover outlines the resolved element -> click inserts
 *   the locating block -> clicking again or Escape leaves selection mode, with
 *   the application never seeing the swallowed clicks.
 *
 * Three modes exercise the insertion cascade: `dom` (contenteditable input
 * events), `paste` (the shell's own paste), and `non-editable` (setDraft as the
 * last resort, preserving the existing draft).
 */
import { createServer } from 'node:http'
import { readFile, mkdir, rm } from 'node:fs/promises'
import { extname, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = join(root, 'e2e-out')

const ROUTES = {
  '/': 'tests/e2e/harness/index.html',
  '/harness/host-stub.js': 'tests/e2e/harness/host-stub.js',
  '/lib/client.js': 'lib/client.js',
  '/vendor/react.js': 'node_modules/react/umd/react.production.min.js',
  '/vendor/react-dom.js': 'node_modules/react-dom/umd/react-dom.production.min.js',
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

const failures = []
let checks = 0

/**
 * @param {string} name - Assertion name.
 * @param {boolean} condition - Result.
 * @param {string} [detail] - Extra context on failure.
 * @returns {void}
 */
function check(name, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures.push(`${name}${detail === '' ? '' : ` — ${detail}`}`)
  console.log(`  FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/**
 * Start the static server.
 *
 * @returns {Promise<{ server: import('node:http').Server, origin: string }>} Server and origin.
 */
async function startServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const relative = ROUTES[url.pathname]
    if (relative === undefined) {
      response.writeHead(404).end('not found')
      return
    }
    try {
      const body = await readFile(join(root, relative))
      response.writeHead(200, { 'content-type': MIME[extname(relative)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      response.end(body)
    } catch (error) {
      response.writeHead(500).end(String(error))
    }
  })

  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  return { server, port, origin: `http://127.0.0.1:${port}` }
}

/**
 * Read the overlay state out of the page.
 *
 * @param {import('playwright').Page} page - Page under test.
 * @returns {Promise<object>} Overlay state.
 */
function overlayState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-dsh-picker-ui="root"]')
    const highlight = document.querySelector('[data-dsh-picker-ui="highlight"]')
    return {
      present: root !== null,
      active: root === null ? null : root.getAttribute('data-dsh-picker-active'),
      ownButtons: document.querySelectorAll('[data-dsh-picker-ui="button"]').length,
      slotPressed: (() => {
        const slot = document.querySelector('[data-dsh-picker-ui="slot-button"]')
        return slot === null ? null : slot.getAttribute('aria-pressed')
      })(),
      highlightVisible: highlight !== null && highlight.getAttribute('data-dsh-picker-visible') === 'true',
      highlightOutline: highlight === null ? null : getComputedStyle(highlight).outlineColor,
      highlightFill: highlight === null ? null : getComputedStyle(highlight).backgroundColor,
      brandOutline: (() => {
        // The same token the highlight is expected to use.
        const probe = document.createElement('div')
        probe.style.outlineColor = 'var(--dsw-static-blue-500, #3b82f6)'
        document.body.appendChild(probe)
        const value = getComputedStyle(probe).outlineColor
        probe.remove()
        return value
      })(),
      highlight: highlight === null ? null : {
        left: Number.parseFloat(highlight.style.left),
        top: Number.parseFloat(highlight.style.top),
        width: Number.parseFloat(highlight.style.width),
        height: Number.parseFloat(highlight.style.height),
      },
      transcriptPills: document.querySelectorAll('[data-dsh-picker-transcript-pill]').length,
      transcriptFoldedLines: document.querySelectorAll('[data-dsh-picker-folded]').length,
      transcriptPillText: (() => {
        const pill = document.querySelector('[data-dsh-picker-transcript-pill]')
        return pill === null ? '' : pill.textContent.trim()
      })(),
      transcriptHiddenLines: [...document.querySelectorAll('#transcript p')].filter(
        (line) => getComputedStyle(line).display === 'none',
      ).length,
      transcriptLineText: (() => {
        const line = document.getElementById('sent-line-6')
        return line === null ? '' : line.textContent.trim()
      })(),
      hintRing: (() => {
        const hint = document.querySelector('[data-dsh-picker-ui="hint"]')
        if (hint === null) return null
        const style = getComputedStyle(hint, '::after')
        return {
          conic: (style.backgroundImage ?? '').includes('conic-gradient'),
          composite: style.maskComposite || style.webkitMaskComposite || '',
          playState: style.animationPlayState,
        }
      })(),
      infoVisible: (() => {
        const card = document.querySelector('[data-dsh-picker-ui="info"]')
        if (card === null) return false
        return getComputedStyle(card).display !== 'none'
      })(),
      infoBackground: (() => {
        const card = document.querySelector('[data-dsh-picker-ui="info"]')
        return card === null ? '' : getComputedStyle(card).backgroundColor
      })(),
      infoText: (() => {
        const card = document.querySelector('[data-dsh-picker-ui="info"]')
        return card === null ? '' : card.innerText.replace(/\s+/g, ' ').trim()
      })(),
      hintVisible: (() => {
        const hint = document.querySelector('[data-dsh-picker-ui="hint"]')
        if (hint === null) return false
        return getComputedStyle(hint).display !== 'none'
      })(),
      hintTop: (() => {
        const hint = document.querySelector('[data-dsh-picker-ui="hint"]')
        return hint === null ? null : Math.round(hint.getBoundingClientRect().top)
      })(),
      hintRect: (() => {
        const hint = document.querySelector('[data-dsh-picker-ui="hint"]')
        if (hint === null) return null
        const box = hint.getBoundingClientRect()
        return { top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height) }
      })(),
      composerTop: (() => {
        const card = document.querySelector('[data-composer-card]')
        return card === null ? null : Math.round(card.getBoundingClientRect().top)
      })(),
      slotButtons: document.querySelectorAll('[data-dsh-picker-ui="slot-button"]').length,
      chips: [...document.querySelectorAll('[data-composer-chip]')].map((chip) => ({
        source: chip.getAttribute('data-composer-chip'),
        // The label excludes the injected remove affordance.
        label: (chip.textContent ?? '').replace('×', '').trim(),
      })),
      slotBackground: (() => {
        const slot = document.querySelector('[data-dsh-picker-ui="slot-button"]')
        return slot === null ? null : getComputedStyle(slot).backgroundColor
      })(),
      slotRing: (() => {
        const slot = document.querySelector('[data-dsh-picker-ui="slot-button"]')
        if (slot === null) return null
        const style = getComputedStyle(slot, '::after')
        return {
          content: style.content,
          conic: (style.backgroundImage ?? '').includes('conic-gradient'),
          composite: style.maskComposite || style.webkitMaskComposite || '',
          animation: style.animationName,
          duration: style.animationDuration,
          playState: style.animationPlayState,
        }
      })(),
      previewVisible: (() => {
        const panel = document.querySelector('[data-dsh-picker-ui="chip-preview"]')
        if (panel === null) return false
        return getComputedStyle(panel).display !== 'none' && panel.getAttribute('data-dsh-picker-visible') === 'true'
      })(),
      previewRows: document.querySelectorAll('[data-dsh-picker-preview-item]').length,
      previewRemoveButtons: (() => {
        const rows = Array.from(document.querySelectorAll('[data-dsh-picker-preview-item]'))
        if (rows.length === 0) return 0
        return rows.filter((row) => row.querySelector('[data-dsh-picker-ui="preview-remove"]') !== null).length
      })(),
      previewRemoveCursor: (() => {
        const button = document.querySelector('[data-dsh-picker-preview-item] [data-dsh-picker-ui="preview-remove"]')
        if (button === null) return null
        const box = button.getBoundingClientRect()
        return { width: Math.round(box.width), height: Math.round(box.height), cursor: getComputedStyle(button).cursor }
      })(),
      previewRowFont: (() => {
        const row = document.querySelector('[data-dsh-picker-preview-summary]')
        if (row === null) return null
        const style = getComputedStyle(row)
        return { size: style.fontSize, smoothing: style.webkitFontSmoothing }
      })(),
      previewText: (() => {
        const panel = document.querySelector('[data-dsh-picker-ui="chip-preview"]')
        return panel === null ? '' : (panel.innerText ?? '').replace(/\s+/g, ' ').trim()
      })(),
      previewScrollable: (() => {
        const panel = document.querySelector('[data-dsh-picker-ui="chip-preview"]')
        if (panel === null) return false
        const style = getComputedStyle(panel)
        return style.overflowY === 'auto' && style.maxHeight !== 'none'
      })(),
      previewMaxHeight: (() => {
        const panel = document.querySelector('[data-dsh-picker-ui="chip-preview"]')
        return panel === null ? null : getComputedStyle(panel).maxHeight
      })(),
      chipRemoveGlyph: (() => {
        const chip = document.querySelector('[data-composer-chip="element-picker"]')
        if (chip === null) return null
        return getComputedStyle(chip, '::after').content
      })(),
      draft: document.querySelector('[data-composer-input]').textContent,
    }
  })
}

/**
 * Read the harness counters and wiring state.
 *
 * @param {import('playwright').Page} page - Page under test.
 * @returns {Promise<object>} Harness state.
 */
function harnessState(page) {
  return page.evaluate(async () => ({
    calls: { ...window.__harness.calls },
    mode: window.__harness.mode,
    injected: window.__harness.injected,
    mounted: window.__harness.mounted === undefined ? null : window.__harness.mounted.options,
    chipCodec: window.__harness.chips === undefined || window.__harness.chips.name === null ? null : window.__harness.chips.name,
    chipPayloads: window.__harness.chips === undefined ? [] : window.__harness.chips.inserted.map((entry) => entry.clipboardText),
    chipLabels: window.__harness.chips === undefined ? [] : window.__harness.chips.inserted.map((entry) => entry.label),
    chipModels: window.__harness.chips === undefined ? [] : window.__harness.chips.inserted.map((entry) => entry.ref),
    serializedPrompt:
      window.__harness.chips === undefined || window.__harness.chips.serializePrompt === undefined
        ? ''
        : await window.__harness.chips.serializePrompt(),
    reactVersion: window.React.version,
  }))
}

/**
 * Run the shared interaction against one insertion mode.
 *
 * @param {import('playwright').Browser} browser - Browser instance.
 * @param {string} mode - Harness mode.
 * @returns {Promise<object>} Collected page state for the mode.
 */
async function runScenario(browser, mode, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: join(out, `${mode}-${name}.png`) })

  // Page-level failures are the difference between "the assertion is wrong" and
  // "the bundle threw", so they are collected and asserted too.
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })

  console.log(`\n[${mode}]`)
  await page.goto(`${origin}/?mode=${mode}`)
  // The overlay is a zero-size, pointer-events:none layer, so Playwright would
  // never call it "visible": wait for it to exist.
  await page.waitForSelector('[data-dsh-picker-ui="root"]', { state: 'attached' })

  const boot = await overlayState(page)
  const harness = await harnessState(page)
  check(
    'the bundle registers into the sidebar footer slot',
    harness.injected === 'sidebar.footer.action',
    String(harness.injected),
  )
  check('the entry id is element-picker', harness.mounted?.id === 'element-picker', JSON.stringify(harness.mounted))
  check('the registered component renders into its slot host', boot.slotButtons === 1, `slot buttons: ${boot.slotButtons}`)
  check('the overlay is mounted', boot.present === true)
  check(
    'a sent element block is folded into a pill',
    boot.transcriptPills === 1 && boot.transcriptFoldedLines >= 1 && boot.transcriptHiddenLines === 7,
    JSON.stringify(boot),
  )
  check(
    'the pill carries the element summary',
    /完全权限/.test(boot.transcriptPillText ?? '') && !/\[元素\]/.test(boot.transcriptPillText ?? ''),
    String(boot.transcriptPillText),
  )
  check(
    'the folded lines are hidden but still in the document',
    boot.transcriptHiddenLines === 7 && boot.transcriptLineText !== '',
    JSON.stringify({ hidden: boot.transcriptHiddenLines }),
  )
  check('selection mode starts off', boot.active === 'false', String(boot.active))
  check('the hint stays hidden until selecting', boot.hintVisible === false, String(boot.hintVisible))
  check('the info card stays hidden until hovering', boot.infoVisible === false, String(boot.infoVisible))
  check('the harness runs the real React build', harness.reactVersion !== undefined, String(harness.reactVersion))
  check(
    'the overlay owns no button of its own',
    boot.ownButtons === 0,
    `found ${boot.ownButtons} overlay button(s)`,
  )
  check('exactly one picker control exists', boot.slotButtons === 1, `found ${boot.slotButtons}`)
  check(
    'the control draws the conic border ring',
    boot.slotRing !== null && boot.slotRing.content === '""' && boot.slotRing.conic === true,
    JSON.stringify(boot.slotRing),
  )
  check(
    'the ring is masked down to the border',
    /exclude|destination-out/.test(boot.slotRing?.composite ?? ''),
    String(boot.slotRing?.composite),
  )
  check(
    'the ring turns slowly without being hovered',
    boot.slotRing?.playState === 'running' &&
      boot.slotRing?.duration === '3s' &&
      /rotate-hue/.test(boot.slotRing?.animation ?? ''),
    JSON.stringify(boot.slotRing),
  )
  await shot('01-boot')

  // Hovering must not change the control's look, and neither must activating it.
  await page.hover('[data-dsh-picker-ui="slot-button"]')
  const ringHovered = await overlayState(page)
  check('the ring keeps turning while hovered', ringHovered.slotRing?.playState === 'running', JSON.stringify(ringHovered.slotRing))
  check(
    'hovering does not repaint the control',
    ringHovered.slotBackground === boot.slotBackground,
    JSON.stringify({ idle: boot.slotBackground, hovered: ringHovered.slotBackground }),
  )

  // The single control toggles the state, twice in a row.
  await page.click('[data-dsh-picker-ui="slot-button"]')
  const viaSlot = await overlayState(page)
  check('the tool-row control toggles on', viaSlot.active === 'true', String(viaSlot.active))
  await page.click('[data-dsh-picker-ui="slot-button"]')
  const viaSlotOff = await overlayState(page)
  check('the tool-row control toggles off', viaSlotOff.active === 'false', String(viaSlotOff.active))

  // Enter selection mode from the single control: hint appears.
  await page.click('[data-dsh-picker-ui="slot-button"]')
  const active = await overlayState(page)
  check('the tool-row control enters selection mode', active.active === 'true', String(active.active))
  check('the tool-row control shows its active state', active.slotPressed === 'true', String(active.slotPressed))
  check(
    'activating the control does not repaint it',
    active.slotBackground === boot.slotBackground,
    JSON.stringify({ idle: boot.slotBackground, active: active.slotBackground }),
  )
  check(
    'the ring keeps turning after the click',
    active.slotRing?.playState === 'running',
    JSON.stringify(active.slotRing),
  )
  check(
    'the ring spins faster while selecting',
    active.slotRing?.duration === '0.9s',
    String(active.slotRing?.duration),
  )
  check('the hint bar is visible in selection mode', active.hintVisible === true)
  check(
    'the hint sits above the composer instead of covering it',
    active.hintRect !== null && active.composerTop !== null && active.hintRect.bottom <= active.composerTop,
    JSON.stringify({ hint: active.hintRect, composerTop: active.composerTop }),
  )
  await shot('02-selection-mode')

  // Hover outlines the element under the pointer.
  const send = page.locator('button[aria-label="发送消息"]')
  const box = await send.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(150)
  const hovering = await overlayState(page)
  check('hovering shows the highlight', hovering.highlightVisible === true)
  check('hovering shows the info card', hovering.infoVisible === true)
  check(
    'the info card is painted with an opaque surface',
    /^rgb/.test(hovering.infoBackground) && hovering.infoBackground.includes('rgba(0, 0, 0, 0)') === false,
    hovering.infoBackground,
  )
  check(
    'the info card carries the tag, size, colour and font',
    /发送/.test(hovering.infoText) === false &&
      /^button/.test(hovering.infoText) &&
      /\d+x\d+/.test(hovering.infoText) &&
      hovering.infoText.includes('Color') &&
      hovering.infoText.includes('Font'),
    hovering.infoText,
  )
  check(
    'the highlight is DSH brand-tinted and filled',
    hovering.highlightOutline === hovering.brandOutline && hovering.highlightFill !== 'rgba(0, 0, 0, 0)',
    JSON.stringify({ outline: hovering.highlightOutline, brand: hovering.brandOutline, fill: hovering.highlightFill }),
  )
  check(
    'the highlight matches the hovered element',
    hovering.highlight !== null &&
      Math.abs(hovering.highlight.left - box.x) <= 2 &&
      Math.abs(hovering.highlight.top - box.y) <= 2 &&
      Math.abs(hovering.highlight.width - box.width) <= 2 &&
      Math.abs(hovering.highlight.height - box.height) <= 2,
    JSON.stringify({ highlight: hovering.highlight, box }),
  )
  await shot('03-hover-highlight')

  // Click inserts and leaves selection mode.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  // The insert may land as a chip (chip mode) or as the compact text line.
  await page.waitForFunction(
    () =>
      document.querySelector('[data-composer-input]').textContent.includes('[元素]') ||
      document.querySelector('[data-composer-chip]') !== null,
    null,
    { timeout: 5000 },
  )
  const inserted = await overlayState(page)
  const afterInsert = await harnessState(page)

  if (mode === 'chip') {
    check('the click reached the composer as a chip', inserted.chips.length === 1, JSON.stringify(inserted.chips))
  } else {
  check('the click reached the composer', inserted.draft.includes('[元素]'), inserted.draft)
  check('the block carries a selector', inserted.draft.includes('[选择器]'), inserted.draft)
  check('the block carries the DSH source file', /\[源码\] …\/.*\.tsx/.test(inserted.draft), inserted.draft)
  check(
    'the pick is one compact line, not a wall of text',
    inserted.draft.trim().split('\n').filter((line) => line.trim() !== '').length === 1,
    JSON.stringify(inserted.draft),
  )
  check('the block names the picked element', inserted.draft.includes('发送'), inserted.draft)
  }
  check('selection mode stays on for the next pick', inserted.active === 'true', String(inserted.active))
  check('the send button never received the swallowed click', afterInsert.calls.sends === 0, JSON.stringify(afterInsert.calls))
  check('no other application click was triggered', afterInsert.calls.sidebar === 0, JSON.stringify(afterInsert.calls))
  await shot('04-inserted')

  if (mode === 'chip') {
    check('the pick produced a composer chip', inserted.chips.length === 1, JSON.stringify(inserted.chips))
    check(
      'the chip belongs to the picker source',
      inserted.chips[0]?.source === 'element-picker',
      JSON.stringify(inserted.chips[0]),
    )
    check(
      'the chip is a short label, not a text wall',
      (inserted.chips[0]?.label ?? '').length > 0 &&
        (inserted.chips[0]?.label ?? '').length < 70 &&
        inserted.draft.includes('[元素]') === false,
      JSON.stringify(inserted.chips[0]),
    )
    const newline = String.fromCharCode(10)
    check(
      'the chip keeps the draft to one compact line',
      afterInsert.chipPayloads.length > 0 &&
        afterInsert.chipPayloads.every((text) => text.split(newline).length === 1 && text.includes('[XPath]') === false),
      JSON.stringify(afterInsert.chipPayloads),
    )
    check(
      'the reference carries the full block for the model',
      afterInsert.chipModels.length > 0 &&
        afterInsert.chipModels.every((model) => typeof model === 'string' && model.includes('[XPath]')),
      JSON.stringify((afterInsert.chipModels[0] ?? '').slice(0, 70)),
    )
    check(
      'sending expands the chip to the full block, not the draft line',
      afterInsert.serializedPrompt.includes('[XPath]') &&
        afterInsert.serializedPrompt.includes('[元素]') &&
        afterInsert.serializedPrompt.includes('[选择器]'),
      afterInsert.serializedPrompt.slice(0, 90),
    )
    check(
      'the codec that expands the chip on send was registered',
      afterInsert.chipCodec === 'element-picker',
      String(afterInsert.chipCodec),
    )
    // One more element without touching the control again. The picks merge as
    // you go (ZCode's behaviour), so there is one group chip and not a row.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(150)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(700)
    const afterSecondPick = await overlayState(page)
    check(
      'a second pick is merged into one group chip automatically',
      afterSecondPick.chips.length === 1,
      JSON.stringify(afterSecondPick.chips),
    )
    check(
      'the group chip counts the elements',
      /^2 个元素$/.test(afterSecondPick.chips[0]?.label ?? ''),
      JSON.stringify(afterSecondPick.chips[0]),
    )
    check('the mode is still on after the second pick', afterSecondPick.active === 'true', String(afterSecondPick.active))

    // The outer delete has to work right here: the user has just picked, so
    // selection mode is still on when they reach for the ×.
    let activeChipBox = await page.locator('[data-composer-chip="element-picker"]').first().boundingBox()
    await page.mouse.click(activeChipBox.x + activeChipBox.width - 4, activeChipBox.y + activeChipBox.height / 2)
    await page.waitForTimeout(400)
    const afterActiveClear = await overlayState(page)
    check(
      'the × clears every pick while selection mode is still on',
      afterActiveClear.chips.length === 0,
      JSON.stringify(afterActiveClear.chips),
    )
    check(
      'clearing the picks leaves selection mode alone',
      afterActiveClear.active === 'true',
      String(afterActiveClear.active),
    )
    check(
      'clicking the chip did not pick the chip as an element',
      afterActiveClear.draft.includes('[元素]') === false,
      JSON.stringify(afterActiveClear.draft.slice(0, 80)),
    )

    // Pick the same two elements again for the hover-list part of the run.
    for (let round = 0; round < 2; round += 1) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(150)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(500)
    }
    const regrouped = await overlayState(page)
    check(
      'picking again re-builds the group chip',
      /^2 个元素$/.test(regrouped.chips[0]?.label ?? ''),
      JSON.stringify(regrouped.chips),
    )

    // Hovering the group chip lists what it holds, and the list scrolls.
    await page.hover('[data-composer-chip="element-picker"]')
    await page.waitForTimeout(400)
    const preview = await overlayState(page)
    check('hovering the chip opens the preview', preview.previewVisible === true)
    check('the preview lists both elements', preview.previewRows === 2, String(preview.previewRows))
    check(
      'the preview shows a summary, a tag line and the page it came from',
      /发送/.test(preview.previewText) &&
        /button/.test(preview.previewText) &&
        preview.previewText.includes('DSH Element Picker'),
      preview.previewText.slice(0, 120),
    )
    check('the preview scrolls', preview.previewScrollable === true, String(preview.previewMaxHeight))
    check(
      'every preview row carries its own delete button',
      preview.previewRemoveButtons === preview.previewRows && preview.previewRows > 0,
      `${preview.previewRemoveButtons}/${preview.previewRows}`,
    )
    check(
      'the preview text is a whole number of pixels with subpixel smoothing',
      preview.previewRowFont !== null &&
        Number.parseFloat(preview.previewRowFont.size) === Number.parseInt(preview.previewRowFont.size, 10) &&
        preview.previewRowFont.smoothing === 'auto',
      JSON.stringify(preview.previewRowFont),
    )
    check(
      'the row delete button is a clickable target',
      preview.previewRemoveCursor !== null && preview.previewRemoveCursor.cursor === 'pointer',
      JSON.stringify(preview.previewRemoveCursor),
    )
    await shot('04b-chip-preview')

    // The list has to survive the pointer travelling from the chip into it, or
    // the row's delete button can never be reached with a real mouse.
    const panelBox = await page.locator('[data-dsh-picker-ui="chip-preview"]').boundingBox()
    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2, { steps: 8 })
    await page.waitForTimeout(500)
    const afterEnter = await overlayState(page)
    check(
      'the preview stays open while the pointer is inside it',
      afterEnter.previewVisible === true,
      String(afterEnter.previewVisible),
    )

    await page.mouse.move(4, 4)
    await page.waitForTimeout(500)

    // Leave the mode before exercising the delete controls: while selecting,
    // clicks belong to the picker.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // A row's trash button drops that one element and keeps the rest grouped.
    await page.hover('[data-composer-chip="element-picker"]')
    await page.waitForTimeout(400)
    await page.click('[data-dsh-picker-preview-item] [data-dsh-picker-ui="preview-remove"]')
    await page.waitForTimeout(500)
    const afterRowRemove = await overlayState(page)
    check(
      'deleting a row leaves the other elements in one group chip',
      afterRowRemove.chips.length === 1 && /^1 个元素$/.test(afterRowRemove.chips[0]?.label ?? ''),
      JSON.stringify(afterRowRemove.chips),
    )
    const afterRowRemovePreview = await overlayState(page)
    check(
      'the preview stays open after a row is dropped',
      afterRowRemovePreview.previewVisible === true,
      String(afterRowRemovePreview.previewVisible),
    )
    check(
      'the preview now lists only what is left',
      afterRowRemovePreview.previewRows === 1,
      String(afterRowRemovePreview.previewRows),
    )
    await shot('04d-chip-row-removed')

    check(
      'the chip draws a remove glyph',
      String(inserted.chipRemoveGlyph ?? '').includes('×'),
      String(inserted.chipRemoveGlyph),
    )

    // The × is the outer delete: one click clears every picked element.
    const chipBox = await page.locator('[data-composer-chip="element-picker"]').first().boundingBox()
    await page.mouse.click(chipBox.x + chipBox.width - 4, chipBox.y + chipBox.height / 2)
    await page.waitForTimeout(400)
    const afterRemove = await overlayState(page)
    check(
      'clicking the × cleared every picked element',
      afterRemove.chips.length === 0,
      JSON.stringify(afterRemove.chips),
    )
    check(
      'the preview goes away with its chip',
      afterRemove.previewVisible === false,
      String(afterRemove.previewVisible),
    )
    await shot('04c-chip-removed')
  }


  // Finishing the selection is what returns clicks to the application.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const afterFinish = await overlayState(page)
  check('Escape finishes the selection', afterFinish.active === 'false', String(afterFinish.active))

  // With selection mode off, the application works normally again.
  await page.click('#sidebar-toggle')
  const afterNormalClick = await harnessState(page)
  check('ordinary interaction resumes once selection mode is off', afterNormalClick.calls.sidebar === 1, JSON.stringify(afterNormalClick.calls))

  // The composer's own controls must stay usable while the picker is idle.
  await page.click('button[aria-label="发送消息"]')
  const afterSendClick = await harnessState(page)
  check('the send button stays clickable while the picker is idle', afterSendClick.calls.sends === 1, JSON.stringify(afterSendClick.calls))

  // Escape cancels without inserting.
  const draftBeforeEscape = (await overlayState(page)).draft
  await page.click('[data-dsh-picker-ui="slot-button"]')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  const cancelled = await overlayState(page)
  check('Escape leaves selection mode', cancelled.active === 'false', String(cancelled.active))
  check('Escape inserts nothing', cancelled.draft === draftBeforeEscape, cancelled.draft.slice(-40))
  await shot('05-escape-cancelled')

  check('the page raised no errors', pageErrors.length === 0, pageErrors.join(' | '))

  await context.close()
  return { inserted, afterInsert }
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const { server, origin } = await startServer()
const browser = await chromium.launch()

try {
  for (const mode of ['dom', 'paste', 'non-editable', 'chip']) {
    await runScenario(browser, mode, origin)
  }
} finally {
  await browser.close()
  server.closeAllConnections?.()
  server.close()
}

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`screenshots: ${out}`)
console.log(`harness origin: ${origin}`)
