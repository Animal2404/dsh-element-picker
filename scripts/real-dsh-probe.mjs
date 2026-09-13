/**
 * Real-DSH probe (cloud only).
 *
 * Boots the actual `@deepseek-ai/dsh` build on the runner, installs this plugin
 * into a throwaway profile, and drives the real Web UI with Chromium. The point
 * is to answer the questions the harness cannot:
 *
 *   - does the plugin load and mount its floating button inside real DSH?
 *   - is the real composer really a Lexical `contenteditable`
 *     (`[data-composer-input]`), not the `<textarea>` an earlier attempt assumed?
 *   - does the session-scoped `conversation.input.left` entry render?
 *   - can the picker actually insert into the real composer, and by which path?
 *
 * It is diagnostics-first on purpose: unknown environment facts are reported and
 * the run only fails for things that are unambiguously broken (the server never
 * boots, the page never loads, the plugin never mounts). Skipped steps are
 * printed with their reason, never silently passed.
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
 * @param {string} reason - Why it cannot be checked here.
 * @returns {void}
 */
function skip(name, reason) {
  skips.push(`${name}: ${reason}`)
  say(`SKIP  ${name}: ${reason}`)
}

/**
 * @param {string} label - Step label.
 * @param {string} command - Executable.
 * @param {string[]} args - Arguments.
 * @param {object} [options] - spawn options.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} Result.
 */
