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
      highlight: highlight === null ? null : {
        left: Number.parseFloat(highlight.style.left),
        top: Number.parseFloat(highlight.style.top),
        width: Number.parseFloat(highlight.style.width),
        height: Number.parseFloat(highlight.style.height),
      },
      hintVisible: (() => {
        const hint = document.querySelector('[data-dsh-picker-ui="hint"]')
        if (hint === null) return false
        return getComputedStyle(hint).display !== 'none'
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
  return page.evaluate(() => ({
    calls: { ...window.__harness.calls },
    mode: window.__harness.mode,
    injected: window.__harness.injected,
    mounted: window.__harness.mounted === undefined ? null : window.__harness.mounted.options,
    chipCodec: window.__harness.chips === undefined || window.__harness.chips.name === null ? null : window.__harness.chips.name,
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
  check('the bundle registers into conversation.input.left', harness.injected === 'conversation.input.left', String(harness.injected))
  check('the entry id is element-picker', harness.mounted?.id === 'element-picker', JSON.stringify(harness.mounted))
  check('the registered component renders into the tool row', boot.slotButtons === 1, `slot buttons: ${boot.slotButtons}`)
  check('the overlay is mounted', boot.present === true)
  check('selection mode starts off', boot.active === 'false', String(boot.active))
  check('the harness runs the real React build', harness.reactVersion !== undefined, String(harness.reactVersion))
  check(
    'the overlay owns no button of its own',
    boot.ownButtons === 0,
    `found ${boot.ownButtons} overlay button(s)`,
  )
  check('exactly one picker control exists', boot.slotButtons === 1, `found ${boot.slotButtons}`)
  await shot('01-boot')

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
  check(
    'the highlight uses the high-contrast outline',
    hovering.highlightOutline === 'rgb(255, 138, 61)',
    String(hovering.highlightOutline),
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
    check(
      'the codec that expands the chip on send was registered',
      afterInsert.chipCodec === 'element-picker',
      String(afterInsert.chipCodec),
    )
    // One more element without touching the control again: the point of the mode.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(150)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(500)
    const afterSecondPick = await overlayState(page)
    check(
      'a second element can be picked without leaving the mode',
      afterSecondPick.chips.length === 2,
      JSON.stringify(afterSecondPick.chips),
    )
    check(
      'the mode is still on after the second pick',
      afterSecondPick.active === 'true',
      String(afterSecondPick.active),
    )

    // Leave the mode before exercising the ×: while selecting, clicks belong to
    // the picker, so the × is deliberately inert.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    check(
      'the chip draws a remove glyph',
      String(inserted.chipRemoveGlyph ?? '').includes('×'),
      String(inserted.chipRemoveGlyph),
    )

    // The × drops that chip, like ZCode's picked-element pill: a real click in
    // the chip's right-hand remove region.
    const chipBox = await page.locator('[data-composer-chip="element-picker"]').first().boundingBox()
    await page.mouse.click(chipBox.x + chipBox.width - 4, chipBox.y + chipBox.height / 2)
    await page.waitForTimeout(400)
    const afterRemove = await overlayState(page)
    check(
      'clicking the × removed exactly that one chip',
      afterRemove.chips.length === 1,
      JSON.stringify(afterRemove.chips),
    )
    await shot('04b-chip-removed')
  } else if (mode === 'paste') {
    check('the shell paste path was chosen', afterInsert.calls.paste === 1, JSON.stringify(afterInsert.calls))
    check('setDraft was never used', afterInsert.calls.setDraft === 0, JSON.stringify(afterInsert.calls))
  } else if (mode === 'non-editable') {
    check('setDraft was the path used', afterInsert.calls.setDraft === 1, JSON.stringify(afterInsert.calls))
    check('the existing draft survived', inserted.draft.startsWith('existing draft '), inserted.draft.slice(0, 40))
    check('no paste path was available', afterInsert.calls.paste === 0, JSON.stringify(afterInsert.calls))
  } else {
    check('the dom path was used, not setDraft', afterInsert.calls.setDraft === 0, JSON.stringify(afterInsert.calls))
    check('the dom path did not need paste', afterInsert.calls.paste === 0, JSON.stringify(afterInsert.calls))
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
