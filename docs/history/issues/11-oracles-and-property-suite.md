# 11: Oracles and property suite

**What to build:** The maintainer's suite proves that the NFA's language equals three independent oracles on generated expressions, and fails when the construction is broken.

**Blocked by:** 04: Syntax errors; 05: Plus, optional, parse views; 06: Settings

**Status:** done

- [x] Test support provides the bounded-language enumerator, the derivative matcher, the wrapping RegExp translator with a capped worker runner (a timeout means skipped, never failed), and an independent recursive-descent parser. (`tests/oracles.ts`, `tests/regexp-worker.cjs`, verified by `[T11-03]`, `[T11-04]`)
- [x] Properties, in both construction modes and both notations: the oracles agree with each other; the NFA's language equals the enumerator's on every string up to length 6; I1–I4, the size formula and step-log replay hold; the parse tree from the postfix equals the independent parser's; merge and ε-link agree on language and differ by exactly the number of concatenations; the two front-ends accept and reject the same inputs. (Verified by `[T11-03]`, `[T11-04]`, `[T11-05]`, `[T11-06]`, `[T11-07]`, `[T11-08]`)
- [x] The generator is tuned and a test asserts its size distribution: median at least 6 nodes, 90th percentile at least 20, maximum at most 60. (Verified by `[T11-01]`)
- [x] A failing property prints the shrunk counterexample as a source string, plus the seed and path to replay it. (Verified by `[T11-02]`)
- [x] The whole suite runs in under 60 seconds on a laptop. (`npm run check` finishes in 1.2s)
- [x] One deliberately injected bug is shown to fail the suite, then reverted. (Injected `star-no-back` mutant in STAR construction; failed `[T11-06]` and `[T11-07]`, then reverted)
