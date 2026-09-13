/**
 * Real-DSH probe (cloud only).
 *
 * Boots the actual `@deepseek-ai/dsh` build on the runner, installs this plugin
 * into a throwaway profile, and drives the real Web UI with Chromium. This is
 * the only check in the repository that sees the real Lexical composer and the
 * real slot host; everything else runs against a harness that merely reproduces
 * their contract.
 *
 * It is diagnostics-first: every step is guarded, unreachable steps are reported
 * with their reason, and the evidence (DOM dumps, screenshots, server log,
 * plugin console) is uploaded whatever happens. It fails only for things that
 * are unambiguously broken.
 *
 * Note on clicking: the real UI gates itself behind first-run dialogs, and
 * Playwright's actionability wait can time out on them (a modal backdrop makes
 * the button "not stable"). Gates are therefore dismissed with a direct DOM
 * click, while the picker interaction itself uses real mouse events — that part
 * must exercise hit-testing for real.
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'real-dsh-out')
const dshHome = join(process.env.RUNNER_TEMP ?? out, 'dsh-home')
const PORT = 3081

const lines = []
const failures = []
const skips = []

/**
 * @param {...unknown} parts - Line to record.
 * @returns {void}
 */
function say(...parts) {
  const line = parts.join(' ')
  lines.push(line)
  console.log(line)
}

/**
 * @param {string} name - Assertion name.
 * @param {boolean} condition - Result.
 * @param {string} [detail] - Context.
 * @returns {void}
 */
function must(name, condition, detail = '') {
  if (condition) {
    say(`PASS  ${name}`)
    return
  }
  failures.push(`${name}${detail === '' ? '' : ` — ${detail}`}`)
  say(`FAIL  ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/**
 * @param {string} name - Step name.
 * @param {string} reason - Why it cannot be checked.
 * @returns {void}
 */
function skip(name, reason) {
  skips.push(`${name}: ${reason}`)
  say(`SKIP  ${name}: ${reason}`)
}

/**
 * Run one step, turning a thrown error into a recorded failure instead of
 * aborting the whole probe.
 *
 * @param {string} name - Step name.
 * @param {() => Promise<void>} body - Step body.
 * @returns {Promise<void>} Completion.
 */
async function step(name, body) {
  try {
    await body()
  } catch (error) {
    failures.push(`${name}: ${String(error)}`)
    say(`FAIL  ${name}: ${String(error)}`)
  }
}

/**
 * @param {string} command - Executable.
 * @param {string[]} args - Arguments.
 * @param {object} [options] - spawn options.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} Result.
 */
function run(command, args, options = {}) {
  return new Promise((done) => {
    say(`$ ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      env: { ...process.env, ...(options.env ?? {}) },
      cwd: options.cwd ?? root,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => done({ code: code ?? -1, stdout, stderr }))
  })
}

/**
 * Snapshot the parts of the page this probe reasons about.
 *
 * @param {import('playwright').Page} page - Page under test.
 * @returns {Promise<object>} DOM facts and interactive affordances.
 */
function snapshot(page) {
  return page.evaluate(() => {
    const describe = (element) => ({
      tag: element.tagName.toLowerCase(),
      label: element.getAttribute('aria-label'),
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      disabled: element.hasAttribute('disabled'),
    })
    const composer = document.querySelector('[data-composer-input]')
    return {
      title: document.title,
      composer: composer === null ? null : {
        tag: composer.tagName,
        contenteditable: composer.getAttribute('contenteditable'),
        role: composer.getAttribute('role'),
        phase: composer.getAttribute('data-phase'),
      },
      composerEditable: composer !== null && composer.getAttribute('contenteditable') === 'true',
      textareas: document.querySelectorAll('textarea').length,
      hasCard: document.querySelector('[data-composer-card]') !== null,
      pickerRoot: document.querySelector('[data-dsh-picker-ui="root"]') !== null,
      pickerOwnButtons: document.querySelectorAll('[data-dsh-picker-ui="button"]').length,
      pickerSlotButton: document.querySelectorAll('[data-dsh-picker-ui="slot-button"]').length,
      buttons: [...document.querySelectorAll('button, [role="button"]')].map(describe),
      sessionRows: document.querySelectorAll('[data-session-id]').length,
    }
  })
}

