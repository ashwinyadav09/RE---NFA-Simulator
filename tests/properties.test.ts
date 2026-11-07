import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { makeAstArb, astSize, printAst } from './generator';
import {
  lang,
  derivMatch,
  toJs,
  RegExpRunner,
  allStrings,
  parseRD,
} from './oracles';
import { analyze, checkInvariants, run } from '../src/engine/index';

describe('Property suite and generator', () => {
  test('[T11-01] Generator size distribution: median >= 6, p90 >= 20, max <= 60', () => {
    const samples = fc.sample(makeAstArb(), { numRuns: 1000, seed: 42 });
    expect(samples.length).toBe(1000);

    const sizes = samples.map(astSize).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length * 0.5)];
    const p90 = sizes[Math.floor(sizes.length * 0.9)];
    const max = sizes[sizes.length - 1];

    expect(median).toBeGreaterThanOrEqual(6);
    expect(p90).toBeGreaterThanOrEqual(20);
    expect(max).toBeLessThanOrEqual(60);
  });

  test('[T11-02] A failing property prints the shrunk counterexample as a source string, plus seed and path', () => {
    let failureMsg = '';
    try {
      fc.assert(
        fc.property(makeAstArb(), (_ast) => {
          // Deliberately fail to test shrinking and reporting
          return false;
        }),
        { numRuns: 10, seed: 12345 }
      );
    } catch (err: any) {
      failureMsg = err.message;
    }

    expect(failureMsg).toContain('seed: 12345');
    expect(failureMsg).toContain('path:');
    // Counterexample should be formatted as a source string (e.g. Counterexample: [a] or [@]), NOT JSON { k: 'sym', ... }
    expect(failureMsg).toMatch(/Counterexample:\s*\[[a-zA-Z0-9@#\(\)\|\+\*\?]+\]/);
    expect(failureMsg).not.toContain('"k": "sym"');
    expect(failureMsg).not.toContain("{ k: 'sym'");
  });

  test('[T11-03] Test support oracles agree with each other on generated ASTs up to length 6', async () => {
    const runner = new RegExpRunner();
    const alphabet = ['a', 'b'];
    const maxLen = 6;
    const testStrings = allStrings(alphabet, maxLen);

    try {
      await fc.assert(
        fc.asyncProperty(makeAstArb({ alphabet }), async (ast) => {
          const expectedSet = lang(ast, maxLen);

          // 1. Derivative matcher vs bounded language enumerator
          for (const w of testStrings) {
            const inEnumerator = expectedSet.has(w);
            const inDerivative = derivMatch(ast, w);
            if (inEnumerator !== inDerivative) {
              return false;
            }
          }

          // 2. Wrapping RegExp runner with 2s timeout
          const reResult = await runner.testMatches(toJs(ast), testStrings);
          if (!reResult.timeout && reResult.matches) {
            for (let i = 0; i < testStrings.length; i++) {
              const w = testStrings[i];
              const inEnumerator = expectedSet.has(w);
              const inRegExp = reResult.matches[i];
              if (inEnumerator !== inRegExp) {
                return false;
              }
            }
          }
          // If timeout, skipped, not failed.

          return true;
        }),
        { numRuns: 50, seed: 101 }
      );
    } finally {
      await runner.close();
    }
  }, 30000);

  test('[T11-04] Parse tree agreement: postfix parse tree equals independent parseRD and original AST in both notations', () => {
    // Standard notation
    fc.assert(
      fc.property(makeAstArb({ notation: 'standard' }), (ast) => {
        const src = printAst(ast, 'standard');
        const res = analyze(src, { notation: 'standard' });
        if (!res.ok) return false;
        const rd = parseRD(src, { notation: 'standard' });
        // Engine seam parseTree vs independent parseRD
        expect(res.parseTree).toEqual(rd);
        // Both equal the original AST structure
        expect(JSON.stringify(res.parseTree)).toEqual(JSON.stringify(ast));
        return true;
      }),
      { numRuns: 100, seed: 201 }
    );

    // Textbook notation
    fc.assert(
      fc.property(makeAstArb({ notation: 'textbook' }), (ast) => {
        const src = printAst(ast, 'textbook');
        const res = analyze(src, { notation: 'textbook' });
        if (!res.ok) return false;
        const rd = parseRD(src, { notation: 'textbook' });
        // Engine seam parseTree vs independent parseRD
        expect(res.parseTree).toEqual(rd);
        expect(JSON.stringify(res.parseTree)).toEqual(JSON.stringify(ast));
        return true;
      }),
      { numRuns: 100, seed: 202 }
    );
  });

  test('[T11-05] Front-end validity agreement on random token sequences: analyze and parseRD accept and reject the same inputs', () => {
    const charsStd = ['a', 'b', '|', '*', '+', '?', '(', ')', '@', '#', ' '];
    const fuzzStd = fc.array(fc.constantFrom(...charsStd), { minLength: 0, maxLength: 8 }).map((a) => a.join(''));

    fc.assert(
      fc.property(fuzzStd, (src) => {
        const analyzeOk = analyze(src, { notation: 'standard' }).ok;
        let rdOk = false;
        try {
          parseRD(src, { notation: 'standard' });
          rdOk = true;
        } catch {
          rdOk = false;
        }
        return analyzeOk === rdOk;
      }),
      { numRuns: 500, seed: 301 }
    );

    const charsTxt = ['a', 'b', '+', '*', '?', '(', ')', '@', '#', ' ', '|'];
    const fuzzTxt = fc.array(fc.constantFrom(...charsTxt), { minLength: 0, maxLength: 8 }).map((a) => a.join(''));

    fc.assert(
      fc.property(fuzzTxt, (src) => {
        const analyzeOk = analyze(src, { notation: 'textbook' }).ok;
        let rdOk = false;
        try {
          parseRD(src, { notation: 'textbook' });
          rdOk = true;
        } catch {
          rdOk = false;
        }
        return analyzeOk === rdOk;
      }),
      { numRuns: 500, seed: 302 }
    );
  });

  test('[T11-06] Structural invariants I1-I4, size formula, and step-log replay hold across all modes and notations', () => {
    const notations: ('standard' | 'textbook')[] = ['standard', 'textbook'];
    const concatenationModes: ('epsilon-link' | 'merge')[] = ['epsilon-link', 'merge'];

    for (const notation of notations) {
      for (const concatenation of concatenationModes) {
        fc.assert(
          fc.property(makeAstArb({ notation }), (ast) => {
            const src = printAst(ast, notation);
            const res = analyze(src, { notation, concatenation });
            if (!res.ok) return false;

            // 1. Invariants I1-I4 and no dangling edges
            const inv = checkInvariants(res.nfa);
            expect(inv.I1).toBe(true);
            expect(inv.I2).toBe(true);
            expect(inv.I3).toBe(true);
            expect(inv.I4).toBe(true);
            expect(inv.noDanglingEdges).toBe(true);

            // 2. Exact size formula
            const atoms = res.postfix.filter(
              (t) => t.type === 'SYMBOL' || t.type === 'EPSILON' || t.type === 'EMPTY'
            ).length;
            const symbolAtoms = res.postfix.filter((t) => t.type === 'SYMBOL').length;
            const epsAtoms = res.postfix.filter((t) => t.type === 'EPSILON').length;
            const unions = res.postfix.filter((t) => t.type === 'UNION').length;
            const stars = res.postfix.filter((t) => t.type === 'STAR').length;
            const plusAndOpt = res.postfix.filter(
              (t) => t.type === 'PLUS' || t.type === 'OPT'
            ).length;
            const unary = stars + plusAndOpt;
            const concats = res.postfix.filter((t) => t.type === 'CONCAT').length;

            const expectedStates =
              2 * (atoms + unions + unary) - (concatenation === 'merge' ? concats : 0);
            const expectedTransitions =
              symbolAtoms +
              epsAtoms +
              4 * unions +
              4 * stars +
              3 * plusAndOpt +
              (concatenation === 'merge' ? 0 : concats);

            expect(res.nfa.states.length).toBe(expectedStates);
            expect(res.nfa.transitions.length).toBe(expectedTransitions);
            expect(res.stats.states).toBe(expectedStates);
            expect(res.stats.transitions).toBe(expectedTransitions);

            // 3. Step-log replay reproduces final NFA exactly
            const replayedStates: number[] = [];
            const replayedTransitions: { from: number; to: number; label: string }[] = [];
            for (const step of res.steps) {
              replayedStates.push(...step.newStates);
              if (step.mergedPair) {
                const { removed, into } = step.mergedPair;
                const idx = replayedStates.indexOf(removed);
                if (idx !== -1) replayedStates.splice(idx, 1);
                for (const t of replayedTransitions) {
                  if (t.from === removed) t.from = into;
                  if (t.to === removed) t.to = into;
                }
              }
              replayedTransitions.push(...step.newTransitions);
            }

            expect(replayedStates.sort((a, b) => a - b)).toEqual(
              res.nfa.states.slice().sort((a, b) => a - b)
            );
            expect(replayedTransitions).toEqual(res.nfa.transitions);

            return true;
          }),
          { numRuns: 50, seed: 401 }
        );
      }
    }
  });

  test('[T11-07] NFA language equals enumerator on every string up to length 6 across all modes and notations', () => {
    const alphabet = ['a', 'b'];
    const maxLen = 6;
    const testStrings = allStrings(alphabet, maxLen);
    const notations: ('standard' | 'textbook')[] = ['standard', 'textbook'];
    const concatenationModes: ('epsilon-link' | 'merge')[] = ['epsilon-link', 'merge'];

    for (const notation of notations) {
      for (const concatenation of concatenationModes) {
        fc.assert(
          fc.property(makeAstArb({ notation, alphabet }), (ast) => {
            const expectedSet = lang(ast, maxLen);
            const src = printAst(ast, notation);
            const res = analyze(src, { notation, concatenation });
            if (!res.ok) return false;

            for (const w of testStrings) {
              const inEnumerator = expectedSet.has(w);
              const sim = run(res.nfa, alphabet, w);
              const inNfa = sim.verdict === 'ACCEPT';
              if (inEnumerator !== inNfa) {
                return false;
              }
            }
            return true;
          }),
          { numRuns: 30, seed: 501 }
        );
      }
    }
  });

  test('[T11-08] Merge and epsilon-link agree on language and differ by exactly the number of concatenations', () => {
    const alphabet = ['a', 'b'];
    const maxLen = 6;
    const testStrings = allStrings(alphabet, maxLen);
    const notations: ('standard' | 'textbook')[] = ['standard', 'textbook'];

    for (const notation of notations) {
      fc.assert(
        fc.property(makeAstArb({ notation, alphabet }), (ast) => {
          const src = printAst(ast, notation);
          const resEps = analyze(src, { notation, concatenation: 'epsilon-link' });
          const resMerge = analyze(src, { notation, concatenation: 'merge' });
          if (!resEps.ok || !resMerge.ok) return false;

          const numConcats = resEps.postfix.filter((t) => t.type === 'CONCAT').length;

          // Differ by exactly the number of concatenations
          expect(resEps.nfa.states.length - resMerge.nfa.states.length).toBe(numConcats);
          expect(resEps.nfa.transitions.length - resMerge.nfa.transitions.length).toBe(numConcats);

          // Agree on language
          for (const w of testStrings) {
            const vEps = run(resEps.nfa, alphabet, w).verdict;
            const vMerge = run(resMerge.nfa, alphabet, w).verdict;
            if (vEps !== vMerge) {
              return false;
            }
          }
          return true;
        }),
        { numRuns: 40, seed: 601 }
      );
    }
  });
});
