import { test, expect } from 'vitest';
import fc from 'fast-check';
import { test as fcTest } from '@fast-check/vitest';
import { instance } from '@viz-js/viz';
test('viz renders in node', async () => { const viz = await instance(); expect(viz.renderString('digraph{a->b}', { format: 'svg' })).toContain('<svg'); });
test('fast-check works under vitest', () => { fc.assert(fc.property(fc.array(fc.integer()), (xs) => [...xs].reverse().reverse().join() === xs.join())); });
fcTest.prop([fc.string()])('@fast-check/vitest test.prop works', (s) => s.length >= 0);
