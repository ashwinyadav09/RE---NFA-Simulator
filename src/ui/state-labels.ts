import type { NFA } from '../engine/index';

/**
 * Normalizes NFA state labels for display in the Final NFA view:
 * 1. Start state is always assigned q0.
 * 2. Reachable states are visited via BFS from start, breaking ties by construction ID (ascending).
 * 3. The accept state is always deferred to the end and assigned q(n-1).
 * 4. Unreachable states (e.g. in empty set ∅) are assigned in construction order after reachable ones, with accept state still last.
 * 5. Returns a Map from engine state ID to display label (e.g. 6 -> "q0").
 */
export function normalizeStateLabels(nfa: NFA): Map<number, string> {
  const result = new Map<number, string>();
  const totalStates = nfa.states.length;
  if (totalStates === 0) return result;

  const start = nfa.start;
  const accept = nfa.accept;

  // Single-state edge case (though Thompson NFAs have at least 2 states)
  if (totalStates === 1) {
    result.set(start, 'q0');
    return result;
  }

  // Build adjacency list (sorted by target ID ascending)
  const adj = new Map<number, number[]>();
  for (const s of nfa.states) {
    adj.set(s, []);
  }
  for (const t of nfa.transitions) {
    const list = adj.get(t.from);
    if (list && !list.includes(t.to)) {
      list.push(t.to);
    }
  }
  for (const [, list] of adj) {
    list.sort((a, b) => a - b);
  }

  // BFS traversal starting at nfa.start
  let nextIndex = 0;
  result.set(start, `q${nextIndex++}`);

  const queue: number[] = [start];
  const visited = new Set<number>([start]);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const neighbors = adj.get(curr) || [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        // Defer accept state to the end
        if (next !== accept) {
          result.set(next, `q${nextIndex++}`);
          queue.push(next);
        }
      }
    }
  }

  // Any unreachable states in construction order (excluding accept)
  const sortedStates = [...nfa.states].sort((a, b) => a - b);
  for (const s of sortedStates) {
    if (!result.has(s) && s !== accept) {
      result.set(s, `q${nextIndex++}`);
    }
  }

  // Accept state is always last
  result.set(accept, `q${totalStates - 1}`);

  return result;
}

/**
 * Computes the creating step and rule for each state across all construction steps.
 */
export function computeStateCreators(
  steps: Array<{ index: number; rule: string; newStates: number[] }>
): Record<number, { step: number; rule: string }> {
  const creators: Record<number, { step: number; rule: string }> = {};
  for (const s of steps) {
    for (const q of s.newStates) {
      if (!creators[q]) {
        creators[q] = { step: s.index, rule: s.rule };
      }
    }
  }
  return creators;
}
