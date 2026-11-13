# 37: Kleene star shown raised in the regex bar

**What to build:** The Kleene star `*` in the regex input bar and wherever regular expressions are displayed as text must be typeset raised (superscripted), matching textbook style (e.g. $(a|b)^*$).
- `#regex-input` remains a standard HTML `<input>` element. Its value stays plain `*`, so copy/paste, Copy Link, deep links, and e2e assertions are completely unaffected.
- Typeset mirror layer `#regex-mirror`: placed directly behind `#regex-input` with identical font, font-size, letter-spacing, padding, and box dimensions. The input text is styled with transparent color and visible caret (`caret-color: var(--text-primary)`). The star is rendered raised without altering its monospace advance width (`width: 1ch`), keeping caret and selection coordinates aligned ($\le \pm 1\text{px}$).
- Synchronize horizontal scroll (`scrollLeft`) between `#regex-input` and `#regex-mirror` for long expressions (150+ tokens).
- The mirror layer is `aria-hidden="true"` and built exclusively with DOM text nodes and element nodes—never `innerHTML` of user input.
- Only the postfix star is raised; operators `|`, `+`, `?` and symbols $\epsilon, \emptyset$ remain at standard baseline.
- Provide a pure helper `typesetRegex(text: string): HTMLElement` and use it wherever regex is displayed as text: full-screen header, Validation summary line, parse tree visual chips, and step log.
- Unit and e2e tests covering caret alignment, typing, backspace, paste, XSS safety (`<img src=x onerror=alert(1)>`), and plain-text copying.
- Mutants for star raised, mirror sync, and innerHTML prohibition killed.

**Blocked by:** 36: Full-screen canvas mode

**Status:** done

- [x] AC1: `#regex-mirror` positioned behind `#regex-input` with transparent input text and visible caret.
- [x] AC2: Postfix Kleene star `*` rendered raised via `.raised-star` with fixed `1ch` advance width; caret x aligns with mirror glyph x ($\le \pm 1\text{px}$) across zoom levels (100%, 150%, 200%).
- [x] AC3: Mirror text content is synchronized with input value on all input, keydown, paste, and reset events using DOM text nodes only (no `innerHTML`).
- [x] AC4: Horizontal scrolling (`scrollLeft`) synchronized between `#regex-input` and `#regex-mirror`.
- [x] AC5: `typesetRegex(text)` helper created and used in full-screen header, validation summary line, parse tree root, and step log.
- [x] AC6: XSS safe: inputs like `<img src=x onerror=alert(1)>` render strictly as plain text nodes.
- [x] AC7: Copying from `#regex-input` yields plain `*` characters.
- [x] AC8: Unit tests in `tests/typeset-regex.test.ts` and e2e tests in `tests/e2e.cjs`.
- [x] AC9: Mutants defined and killed in `tests/ui-mutants.cjs`.