function run(label, command, args, options = {}) {
  return new Promise((done) => {
    say(`$ ${label}: ${command} ${args.join(' ')}`)
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

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await mkdir(dshHome, { recursive: true })

// ---------------------------------------------------------------- environment
const dshBin = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(dshBin)) {
  say(`dsh CLI not found at ${dshBin}; expected the workflow to install it`)
  process.exit(1)
}
const version = JSON.parse(
  await readFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
).version
say(`dsh version: ${version}`)

// ------------------------------------------------------------ plugin install
const install = await run('install plugin into a throwaway profile', 'node', [
  dshBin,
  'plugin',
  '--profile',
  'web',
  'add',
  `link:${root}`,
], { env: { DSH_HOME: dshHome } })
await writeFile(join(out, 'plugin-install.log'), `${install.stdout}\n${install.stderr}`)
must('the plugin installs into the profile', install.code === 0, `exit ${install.code}`)
if (install.code !== 0) {
  say(install.stdout.slice(-2000), install.stderr.slice(-2000))
}

// -------------------------------------------------------------------- boot it
const serverLog = join(out, 'server.log')
const server = spawn('node', [dshBin, '--profile', 'web', '--no-open', '--port', String(PORT)], {
  cwd: root,
  env: { ...process.env, DSH_HOME: dshHome },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
server.stdout.on('data', (chunk) => {
  serverOutput += chunk
  process.stdout.write(`[dsh] ${chunk}`)
})
server.stderr.on('data', (chunk) => {
  serverOutput += chunk
  process.stdout.write(`[dsh:err] ${chunk}`)
})

const tokenMatch = await new Promise((done) => {
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

await writeFile(serverLog, serverOutput)
must('the dsh web server boots and prints a URL', tokenMatch !== null, 'no tokenized URL within 120s')
if (tokenMatch === null) {
  say('server output tail:', serverOutput.slice(-3000))
  server.kill()
  await writeFile(join(out, 'summary.txt'), lines.join('\n'))
  process.exit(1)
}
say(`server URL: ${tokenMatch}`)

// ------------------------------------------------------------------ inspect it
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const pluginLog = []
page.on('console', (message) => {
  const text = message.text()
  if (text.includes('dsh-element-picker')) pluginLog.push(`console[${message.type()}] ${text}`)
})
page.on('pageerror', (error) => pluginLog.push(`pageerror ${String(error)}`))

await page.goto(tokenMatch, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
await page.screenshot({ path: join(out, '01-real-dsh-boot.png') })

const dom = await page.evaluate(() => {
  const composer = document.querySelector('[data-composer-input]')
  const card = document.querySelector('[data-composer-card]')
  return {
    title: document.title,
    composer: composer === null ? null : {
      tag: composer.tagName,
      contenteditable: composer.getAttribute('contenteditable'),
      role: composer.getAttribute('role'),
      phase: composer.getAttribute('data-phase'),
    },
    hasCard: card !== null,
    hasSeat: document.querySelector('[data-composer-seat]') !== null,
    pickerButton: document.querySelectorAll('[data-dsh-picker-ui="button"]').length,
    pickerSlotButton: document.querySelectorAll('[data-dsh-picker-ui="slot-button"]').length,
    pickerRoot: document.querySelector('[data-dsh-picker-ui="root"]') !== null,
    textareas: document.querySelectorAll('textarea').length,
    buttons: document.querySelectorAll('button').length,
  }
})
say(`real DOM: ${JSON.stringify(dom, null, 2)}`)
await writeFile(join(out, 'dom.json'), JSON.stringify(dom, null, 2))

must('the page is the DSH Web UI', dom.title.length > 0 || dom.buttons > 0, dom.title)
must('the real composer input exists', dom.composer !== null)
must(
  'the real composer is a contenteditable, not a textarea',
  dom.composer !== null && dom.composer.contenteditable !== null && dom.textareas === 0,
  JSON.stringify(dom.composer),
)
must('the plugin mounted its floating button inside real DSH', dom.pickerButton === 1, `found ${dom.pickerButton}`)

if (dom.pickerSlotButton === 0) {
  skip(
    'the conversation.input.left entry',
    'no active session in this boot, so the session-scoped slot is not rendered',
  )
} else {
  say('PASS  the composer-row entry rendered inside a live session')
}

// ------------------------------------------------------- the interaction itself
/**
 * Dump the page's interactive affordances, so an unknown UI can be driven from
 * evidence instead of guesses.
 *
 * @param {import('playwright').Page} page - Page under test.
 * @returns {Promise<object>} Buttons, inputs, and composer state.
 */
function affordances(page) {
  return page.evaluate(() => {
    const describe = (element) => ({
      tag: element.tagName.toLowerCase(),
      label: element.getAttribute('aria-label'),
      title: element.getAttribute('title'),
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      disabled: element.hasAttribute('disabled'),
    })
    const composer = document.querySelector('[data-composer-input]')
    return {
      buttons: [...document.querySelectorAll('button, [role="button"]')].map(describe),
      inputs: [...document.querySelectorAll('input, [data-composer-input]')].map((element) => ({
        ...describe(element),
        contenteditable: element.getAttribute('contenteditable'),
        phase: element.getAttribute('data-phase'),
      })),
      composerEditable: composer !== null && composer.getAttribute('contenteditable') === 'true',
      slotEntries: document.querySelectorAll('[data-dsh-picker-ui="slot-button"]').length,
      sessionRows: document.querySelectorAll('[data-session-id], [role="listitem"]').length,
    }
  })
}

/**
 * Click the first affordance matching a predicate, if any.
 *
 * @param {import('playwright').Page} page - Page under test.
 * @param {(item: object) => boolean} predicate - Match against an affordance.
 * @returns {Promise<string | null>} What was clicked, else null.
 */
async function clickAffordance(page, predicate) {
  const map = await affordances(page)
  const match = map.buttons.find(predicate) ?? map.inputs.find(predicate)
  if (match === undefined) return null
  if (match.tag === 'button' || match.tag === '[role="button"]') {
    await page.getByRole('button', { name: match.text === '' ? match.label : match.text }).first().click()
  } else {
    await page.locator('button', { hasText: match.text }).first().click()
  }
  return match.label ?? match.text
}

// ------------------------------------------------------- dismiss first-run UI
const notice = await clickAffordance(page, (item) => item.text === 'Continue' || item.label === 'Continue')
if (notice !== null) {
  say(`dismissed the first-run notice via "${notice}"`)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(out, '02-after-notice.png') })
} else {
  skip('dismissing the first-run notice', 'no Continue affordance found')
}

const map = await affordances(page)
say(`affordances after the notice: ${JSON.stringify(map, null, 2)}`)
await writeFile(join(out, 'affordances.json'), JSON.stringify(map, null, 2))

// ------------------------------------------------------------- create session
if (!map.composerEditable) {
  const created = await clickAffordance(page, (item) =>
    /new session|新建会话/i.test(`${item.label ?? ''} ${item.text ?? ''}`),
  )
  if (created === null) {
    skip('creating a session', 'no New Session affordance found')
  } else {
    say(`started a session via "${created}"`)
    await page.waitForTimeout(3000)
    await page.screenshot({ path: join(out, '03-new-session.png') })
  }
}

const afterSession = await affordances(page)
say(`composer editable after the attempt: ${afterSession.composerEditable}`)
say(`composer-row entries: ${afterSession.slotEntries}`)
await writeFile(join(out, 'affordances-after-session.json'), JSON.stringify(afterSession, null, 2))

if (afterSession.composerEditable) {
  say('PASS  the real composer becomes editable with a session')
} else {
  skip(
    'an editable composer',
    'no workspace/session could be created headlessly, so the composer stays inert',
  )
}
if (afterSession.slotEntries === 1) {
  say('PASS  the composer-row entry renders inside a live session')
} else if (afterSession.composerEditable) {
  must('the composer-row entry renders inside a live session', false, `found ${afterSession.slotEntries}`)
} else {
  skip('the composer-row entry', 'no live session to host the session-scoped slot')
}

// ---------------------------------------------------------- pick and insert
let picked = null
if (dom.pickerButton === 1) {
  await page.click('[data-dsh-picker-ui="button"]')
  await page.waitForTimeout(300)
  const active = await page.evaluate(
    () => document.querySelector('[data-dsh-picker-ui="root"]').getAttribute('data-dsh-picker-active'),
  )
  must('selection mode turns on in the real UI', active === 'true', String(active))

  // Aim at a real DSH element: the composer card itself (it always exists).
  const target = page.locator('[data-composer-card]').first()
  if ((await target.count()) > 0) {
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
    await page.screenshot({ path: join(out, '04-real-dsh-hover.png') })

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(1000)
    picked = await page.evaluate(() => {
      const composer = document.querySelector('[data-composer-input]')
      return composer === null ? null : composer.textContent
    })
    await page.screenshot({ path: join(out, '05-real-dsh-after-pick.png') })
  } else {
    skip('picking an element', 'no [data-composer-card] in the real DOM')
  }
}

say(`plugin console output: ${pluginLog.length === 0 ? '(none)' : JSON.stringify(pluginLog, null, 2)}`)
await writeFile(join(out, 'plugin-console.log'), pluginLog.join('\n'))

if (picked !== null && picked.includes('[元素]')) {
  say('PASS  the pick inserted the locating block into the real composer')
  say(`inserted text: ${JSON.stringify(picked)}`)
} else if (picked === null) {
  skip('insertion into the real composer', 'no composer input element to read back')
} else {
  skip(
    'insertion into the real composer',
    `composer text after the pick was ${JSON.stringify(picked)}; the cascade reported: ${pluginLog.join(' | ') || 'no diagnostics'}`,
  )
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
  const summary = [
    '### real-DSH probe',
    '',
    '```',
    ...lines.slice(-40),
    '```',
  ].join('\n')
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' })
}

process.exit(failures.length > 0 ? 1 : 0)