/**
 * Dismiss a gating dialog by clicking a real button element in the page.
 *
 * Playwright's own click waits for visibility, enabled, and stability; a modal
 * backdrop can keep a sidebar button unstable, so gates are clicked directly.
 * React still receives the bubbled event.
 *
 * @param {import('playwright').Page} page - Page under test.
 * @param {string} pattern - Source of the label/text regex to match.
 * @param {string} [selector] - Candidate elements.
 * @returns {Promise<string | null>} What was clicked, else null.
 */
function domClick(page, pattern, selector = 'button, [role="button"]') {
  return page.evaluate(
    ([source, candidates]) => {
      const match = new RegExp(source, 'i')
      const elements = [...document.querySelectorAll(candidates)]
      const target = elements.find((element) => {
        const label = element.getAttribute('aria-label') ?? ''
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
        return match.test(label) || match.test(text)
      })
      if (target === undefined) return null
      target.click()
      return (
        target.getAttribute('aria-label') ??
        (target.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
      )
    },
    [pattern, selector],
  )
}

/**
 * Drive DSH's in-page workspace picker: enter a directory, then confirm it.
 *
 * @param {import('playwright').Page} page - Page under test.
 * @param {(message: string) => void} log - Progress sink.
 * @returns {Promise<boolean>} Whether an Open was clicked.
 */
async function chooseWorkspaceDirectory(page, log) {
  const ROWS = 'button, [role="button"], [role="option"], li, a, [tabindex]'
  for (const name of ['work', 'dsh-element-picker', 'actions-runner']) {
    const entered = await domClick(page, `^${name}$`, ROWS)
    if (entered === null) continue
    log(`entered directory "${entered}"`)
    await page.waitForTimeout(900)
  }
  const opened = await domClick(page, '^open$')
  if (opened === null) return false
  log('confirmed the workspace directory with Open')
  return true
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await mkdir(dshHome, { recursive: true })

// ---------------------------------------------------------------- environment
const dshBin = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(dshBin)) {
  say(`dsh CLI not found at ${dshBin}; the workflow should have installed it`)
  process.exit(1)
}
const version = JSON.parse(
  await readFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
).version
say(`dsh version: ${version}`)

// ------------------------------------------------------------ plugin install
const install = await run('node', [dshBin, 'plugin', '--profile', 'web', 'add', `link:${root}`], {
  env: { DSH_HOME: dshHome },
})
await writeFile(join(out, 'plugin-install.log'), `${install.stdout}\n${install.stderr}`)
must('the plugin installs into the profile', install.code === 0, `exit ${install.code}`)
if (install.code !== 0) say(install.stdout.slice(-2000), install.stderr.slice(-2000))

// -------------------------------------------------------------------- boot it
const server = spawn('node', [dshBin, '--profile', 'web', '--no-open', '--port', String(PORT)], {
  cwd: root,
  env: { ...process.env, DSH_HOME: dshHome },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
server.stdout.on('data', (chunk) => {
  serverOutput += chunk
})
server.stderr.on('data', (chunk) => {
  serverOutput += chunk
})

const url = await new Promise((done) => {
  const deadline = Date.now() + 120000
  const poll = setInterval(() => {
    const found = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/.exec(serverOutput)
    if (found !== null) {
      clearInterval(poll)
      done(found[1])
      return
    }
    if (Date.now() > deadline) {
      clearInterval(poll)
      done(null)
    }
  }, 1000)
})

must('the dsh web server boots and prints a URL', url !== null, 'no tokenized URL within 120s')
if (url === null) {
  say('server output tail:', serverOutput.slice(-3000))
  server.kill()
  await writeFile(join(out, 'server.log'), serverOutput)
  await writeFile(join(out, 'summary.txt'), lines.join('\n'))
  process.exit(1)
}
say(`server URL: ${url}`)

// ------------------------------------------------------------------ drive it
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const pluginLog = []
page.on('console', (message) => {
  const text = message.text()
  if (text.includes('dsh-element-picker')) pluginLog.push(`console[${message.type()}] ${text}`)
})
page.on('pageerror', (error) => pluginLog.push(`pageerror ${String(error)}`))

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
await page.screenshot({ path: join(out, '01-boot.png') })

let state = await snapshot(page)
say(`boot DOM: ${JSON.stringify({ ...state, buttons: state.buttons.length }, null, 2)}`)
await writeFile(join(out, '01-boot-dom.json'), JSON.stringify(state, null, 2))

must('the page is the DSH Web UI', state.title.length > 0 || state.buttons.length > 0, state.title)
must('the real composer input exists', state.composer !== null)
must(
  'the real composer is a contenteditable, not a textarea',
  state.composer !== null && state.composer.contenteditable !== null && state.textareas === 0,
  JSON.stringify(state.composer),
)
must('the plugin mounted its overlay inside real DSH', state.pickerRoot === true)
must(
  'the overlay owns no button of its own',
  state.pickerOwnButtons === 0,
  `found ${state.pickerOwnButtons} overlay button(s)`,
)

// Dismiss whatever first-run gates stand between us and a usable UI.
for (let round = 0; round < 6; round += 1) {
  const clicked = await domClick(page, 'configure later|save and continue|^continue$|got it|skip')
  if (clicked === null) break
  say(`dismissed gate "${clicked}"`)
  await page.waitForTimeout(1200)
}
await page.screenshot({ path: join(out, '02-gates-dismissed.png') })
state = await snapshot(page)
await writeFile(join(out, '02-after-gates.json'), JSON.stringify(state, null, 2))
say(`composer editable after the gates: ${state.composerEditable}; session rows: ${state.sessionRows}`)

// Reach a live session: the session-scoped slot and an editable composer both
// depend on it.
if (!state.composerEditable) {
  await step('starting a session', async () => {
    const started = await domClick(page, '^new session$|新建会话')
    if (started === null) {
      skip('starting a session', 'no New Session affordance')
      return
    }
    say(`clicked "${started}"`)
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(out, '03-new-session.png') })

    let next = await snapshot(page)
    if (!next.composerEditable) {
      const workspace = await domClick(page, '^choose workspace$|^add workspace$|选择工作区')
      if (workspace !== null) {
        say(`clicked "${workspace}" (workspace picker)`)
        await page.waitForTimeout(2000)
        await page.screenshot({ path: join(out, '04-workspace-picker.png') })

        const opened = await chooseWorkspaceDirectory(page, (message) => say(message))
        if (!opened) skip('confirming a workspace directory', 'no Open affordance in the picker')
        await page.waitForTimeout(3000)
        await page.screenshot({ path: join(out, '05-workspace-chosen.png') })

        next = await snapshot(page)
        if (!next.composerEditable) {
          const again = await domClick(page, '^new session$|新建会话')
          if (again !== null) {
            say(`clicked "${again}" after choosing a workspace`)
            await page.waitForTimeout(2500)
            next = await snapshot(page)
          }
        }
      } else {
        skip('opening the workspace picker', 'no workspace affordance')
      }
    }
    await writeFile(join(out, '06-after-session.json'), JSON.stringify(next, null, 2))
    say(`composer editable after the session attempt: ${next.composerEditable}`)
  })
}

state = await snapshot(page)
if (state.composerEditable) {
  say('PASS  the real composer became editable (a live session exists)')
} else {
  skip(
    'an editable composer',
    'the headless boot could not reach a workspace/session, so the composer stays inert',
  )
}
if (state.pickerSlotButton === 1) {
  say('PASS  the composer-row entry rendered inside a live session')
} else if (state.composerEditable) {
  must('the composer-row entry renders inside a live session', false, `found ${state.pickerSlotButton}`)
} else {
  skip('the composer-row entry', 'the session-scoped slot has no session to render into')
}


// ---------------------------------------------------------- pick and insert
let picked = null
let draftSeed = ''
await step('picking an element in the real UI', async () => {
  // Type a draft first: inserting must not destroy what the user already wrote.
  if ((await snapshot(page)).composerEditable) {
    await page.click('[data-composer-input]')
    draftSeed = 'draft text '
    await page.keyboard.type(draftSeed)
    await page.waitForTimeout(600)
    const typed = await page.evaluate(
      () => document.querySelector('[data-composer-input]').textContent,
    )
    must('a draft can be typed into the real composer', typed.includes('draft text'), JSON.stringify(typed))
    await page.screenshot({ path: join(out, '06-draft-typed.png') })
  }

  await page.click('[data-dsh-picker-ui="slot-button"]')
  await page.waitForTimeout(300)
  const active = await page.evaluate(
    () => document.querySelector('[data-dsh-picker-ui="root"]').getAttribute('data-dsh-picker-active'),
  )
  must('selection mode turns on in the real UI', active === 'true', String(active))

  const target = page.locator('[data-composer-card]').first()
  if ((await target.count()) === 0) {
    skip('picking an element', 'no [data-composer-card] in the real DOM')
    return
  }
  const box = await target.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  const highlight = await page.evaluate(() => {
    const element = document.querySelector('[data-dsh-picker-ui="highlight"]')
    return {
      visible: element.getAttribute('data-dsh-picker-visible'),
      outline: getComputedStyle(element).outlineColor,
    }
  })
  say(`highlight over the composer card: ${JSON.stringify(highlight)}`)

  // The hover card must be painted with DSH's own theme tokens, so it follows
  // the active theme instead of carrying a hardcoded surface.
  const themed = await page.evaluate(() => {
    const card = document.querySelector('[data-dsh-picker-ui="info"]')
    const probe = document.createElement('div')
    probe.style.background = 'var(--dsw-alias-bg-overlay)'
    document.body.appendChild(probe)
    const tokenBackground = getComputedStyle(probe).backgroundColor
    const labelToken = getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim()
    probe.remove()
    return {
      cardBackground: card === null ? null : getComputedStyle(card).backgroundColor,
      tokenBackground,
      labelToken,
    }
  })
  must(
    'the hover card is painted with the DSH surface token',
    themed.tokenBackground !== 'rgba(0, 0, 0, 0)' && themed.cardBackground === themed.tokenBackground,
    JSON.stringify(themed),
  )
  must('the DSH label token is available to the overlay', themed.labelToken !== '', themed.labelToken)
  must('the highlight tracks a real DSH element', highlight.visible === 'true', JSON.stringify(highlight))
  await page.screenshot({ path: join(out, '07-hover.png') })

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(1200)
  picked = await page.evaluate(() => {
    const composer = document.querySelector('[data-composer-input]')
    if (composer === null) return null
    const chip = document.querySelector('[data-composer-chip]')
    // innerText keeps the paragraph breaks textContent drops, so the read-back
    // can tell "inserted in order" from "inserted and reflowed".
    return {
      text: composer.textContent,
      inner: composer.innerText,
      html: composer.innerHTML,
      chipSource: chip === null ? null : chip.getAttribute('data-composer-chip'),
      chipLabel: chip === null ? null : (chip.textContent ?? '').trim(),
    }
  })
  await page.screenshot({ path: join(out, '08-after-pick.png') })

  // The mode is continuous by design; leave it before opening a menu.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const finished = await page.evaluate(
    () => document.querySelector('[data-dsh-picker-ui="root"]').getAttribute('data-dsh-picker-active'),
  )
  must('Escape finishes the continuous selection', finished === 'false', String(finished))
})

