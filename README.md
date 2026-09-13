# DSH Element Picker

A native picker for the DeepSeek Harness Web UI: click the floating pointer
button to enter selection mode, hover to outline a UI element, click it to
insert its locating information into the chat composer, and click the button
again (or press Escape) to leave selection mode.

Built for DSH itself — the button lives inside the app, and the elements it
picks are the app's own UI. Picking elements on arbitrary websites is a
different job (a browser extension), not this one.

## Behaviour

1. A floating pointer button sits at the bottom-right of the DSH page, and the
   same control is registered in the composer tool row
   (`conversation.input.left`).
2. Click either one: selection mode turns on, the hint bar appears, and hovering
   outlines the resolved element.
3. Click an element: its locating block is inserted into the composer at the
   caret, and selection mode exits.
4. Click the button again, or press Escape: selection mode exits without
   picking.
5. Selector generation prefers the hooks DSH exposes on purpose (`data-*`
   markers) over CSS-module class names, which are build-time hashes, and still
   falls back to a unique positional path when nothing stable exists.

## Inserted block

```
[元素] button.primary "发送"
[选择器] [data-composer-card] button[aria-label="发送消息"]
[XPath] /html/body/div[2]/div[3]/button
[位置] 44x44 @ viewport(1032,688) page(1032,808)
[样式] color #F9FAFB; font 16px -apple-system,…; font-weight 600; display flex
[属性] aria-label="发送消息"
[源码] packages/client/ui-conversation/src/client/skeleton/InputBar.tsx (data-composer-card)
[HTML] <button aria-label="发送消息" data-phase="idle">发送</button>
```

The `[源码]` line is the DSH-specific part: stable hooks are mapped to the
source files that render them, so a follow-up request ("move this button")
starts from a path instead of a class hash.

## Insertion

The composer is a Lexical `contenteditable` (`[data-composer-input]`), and the
published plugin API only offers "replace the whole draft". Insertion is
therefore a cascade, each step verified before the next is tried:

| Path | How | Effect |
| --- | --- | --- |
| `paste` | the shell's internal `paste(text)` | inserts at the caret, keeps reference chips |
| `dom` | `execCommand('insertText')`, then a synthetic `beforeinput` | Lexical applies it as a user edit |
| `setDraft` | `setDraft(draft + text)` | last resort: chips are lost, caret moves to the end |

The path actually used is logged as `[dsh-element-picker] inserted via "…"`.

## Repository policy: cloud-only

Nothing in this repository is built, tested, or run on a developer machine.
`.github/workflows/ci.yml` is the only producer:

- `npm run lint` — manifest contract, flattenability, CSS namespacing, no
  Node/network access in browser code;
- `npm run build` — flattens `src/` into `lib/client.js` in the DSH loader
  format (`window.__ModuleLoader__.load({ id, factory })`, a classic script);
- `npm run verify` — asserts the artifact's loader contract;
- `npm test` — selector, describe, insertion-cascade, overlay, and
  loader/registration suites, all dependency-free;
- `.github/workflows/e2e.yml` — a real Chromium, driven through the whole
  interaction, over a harness page that reproduces the composer's DOM contract
  and loads the built bundle through a loader stub with the real React UMD
  build. It asserts the highlight geometry against the element's bounding box,
  that the swallowed click never reaches the application, that ordinary
  interaction resumes afterwards, and that Escape cancels without inserting.
  Screenshots are uploaded as the evidence artifact. What it does **not** prove
  is that DSH's real Lexical editor behaves like the harness editable — that is
  the remaining unknown, and it needs a real DSH build (see Verification
  status);
- `publish-lib` — commits the built `lib/` back to `main`, because a DSH client
  plugin must ship a built `./client` export and local builds are not allowed.

## Verification status

| Layer | Evidence |
| --- | --- |
| Selector, block, cascade, overlay logic | 37 `node:test` assertions, green in CI |
| Built artifact contract | `verify-bundle` + the loader/registration suite, green in CI |
| Real browser behaviour | Playwright run over the harness page, green in CI, screenshots archived |
| Real DSH 0.1.5-rc.2 (Lexical composer, live slot) | not yet covered — requires a real DSH build |

The harness is a stub host, not DSH: it reproduces the DOM contract and the
`slots`/`inputActions` surface the plugin consumes. Treat its result as
"the picker's own logic works in a browser", not "it works in DSH".

## Install

```
dsh plugin --profile web add "link:<path to this repository>"
```

or, from GitHub once `lib/` has been published by the pipeline:

```
dsh plugin --profile web add "github:Animal2404/dsh-element-picker"
```

Restart `dsh web` afterwards. To disable without uninstalling, add to the
profile's `cordis.patch.yml`:

```yaml
- id: element-picker
  disabled: true
```

## Layout

```
package.json          dsh.bundle.patch + dsh.client + exports["./client"]
cordis.patch.yml      loader row: id element-picker
src/styles.js         overlay CSS (namespaced, injected as one <style>)
src/selector.js       CSS selector, XPath, hook resolution, summary
src/hooks-map.js      stable DOM hook -> DSH source file
src/describe.js       the inserted block
src/insert.js         the paste/dom/setDraft cascade
src/overlay.js        selection mode: button, highlight, hint, events
src/plugin.js         entry: applies styles, mounts the overlay, registers the slot
scripts/              cloud-side lint, build, verify
tests/                node:test suites over a dependency-free DOM stub
lib/                  generated by CI and committed by the pipeline
```

## License

MIT
