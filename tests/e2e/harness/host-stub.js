/**
 * Harness host stub.
 *
 * The real host is DSH's Cordis client runtime, which cannot run in CI (the
 * instance lives on the user's machine). This stub reproduces the parts of the
 * contract the plugin actually touches:
 *
 *   - `window.__ModuleLoader__.load(...)` receives the built bundle;
 *   - `require('react')` resolves to the real React 18 UMD build;
 *   - `ctx.slots.inject` / `ctx.slots.register` mount the entry into a container
 *     standing in for the composer tool row;
 *   - `ctx.effect` collects disposers;
 *   - `inputActions` mimics the three shapes the insertion cascade probes
 *     (`paste` present, `dom` only, `setDraft` only).
 *
 * What this does NOT prove: that DSH's real Lexical editor behaves like the
 * harness editable. That is what the real-DSH job in the cloud is for.
 */
;(function () {
  var definition = null
  var disposers = []
  var inputActions = {}
  var currentDraft = ''
  var calls = { paste: 0, setDraft: 0, sends: 0, sidebar: 0 }

  window.__ModuleLoader__ = {
    load: function (loaded) {
      definition = loaded
    },
  }

  /** @returns {Element} The composer's editable element. */
  function composerInput() {
    return document.querySelector('[data-composer-input]')
  }

  /**
   * @param {string} text - Replacement draft text.
   * @returns {void}
   */
  function setEditableText(text) {
    composerInput().textContent = text
  }

  /**
   * Insert over the current selection, the way a paste into the shell behaves.
   *
   * @param {string} text - Text to insert.
   * @returns {void}
   */
  function insertAtCaret(text) {
    var input = composerInput()
    input.focus()
    document.execCommand('insertText', false, text)
  }

  /**
   * Build the input-actions face for one mode.
   *
   * @param {string} mode - dom | paste | non-editable
   * @returns {object} The actions object.
   */
  function buildInputActions(mode) {
    var actions = {
      setDraft: function (text) {
        calls.setDraft += 1
        setEditableText(text)
      },
      submit: function () {
        calls.sends += 1
      },
      addAttachments: function () {},
      removeAttachment: function () {},
      pruneAttachments: function () {},
    }
    if (mode === 'paste') {
      actions.paste = function (text) {
        calls.paste += 1
        insertAtCaret(text)
      }
    }
    return actions
  }

  /**
   * Mount the slot entry the plugin registers.
   *
   * @param {Function} component - Registered React component.
   * @param {object} options - Registration options.
   * @returns {void}
   */
  function mountEntry(component, options) {
    var container = document.getElementById('slot-host')
    var props = {
      inputActions: inputActions,
      sessionId: 'ci-session',
      useInput: function (selector) {
        return selector({ draft: currentDraft, draftRev: 0, occurrences: [], phase: 'plain' })
      },
    }
    window.__harness.mounted = { component: component, options: options }
    window.ReactDOM.createRoot(container).render(window.React.createElement(component, props))
  }

  window.__harness = {
    calls: calls,
    disposers: disposers,
    getDraft: function () {
      return composerInput().textContent
    },
    setDraftSeed: function (text) {
      currentDraft = text
      setEditableText(text)
    },
    dispose: function () {
      for (var i = 0; i < disposers.length; i += 1) {
        if (typeof disposers[i] === 'function') disposers[i]()
      }
      disposers = []
    },
    boot: function () {
      var params = new URLSearchParams(window.location.search)
      var mode = params.get('mode') || 'dom'
      window.__harness.mode = mode

      if (mode === 'non-editable') {
        composerInput().setAttribute('contenteditable', 'false')
        window.__harness.setDraftSeed('existing draft ')
      }

      inputActions = buildInputActions(mode)
      // A chip-capable host: the picker prefers inserting a reference chip, and
      // that path needs a session scope plus an input facade. Stubbed here so
      // the decision itself is covered without a real DSH.
      var chips = { registered: null, inserted: [], name: null, projection: '', occurrences: [] }
      window.__harness.chips = chips

      // Application-side listeners: if the picker leaks a click, these fire.
      document.querySelector('button[aria-label="发送消息"]').addEventListener('click', function () {
        calls.sends += 1
      })
      document.getElementById('sidebar-toggle').addEventListener('click', function () {
        calls.sidebar += 1
      })

      var exports = definition.factory(function (id) {
        if (id === 'react') return window.React
        throw new Error('unexpected platform module: ' + id)
      })

      window.__harness.exports = exports

      var extra = {}
      if (mode === 'chip') {
        // A small but faithful model of the real shell: the draft is a clipboard
        // projection, each chip occupies one detect character, and removal is
        // addressed by the detect span the caller computed.
        chips.text = ''
        var recompute = function () {
          var text = chips.text
          chips.occurrences = chips.inserted.map(function (entry) {
            var occurrence = { offset: text.length, length: entry.clipboardText.length, clipboardText: entry.clipboardText, ref: entry.ref, source: entry.source }
            text += entry.clipboardText + ' '
            return occurrence
          })
          chips.projection = text
        }
        var detectStartOf = function (index) {
          var detect = chips.occurrences[index].offset
          for (var i = 0; i < index; i += 1) detect -= Math.max(0, chips.occurrences[i].length - 1)
          return detect
        }
        extra.sessions = { scope: function (id) { return { id: id } } }
        extra.conversation = { input: { for: function () { return {
          state: { getSnapshot: function () {
            return { draftRev: 42, draft: chips.projection, occurrences: chips.occurrences.slice() }
          } },
          setDraft: function (text) {
            chips.text = text
            chips.inserted = []
            composerInput().textContent = text
            recompute()
            return true
          },
          consumeToken: function (guard) {
            if (guard.kind !== 'span' || guard.span.draftRev !== 42) return false
            for (var i = 0; i < chips.occurrences.length; i += 1) {
              if (detectStartOf(i) !== guard.span.start) continue
              var chipElements = composerInput().querySelectorAll('[data-composer-chip]')
              if (chipElements[i] !== undefined) chipElements[i].remove()
              chips.inserted.splice(i, 1)
              recompute()
              return true
            }
            return false
          },
          insertReference: function (ref, span) {
            chips.inserted.push({ source: ref.source, ref: ref.ref, clipboardText: ref.clipboardText, label: ref.label, span: span })
            var chip = document.createElement('span')
            chip.setAttribute('data-composer-chip', ref.source)
            chip.setAttribute('contenteditable', 'false')
            chip.textContent = ref.label
            composerInput().appendChild(chip)
            recompute()
            return true
          }
        } } } }
        // DSH's submit path (sinkSerialized): every chip's draft slice is replaced
        // by its codec's model form before the prompt is sent.
        chips.serializePrompt = function () {
          var draft = chips.projection
          if (chips.registered === undefined || chips.registered.codec === undefined) return Promise.resolve(draft)
          return Promise.all(chips.occurrences.map(function (occurrence) {
            return Promise.resolve(chips.registered.codec.serialize(occurrence.ref)).then(function (text) {
              return { offset: occurrence.offset, length: occurrence.length, text: text }
            })
          })).then(function (parts) {
            var out = ''
            var cursor = 0
            for (var i = 0; i < parts.length; i += 1) { out += draft.slice(cursor, parts[i].offset) + parts[i].text; cursor = parts[i].offset + parts[i].length }
            return out + draft.slice(cursor)
          })
        }
        extra.inputTriggers = { registerSource: function (source) { chips.registered = source; chips.name = source.name; return function () {} } }
      }

      exports.apply(Object.assign({
        slots: {
          inject: function (name, build) {
            window.__harness.injected = name
            return build()
          },
          register: function (options, component) {
            mountEntry(component, options)
            return function () {}
          },
        },
        effect: function (fn) {
          var dispose = fn()
          if (typeof dispose === 'function') disposers.push(dispose)
          return function () {}
        },
      }, extra))
    },
  }
})()
