export interface Transition {
  from: number;
  to: number;
  label: string;
}

export interface NFA {
  states: number[];
  start: number;
  accept: number;
  transitions: Transition[];
}

export interface AnalysisStats {
  states: number;
  transitions: number;
}

export interface AnalysisResult {
  nfa: NFA;
  alphabet: string[];
  stats: AnalysisStats;
}

export function analyze(source: string): AnalysisResult {
  return {
    nfa: {
      states: [0, 1],
      start: 0,
      accept: 1,
      transitions: [{ from: 0, to: 1, label: source }]
    },
    alphabet: [source],
    stats: {
      states: 2,
      transitions: 1
    }
  };
}