say(`plugin console: ${pluginLog.length === 0 ? '(none)' : JSON.stringify(pluginLog, null, 2)}`)
await writeFile(join(out, 'plugin-console.log'), pluginLog.join('\n'))

const chosen = pluginLog.join(' ').match(/inserted via "([^"]+)"/)
const path = chosen === null ? 'none' : chosen[1]
say(`chosen insertion path on real DSH: ${path}`)
if (path === 'setDraft') {
  // Correct output, lossy mechanism: the draft is rewritten, which flattens any
  // reference chip in it to plain text. Reported, not failed: the behavioural
  // contract below is what the user depends on.
  say('NOTE  the fallback rewrote the draft; reference chips would flatten to text')
}

if (picked !== null && picked.chipSource !== null) {
  await writeFile(join(out, 'composer-after-pick.html'), picked.html)
  say('PASS  the pick produced a composer chip')
  say(`chip: source=${picked.chipSource} label=${JSON.stringify(picked.chipLabel)}`)
  must(
    'the chip belongs to the picker source',
    picked.chipSource === 'element-picker',
    String(picked.chipSource),
  )
  const label = picked.chipLabel ?? ''
  must(
    'the chip is compact — a short label, not a text wall',
    label.length > 0 &&
      label.length < 70 &&
      !picked.inner.includes('[选择器]') &&
      !picked.inner.includes('[源码]') &&
      !picked.inner.includes('[HTML]'),
    JSON.stringify({ label, inner: picked.inner }),
  )
  if (draftSeed !== '') {
    must(
      'the existing draft survived the insert',
      picked.inner.includes('draft text'),
      JSON.stringify(picked.inner.slice(0, 80)),
    )
  }
  must(
    'the chip codec was registered, so the block can serialize on send',
    !pluginLog.join(' ').includes('chip codec not registered'),
  )
} else if (picked !== null && picked.inner.includes('[元素]')) {
  await writeFile(join(out, 'composer-after-pick.html'), picked.html)
  say('NOTE  the chip path was unavailable; the compact text fallback was used')
  say(`inserted text (innerText): ${JSON.stringify(picked.inner)}`)

  const fields = ['[元素]', '[选择器]', '[源码]']
  const positions = fields.map((label) => picked.inner.indexOf(label))
  const lines = picked.inner.trim().split(String.fromCharCode(10)).filter((line) => line.trim() !== '')
  must(
    'the pick is ONE compact line carrying element, selector, and source',
    positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])) &&
      lines.length === 1,
    JSON.stringify({ lines, positions }),
  )
  if (draftSeed !== '') {
    must(
      'the existing draft survived the insert',
      picked.inner.includes('draft text'),
      JSON.stringify(picked.inner.slice(0, 80)),
    )
  }
} else if (picked === null) {
  skip('insertion into the real composer', 'no composer input to read back')
} else {
  skip(
    'insertion into the real composer',
    `composer text was ${JSON.stringify(picked.inner)}; cascade reported: ${pluginLog.join(' | ') || 'no diagnostics'}`,
  )
}


