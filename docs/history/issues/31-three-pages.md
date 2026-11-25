# 31: Split Workbench, Validation and Stress into three separate pages

**What to build:** Three real pages (#workbench, #validation, #stress) with hash routing, legacy alias support, hidden attribute page swapping, deferred fit calculation for hidden builds, back/forward history navigation without bounce, and deep link / Copy Link hash preservation.

**Blocked by:** 30: Final release audit

**Status:** done

- [x] Pure router module `src/ui/router.ts` with `parseRoute`, `formatRoute`, `isLegacyAlias`, and `getRouteTitle` tested in `tests/router.test.ts`.
- [x] Three page containers (`#page-workbench`, `#page-validation`, `#page-stress`) hidden via `hidden` attribute so DOM IDs, state, and event listeners survive.
- [x] Accessible page headings with `tabindex="-1"` receiving focus on navigation (not first load), title updates, live region announcements, and active nav link `aria-current="page"`.
- [x] Legacy aliases `#validation-panel` and `#stress-section` canonicalized via `history.replaceState` so back button does not bounce.
- [x] Scoped keyboard shortcuts: arrow key stepping active only when `#workbench` is visible; "?" help dialog accessible everywhere.
- [x] Hidden build trap fixed: deferred canvas fit and viewport calculation until `#workbench` becomes visible.
- [x] Validation page empty state with "Go to Workbench" button when no build exists; 24-case suite remains runnable.
- [x] Copy Link and deep links preserve route hash across page changes.
- [x] Mobile responsive nav at 390x844 without horizontal overflow.
- [x] Vitest tests, e2e suite, and all Ticket 31 mutants pass cleanly.

