# design.md — RE → NFA (Thompson) Simulator · UI Redesign Brief

> Handover document for **Stitch** (screen design) and for the engineer who will port the result into the existing codebase.
> Project: *Automata Theory and Computability* — RE → NFA (Thompson's construction) simulator.
> Repo: `D:\Projects\Automata` · build: single static file `dist/index.html` (≈1.46 MB, no backend).
> Written 10 Nov 2026 against the build with `dist/index.html` = 1,462,130 bytes (Ticket 19: Copy Link, Export SVG, keyboard-help dialog).

---

## 0. How to use this file

**If you are Stitch:** read §1 (what the product is), §3 (design direction), §5 (tokens) and §7 (screens). Every screen in §7 starts with a short *Stitch prompt* you can use as-is; the rest of that screen's section is the detailed spec. §6 defines the components the screens are built from. Design **light and dark** for every screen.

**If you are the engineer:** read §15 (handoff contract) before anything else. The existing UI is vanilla TypeScript + a hand-written `index.html`, with **553 end-to-end assertions** that depend on element ids and `data-testid`s. The redesign is a *re-skin and re-layout* of that DOM, not a rewrite. Stitch's HTML is a visual reference, not code to paste.

**Tags used throughout**

| Tag | Meaning |
|---|---|
| `EXISTING` | The control/feature exists today. Design restyles it; behaviour does not change. |
| `EXISTING+` | Exists today, but the design asks for a richer presentation built from data the engine already returns (CSS/markup only). |
| `NEW-UI` | New visual element needing small UI code, no engine change. |
| `NEW-ENG` | Needs real interaction or engine work. Design it, but it can ship later. |

**Priorities:** **P0** = required for the redesign to count as done · **P1** = high value, do next · **P2** = nice to have.

---

## 1. Product context

### 1.1 What it is
A browser app that turns a regular expression into an ε-NFA using Thompson's construction, **one operator at a time**, draws every intermediate fragment and the final automaton, simulates input strings with ε-closure traces, and **validates its own output** (structural invariants, a 24-case suite, differential testing against 3 independent matchers, and a backtracking-vs-NFA stress test).

It is a course deliverable (Automata Theory and Computability, evaluation window 2–6 Nov 2026 for M1; the simulator build continues after). It is opened from a link by evaluators, so it must be **zero-install, instantly legible, and correct-looking on first load**.

### 1.2 Users and their jobs

| User | Job to be done | What they need to see first |
|---|---|---|
| **Student** learning Thompson's construction | "Show me how `(a\|b)*a` becomes an NFA, one rule at a time." | The diagram growing step by step, the rule being applied, what was *added* at this step. |
| **Evaluator** (examiner) | "Is this correct? Does it do more than existing tools?" | Final NFA + size stats, a worked trace, green validation evidence, the stress-test chart. |
| **Presenter** (the author, live demo) | Walk through the example without fumbling. | Presets, big readable diagram, keyboard stepping, a stable layout that does not jump. |
| **Tinkerer** | Try odd expressions (`a**`, `(a+ε)b`, errors). | Clear syntax errors with the exact position; both notations; both concatenation modes. |

### 1.3 The five things the UI must make obvious
1. **What did I type and how was it parsed?** (tokens → postfix → parse tree)
2. **What happened at this step?** (rule, operands, new states/edges highlighted)
3. **What is the final machine?** (diagram + transition table + counts)
4. **Does it accept this string, and why?** (state set after each symbol)
5. **Can I trust it?** (validation evidence)

### 1.4 Hard product constraints (design within these)
- Static single file; **no network at runtime** (no CDN fonts, no remote images, no analytics). Fonts/icons must be embedded or system.
- Diagrams are rendered by **Viz.js (Graphviz → SVG)**; layout is Graphviz's. Design the *frame and styling* around it; do not assume hand-placed nodes.
- Works from `file://` and from a static host.
- Engine is deterministic and returns plain data; UI only renders it.
- Caps (verified in the running build): Diagram stepping works up to **400** postfix tokens. Above **400** tokens the diagram is disabled entirely; table, simulation and tests still work, and **Export SVG** is disabled (§9).

---

## 2. Current UI audit (what exists today)

*Evidence: the built `dist/index.html` was run in headless Chromium at 1440×900 and 390×844; states captured: empty, built (stepping, flat/textbook/final), simulation, syntax error, deep link with ignored params, shortcuts dialog, validation (suite + differential), stress (complete), mobile. The Playwright connector was not exposed as a tool in the authoring session, so this was done with a standalone headless browser against the same build.*

### 2.1 What it looks like
A **single unstyled column** on browser defaults (system font, 16px, default grey buttons and selects). Only a few things have custom CSS: the canvas frame (grey `#fafafa`, 1 px border), validation tables, green/red check rows, and the shortcuts dialog. There is no brand, no colour system, no dark mode, no layout beyond "stack everything".

### 2.2 Page order today (top to bottom)
1. `h1` "RE → NFA (Thompson) Simulator"
2. Controls row: Presets ▾ · regex field · `ε` · `∅` · Notation ▾ · Concatenation ▾ · **Build** · **Copy Link** · "Link copied!" · `?`
3. Link notice line (only for deep links with bad params)
4. Alphabet field + message
5. Error message line
6. Stats line ("States: 14, Transitions: 16")
7. Raw token dump · postfix chips · parse tree
8. Stepper row: `|◀ ◀ Play ▶ ▶|` · "step 4 / 10" · Speed ▾ · View ▾ · Compact labels
9. Step log (numbered list, **all** steps)
10. Layout note (cap/fallback notices)
11. Canvas toolbar: `+ − Fit 100%` · zoom % · Export SVG · hint text
12. **Canvas** (the diagram)
13. Transition table
14. Test-string textarea + Run · run status · verdict list · trace blocks
15. A raw debug string (see A3)
16. Validation panel: invariants → suite → differential → stress (table + chart)

### 2.3 Problems found (ranked)

| # | Problem | Evidence | Fix lives in |
|---|---|---|---|
| **A1** | **The diagram — the whole point of the product — is pushed below the fold.** With a 10-step expression at 1440×900 the canvas starts ≈650 px down; longer expressions push it further because the step log grows unbounded. | Screenshot after building `(a\|b)*abb`: canvas top at y≈650 of 900. On a 390 px phone it starts ≈1,190 px down. | Layout (§4) |
| **A2** | **Debug/raw output is shown to users.** The token list prints `[SYMBOL(a)@1] [UNION@2]…`; the parse tree is a text indent that **collapses onto one line** (`cat cat cat star union sym(a) sym(b)…`) because whitespace isn't preserved. | Observed on every build. | Parse panel (§6.9–6.10) |
| **A3** | **A leftover worker handshake string is visible** under the simulation area: `{"pong":"hello","timestamp":19.099999999998545}`. | Visible on first paint and in every state. `#worker-status`. | Remove/hide (P0) |
| **A4** | **Simulation results are disconnected.** Verdicts are a bare `ACCEPT / REJECT` list; traces are separate blocks below. With 4 strings you cannot tell which verdict belongs to which string without counting. | Run `ba / ab / a / ε`. | Test panel (§6.12) |
| **A5** | **Status and selection styling is ad hoc.** The current postfix chip (blue pill) and current step-log row (pale lavender, bold) are the only selection cues, and they are inline one-offs. Link notices, run-status lines and layout notes render as plain body text: the `warning` class they use has no style in the stylesheet. | Link-notice line in the deep-link screenshot reads like body copy. | Tokens + components |
| **A6** | **Diagram frame problems.** Graphviz's white page rectangle shows as a white box inside the grey canvas; at step 1 the two circles `0` and `1` **overlap** and the `a (new)` label sits on top of them. | Step 1 of any build. | Diagram spec (§8) + engineering ticket |
| **A7** | **Mobile is broken-ish.** Page is wider than the viewport (scroll width 398 px at 390 px), suite table is 437 px wide, and the canvas **cannot be panned or pinch-zoomed by touch** (touch drag is disabled; only the +/−/Fit buttons work). | 390×844 run. | Responsive (§12) |
| **A8** | **Touch targets are small.** Buttons are 28–33 px tall (zoom buttons 32×28). | Measured. Target ≥ 44 px on touch. | Components (§6) |
| **A9** | **Labels missing on controls.** Regex field, Notation, Concatenation and test textarea have only placeholder text or nothing (no `<label>`); `ε`/`∅` buttons are named only by their bare glyph (the "Insert ε" `title` is a hover tooltip, invisible on touch); the preset's helpful `description` strings exist in data but are never shown. | `index.html`. | A11y (§13) |
| **A10** | **Stress chart legend overlaps its title**; chart is a fixed ≈760 px centred block; panel B plots near-zero timings so noise reads as a jagged trend, with no note explaining it. | Stress screenshot. | Charts (§6.16) |
| **A11** | **Inconsistent wording/casing.** Oracle results mix `PASS` and `pass`; headings mix "&" and words; status strings have no icons. | Differential results. | Microcopy (§10) |
| **A12** | **No loading or progress treatment was observed** for diagram rendering or for the differential run (plain status text only). | Captured states. | States (§9) |

### 2.4 What already works well (keep)
- The **semantic diagram language** is right: start = black dot + arrow, accept = double circle, ε-edges dashed, **new elements red**, **active states blue**.
- Pan/zoom model (Ctrl+wheel zoom, Shift+wheel / drag pan, `+ − 0 f`, Shift+arrows) with keyboard parity.
- Deep links (`?regex=…&notation=…`), Copy Link, graceful "Ignored link parameters" notice.
- Error messages carry **position and reason**, and the input selects the offending character.
- Honest validation: PASS/FAIL with explanations, a timed oracle, a stress test that really times out.
- Live region announcements for stepping and verdicts.

---
## 3. Design direction

### 3.1 Concept: "the drafting table"
This is a **teaching instrument**, not a dashboard. The feel is a well-kept engineer's drafting table: calm warm-paper surfaces, graphite text, thin precise lines, one confident ink-blue for action, and a single warm vermilion that means *"this was just added"*. The diagram is the sheet of paper; everything else is the instrument around it.

Why this and not a generic SaaS look: the product's content is **lines, circles and set notation**. A restrained, typographically careful interface lets the figures carry the weight, matches textbook figures (serif headings, mono for sets), and avoids the purple-gradient/rounded-card look every AI-built tool shares.

### 3.2 Principles (use these to settle any ambiguity)
1. **The diagram is the hero.** At 1440×900 the canvas must be fully visible without scrolling and take ≥ 45 % of the workbench area. Nothing above it may grow with content.
2. **Show the delta.** At every construction step, make *what changed* unmistakable: vermilion on canvas, a "+2 states · +4 transitions" chip in the log, the rule name in words.
3. **One colour, one meaning.** Blue = *current / active / selected*. Vermilion = *new at this step*. Green/red/amber/grey = validation status only. Never reuse a colour for a second meaning.
4. **Never colour alone.** Every status pairs colour with an icon **and** a word (`PASS ✓`, `FAIL ✕`, `TIMEOUT ⏱`). The diagram pairs colour with stroke weight/dash and the `(new)` label.
5. **Errors are specific and local.** The message names the position and reason, appears next to the input, and the offending character is marked.
6. **Evidence is first-class.** Validation is a designed section of the product, not a developer console below the fold.
7. **Stable layout.** Controls do not move when state changes. Reserve space for messages; use skeletons, not reflow.
8. **Keyboard-complete.** Anything doable with a mouse is doable with a keyboard, with a visible focus ring.

### 3.3 Tone
Plain, precise, a little warm. Labels say what they do ("Build NFA"), explanations use the course vocabulary (ε-closure, fragment, accept state). No exclamation marks except the existing "Link copied!". No jokes, no emojis.

---

## 4. Information architecture and layout

### 4.1 Sitemap (single page, three regions)

```
App bar  (brand · section nav · Copy link · Shortcuts · Theme)
│
├─ 1. WORKBENCH   ← fills the first viewport
│     Input strip (expression + settings + stats)
│     ├─ Left rail   "Parse"       parse tree · postfix text · raw tokens
│     ├─ Centre      "Construction" stepper bar + postfix timeline · CANVAS · Test dock
│     └─ Right rail  "Inspector"   Steps panel over Transition-table panel
│
├─ 2. VALIDATION  ← scroll target "#validation-panel"
│     Summary strip · Invariants · Built-in suite · Differential testing
│
└─ 3. STRESS TEST ← scroll target "#stress-section"
      Controls · live table · chart
```

**Decision D-IA-1 (default):** Validation and Stress are **sections further down the same page**, reached by the app-bar nav (smooth-scroll with scroll-spy), *not* separate tabs/routes. Reason: the e2e suite asserts on elements inside `#validation-panel`; hiding them in inactive tabs would break visibility checks, and evaluators like one scrollable page. If tabs are preferred later, the e2e suite must be updated.

### 4.2 App bar (56 px, sticky)
| Slot | Content | Tag |
|---|---|---|
| Left | Logo mark (28 px, §14) + **h1** "RE → NFA (Thompson) Simulator" (display serif 20/24; the arrow in primary colour). Subtitle "Thompson's construction, one operator at a time" (muted, hidden < 1100 px). | `EXISTING+` |
| Centre | Section nav: **Workbench · Validation · Stress test** (text links, underline-on-current, scroll-spy) | `NEW-UI` |
| Right | `Copy Link` (secondary button with link icon) + transient status chip "Link copied!" · `?` icon button (Keyboard shortcuts) · Theme menu (System / Light / Dark) | `EXISTING` + `NEW-UI` (theme) |

The h1 must remain a real `<h1>` with the same text.

### 4.3 Input strip (sticky under the app bar when viewport height ≥ 760 px)
Two rows inside one surface (`--bg-surface`, bottom border).

**Row 1 — expression**
`[Preset ▾] [ regex field………………………… ε ∅ ] [ Build ]`
- Preset: styled native `<select>`, 220 px, shows the preset name; the menu (or an adjacent hint) must show each preset's **description** (see Appendix B). `EXISTING+`
- Regex field: flex-1, **mono 18/28**, 48 px tall, `spellcheck=false`, `autocomplete=off`, `autocapitalize=off`, placeholder "Enter regular expression…". Inside its right edge: two 32 px ghost buttons `ε` and `∅` (with visible tooltips "Insert ε" / "Insert ∅" and accessible names "Insert epsilon", "Insert empty set"). `EXISTING`
- **Build** — the only filled primary button on the whole page, 48 px tall. `Enter` in the field also builds. `EXISTING`

**Row 2 — settings and facts** (40 px)
`Notation [Standard (| is union) ▾]  Concatenation [ε-link ▾]  Alphabet [ a, b ]   ………   10 states · 12 transitions`
- Each select gets a **visible label** above-left (13 px muted caps) or inline prefix. Options and values unchanged. `EXISTING+`
- Alphabet: text input with visible label, placeholder "Inferred alphabet", message line below it reserved (no layout jump). `EXISTING`
- Stats: two number chips ("10 states", "12 transitions") right-aligned, tabular figures. Text content must still read `States: 10, Transitions: 12` for `#stats` (see §15). `EXISTING+`

**Message line (reserved 24 px, below Row 2):** shows, in priority order, the syntax error, the link notice, or nothing. See §9.

### 4.4 Workbench grid (≥ 1280 px)

```
┌ Left rail 280–300 ┐ ┌──────────── Centre (flex) ──────────────┐ ┌ Right rail 320–360 ┐
│ PARSE             │ │ Stepper bar (56)                        │ │ STEPS              │
│  Parse tree       │ │ Postfix timeline (chips, 40)            │ │                    │
│  Postfix (text)   │ │ ┌─────────────────────────────────────┐ │ │  Step log          │
│  ▸ Raw tokens     │ │ │ CANVAS (hero)                       │ │ │  (scrolls inside)  │
│                   │ │ │ overlays: view chip, zoom, export   │ │ │ TRANSITION TABLE   │
│                   │ │ └─────────────────────────────────────┘ │ │ (scrolls inside)   │
│                   │ │ TEST DOCK  (collapsible, 200–260)       │ │                    │
└───────────────────┘ └─────────────────────────────────────────┘ └────────────────────┘
```
- The workbench height is `calc(100dvh − app bar − input strip)` with a **minimum of 620 px**; rails and the log **scroll inside themselves**, never the page.
- Gaps 16 px; panels are `--bg-surface` with 1 px `--border`, radius 10.
- Rails collapse to a 40 px icon strip via a chevron (state not persisted). `P2`

### 4.5 Breakpoints

| Name | Width | Layout |
|---|---|---|
| **xl** | ≥ 1280 | Three columns as above. |
| **lg** | 1024–1279 | Two columns: Centre + Inspector. The Parse rail collapses into a **"Parse" disclosure** above the stepper (the tree opens inline; the postfix timeline is unchanged). |
| **md** | 768–1023 | Single column: input → stepper → canvas → **tabs** (Steps · Table · Parse · Test). |
| **sm** | < 768 | Mobile layout (§12): compact app bar, input card, canvas with docked stepper, bottom tab bar, validation as accordions. |

### 4.6 Vertical budget check (1440×900, xl)
App bar 56 + input strip ≈ 132 = 188 → workbench ≈ 712. Centre column: stepper bar + timeline ≈ 96 + canvas ≈ 376 + test dock ≈ 240. The canvas is never smaller than 360 px high. At 1366×768: test dock collapses to its 48 px header by default.

---

## 5. Design tokens

All values are CSS custom properties on `:root`; dark values under `:root[data-theme="dark"]` and, when the user choice is System, under `@media (prefers-color-scheme: dark)`. Declare `color-scheme: light dark`. Add `<meta name="theme-color">` per theme.

### 5.1 Colour — three tiers
**Tier 1 Primary** (actions, focus, *current/selected/active*): ink blue.
**Tier 2 Neutrals** (surfaces, text, borders): warm graphite/paper (hue ≈ 40°), never pure grey.
**Tier 3 Supporting** (meaning): *new* vermilion; status green / red / amber / grey.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg-page` | `#F7F5F0` | `#14130F` | Page background |
| `--bg-surface` | `#FFFFFF` | `#1D1B16` | Panels, inputs, cards |
| `--bg-sunken` | `#F0EDE6` | `#12110D` | Table headers, code wells, tracks |
| `--bg-canvas` | `#FFFFFF` | `#17160F` | Diagram sheet (optional 24 px dot grid `#E7E2D8` / `#2A2820`) |
| `--border` | `#DDD8CC` | `#34312A` | Hairlines, dividers |
| `--border-strong` | `#8F8878` | `#7A7464` | Input borders, control outlines (≥ 3:1) |
| `--text` | `#1F1D18` | `#EEEAE0` | Primary text |
| `--text-muted` | `#5E584D` | `#A7A092` | Secondary text, captions |
| `--text-faint` | `#7A7365` | `#8C8577` | Placeholders, disabled text |
| `--primary` | `#2541B2` | `#9DB0FF` | Primary button, links, focus, current step |
| `--primary-hover` | `#1B3396` | `#B5C3FF` | Hover |
| `--on-primary` | `#FFFFFF` | `#0E1330` | Text on primary |
| `--primary-soft` | `#E8ECFA` | `#232B52` | Selected row/chip background |
| `--new` | `#B8400A` | `#FF9A62` | "New at this step" text/icons |
| `--new-stroke` | `#D9480F` | `#FF9A62` | New nodes/edges in the diagram |
| `--new-soft` | `#FDEBDD` | `#3A2415` | "+2 states" chip background |
| `--active-fill` | `#BBD6FB` | `#1E3A5F` | Active states in the diagram |
| `--active-stroke` | `#1F5F99` | `#7FB4F0` | Active-state outline |
| `--success` / `--success-soft` | `#176B35` / `#E3F3E8` | `#6FD99A` / `#14301F` | PASS, ACCEPT |
| `--fail` / `--fail-soft` | `#A8201A` / `#FBE6E4` | `#FF9E96` / `#3A1714` | FAIL, REJECT mismatch, syntax errors |
| `--warn` / `--warn-soft` | `#7A4F00` / `#FFF1D2` | `#F2C057` / `#352A0F` | Notices, TIMEOUT, dead run, caps |
| `--neutral-soft` | `#ECE8DF` | `#2A2720` | SKIPPED, idle pills |
| `--focus-ring` | `#2541B2` | `#9DB0FF` | 2 px ring, 2 px offset in `--bg-page` |

> **Semantic collision to avoid:** *new* (vermilion, hue ≈ 20°) and *fail* (crimson, hue ≈ 3°) are deliberately different. *New* appears only on the canvas, step log and step badges; *fail* appears only on validation rows, errors and mismatch markers. Each is always accompanied by its icon/word.

**Verified contrast** (WCAG 2.2, computed):

| Pair | Light | Dark |
|---|---|---|
| `--text` on `--bg-page` | 15.5 : 1 | 15.5 : 1 |
| `--text-muted` on `--bg-surface` | 7.1 : 1 | 6.6 : 1 |
| `--text-faint` on `--bg-surface` (placeholder) | 4.7 : 1 | 4.7 : 1 |
| `--on-primary` on `--primary` | 8.5 : 1 | 8.7 : 1 |
| `--primary` on `--primary-soft` | 7.2 : 1 | 6.6 : 1 |
| `--new` on `--bg-surface` / on `--new-soft` | 5.6 : 1 / 4.8 : 1 | 8.2 : 1 / 7.0 : 1 |
| `--success` on `--success-soft` | 5.7 : 1 | 8.2 : 1 |
| `--fail` on `--fail-soft` | 6.1 : 1 | 8.1 : 1 |
| `--warn` on `--warn-soft` | 6.4 : 1 | 8.4 : 1 |
| `--border-strong` on `--bg-surface` (UI ≥ 3:1) | 3.5 : 1 | 3.7 : 1 |
| `--active-stroke` on `--bg-canvas` (graphics ≥ 3:1) | 6.7 : 1 | 8.4 : 1 |
| `--new-stroke` on `--bg-canvas` (graphics ≥ 3:1) | 4.3 : 1 | 8.7 : 1 |

### 5.2 Typography
**Families** (all must be embedded as subsetted WOFF2 or fall back to system; no CDN):
- **Display:** *Source Serif 4* (600) — app title, section titles, empty-state headings.
- **UI/body:** *IBM Plex Sans* (400, 500, 600).
- **Data:** *IBM Plex Mono* (400, 500) — regex, state sets, token chips, tables of numbers.

Fallback stacks: display `"Source Serif 4", "Iowan Old Style", Georgia, serif`; UI `"IBM Plex Sans", system-ui, "Segoe UI", Roboto, sans-serif`; mono `"IBM Plex Mono", ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace`.
**Glyph requirement:** the subset must cover `ε ∅ → ← ⁿ ∪ ◀ ▶ ✓ ✕ ⏱ … − ·`. If a font lacks one, the fallback stack must (Segoe UI Symbol / Cambria Math / STIX) — verify visually, do not assume.

| Role | Font · weight | Size / line | Notes |
|---|---|---|---|
| App title | Display 600 | 20 / 24 | h1 |
| Section title (h2) | Display 600 | 24 / 30 | "Validation & Oracles", "Stress test" |
| Subsection (h3) | UI 600 | 16 / 24 | "Structural Invariants & Consistency" |
| Body | UI 400 | 16 / 24 | Descriptions, empty states |
| Control label / button | UI 500 | 14 / 20 | |
| Dense data (tables, logs) | UI 400 / Mono 400 | 14 / 20 | `font-variant-numeric: tabular-nums` |
| Caption / helper | UI 400 | 13 / 18 | **Minimum text size is 13 px** (12 px only for `<kbd>`) |
| Regex input | Mono 500 | 18 / 28 | |
| State sets, token chips | Mono 400 | 14 / 20 | `translate="no"` |
| Overline (field labels) | UI 600 | 12 / 16, +0.04em, uppercase | Labels like NOTATION |

Rules: inputs are **16 px minimum on touch** (prevents iOS zoom); headings use `text-wrap: balance`; use real ellipsis `…`, real minus `−`, arrows `→`, and non-breaking spaces in "step 4 / 10", "10 states"; regex, state sets and state ids carry `translate="no"`.

### 5.3 Spacing, shape, elevation
- Spacing scale (4 px base): **4 · 8 · 12 · 16 · 24 · 32 · 48**. Page gutter 24 (desktop) / 16 (mobile). Panel padding 16. Control gap 8.
- Radius: **6** controls and chips · **10** panels and cards · **999** pills and status badges · **0** diagram frame inner.
- Elevation: borders first. Shadows only for floating layers: popover `0 6px 20px rgba(31,29,24,.14)`, dialog `0 12px 40px rgba(31,29,24,.24)`, toast `0 4px 14px rgba(31,29,24,.16)`; dark theme uses a 1 px lighter border instead of shadow.
- Control heights: **36** default desktop · **44** touch (`@media (pointer: coarse)`) · **48** regex field and Build.

### 5.4 Motion
| Token | Value | Used for |
|---|---|---|
| `--dur-fast` | 100 ms | Hover, press |
| `--dur-base` | 160 ms | Panel/disclosure, popover, toast in |
| `--dur-slow` | 240 ms | Step "new element" entrance |
| `--ease` | `cubic-bezier(.2,.8,.2,1)` | All |

- On stepping **forward**, new elements fade/draw in over 240 ms and the step-log row's "+N" chip pulses once. Stepping backward and jumping: no animation.
- `@media (prefers-reduced-motion: reduce)`: all durations → 0; no pulse; no smooth scroll.
- **Animation must never gate the DOM state.** Tests assert immediately after a click; transitions are cosmetic only.
- Only animate `opacity` and `transform`. Never `transition: all`.

### 5.5 Iconography
Inline SVG only (no icon font, no network): 20 px grid, 1.5 px stroke, round caps, `currentColor`, decorative icons `aria-hidden="true"`. Needed set: first, previous, next, last, play, pause, zoom-in, zoom-out, fit, link, download, keyboard, sun, moon, monitor (system), check-circle, x-circle, alert-triangle, clock (timeout), skip, info, chevron-down/right, copy, close, plus a **state-circle glyph** (single and double ring) used in legends. A Lucide-style set is the reference look.

### 5.6 Layers (z-index)
canvas overlays 10 · sticky input strip 20 · app bar 30 · popover/menu 40 · toast 50 · dialog 60.

---
## 6. Component library

Every component below lists **anatomy, states, behaviour that already exists, and accessibility**. All components exist in light and dark.

### 6.1 Buttons
| Variant | Look | Used for |
|---|---|---|
| **Primary** | Filled `--primary`, text `--on-primary`, radius 6, 600 weight | **Build** only (one per screen region). *Run*, *Run Suite*, *Run Differential Test*, *Run Stress Test* are **Secondary-strong** (below) so Build stays the single focal action. |
| **Secondary-strong** | 1 px `--primary` outline, text `--primary`, transparent fill | Run / Run Suite / Run Differential Test / Run Stress Test |
| **Secondary** | 1 px `--border-strong`, `--bg-surface` fill, `--text` | Copy Link, Copy CSV, Export SVG, Fit, 100%, Log scale, Cancel |
| **Ghost** | No border, hover `--bg-sunken` | ε/∅ inserts inside the field, rail chevrons |
| **Icon** | 36 × 36 (44 touch), ghost or secondary, 20 px icon, tooltip + `aria-label` | First/Prev/Next/Last, Play/Pause, zoom ±, `?`, theme |
| **Toggle** | Secondary; when on: `--primary-soft` fill + `--primary` text + check icon; `aria-pressed` | **Log scale**, Compact labels (as switch) |

States for all: default · hover (`--primary-hover` / `--bg-sunken`) · active (scale .98, 100 ms) · **focus-visible** (2 px `--focus-ring`, 2 px offset) · disabled (`--text-faint`, 55 % opacity, `cursor: not-allowed`, **a tooltip says why**, e.g. "Build an expression first") · loading (spinner replaces icon, label stays, `aria-busy`, width unchanged).
Targets ≥ 36 px desktop, ≥ 44 px on coarse pointers. Minimum 8 px between adjacent targets.

### 6.2 Fields
- **Text input / textarea / select:** height 36 (textarea min 96), radius 6, 1 px `--border-strong`, `--bg-surface`; hover darkens border; focus = 2 px `--primary` ring (no layout shift); invalid = `--fail` border + icon + message **below**, `aria-invalid="true"`, `aria-describedby` → message.
- **Every field has a visible label** (overline style, §5.2). Placeholders are examples only and end with `…`.
- **Regex field** (special): mono 18/28, 48 px tall, `ε` `∅` ghost buttons inside the right edge, optional character counter at the far right for long input ("37 / 2000 tokens" appears only above 100 characters). On a syntax error the offending character range is **selected** (existing) *and* drawn with a red wavy underline overlay behind the text (`NEW-UI`).
- **Select:** native `<select>` restyled (chevron icon, same height); **do not replace with a custom listbox** (tests use `selectOption`). Preset menu descriptions: render the selected preset's `description` as a helper line beneath the field row or as a tooltip, and in the OS menu append it after the name where the platform allows.
- **Textarea (test strings):** mono 14/20, label "Test strings", helper "One per line. A blank line tests the empty string ε."

### 6.3 Pills, chips and badges
| Component | Spec |
|---|---|
| **Status pill** | Height 24, radius 999, 13/16 600, icon 14 px + word. Variants: `PASS` (success, ✓), `FAIL` (fail, ✕), `ACCEPT` (success, ✓), `REJECT` (neutral-ink on `--neutral-soft`, ✕ — *reject is a valid outcome, not an error*, so it is not red unless it disagrees with the expected result), `TIMEOUT` (warn, clock), `SKIPPED` (neutral, skip icon), `ERROR` (fail, alert). **Uppercase text always** (fixes the `pass`/`PASS` inconsistency). |
| **Stat chip** | `--bg-sunken`, radius 6, number in mono 600 + unit in muted 13 px: `10 states`, `12 transitions`. |
| **Delta chip** | `--new-soft` bg, `--new` text, mono: `+2 states`, `+4 transitions`; a merge step also shows `−1 state (merged)` in `--warn-soft`. |
| **State chip** | 24 × 24 circle, mono 13, 1 px `--border-strong`; **active** = `--active-fill` + `--active-stroke` ring; **accept** = double ring; **start** = small arrow tail. Used in traces and the transition table so numbers look like the diagram. |
| **Kbd** | `<kbd>` 12/16 mono, 1 px border, 2 px bottom border, radius 4. |

### 6.4 Inline message (alert bar)
One component for link notices, layout notes, run status and errors. 1 px tinted border, tinted fill, 16 px icon, text 14/20, optional trailing action. Variants: **error** (`--fail`, alert icon, `role="alert"`), **warning** (`--warn`, triangle, `role="status"`), **info** (`--primary-soft`, info icon, `role="status"`), **success** (`--success`, check, `role="status"`). Never more than two lines on desktop. Messages **reserve their row** so nothing jumps.

### 6.5 Transient status and toast
- **Inline transient status** (existing): "Link copied!" / "Copied!" appear next to the button that caused them, `role="status"`, success tint, auto-clear after ≈ 2 s. Keep it adjacent (not a global toast) so screen-reader users hear it and sighted users see it where they looked.
- **Toast** (`NEW-UI`, optional): only for failures that happen away from the trigger (e.g. clipboard blocked → "Couldn't copy. Select the link and copy manually."). Bottom-centre, 4 s, dismissible, `role="alert"`.

### 6.6 Stepper bar (above the canvas, 56 px) — `EXISTING+`
```
[|◀] [◀] [ ▶ Play ] [▶] [▶|]   ──●──────────────  step 4 / 10   Speed [1x ▾]  View [Flat ▾]  [☐ Compact labels]
```
- Buttons and ids unchanged. **Play** toggles to **Pause** while playing and shows a pause icon; auto-stops at the last step.
- **Scrubber** (`NEW-UI`): a 6 px track with one tick per step, a primary thumb; keyboard `←/→`; it **drives the same step state** as the buttons (implementation: wrap `input[type=range]` and call the existing step setter). P1.
- **Counter** text: `step 4 / 10` (mono, tabular). At the end of construction and in Final view it reads `Final NFA (14 states, 16 transitions)` — keep this exact wording; widen the slot so it never wraps.
- **Speed** options `0.5x · 1x · 2x`; **View** options `NFA · Final NFA` (native selects, labelled).
- Disabled until an NFA exists; **First/Prev disabled at step 0/1, Next/Last disabled at the end, Play disabled in Final view** (existing). Disabled buttons keep their tooltip explaining why.
- Live region: stepping announces "Step 4 of 10: star of fragment 4→5" (existing `#live-region`).

### 6.7 Canvas frame — `EXISTING+`
The canvas is a focusable region (`tabindex=0`, `role=region`, label "NFA diagram canvas") that holds the Graphviz SVG and handles pan/zoom.

**Frame:** `--bg-canvas`, 1 px `--border`, radius 10, **inner padding 0**, optional 24 px dot grid (6 % opacity) to read as drafting paper. Focus-visible: 2 px `--focus-ring` outside the frame.

**Overlays** (all 36 px controls, translucent surface `--bg-surface` at 92 % + hairline border, 8 px from edges, they never cover the diagram's centre):
| Position | Overlay | Notes |
|---|---|---|
| Top-left | **View chip**: `NFA · step 4 of 10` / `Final NFA` | `NEW-UI`, mirrors the counter |
| Top-right | **Export** group: `Export SVG` (secondary, download icon) | `EXISTING`; disabled until built. SVG disabled with tooltip "Diagram is disabled above 400 postfix tokens" above the cap |
| Bottom-right | **Zoom cluster**: `−` · `90%` · `+` · `Fit` · `100%` | `EXISTING`; the percentage is a read-only mono label |
| Bottom-left | **Legend** toggle (`?` in a circle) → popover (§8.3) | `NEW-UI` |
| Bottom-centre | Hint caption `Ctrl+scroll to zoom · drag or Shift+scroll to pan · Shift+arrows pan` (13 px muted, fades after first interaction, always in the legend) | `EXISTING` text |

**Cursor:** `grab` / `grabbing`. **Hover on a state:** tooltip "State 7 · created at step 6" (`EXISTING` behaviour; restyle as a popover with 8 px offset).
**Loading:** while Viz.js renders, show a centred spinner and the text "Rendering diagram…" over a faint skeleton (three ghost circles); the previous SVG stays visible at 40 % opacity if re-rendering.
**Empty:** §7 S1. **Error:** alert bar inside the frame: "Couldn't draw the diagram. The NFA and table are still correct." + Retry.

### 6.8 Step log (right rail, upper panel) — `EXISTING+`
A vertical list, one row per construction step, scrolls inside its panel, auto-scrolls the current row into view.

Row anatomy (min height 56, padding 12):
```
┌────────────────────────────────────────────┐
│ ④  STAR                       4→5   [+2 st][+4 tr] │   ← rule badge · fragment · delta chips
│    Step 4: star of fragment 4→5             │   ← existing description text, unchanged
└────────────────────────────────────────────┘
```
- Number badge (24 px circle, mono). Rule name in overline caps (`SYMBOL`, `EPSILON`, `EMPTY`, `CONCAT`, `UNION`, `STAR`, `PLUS`, `OPT`) — **derived from `step.rule`**, already in the engine data (`EXISTING+`).
- **Delta chips** from `step.newStates` / `step.newTransitions` counts (`EXISTING+`). Merge-mode concat adds the "merged states 7 and 8 into 7" note in a `--warn-soft` line.
- States: **past** (normal), **current** (`--primary-soft` fill, 3 px `--primary` left bar, text 600, `aria-current="step"`), **future** (60 % opacity, shown but dimmed). Hover: `--bg-sunken`. Click or `Enter`/`Space` jumps to that step.
- The description text content must remain exactly `Step N: …` (tests read it).
- **Fragment stack footer** (`NEW-ENG`, P2): a strip under the list showing the fragment stack after the current step as little boxes `[0→1] [2→3]`, from `step.stackAfter`.

### 6.9 Postfix timeline (above the canvas) — `EXISTING+`
A horizontally scrolling row (40 px) of **chips**, one per postfix token, auto-scrolled so the current chip is centred. This is the construction's timeline; it replaces today's raw chip row.
- Chip: mono 14, height 28, min-width 28, radius 6, 1 px `--border-strong`. Symbols show the character; operators show their word exactly as today (`UNION`, `STAR`, `CONCAT`, `PLUS`, `OPT`) with a small operator glyph before it (`∪ · ∗ · ⋅ · + · ?`). ε and ∅ show the glyphs.
- States: **done** (solid), **current** (`--primary` fill? **no** — `--primary-soft` fill, 2 px `--primary` border, `--primary` text), **upcoming** (dashed border, muted text).
- Click or `Enter` jumps to the chip's step. Hover tooltip: "Step 4 · star". Real `<button>`s in a `role="group"` labelled "Postfix tokens".
- Next to the row: a 13 px muted caption "Postfix form — read left to right; each token is one construction step."

### 6.10 Parse tree (left rail) — `EXISTING+`  *(fixes A2)*
Today's tree is indented text that collapses to one line. Design a **real tree**:
- Nodes are 28 px chips: `cat`, `union`, `star`, `plus`, `opt` (operators, `--bg-sunken`, mono) and `sym(a)`, `eps`, `empty` (leaves, `--bg-surface`, bold glyph). Children are joined with 1 px connector lines (CSS borders/SVG, not box-drawing characters).
- **Linked highlighting:** hovering a node highlights the postfix chip, step-log row and (if built) the fragment's states in the diagram; clicking a node jumps to the step that built it. P1.
- Collapsible subtrees on nodes with children; default fully expanded up to depth 6, deeper levels collapsed with "+N more".
- Keep a hidden-but-present text rendering (`#tree-view` text content: `cat\n  star\n    union…`) for tests: render the visual tree *inside* `#tree-view` and keep the indented text as `sr-only` text, or keep the current text nodes intact.
- Under the tree: **Postfix (text)** in a mono code well with a copy button: `a b | * a .`; and a disclosure **"Raw tokens"** (closed by default) listing `[SYMBOL(a)@1] [UNION@2] …` for debugging. The raw token list is a developer aid and must **not** be visible by default.

### 6.11 Transition table (right rail, lower panel) — `EXISTING+`
- Columns: **State · Symbol · Next state(s)** (as today: one row per state/symbol pair, ε shown as `ε`, states as `q0`, `q6 (start)`, `q9 (accept)`; a state with no outgoing transitions shows `-`).
- Mono 14, tabular figures, sticky header (`--bg-sunken`), 1 px row separators, no vertical grid lines. State cells use **state chips** (start/accept markers visible); next-state lists are comma-separated chips.
- **Active-state highlighting** (`NEW-UI`, P1): when a trace step is selected, rows of states in that active set get `--active-fill` at 35 % and a left bar, linking table ↔ diagram ↔ trace.
- Toolbar above the table: stat chips (`10 states · 12 transitions`) and a **Copy as CSV** secondary button (`NEW-UI`, P2).
- The transition table is semantic `<table>` markup; do not turn it into divs.

### 6.12 Test dock and result cards (centre column, below the canvas) — `EXISTING+`  *(fixes A4)*
**Dock header (48 px):** title "Test strings", result summary ("2 accepted · 2 rejected" or "Not run"), collapse chevron. Collapsed by default below 800 px viewport height.
**Dock body, two columns (≥ 1100 px) or stacked:**
- **Left (min 260 px):** textarea (§6.2) + **Run** (secondary-strong). Prefilled by presets. `Ctrl/⌘+Enter` runs (`NEW-UI`, P2).
- **Right:** one **result card per string**, in input order.

**Result card:**
```
┌───────────────────────────────────────────────────────────┐
│ "ba"                                         [✓ ACCEPT]   │  ← string in mono; ε shown as  ε (empty string)
│ ○ Initial    {0 2 4 6 7 8}                                │  ← state chips; accept state has double ring
│ ● After 'b'  {0 2 3 4 5 7 8}                              │
│ ● After 'a'  {0 1 2 4 5 7 8 9}   ← selected               │  ← accept state 9 present ⇒ ACCEPT
└───────────────────────────────────────────────────────────┘
```
- Each trace row is a **button**. Selecting a row (click / `Enter`) **switches the canvas to the Final NFA view and highlights that active set** in blue (existing behaviour) and marks the row selected (`--primary-soft`, left bar, `aria-pressed`). The first string's *Initial* set is selected automatically after Run (existing).
- Labels stay as today: `Initial`, `After 'b'` (straight quotes in the DOM text, may be typeset with curly quotes only via CSS, not by changing text).
- **Verdict pill** right-aligned: `ACCEPT` / `REJECT`. If a verdict disagrees with an expected value (suite cases only) it uses FAIL.
- **Dead run** (active set becomes empty before the string ends): the trace ends with a status row **"Dead at position 0"** (existing text, `warning` tone, clickable like a trace row). Selecting it shows the longer explanation "Run is dead at position 0: active set is empty." in the dock's status bar (`#run-status`, existing) and clears the blue highlight on the canvas (`data-run-status="dead"`). The verdict stays REJECT.
- **Symbol outside the alphabet:** the trace ends with a status row **"Symbol 'c' at position 2 outside alphabet"** (existing text, `error` tone); the verdict is REJECT.
- Existing markup to keep: each string is a `.trace-line`; rows are `.trace-step` (the selected one also has `.active`) with `data-step` and `data-states`; status rows are `.trace-status` with `.dead`.
- Keep the compact legacy summary available: `#verdict` text (one verdict per line, in order) and `#run-status` messages remain in the DOM (visually integrated as the dock's summary and card messages, not removed).
- Empty (before Run): illustration-free helper "Enter strings and press Run to see the state set after each symbol." Disabled **Run** until an NFA exists.

### 6.13 Check row (Validation → Invariants) — `EXISTING+`
One row per check, 52 px, `--bg-surface`, 1 px border, 4 px left bar in status colour:
`[✓ PASS]  I1 · Distinct start & accept  —  start state (6) and accept state (9) are distinct and valid`
- Order and ids unchanged: I1, I2, I3, I4, Size formula, Step-log replay (`inv-I1 … inv-replay`).
- **Existing text stays**; the row is re-composed as: status pill · code badge (`I1`, `Size`, `Replay` in mono) · name · explanation (muted). Failed rows expand to show the offending state ids.
- Reserve the six rows with skeleton placeholders before any build (no empty gap, §9).

### 6.14 Data tables (suite, stress) — `EXISTING+`
- Container: panel with header toolbar, **sticky `<thead>`**, vertical scroll inside (max-height 360), horizontal scroll inside on narrow widths (never the page), `tabindex=0` on the scroll region with an `aria-label`.
- Rows 40 px, 14/20; zebra off; row hover `--bg-sunken`; numbers right-aligned with tabular figures; text left-aligned.
- **Suite columns** (unchanged): ID · Expression · Notation · Expected · Generated · Verdict. *Expected* and *Generated* are long summaries — render as two lines: `States 10 · Transitions 12` then `accepts [a, ba] · rejects ["", ab]` in muted mono; identical summaries collapse visually, **mismatches show a diff marker** and `--fail-soft` background on the differing cell. Verdict = status pill.
- **Stress columns** (unchanged): n · String length · RegExp time (ms) · NFA time (ms) · RegExp verdict · NFA verdict. Time cells keep the ` ms` suffix. Rows **append live** with the newest scrolled into view; the TIMEOUT row shows `> 8,000 ms (timeout)` with the TIMEOUT pill; later rows show `— (skipped)` + SKIPPED pill.
- A **summary chip** above each table: Suite "24 / 24 pass" (success) or "22 / 24 pass · 2 fail" (fail); Stress "Backtracking timed out at n = 30; NFA handled n = 1,000".

### 6.15 Oracle result row (Differential testing) — `EXISTING+`
One row per oracle, three rows: **Bounded-Language Enumerator**, **Brzozowski Derivatives**, **JS RegExp (Capped Worker)**.
`[✓ PASS] Brzozowski Derivatives — 511 strings` with a one-line muted description of what the oracle is (copy §10.4). Statuses: PASS · FAIL · SKIPPED (e.g. oracle timed out). Above them a **summary bar**: `Differential test completed for k = 8 (511 strings tested): ALL PASSED` (success) or `… 2 MISMATCHES` (fail). Below, when mismatches exist: a table (String · NFA says · Oracle says · Oracle) listing up to 20, else the line `No mismatches found.`

### 6.16 Charts (stress) — `EXISTING+`  *(fixes A10)*
The chart is an SVG generated in code; design its look and layout, engineering adapts the generator.
- **Container:** full panel width, aspect ≈ 2.4 : 1 on desktop, stacks to two charts on mobile.
- **Layout:** *chart title and legend are separate rows* (legend **below** the title, never overlapping). Two panels side by side: **A** "Backtracking vs NFA, n = 12 to 30" and **B** "NFA only, n up to 1,000". Panel titles 14/20 600.
- **Series:** *Backtracking RegExp* = violet (`#8E3B9E` light / `#D9A6E8` dark, 6.4 : 1 and 9.1 : 1 on the canvas), circle markers; *Thompson NFA* = `--primary`, square markers. Red/vermilion are deliberately **not** used (reserved for *fail* and *new*). Violet and blue are close in lightness, so the series also differ by **marker shape**, and each line is **directly labelled at its right end** as well as in the legend. Lines 2 px, markers 6 px.
- **Timeout marker:** a `--warn` dashed horizontal line at 8,000 ms labelled "timeout (8,000 ms)" and an × marker with the word "timeout" on the last point.
- **Axes:** labelled with units ("n (input length)", "time (ms)"), tick labels mono 12 px (min 12 in charts), light gridlines, **log-scale toggle** relabels ticks (1, 10, 100, 1,000, 10,000).
- **Panel B** must not read as noise: plot it on its own y-axis with a faint note "sub-millisecond timings are noisy; the trend is linear". `NEW-UI` caption.
- **Empty:** dashed frame, faint ghost axes, text "Run stress test to see comparison chart" (existing text) + a Run button.
- Chart controls (existing): **Log scale** toggle (`aria-pressed`) and **Export SVG** (disabled until data) in a header toolbar above the chart; **Copy CSV** sits with the table.
- Provide a text alternative: `role="img"` with `aria-label` summarising ("Backtracking time grows from 1 ms at n = 12 to over 8,000 ms at n = 30; NFA time stays under 10 ms up to n = 1,000.") and the table remains the accessible data source.

### 6.17 Dialog (Keyboard shortcuts) — `EXISTING`
Native `<dialog>`. Width 520 (90 % max), radius 12, padding 24, backdrop `rgba(20,19,15,.5)`. Header: "Keyboard Shortcuts" (h2) + close icon button (`✕`, accessible name "Close dialog"). Body: a two-column table (Key · Action) with `<kbd>` keys. Footer: "Esc closes this dialog." Opens with `?`; focus moves to the close button; focus returns to the `?` button on close. Content is exactly the nine rows in §11.1 (plus any new shortcuts).

### 6.18 Tabs, disclosure, accordion
- **Tabs** (used only at **md and below**: Steps · Table · Parse · Test): underline style, `role="tablist"`, arrow-key navigation; inactive panels stay in the DOM (`hidden`), never removed. At **xl/lg** there are **no tabs** in the right rail: *Steps* and *Transition table* are two stacked panels (≈ 60 / 40 split, each scrolling inside itself), so both stay visible and testable.
- **Disclosure** (`<details>`): chevron rotates 90°, summary 44 px touch target.
- **Accordion** (mobile validation): single-open optional, header shows the section's summary status pill.

### 6.19 Section header and summary strip (Validation, Stress)
- Section header: h2 (display serif 24/30) + one-line description (muted) + right-aligned primary action for the section.
- **Validation summary strip** (`NEW-UI`, P1) at the top of the Validation section, four equal cards, each `status pill + label + number`: **Invariants** `6 / 6`, **Suite** `24 / 24` or `Not run`, **Differential** `3 oracles · 511 strings` or `Not run`, **Stress** `n ≤ 1,000` or `Not run`. Clicking a card scrolls to its section. Counts are derived from data the sections already compute.

---
## 7. Screens

Design each screen in **light and dark**, at **1440 × 900** (desktop) unless stated. Sample data below is real output of the engine, so the figures are correct; use it verbatim.

**Screen list (deliver in this order)**

| ID | Screen | Priority |
|---|---|---|
| S0 | Style sheet (tokens + components) | P0 |
| S1 | Workbench — first load / empty | P0 |
| S2 | Workbench — mid-construction (flat view, step 4 of 6) | P0 |
| S3 | Workbench — Final NFA with simulation traces | P0 |
| S4 | Workbench — error states (syntax error, alphabet error, dead run) | P0 |
| S6 | Validation section (all pass) + failure variant | P0 |
| S7 | Stress-test section (running and complete) | P0 |
| S8 | Overlays: preset menu, legend popover, shortcuts dialog, link-copied status | P0 |
| S9 | Mobile 390 × 844: workbench, tabs, validation accordion | P0 |
| S10 | Large-expression notice (stepping disabled) | P1 |

### S0 — Style sheet
> **Stitch prompt:** A one-page style guide for a scientific teaching tool called "RE → NFA Simulator". Warm paper neutrals, ink-blue primary, vermilion for "new", Source Serif 4 headings, IBM Plex Sans UI, IBM Plex Mono for data. Show light and dark side by side: colour tokens with names and hex, type scale, buttons (primary, secondary-strong, secondary, ghost, icon, toggle) in all states, form fields (text, regex field with ε/∅ buttons, select, textarea, error), status pills (PASS FAIL ACCEPT REJECT TIMEOUT SKIPPED ERROR), stat chips, delta chips (+2 states, +4 transitions), state chips (plain, active, accept double-ring, start), postfix token chips (done, current, upcoming), alert bars (error, warning, info, success), a check row, a table row, and a kbd key.

Deliver exactly the tokens in §5 and the components in §6. This sheet is the source of truth for every other screen.

---

### S1 — Workbench, first load (empty)
> **Stitch prompt:** Desktop app screen, light theme. Top app bar with a small logo mark (a circle connected by an arrow to a double circle), the title "RE → NFA (Thompson) Simulator", section links "Workbench · Validation · Stress test" and on the right a "Copy Link" button, a "?" icon button and a theme menu. Below it a sticky input strip: a Presets select, a large monospace regex field with ε and ∅ buttons inside its right edge, and a filled blue "Build" button; second row: Notation select, Concatenation select, Alphabet field, and "0 states · 0 transitions". Main area is a 3-column workbench: narrow left "Parse" rail, large centre drawing canvas that is the hero, right "Steps" and "Transition table" panels. Everything is in a calm empty state with helpful guidance, not blank space.

**Content & states**
- Regex field empty, placeholder "Enter regular expression…". Build **enabled**; pressing it on an empty field shows the app's hint "Enter a regular expression to build its NFA" (§9). Stepper bar and export buttons **disabled** with tooltips.
- **Canvas empty state** (centred in the canvas): a ghost NFA fragment (dashed outline: start arrow → circle → arrow → double circle), heading (display serif 24) **"Draw an NFA from a regular expression"**, body "Type an expression above and press Build, or start from an example." and three **preset quick-chips**: `(a|b)*a` *Worked example* · `(a|b)*abb` *Classic textbook* · `a*b`. Clicking a chip behaves exactly like choosing that preset (fills, builds, fills test strings).
- Left rail: Parse tree panel with the empty caption "The parse tree appears here after you build." Steps panel: "Construction steps appear here, one per symbol or operator." Table: "Transition table appears after the last step."
- Test dock (collapsed to header): "Test strings · Not run".
- Validation/Stress sections are below; at the fold bottom, a faint chevron "Validation & stress tests ↓" links to them.
- **Never** show the stray worker string or the raw token list here.

---

### S2 — Mid-construction (the core screen)
> **Stitch prompt:** Same app shell. The regular expression "(a|b)*a" has been built and the user is on step 4 of 6, the "star" step, in Flat view. The centre canvas shows a left-to-right NFA diagram on white drafting paper: states 0→1 labelled a, 2→3 labelled b, new states 4 and 5 wrapping them as a union with dashed ε edges, and new states 6 and 7 wrapping that as a star, drawn in vermilion with thicker strokes and "(new)" labels. Above the canvas a stepper bar with first/previous/play/next/last buttons, a scrubber, "step 4 / 6", Speed and View selects, and a row of postfix chips "a b | * a ." where "*" is the highlighted current chip. Right rail lists six steps; step 4 is selected and shows "+2 states +4 transitions" chips. Left rail shows a real parse tree: concat → star → union → a, b; and a. Floating zoom controls bottom-right, a view chip top-left "Flat · step 4 of 6", Export SVG top-right, a legend button bottom-left.

**Data**
- Expression `(a|b)*a`, Standard notation, ε-link. Stat chips: today the counts appear once the NFA is built. **Decision:** keep the final counts (`10 states · 12 transitions`) in the input strip, and add `NEW-UI` "so far" counts for the current step (`8 states · 9 transitions so far`) in the step panel header.
- Postfix timeline: `a` `b` `∪ UNION` `∗ STAR` `a` `⋅ CONCAT`; current = STAR (index 4).
- Step log (existing text, new chrome):

| # | Rule | Text | Delta |
|---|---|---|---|
| 1 | SYMBOL | Step 1: symbol 'a' (fragment 0→1) | +2 st · +1 tr |
| 2 | SYMBOL | Step 2: symbol 'b' (fragment 2→3) | +2 st · +1 tr |
| 3 | UNION | Step 3: union of fragments 0→1 and 2→3 | +2 st · +4 tr |
| 4 | STAR | Step 4: star of fragment 4→5 | +2 st · +4 tr |
| 5 | SYMBOL | Step 5: symbol 'a' (fragment 8→9) | +2 st · +1 tr |
| 6 | CONCAT | Step 6: concatenation of fragments 6→7 and 8→9 | +0 st · +1 tr |

- Parse tree: `concat( star( union( sym(a), sym(b) ) ), sym(a) )`.
- Canvas at step 4: states 0–7; **new**: states 6 and 7 and ε-edges 6→4, 5→7, 6→7, 5→4 (vermilion, 2.5 px, labels `ε (new)`); older elements ink.
- The transition table shows the **final** NFA (existing behaviour: it does not change per step). Rows for states not yet created at the current step are dimmed and rows created by the current step carry a `NEW` tag (`NEW-UI`, P2).
- Right-rail **Table** panel can be scrolled; its header shows stat chips for the current step.

**Variant S2b — Play mode:** Play button shows Pause; the scrubber thumb advances; the canvas animates new elements in (240 ms). Reduced-motion: instant.
**Variant S2c — Merge mode:** after changing Concatenation to *Merge*, the step-6 row shows a `--warn-soft` line "merged states 7 and 8 into 7", the delta chip `−1 st (merged)`, and the final counts become 9 states · 11 transitions.

---

### S3 — Final NFA with simulation
> **Stitch prompt:** Same screen after the last step. View is "Final NFA". The canvas shows the finished 10-state NFA for (a|b)*a, left to right, with state 6 as start (arrow) and state 9 as a double-circle accept. The user ran four test strings below the canvas. The test dock shows four result cards: "ba" ACCEPT, "ab" REJECT, "a" ACCEPT, and ε (empty string) REJECT. In the card for "ba" the third trace row "After 'a'" is selected, and on the canvas exactly those states {0,1,2,4,5,7,8,9} are filled light blue with a blue outline. In the transition table the same states have a soft blue left bar. Headline stat chips read "10 states" and "12 transitions".

**Data**
- Counts: **10 states · 12 transitions**; start **q6**, accept **q9**. Final view counter: `Final NFA (10 states, 12 transitions)`.
- Transition table (state · symbol · next): q0 a q1 · q1 ε q5 · q2 b q3 · q3 ε q5 · q4 ε q0, q2 · q5 ε q4, q7 · q6 (start) ε q4, q7 · q7 ε q8 · q8 a q9 · q9 (accept) –.
- Traces:

| String | Initial | After 1st | After 2nd | Verdict |
|---|---|---|---|---|
| `ba` | {0 2 4 6 7 8} | 'b' → {0 2 3 4 5 7 8} | 'a' → {0 1 2 4 5 7 8 9} | **ACCEPT** (9 present) |
| `ab` | {0 2 4 6 7 8} | 'a' → {0 1 2 4 5 7 8 9} | 'b' → {0 2 3 4 5 7 8} | REJECT |
| `a` | {0 2 4 6 7 8} | 'a' → {0 1 2 4 5 7 8 9} | — | **ACCEPT** |
| `ε` | {0 2 4 6 7 8} | — | — | REJECT |

- Verdict summary in dock header: "2 accepted · 2 rejected".
- Selecting a different trace row moves the blue highlight (canvas, table, row). Selecting nothing (Esc) clears it.
- The accept state in a trace row's chip list is drawn with a **double ring** so "contains the accept state" is visible without reading numbers.

---

### S4 — Error states
> **Stitch prompt:** Three stacked variants of the input strip and canvas. (1) The user typed "(a|)": the regex field has a red border, the character at position 2 is underlined with a red wave, and a red alert bar below the strip says "Missing operand after '|' at position 2" with an alert icon; Build stays enabled; the canvas shows its empty state. (2) The Alphabet field holds an invalid entry: the field has a red border and the app's validation message sits under it, the rest of the strip is normal. (3) After running the string "ba" on the NFA for "ab", the "ba" result card ends with an amber status row "Dead at position 0" and a REJECT pill, and the dock's status bar explains "Run is dead at position 0: active set is empty."; another card for "abc" ends with a red status row "Symbol 'c' at position 2 outside alphabet".

**Rules**
- Syntax errors: message text is the engine's text (do not paraphrase); focus returns to the regex field and the offending character is selected (existing). If an NFA was already built, it **stays on screen at 50 % opacity with a banner "Showing the last successful build"** (`NEW-UI`, P1; check what the app does today before implementing) — it must not silently vanish.
- Empty submit: the app's existing hint "Enter a regular expression to build its NFA" (class `hint`), shown as an **info** bar.
- Alphabet messages live under the Alphabet field, `aria-describedby`.
- Dead run is **not an error**: warning tone, and the verdict pill stays REJECT (neutral).

---

### S6 — Validation section
> **Stitch prompt:** The Validation section of the same page, scrolled into view. Section header "Validation & Oracles" with the subtitle "Independent checks that the NFA is built correctly." A summary strip of four cards: Invariants 6/6 pass, Suite 24/24 pass, Differential 3 oracles · 511 strings · all passed, Stress n ≤ 1,000 · NFA linear. Below, three panels: (1) "Structural Invariants & Consistency" with six check rows (I1, I2, I3, I4, Size formula, Step-log replay), each with a green PASS pill, code badge and one-line explanation; (2) "Built-in Suite (24 Cases)" with a Run Suite button, a green "24 / 24 pass" chip and a sticky-header table (ID, Expression, Notation, Expected, Generated, Verdict); (3) "Differential Testing Against 3 Oracles" with a Run Differential Test button, a success bar "Differential test completed for k = 8 (511 strings tested): ALL PASSED", and three oracle rows (Bounded-Language Enumerator, Brzozowski Derivatives, JS RegExp (Capped Worker)) each showing a PASS pill and "511 strings". Also design the failure variant.

**Data (all real)**
- Invariant rows for `(a|b)*a`: I1 *Distinct Start & Accept* — "start state (6) and accept state (9) are distinct and valid"; I2 *No Transition Enters Start* — "no transitions enter start state (6)"; I3 *No Transition Leaves Accept* — "no transitions leave accept state (9)"; I4 *State Degree Constraints* — "every state has either 1 symbol transition (0 ε) or 0 symbol and at most 2 ε-transitions"; *Size Formula* — "10 states and 12 transitions match the Thompson size formula (epsilon-link mode)"; *Step-log Replay* — "step-log replay reproduces final NFA states and transitions exactly".
- Suite table first rows: `single-symbol · a · standard · States: 2, Transitions: 1, accepts: [a], rejects: ["", b] · … · PASS`; `epsilon-symbol · ε`; `empty-symbol · ∅`; `epsilon-alias · @`; `empty-alias · #`; `union-chain · a|b|c`; `nested-operators · ((a|b)*)*`; `stacked-star · a**`; `stacked-plus-opt · a+?`; `textbook-aba · (a|b)*a`; `textbook-abb · (a|b)*abb`; … 24 total.
- Differential: `k = 8`, **511 strings** for a 2-letter alphabet.

**Failure variant (design it; the data is illustrative)**
- One invariant fails: `FAIL · I3 · a transition leaves accept state (9): 9 –ε→ 3` — row expanded, offending ids highlighted in mono.
- Suite chip "23 / 24 pass · 1 fail"; the failing row has `--fail-soft` and a diff marker on the *Generated* cell.
- Differential bar "1 MISMATCH"; one oracle row FAIL; a mismatch table (String · NFA says · Oracle says · Oracle) e.g. `"abb" · ACCEPT · REJECT · Brzozowski Derivatives`.
- Strip card turns `--fail` and says "1 failing check".
- **Not-run / pre-build states:** summary cards say "Build an expression to run checks"; invariant rows show skeleton placeholders; Run buttons say what they need.

---

### S7 — Stress-test section
> **Stitch prompt:** The Stress-test section. Header "Stress Test: Backtracking RegExp vs Thompson NFA" with a one-sentence explainer "Backtracking matchers can take exponential time on pathological patterns; the NFA simulation stays linear." Controls: Family select "(a*)*b on aⁿ", Run Stress Test, Cancel (visible only while running), a muted line "Browser engine: V8 (Chrome 131.0.6778.0)". A status line with progress. A table with live rows. Under it a two-panel line chart: left shows backtracking time exploding to an 8,000 ms timeout at n = 30 while the NFA line stays flat at zero; right shows only the NFA, up to n = 1,000. Legend sits below the title with violet circle markers for Backtracking RegExp and blue squares for Thompson NFA; direct labels on the line ends; timeout drawn as a dashed amber line with an × marker. Buttons: Copy CSV, Log scale toggle, Export SVG. Show two states: running (n = 26) and complete.

**Data (real run)**

| n | RegExp (ms) | NFA (ms) | RegExp | NFA |
|---|---|---|---|---|
| 12 | 1.0 | 0.00 | REJECT | REJECT |
| 14 | 2.3 | 0.10 | REJECT | REJECT |
| 16 | 1.6 | 0.00 | REJECT | REJECT |
| 18 | 34.7 | 0.00 | REJECT | REJECT |
| 20 | 120.1 | 0.10 | REJECT | REJECT |
| 22 | 134.3 | 0.00 | REJECT | REJECT |
| 24 | 267.8 | 0.00 | REJECT | REJECT |
| 26 | 974.0 | 0.00 | REJECT | REJECT |
| 28 | 3745.0 | 0.00 | REJECT | REJECT |
| 30 | > 8,000 (timeout) | 0.00 | TIMEOUT | REJECT |
| 50 | — (skipped) | 0.10 | SKIPPED | REJECT |
| … up to 1,000 | — | ≤ 10 | SKIPPED | REJECT |

- Second family: `(a+)+ on aⁿb`.
- **Running:** status "Testing n = 26…" + indeterminate progress bar, **Cancel** visible, Run disabled ("Another test is running"), the differential **Run** button disabled with the same reason (the two share one worker slot — existing exclusivity). **Cancelling:** "Stress test cancelling…" → "Stress test cancelled." **Complete:** "Stress test complete: NFA completed all inputs up to n = 1,000 in linear time."
- Chart: log-scale variant must be designed (y ticks 1, 10, 100, 1,000, 10,000).

---

### S8 — Overlays
> **Stitch prompt:** Four overlay states on the app shell. (a) The Presets select opened as a menu listing nine items, each with a bold name and a muted one-line description below it, e.g. "(a|b)*abb (Classic textbook)" with "Classic textbook example: 14 states (ε-link) or 11 states (merge)". (b) The canvas legend popover from the bottom-left button, showing six small drawn samples with labels: start state, accept state, symbol transition, ε-transition, new at this step, active in simulation. (c) The "Keyboard Shortcuts" dialog with a two-column table of keys. (d) The Copy Link button just clicked: a small green inline status "Link copied!" next to it, and a link-notice info bar "Ignored link parameters: notation, step".

**Preset list (name — description)** is in Appendix B. **Legend** content: §8.3. **Shortcuts rows:** §11.1.

---

### S9 — Mobile (390 × 844), light and dark
> **Stitch prompt:** Mobile app screens, 390 wide. Screen 1: compact top bar (logo + short title "RE → NFA" + overflow menu holding Copy Link, Shortcuts and Theme), an input card (Presets select full width, regex field 48 px with ε ∅ buttons, a two-column row for Notation and Concatenation, Alphabet, Build full width), then the canvas card 340 px tall with floating zoom buttons and a docked stepper bar (big 44 px buttons: first, previous, play, next, last, with "step 4 / 6"). Below, a horizontally scrolling postfix chip row and a segmented tab bar "Steps · Table · Parse · Test" with the Steps list visible. Screen 2: the Test tab with the textarea, Run, and result cards. Screen 3: the Validation section as accordions with status pills in each header; one open.

**Rules:** see §12.

---

### S10 — Large expression (diagram cap)
> **Stitch prompt:** Workbench for expressions over 400 postfix tokens. The canvas shows a centred, calm message block with an info icon and the text "Diagram is disabled for expressions over 400 postfix tokens (limit: 400). Table, simulation, and tests remain available."; the stepper buttons are disabled with the counter "step 0 / 0", Export SVG is disabled with a tooltip, and the transition table and test dock are fully usable.

**Real behaviour (verified):**
| Postfix tokens | Notice (exact app text) | View select | Stepper | Exports |
|---|---|---|---|---|
| ≤ 400 | none | NFA · Final NFA | normal | SVG |
| > 400 | "Diagram is disabled for expressions over 400 postfix tokens (limit: 400). Table, simulation, and tests remain available." (also fills the canvas) | NFA and Final NFA disabled | disabled, `step 0 / 0` | SVG disabled with tooltip |

Design the notice as the canvas's empty-state card. The transition table, test dock, validation, and stress panels stay fully functional.

---

## 8. Diagram canvas specification

The diagram is Graphviz SVG. The look is controlled by DOT attributes and, for theming, CSS on the inline SVG.

### 8.1 Visual language

| Element | Light | Dark | Notes |
|---|---|---|---|
| **State** | Circle ≈ 40 px, 1.5 px ink stroke, white fill, number label 14 px | Ink `#EEEAE0`, fill `--bg-canvas` | Label is the state id (`0`, `1`…) |
| **Start** | Small filled dot + arrow into the state | same | Dot 6 px |
| **Accept** | **Double circle** (inner ring 3 px gap) | same | Never colour-coded |
| **Symbol transition** | Solid 1.25 px ink, arrowhead, symbol label above | same | |
| **ε-transition** | **Dashed** (4 3), muted ink `#5E584D`, label `ε` | `#A7A092` | Always dashed |
| **New at this step** | Stroke `--new-stroke` 2.5 px, label `--new`, suffix `(new)` kept | `#FF9A62` | Applies to states **and** edges added by the current step only |
| **Active (simulation)** | Fill `--active-fill`, stroke `--active-stroke` 2 px | `#1E3A5F` / `#7FB4F0` | Final NFA view only; never together with *new* |
| **Merged junction** (merge mode) | State with dotted outer ring | same | Tooltip explains |
| **Page background** | **Transparent** (the canvas colour shows) | Transparent | Fixes A6 — Graphviz's white page rect must go (`bgcolor="transparent"`) |

Edge labels sit on small opaque pills (`--bg-canvas`) so crossing lines never strike through text. Label font: the UI sans at 14 px (Graphviz currently uses Helvetica 14; keep metrics-compatible if the font is swapped).

### 8.2 Layout rules (acceptance criteria)
1. **No node overlaps another node at any step** (today at step 1 states 0 and 1 overlap and the `a (new)` label sits on them — a defect, not a styling matter; routed to engineering as "layout minimum distance ≥ 1.2 × node diameter").
2. Edge labels never overlap nodes or other labels.
3. Left-to-right flow; the start state is leftmost, accept rightmost for Final view.
4. Fit-to-canvas on build and on view change; zoom clamps (existing).
5. Diagram text ≥ 12 px at 100 % zoom; at "Fit" below 60 % a banner suggests zooming.

### 8.3 Legend (popover, 280 px)
Six rows, each = a 64 × 28 drawn sample + label + one short sentence:
1. **Start state** — arrow into a state. 2. **Accept state** — double circle. 3. **Symbol transition** — solid arrow with the symbol. 4. **ε-transition** — dashed arrow; moves without reading input. 5. **New at this step** — vermilion, thicker. 6. **Active in simulation** — filled blue; states the NFA could be in after the symbols read so far.
Dismiss with `Esc` or outside click; reachable by keyboard; `aria-label` "Diagram legend".

### 8.4 Interaction (existing + proposed)
| Interaction | Behaviour | Tag |
|---|---|---|
| `Ctrl` + wheel | Zoom about the cursor | `EXISTING` |
| Drag, or `Shift` + wheel | Pan | `EXISTING` (mouse only) |
| `+` / `=` · `−` / `_` · `0` · `f` | Zoom in · out · reset · fit | `EXISTING` |
| `Shift` + arrows | Pan | `EXISTING` |
| Hover state | Tooltip "State 7 · created at step 6" | `EXISTING` (restyle) |
| **Touch drag + pinch** | Pan and zoom the canvas on touch devices | `NEW-ENG` P1 — today touch pan/zoom is disabled and only buttons work |
| Click a state | Select: outline + dim unrelated edges, table row highlights | `NEW-ENG` P2 |
| Double-click | Fit | `NEW-ENG` P2 |

### 8.5 Export
**Export SVG** (existing) downloads the current view. Exported SVG keeps its **own white background and light-theme ink** regardless of app theme (so it pastes into slides). Filenames as today (`nfa-final.svg`, `nfa-step-<k>.svg`). Success: inline status "Exported nfa-final.svg" next to the button (`NEW-UI`).

---
## 9. States catalogue

Every async or conditional surface needs all of these designed. *Copy in quotes is the app's existing wording; unquoted copy is proposed.*

| Surface | Empty / idle | Loading | Success | Error / blocked |
|---|---|---|---|---|
| **Canvas** | Ghost fragment + "Draw an NFA from a regular expression" + preset chips (S1) | Spinner + "Rendering diagram…", old SVG at 40 % | Diagram, fitted | "Couldn't draw the diagram. The NFA and table are still correct." + Retry |
| **Regex field (empty submit)** | — | — | — | "Enter a regular expression to build its NFA" (hint bar) |
| **Stepper bar** | Disabled, tooltips "Build an expression first" | — | Enabled per position | Disabled with `step 0 / 0` when the diagram is disabled (> 400 tokens) |
| **Step log** | "Construction steps appear here, one per symbol or operator." | 3 skeleton rows | Rows with delta chips | — |
| **Parse tree** | "The parse tree appears here after you build." | skeleton | Tree | — |
| **Transition table** | "Transition table appears after the last step." | skeleton rows | Table | — |
| **Test dock** | "Not run" + helper text | Run button spinner | Result cards | Per-card dead-run / out-of-alphabet warnings |
| **Invariants** | 6 skeleton rows "Build an expression to run checks" | — | 6 PASS rows | FAIL row(s) with offending ids |
| **Suite** | "Run Suite" + "24 cases ready" | Progress "Running 7 / 24…" | "24 / 24 pass" | "n / 24 pass · k fail" + diff cells |
| **Differential** | "Please build an expression first." when nothing is built (existing behaviour) | Progress bar + "Comparing against oracles…", Run disabled | "Differential test completed for k = 8 (511 strings tested): ALL PASSED" + "No mismatches found." | Mismatch bar + table (≤ 20 rows) |
| **Stress** | "Run stress test to see comparison chart" | "Testing n = 26…" + Cancel | "Stress test complete: NFA completed all inputs up to n = 1,000 in linear time." | "Stress test cancelling…" → "Stress test cancelled." · TIMEOUT / SKIPPED / ERROR pills in rows |
| **Copy Link / Copy CSV** | — | — | "Link copied!" / "Copied!" (≈ 2 s, `role="status"`) | "Couldn't copy" inline + toast with manual fallback |
| **Export SVG** | Disabled until built | — | Download + "Exported <file>" | SVG disabled above 400 steps with tooltip |
| **Deep link** | — | — | Page loads built | "Ignored link parameters: notation, step" (info/warning bar, dismissible) |

**Cap and fallback notices** (`#layout-note`, style as a `warning` alert bar above the canvas): "Diagram is disabled for expressions over 400 postfix tokens (limit: 400). Table, simulation, and tests remain available." (full table in S10). If the layout of a single step fails, the app also falls back with a note. Never let a notice push the canvas down by more than one 40 px row — reserve the row.

**Disabled-with-reason rule:** a disabled control always has an accessible tooltip (and `aria-describedby`) saying what enables it.

---

## 10. Microcopy

### 10.1 Rules
- Sentence case for buttons and labels except existing proper labels (`Copy Link`, `Run Suite`… keep the app's current capitalisation; they are asserted by tests).
- Use the course vocabulary: **fragment, ε-closure, accept state, start state, active set**. Say "state set" in explanations.
- Errors say *what*, *where*, *why*. Never "Invalid input".
- Numbers: group thousands (`1,000`), ms with one decimal for RegExp and two for NFA (existing), `n = 30`.
- Use the real glyphs `ε`, `∅`, `→`, `ⁿ`, `…`.

### 10.2 Existing strings (do not change; style around them)
| Where | Text |
|---|---|
| Title (h1) | `RE → NFA (Thompson) Simulator` |
| Placeholders | `Enter regular expression` · `Inferred alphabet` · `Enter test strings, one per line` |
| Preset select | `Presets...` (option 0) |
| Notation | `Standard (\| is union)` · `Textbook (+ is union)` |
| Concatenation | `ε-link` · `Merge` |
| Buttons | `Build` · `Copy Link` · `Play` · `Fit` · `100%` · `Export SVG` · `Run` · `Run Suite` · `Run Differential Test` · `Run Stress Test` · `Cancel` · `Copy CSV` · `Log scale` |
| Step counter | `step 4 / 10` · `Final NFA (14 states, 16 transitions)` |
| Stats | `States: 14, Transitions: 16` |
| Step text | `Step 1: symbol 'a' (fragment 0→1)` · `Step 3: union of fragments 0→1 and 2→3` · `Step 4: star of fragment 4→5` · `Step 6: concatenation of fragments 6→7 and 8→9` · merge: `… (merged states 7 and 8 into 7)` |
| Trace | `String: "ba"` · `Initial: {0, 2, 4, 6, 7, 8}` · `After 'b': {…}` |
| Run messages | `Dead at position 0` (trace row) · `Run is dead at position 0: active set is empty.` (status bar) · `Symbol 'c' at position 2 outside alphabet` (trace row) |
| Syntax / empty input | `Missing operand after '\|' at position 2` (pattern: reason + position) · `Enter a regular expression to build its NFA` · `Please build an expression first.` (differential with nothing built) |
| Link | `Link copied!` · `Ignored link parameters: notation, step` |
| Layout notices | `Diagram is disabled for expressions over 400 postfix tokens (limit: 400). Table, simulation, and tests remain available.` |
| Headings | `Validation & Oracles` · `Structural Invariants & Consistency` · `Built-in Suite (24 Cases)` · `Differential Testing Against 3 Oracles` · `Stress Test: Backtracking RegExp vs Thompson NFA` · `Keyboard Shortcuts` |
| Invariant lines | `PASS - I1 (Distinct Start & Accept): Passed: start state (6) and accept state (9) are distinct and valid` (and I2 *No Transition Enters Start*, I3 *No Transition Leaves Accept*, I4 *State Degree Constraints*, *Size Formula*, *Step-log Replay*) |
| Differential | `Differential test completed for k = 8 (511 strings tested): ALL PASSED` · `No mismatches found.` · oracle names |
| Stress | `Browser engine: V8 (Chrome 131.0.6778.0)` · `> 8,000 ms (timeout)` · `— (skipped)` · `Run stress test to see comparison chart` |

> Where the design shows an invariant as *pill + code + name + explanation*, the app must still be able to produce the combined original string for `data-testid` text checks (render the original sentence as the row's text and style its parts with spans, or keep the full string in a visually hidden node).

### 10.3 New copy (proposed)
| Where | Text |
|---|---|
| Canvas empty heading / body | "Draw an NFA from a regular expression" / "Type an expression above and press Build, or start from an example." |
| Disabled tooltips | "Build an expression first" · "Already at the first step" · "Already at the last step" · "Play is unavailable in the Final NFA view" |
| Test dock helper | "One per line. A blank line tests the empty string ε." |
| Test dock empty | "Enter strings and press Run to see the state set after each symbol." |
| Legend sentences | §8.3 |
| Stress explainer | "Backtracking matchers can take exponential time on pathological patterns; the NFA simulation stays linear." |
| Chart B note | "Sub-millisecond timings are noisy; the trend is linear." |
| Last-build banner | "Showing the last successful build" |
| Accessible chart summary | "Backtracking time grows from 1 ms at n = 12 to over 8,000 ms at n = 30; NFA time stays under 10 ms up to n = 1,000." |

### 10.4 Oracle descriptions (one line each, muted)
- **Bounded-Language Enumerator** — checks every string up to length k against the language definition.
- **Brzozowski Derivatives** — an independent matcher that never builds an automaton.
- **JS RegExp (Capped Worker)** — the browser's own engine, run in a time-limited worker.

(Descriptions are summaries of the project's own M1 design document; the engineer should confirm wording against the code.)

---

## 11. Interaction and motion

### 11.1 Keyboard map (exactly the shortcuts dialog today)
| Key | Action |
|---|---|
| `Enter` (in regex field) | Build NFA from regex |
| `←` / `→` | Step backward / forward through construction (ignored while typing in a field, and with any modifier) |
| `+` or `=` | Zoom in canvas |
| `-` or `_` | Zoom out canvas |
| `0` | Reset canvas zoom and pan |
| `f` | Fit diagram to canvas viewport |
| `Shift` + `←` `→` `↑` `↓` | Pan canvas |
| `?` | Open keyboard shortcuts |
| `Esc` | Close keyboard shortcuts |

The canvas-specific keys apply when the canvas has focus. **Proposed additions** (`NEW-UI`, P2, add to the dialog): `Home` / `End` first / last step · `Space` play/pause when the stepper has focus · `Ctrl/⌘ + Enter` Run in the test textarea · `g` then `v` jump to Validation.

### 11.2 Focus order
App bar → input strip (preset, regex, ε, ∅, Build; notation, concatenation, alphabet) → stepper bar → postfix timeline → canvas → canvas overlays → step log → transition table → test dock → validation → stress. Skip links at the top: "Skip to diagram", "Skip to validation".

### 11.3 Motion inventory
| Moment | Motion | Duration |
|---|---|---|
| Step forward | New nodes/edges fade+scale 0.96→1; log row delta chips pulse once | 240 ms |
| Step back / jump | none | — |
| Play | Auto-advance at 1500 / 750 / 300 ms per step (existing speeds) | — |
| Panel open/close | height + opacity | 160 ms |
| Popover / toast | opacity + 4 px translate | 160 ms |
| Status pill change | cross-fade | 100 ms |
| Button press | scale .98 | 100 ms |
| Scroll-spy nav | underline slides | 160 ms |

Reduced motion: all of the above become instant, Play still works. No parallax, no looping animation, no skeleton shimmer (use static skeleton blocks).

---

## 12. Responsive and touch

### 12.1 Mobile layout (< 768 px)
1. **App bar (52 px):** logo + "RE → NFA" (full title stays in `<title>` and as the `h1`, visually shortened), overflow menu `⋯` containing Copy Link, Keyboard shortcuts, Theme.
2. **Input card:** Presets (full width) · regex field (48 px, ε ∅ inside) · Notation + Concatenation in two columns · Alphabet · **Build** full width, 48 px. Error/notice bars full width below.
3. **Canvas card:** height `clamp(320px, 52dvh, 520px)`; **stepper docked directly under the canvas** (not floating): five 44 px buttons + `step 4 / 6`; Speed/View/Compact in a second row. Zoom `− + Fit` as floating 44 px buttons bottom-right.
4. **Postfix timeline** (scrolls horizontally, momentum scrolling, current chip centred).
5. **Tab bar** (segmented, 44 px): **Steps · Table · Parse · Test**. Panels keep their DOM.
6. **Validation / Stress:** accordions, header = title + status pill; open one at a time.
7. Safe areas: `viewport-fit=cover` and `env(safe-area-inset-*)` padding on the app bar and last section.

### 12.2 Tablet (768–1023)
Single column; canvas first after the input card; tabs below the canvas; Test dock below tabs; validation as full-width sections.

### 12.3 Tables on small screens
- **Suite:** below 600 px render each case as a card (ID + expression + verdict pill; "Expected / Generated" in an expandable area). `NEW-UI`, P1.
- **Stress:** horizontal scroll *inside* the table container, first column sticky, no page-level horizontal scroll at 320 px.
- **Transition table:** fits in the panel; long next-state lists wrap.

### 12.4 Touch
- All controls ≥ 44 × 44 under `@media (pointer: coarse)`; `touch-action: manipulation` on controls (removes the 300 ms tap delay and double-tap zoom).
- **Canvas gestures** (`NEW-ENG`, P1): one-finger drag pans, two-finger pinch zooms about the pinch centre, double-tap fits. Keep `touch-action: none` on the canvas only.
- Hover-only information (state tooltips, chip tooltips) has a **tap** equivalent: tapping a state shows the same popover; tapping a chip jumps to its step.
- No reliance on right-click or `Shift`.

### 12.5 Large screens
At ≥ 1920 px the centre column grows (rails stay fixed width); max content width 2200 px, centred. The canvas keeps ≥ 45 % of the workbench area.

---

## 13. Accessibility

**Standard:** WCAG 2.2 AA, plus the Web Interface Guidelines rules summarised below.

### 13.1 Structure
- Landmarks: `<header>` (banner) · `<nav aria-label="Sections">` · `<main>` containing named regions: *Expression*, *Diagram* (the existing canvas region), *Steps*, *Transition table*, *Test strings*, *Validation*, *Stress test* (`aria-labelledby` their headings).
- Headings: one `h1` (title); `h2` per region (small visual size is fine); existing `h3`s inside Validation stay. No skipped levels.
- Existing live region `#live-region` (`aria-live="polite"`) keeps announcing steps and verdicts; add announcements for: build complete ("Built NFA with 10 states and 12 transitions"), suite/differential/stress completion, theme change.

### 13.2 Controls
- Every field has a **visible `<label>`**; icon-only buttons have `aria-label` (First step, Previous step, Play / Pause, Next step, Last step, Zoom in, Zoom out, Insert epsilon, Insert empty set, Keyboard shortcuts, Close dialog, Theme).
- Anything clickable is a real `<button>` or `<a>`: postfix chips, step-log rows, trace rows, tree nodes, preset quick-chips. Selected state via `aria-current="step"` / `aria-pressed`. Navigation uses `<a href="#…">`.
- `aria-busy` on running buttons; disabled buttons keep tooltips.
- Native `<dialog>`: focus moves in, traps, returns to the opener.
- Toggle buttons use `aria-pressed` (existing on Log scale).

### 13.3 Perception
- Contrast: text ≥ 4.5 : 1, large text and UI/graphics ≥ 3 : 1 (verified values in §5.1).
- **Colour is never the only signal:** pills have icon + word; diagram new = thicker + `(new)` label; active = fill **and** ring weight; charts = marker shape + direct labels.
- Visible focus ring everywhere (2 px, 2 px offset), never `outline: none` without a replacement.
- Support `prefers-reduced-motion`, `prefers-contrast: more` (borders → `--text` at 60 %), and `forced-colors` (rely on borders and system colours; keep icons).
- Text can be 200 % zoomed and 320 px wide without loss (no truncation of verdicts; wrap instead).
- `translate="no"` on regex, state sets, state ids, token chips.

### 13.4 Web Interface Guidelines applied
Inputs have `autocomplete`, correct `type`, `spellcheck="false"` on code-like fields; no paste blocking; placeholders end with `…`; errors are inline next to the field and focus moves to the first error (existing for syntax errors); `overscroll-behavior: contain` on the dialog and inner scroll panels; `scroll-margin-top` on section anchors (sticky header); no `transition: all`; `tabular-nums` on number columns; `text-wrap: balance` on headings; non-breaking spaces in "step 4 / 10"; `color-scheme` + `<meta name="theme-color">`; **native `<select>` and `<option>` get explicit `background-color`/`color`** (Windows dark mode); long lists (suite 24, stress ~20, step log ≤ 150) do not need virtualisation, but the step log must scroll *inside* its panel; URL reflects shareable state (Copy Link — existing; auto-sync is a later item).

---

## 14. Asset briefs

*Format follows the design-assets brief. No assets were generated for this document: the image-generation connector (Recraft) was not available in this session. These briefs are ready to run, and the logo mark is simple enough to hand-draw from the geometry below.*

### 14.1 Logo mark (28 px in app bar; also the favicon source)
- **Subject:** an NFA fragment: a start circle, an arrow, and an accept (double) circle — "a machine reading a symbol".
- **Style:** flat, geometric, stroke-only (2 px at 32 px), round caps, no gradients, no text.
- **Palette:** ink `#1F1D18` strokes with the arrow in `--primary` `#2541B2`; dark variant ink `#EEEAE0` and arrow `#9DB0FF`.
- **Background:** transparent.
- **Output:** SVG, `viewBox="0 0 32 32"`.
- **Geometry (hand-draw spec):** circle r = 5 at (7, 16); arrow from x = 13 to x = 19 at y = 16 with a 4 px head; outer circle r = 6 at (25, 16) and inner circle r = 3.5 at (25, 16).
- **Variants:** mark only · mark + wordmark "RE → NFA" (Source Serif 4, 600).

### 14.2 Favicon
- **Subject:** the same mark, simplified (drop the inner ring below 24 px if illegible).
- **Output:** SVG favicon (inline `data:` URI in `index.html`, since the app is a single file) + 32 × 32 PNG fallback; **Size:** 16, 32, 180 (Apple touch).
- **Variants:** light and dark (`prefers-color-scheme` via the SVG's own `<style>`).

### 14.3 Canvas empty-state illustration
- **Subject:** a ghost NFA fragment (start arrow → circle → arrow → double circle) drawn with a **dashed** outline, as if waiting to be drawn.
- **Style:** same line language as the diagram; 1.5 px dashes in `--border-strong`; no fill.
- **Palette:** `--border-strong` only, one `--primary` arrow tip.
- **Background:** transparent. **Output:** inline SVG, 280 × 120 viewBox. **Variants:** light/dark via `currentColor`.

### 14.4 Social/link preview (optional, P2)
1200 × 630 PNG: the logo, the title, and a small rendering of the `(a|b)*a` NFA on drafting paper. Used only if the page is ever hosted with meta tags.

### 14.5 Icon set
Inline SVG, Lucide-style (20 px grid, 1.5 px stroke) for the list in §5.5; no icon font; no network.

---

## 15. Implementation handoff contract

### 15.1 Non-negotiables
1. **Keep every element `id` and `data-testid`** in `index.html` and in the DOM that `src/ui/main.ts` generates. The e2e suite (553 assertions at the last evidence round) selects by them. Moving, wrapping and restyling elements is fine; renaming or removing is not.
2. **Keep text content that tests read** (see §10.2). When the design shows a richer rendering, wrap parts in `<span>`s so `textContent` is unchanged, or keep the original string in a visually hidden node.
3. **`src/engine` stays untouched.** The project already guards this (no diff against the agreed baseline commit). Every data point this document asks for (rule name, new states/transitions, operands, merged pair, fragment stack, trace sets) is already in the engine's return values.
4. **Native form controls stay native** (`<select>`, `<textarea>`, `<input>`), restyled with CSS, because tests drive them with `selectOption`/`fill`.
5. **Single static file, no runtime network.** The build inlines everything into `dist/index.html`; fonts (subset WOFF2, ≤ 150 KB total), icons and images must be embedded.
6. **No animation gates state.** DOM state and `data-*` attributes are set synchronously; transitions are cosmetic.
7. **No new framework.** Vanilla TypeScript + CSS custom properties. CSS can move from the inline `<style>` to a `src/ui/*.css` file imported by `main.ts` if the build inlines it.

### 15.2 Hook table (all exist today)

| Area | Hooks |
|---|---|
| Shell | `#app` · `#live-region` |
| Input | `#preset-select` · `#regex-input` · `#insert-eps` · `#insert-empty` · `#notation-select` · `#concat-select` · `#build-button` · `#copy-link-btn` · `#copy-link-status` · `#keyboard-help-btn` · `#link-notice` · `#alphabet-input` · `#alphabet-message` · `#error-message` · `#stats` |
| Parse | `#token-list` · `#postfix-view` · `#tree-view` |
| Stepper | `#stepper-controls` · `#step-first` · `#step-prev` · `#step-play` · `#step-next` · `#step-last` · `#step-counter` · `#step-speed` · `#view-toggle` · `#compact-labels` · `#step-log` · `#layout-note` |
| Canvas | `#canvas-toolbar` · `#zoom-in-btn` · `#zoom-out-btn` · `#zoom-fit-btn` · `#zoom-reset-btn` · `#zoom-level` · `#export-svg-btn` · `#canvas-hint` · `#canvas` · `#canvas-viewport` · `#transition-table` |
| Simulation | `#test-input` · `#run-button` · `#run-status` · `#verdict` · `#trace` · `#worker-status` (**remove the debug text; element may be kept empty / hidden**) |
| Validation | `#validation-panel` · `#invariants-section` · `#inv-I1` `#inv-I2` `#inv-I3` `#inv-I4` `#inv-size` `#inv-replay` · `#suite-section` · `#run-suite` · `#suite-table` · `#differential-section` · `#diff-run` · `#diff-status` · `#diff-results` |
| Stress | `#stress-section` · `#stress-family` · `#stress-run` · `#stress-cancel` · `#stress-browser-info` · `#stress-status` · `#stress-table` · `#stress-copy-csv` · `#stress-copy-status` · `#stress-scale-toggle` · `#stress-export-svg` · `#stress-chart-container` (`data-scale="linear|log"`) |
| Dialog | `#keyboard-help-dialog` · `#keyboard-help-close` · `#keyboard-help-table` |
| Data attributes the app sets | `data-run-status` on the canvas (e.g. `dead`) and others added by `main.ts` — grep `dataset` / `setAttribute('data-` before changing |

### 15.3 Theme implementation
- Tokens in §5.1 on `:root`; `[data-theme="light"|"dark"]` on `<html>`; "System" = no attribute + `@media (prefers-color-scheme: dark)`.
- A tiny inline `<script>` in `<head>` reads the saved choice (`localStorage`, wrapped in `try/catch`; falls back to System) and sets the attribute **before first paint** to avoid a flash.
- Theme menu is a native `<select>` or a three-button radio group; announce changes through `#live-region`.

### 15.4 Diagram theming (engineering notes)
- Graphviz writes colours as **inline presentation attributes** (`stroke="black"`, `fill="white"`). Presentation attributes lose to any CSS rule, so on-screen theming can be done with CSS targeting `.node` / `.edge` groups (Graphviz emits `class="node"` / `class="edge"` on each `<g>`; add DOT `class=` attributes such as `new` and `active` to hang rules on).
- Set `bgcolor="transparent"` so the canvas colour shows (fixes the white page rectangle).
- **Exports must stay light and self-contained:** export from the cached SVG strings as today, not from the themed DOM.
- The diagram unit tests (39 at the last round) assert on DOT/labels (including the `(new)` suffix). Changing label text (e.g. replacing `(new)` with an HTML-like "NEW" tag) needs those tests updated; keep the suffix for now.

### 15.5 Where each change lands
| Change | Where |
|---|---|
| Tokens, base, layout grid, components, dark theme | `index.html` `<style>` (or an imported CSS file) |
| Step-log rows with rule badge and delta chips, parse tree, postfix timeline, test result cards, check rows, oracle rows, summary strip, legend popover | render functions in `src/ui/main.ts` (data already available) |
| Diagram colours/classes/transparent background/label pills/min node distance | `src/diagram/index.ts` |
| Chart layout, colours, direct labels, axis titles | the stress-chart generator in `src/ui/main.ts` |
| Touch pan/pinch | `src/ui/viewport.ts` + the pointer handlers in `main.ts` |
| Remove debug `worker-status` text | `src/ui/main.ts` (and `src/ui/worker.ts` handshake) |

### 15.6 Suggested order (each step ends with unit tests + e2e green)
1. Tokens + base typography + remove the debug string + states for existing classes (`warning`, status pills). *(P0)*
2. Layout shell: app bar, input strip, 3-column workbench, canvas as hero, scroll-inside panels. *(P0)*
3. Restyle all existing controls and tables; check rows; suite/stress tables; shortcuts dialog. *(P0)*
4. New presentations from existing data: step-log rows, parse tree, postfix timeline, result cards, summary strip. *(P1)*
5. Diagram restyle and the layout defects (A6). *(P0/P1)*
6. Dark theme + theme menu. *(P1)*
7. Responsive/mobile and touch gestures. *(P0 layout, P1 gestures)*
8. Extras: legend, last-build banner, fragment stack, click-to-select states, presenter focus mode. *(P2)*

### 15.7 Definition of done
- No horizontal page scroll at 320 px; no clipped or overlapping text at 200 % zoom.
- 1440×900: canvas fully visible with the empty state and with a 10-step build, no page scroll to see it.
- Light and dark pass contrast (§5.1) and keep the diagram legible.
- Every control reachable and operable by keyboard with a visible focus ring; every icon-only button named.
- Unit tests and the five-run e2e pass unchanged (except intentional selector updates listed in the PR).
- `dist/index.html` still opens from `file://` with no network requests.
- No visible raw debug output anywhere.

---

## 16. Decisions, assumptions, open questions

| # | Decision / question | Default in this document |
|---|---|---|
| D1 | One scrolling page with anchored sections vs. tabs for Validation/Stress | **Anchored sections** (protects e2e visibility checks) |
| D2 | Native selects (restyled) vs. segmented controls for Notation/Concatenation/View | **Native selects**; segmented controls need a synced hidden select and e2e changes (P2) |
| D3 | Fonts: embed subsets vs. system stack | **Embed** Source Serif 4 / IBM Plex Sans / IBM Plex Mono subsets (≤ 150 KB); fall back to system stacks if any required glyph is missing |
| D4 | Dark theme in scope? | **Yes**, P1; designs required for S2, S3, S6, S7 at minimum |
| D5 | Right rail: tabs vs. stacked panels at xl | **Stacked**, tabs only ≤ md |
| D6 | Chart palette: red/blue today | **Violet/blue**, red reserved for fail |
| D7 | Keep `(new)` text suffix in diagram labels | **Keep** (tests); revisit as P2 |
| D8 | Presenter/focus mode (hide rails, larger canvas and step text) | **P2**; design one frame of S2 with rails collapsed if time allows |
| Q1 | Should "Textbook" be the default notation if the course notes use `+` for union? (open item in the M1 document) | Keep **Standard** default; surface the choice clearly in the input strip |
| Q2 | Is the app hosted anywhere (affects meta tags, OG image)? | Unknown; treated as `file://`/static |

**Out of scope for this redesign:** changing the engine, adding NFA → DFA or minimisation views, accounts/saving sessions, character classes, any backend.

---

## Appendix A — Control inventory (everything the UI exposes today)

**Input strip:** Presets select (9 presets; choosing one fills the regex, sets notation and concatenation, fills the test strings and builds — it does **not** run the strings) · regex text field (Enter builds) · `ε` and `∅` insert buttons · Notation select (changing it rebuilds an existing expression) · Concatenation select (rebuilds likewise) · **Build** · **Copy Link** (+ transient status) · `?` shortcuts button · Alphabet field (+ message line) · error line · stats line · link-notice line.
**Parse:** raw token list · postfix chips (click jumps to that step) · parse tree text.
**Stepper:** first · previous · play/pause · next · last · counter · speed (0.5x/1x/2x) · view (NFA/Final NFA) · compact-labels checkbox · step log (click row jumps) · layout-note line.
**Canvas:** zoom in/out/fit/100% · zoom % · Export SVG · hint text · the pannable/zoomable region · state hover tooltips · transition table.
**Simulation:** test-string textarea (one per line; blank = ε) · Run · run-status line · verdict list · trace blocks (click a trace line to show that active set in Final view) · worker-status line (debug leftover).
**Validation:** six invariant rows · Run Suite + 24-case table · Run Differential Test + status + three oracle rows + mismatch list (≤ 20) · family select (2) · Run Stress Test · Cancel (only while running) · browser info · status · live table · Copy CSV (+ status) · Log scale toggle · Export SVG · two-panel chart.
**Dialog:** Keyboard Shortcuts (9 rows) with close button.
**Not present today:** theme switch, section navigation, loading indicators, per-step counts, fragment stack display, legend, touch gestures, last-build banner, summary strip.

## Appendix B — Presets (name — description)
Descriptions exist in data but are not shown today; show them (S8a).

| # | Name | Regex | Notation / concat | Description |
|---|---|---|---|---|
| 1 | (a\|b)*a (Worked example) | `(a\|b)*a` | standard / ε-link | The M1 hand-solved example: 10 states, 12 transitions |
| 2 | (a\|b)*abb (Classic textbook) | `(a\|b)*abb` | standard / ε-link | Classic textbook example: 14 states (ε-link) or 11 states (merge) |
| 3 | a*b (Zero-or-more then b) | `a*b` | standard / ε-link | Classic single-star sequence: 6 states, 7 transitions |
| 4 | (a+b)*a (Textbook union) | `(a+b)*a` | textbook / ε-link | Textbook notation using + for union |
| 5 | (a+b)*abb (Textbook merge) | `(a+b)*abb` | textbook / merge | Textbook notation with merge concatenation: 11 states, 13 transitions |
| 6 | a+? (Plus and optional) | `a+?` | standard / ε-link | Stacked unary operators: (a+)? |
| 7 | a** (Nested stars) | `a**` | standard / ε-link | Nested stars: (a*)* |
| 8 | (0\|1)*(00\|11) (Binary repeated bit) | `(0\|1)*(00\|11)` | standard / ε-link | Binary strings ending in 00 or 11 |
| 9 | (a+ε)b (Textbook optional via ε) | `(a+ε)b` | textbook / ε-link | Textbook notation with explicit ε transition |

Stress families: `(a*)*b on aⁿ` and `(a+)+ on aⁿb`.

## Appendix C — Numbers to design for
- Postfix tokens: typical 6–20; long demo ≈ 40; diagram cap 400.
- States = about 2 × (atoms + unions + unary operators): `(a|b)*a` → 10; `(a|b)*abb` → 14 (ε-link) / 11 (merge).
- Differential: strings up to length k = 8 → 511 strings for a 2-letter alphabet.
- Stress: n from 12 to 30 for backtracking (timeout 8,000 ms), NFA up to 1,000.
- Suite: 24 cases. Invariant rows: 6. Oracles: 3.
- Viewport targets: 1440×900, 1366×768, 1024×768, 390×844, 320×640.

## Appendix D — Defects found during the audit, for the engineering backlog
| ID | Defect | Priority |
|---|---|---|
| A3 | Debug JSON visible in `#worker-status` | P0 |
| A2 | Parse tree whitespace collapses to one line; raw token dump visible | P0 |
| A6 | Overlapping nodes/labels at step 1; white page rectangle | P0 |
| A7 | Horizontal overflow on mobile; no touch pan/pinch | P0 / P1 |
| A9 | Missing labels/names on controls | P0 |
| A10 | Chart legend overlaps title | P1 |
| A11 | `pass` vs `PASS` casing in oracle results | P1 |
| — | Preset descriptions never shown | P1 |