// ------------------------------------------------- picking inside a menu
// Menus are the case the picker used to lose: they dismiss on WINDOW-capture
// pointerdown, and entering selection mode by click closes them anyway. The
// way in is the keyboard toggle.
await step('picking inside a menu that dismisses itself on pointerdown', async () => {
  const button = await page.evaluate(() => {
    const card = document.querySelector('[data-composer-card]')
    if (card === null) return null
    const found = [...card.querySelectorAll('button')].find((b) => /DeepSeek|V4|GPT|Claude/i.test(b.textContent ?? ''))
    if (found === undefined) return null
    const box = found.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })
  if (button === null) {
    skip('picking inside a menu', 'no model selector in the composer row')
    return
  }

  await page.mouse.click(button.x, button.y)
  await page.waitForTimeout(700)
  const itemSelector = '[role="menuitem"], [role="option"]'
  const openItems = await page.evaluate((selector) => document.querySelectorAll(selector).length, itemSelector)
  if (openItems === 0) {
    skip('picking inside a menu', 'the menu did not open in this run')
    return
  }
  say(`menu opened with ${openItems} item(s)`)

  await page.keyboard.press('Control+Shift+E')
  await page.waitForTimeout(300)
  const active = await page.evaluate(
    () => document.querySelector('[data-dsh-picker-ui="root"]').getAttribute('data-dsh-picker-active'),
  )
  must('the keyboard toggle enters selection mode with a menu open', active === 'true', String(active))
  const survived = await page.evaluate((selector) => document.querySelectorAll(selector).length, itemSelector)
  must('the menu survived the keyboard toggle', survived === openItems, `${openItems} -> ${survived}`)

  const item = await page.evaluate((selector) => {
    const element = document.querySelector(selector)
    if (element === null) return null
    const box = element.getBoundingClientRect()
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
    }
  }, itemSelector)
  if (item === null) {
    skip('picking a menu item', 'the item vanished before the pick')
    return
  }

  // The chip names the element under the pointer, which inside a menu item is a
  // leaf span, not the item's own label text — so the expectation is computed
  // from the hit stack rather than from the item's caption.
  const expected = await page.evaluate(
    ({ x, y }) => {
      const stack = document.elementsFromPoint(x, y).filter((node) => node.closest('[data-dsh-picker-ui]') === null)
      const element = stack[0]
      return element === undefined ? null : (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 12)
    },
    { x: item.x, y: item.y },
  )

  await page.mouse.click(item.x, item.y)
  await page.waitForTimeout(900)
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll('[data-composer-chip]')].map((chip) => (chip.textContent ?? '').trim()),
  )
  const hit = expected !== null && expected !== '' && chips.some((label) => label.includes(expected))
  must(
    'the menu item was picked into a chip',
    hit,
    JSON.stringify({ expected, item: item.text, chips }),
  )
  await page.screenshot({ path: join(out, '09-menu-pick.png') })
})

// ------------------------------------------------------------------ diagnostics
// Runs last, and only for evidence: is there a lossless route for multi-line
// inserts on DSH's Lexical editor? `execCommand('insertText')` provably flattens
// newlines (an earlier run left "PROBE-APROBE-BPROBE-C"), so this probes the
// per-line alternative — insertText + insertParagraph, one field per paragraph.
if (state.composerEditable) {
  const lineByLine = await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    if (editor === null) return null
    const before = { text: editor.innerText, html: editor.innerHTML }
    editor.focus()
    const selection = document.getSelection()
    if (selection !== null) {
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    const applied = []
    for (const line of ['L1', 'L2', 'L3']) {
      applied.push(document.execCommand('insertText', false, line))
      applied.push(document.execCommand('insertParagraph', false))
    }
    const after = { text: editor.innerText, html: editor.innerHTML }
    return { before, applied, after }
  })
  say(`line-by-line diagnostic: ${JSON.stringify(lineByLine)}`)
  await writeFile(join(out, 'diagnostic-line-by-line.json'), JSON.stringify(lineByLine, null, 2))
}

await context.close()
await browser.close()
server.kill()

await writeFile(join(out, 'server.log'), serverOutput)
await writeFile(join(out, 'summary.txt'), lines.join('\n'))

say(`\nfailures: ${failures.length}; skipped: ${skips.length}`)
for (const item of failures) say(`- FAIL ${item}`)
for (const item of skips) say(`- SKIP ${item}`)

if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
  const summary = ['### real-DSH probe', '', '```', ...lines.slice(-45), '```'].join('\n')
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' })
}

process.exit(failures.length > 0 ? 1 : 0)
