// EPS is kept as a dedicated string constant ('ε') rather than a Symbol or null
// so that all engine data (transitions, tables, steps) remains plain JSON-serialisable,
// can be transferred to/from Web Workers without loss, matches golden fixtures,
// and works cleanly as object keys in transition tables (Record<string, number[]>).
export const EPS = 'ε';

export interface SizeCaps {
  flatStepping: number;
  textbookStepping: number;
  engineTokens: number;
}

export const CAPS: SizeCaps = {
  flatStepping: 150,
  textbookStepping: 400,
  engineTokens: 2000
};

export type TokenType =
  | 'SYMBOL'
  | 'EPSILON'
  | 'EMPTY'
  | 'UNION'
  | 'CONCAT'
  | 'STAR'
  | 'PLUS'
  | 'OPT'
  | 'LPAREN'
  | 'RPAREN'
  | 'INVALID_PIPE';

// Parse tree node types (built from postfix form; binary operators are left-nested)
export type ParseNode =
  | { k: 'sym'; v: string }
  | { k: 'eps' }
  | { k: 'empty' }
  | { k: 'star'; c: ParseNode }
  | { k: 'plus'; c: ParseNode }
  | { k: 'opt'; c: ParseNode }
  | { k: 'union'; l: ParseNode; r: ParseNode }
  | { k: 'cat'; l: ParseNode; r: ParseNode };

export interface Token {
  type: TokenType;
  symbol?: string;
  position: number;
}

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

export interface Fragment {
  start: number;
  accept: number;
  expression?: string;
}

export function makeFragment(start: number, accept: number, expression?: string): Fragment {
  const frag: Fragment = { start, accept };
  if (expression !== undefined) {
    Object.defineProperty(frag, 'expression', {
      value: expression,
      enumerable: false,
      writable: true,
      configurable: true
    });
  }
  return frag;
}

export function cloneFragment(frag: Fragment): Fragment {
  return makeFragment(frag.start, frag.accept, frag.expression);
}

export interface Step {
  index: number;
  token: string;
  rule: string;
  description: string;
  newStates: number[];
  newTransitions: Transition[];
  result: Fragment;
  stackAfter: Fragment[];
  stackDepthAfter: number;
  operands?: Fragment[];
  position?: number;
  mergedPair?: { removed: number; into: number };
}

export interface StepSnapshot {
  stepIndex: number;
  states: number[];
  transitions: Transition[];
  stack: Fragment[];
  newStates: number[];
  newTransitions: Transition[];
  operands?: Fragment[];
  mergedPair?: { removed: number; into: number };
  stateCreators?: Record<number, { step: number; rule: string }>;
}

export interface InvariantsResult {
  I1: boolean;
  I2: boolean;
  I3: boolean;
  I4: boolean;
  noDanglingEdges: boolean;
}

export interface AnalysisError {
  code: string;
  position?: number;
  message: string;
  hint?: string;
}

export interface AnalysisSuccess {
  ok: true;
  tokens: Token[];
  postfix: Token[];
  parseTree: ParseNode;
  steps: Step[];
  nfa: NFA;
  alphabet: string[];
  stats: AnalysisStats;
  transitionTable: Record<number, Record<string, number[]>>;
  initialClosure: number[];
  invariants: InvariantsResult;
  error?: undefined;
}

export interface AnalysisFailure {
  ok: false;
  code: string;
  position?: number;
  message: string;
  hint?: string;
  error: AnalysisError;
}

export type AnalysisResult = AnalysisSuccess | AnalysisFailure;

export type SimulationVerdict = 'ACCEPT' | 'REJECT';
export type RunStatus = 'ok' | 'dead' | 'out_of_alphabet';

export interface RunResult {
  accepted: boolean;
  verdict: SimulationVerdict;
  status: RunStatus;
  initialClosure: number[];
  afterEachSymbol: number[][];
  trace: number[][];
  position?: number;
  symbol?: string;
}


export interface AnalyzeOptions {
  notation?: 'standard' | 'textbook';
  concatenation?: 'epsilon-link' | 'merge';
  alphabet?: string[];
  caps?: Partial<SizeCaps>;
}

function tokenize(source: string, notation: 'standard' | 'textbook' = 'standard'): Token[] {
  const codePoints = Array.from(source);
  const rawTokens: Token[] = [];

  for (let i = 0; i < codePoints.length; i++) {
    const char = codePoints[i];
    if (/\s/.test(char)) {
      continue;
    }

    if (char === '(') {
      rawTokens.push({ type: 'LPAREN', position: i });
    } else if (char === ')') {
      rawTokens.push({ type: 'RPAREN', position: i });
    } else if (char === '|') {
      if (notation === 'textbook') {
        rawTokens.push({ type: 'INVALID_PIPE', position: i });
      } else {
        rawTokens.push({ type: 'UNION', position: i });
      }
    } else if (char === '+') {
      if (notation === 'textbook') {
        rawTokens.push({ type: 'UNION', position: i });
      } else {
        rawTokens.push({ type: 'PLUS', position: i });
      }
    } else if (char === '*') {
      rawTokens.push({ type: 'STAR', position: i });
    } else if (char === '?') {
      rawTokens.push({ type: 'OPT', position: i });
    } else if (char === '@' || char === 'ε') {
      rawTokens.push({ type: 'EPSILON', position: i });
    } else if (char === '#' || char === '∅') {
      rawTokens.push({ type: 'EMPTY', position: i });
    } else {
      rawTokens.push({ type: 'SYMBOL', symbol: char, position: i });
    }
  }

  return rawTokens;
}

function validateTokens(tokens: Token[], notation: 'standard' | 'textbook' = 'standard'): AnalysisError | null {
  interface Frame {
    lparen?: Token;
    lastBinaryOp: Token | null;
  }

  const unionOpChar = notation === 'textbook' ? '+' : '|';
  const frames: Frame[] = [{ lastBinaryOp: null }];
  let state: 'EXPECTING_OPERAND' | 'EXPECTING_OPERATOR' = 'EXPECTING_OPERAND';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'INVALID_PIPE') {
      return {
        code: 'NOT_AN_OPERATOR',
        position: token.position,
        message: "'|' is not an operator in textbook mode",
        hint: "Use '+' for union in textbook mode"
      };
    }

    // Check for empty group: ( immediately followed by )
    if (token.type === 'LPAREN' && tokens[i + 1]?.type === 'RPAREN') {
      return {
        code: 'EMPTY_GROUP',
        position: token.position,
        message: 'Empty group ()',
        hint: 'Parentheses must enclose an expression'
      };
    }

    if (state === 'EXPECTING_OPERAND') {
      if (token.type === 'SYMBOL' || token.type === 'EPSILON' || token.type === 'EMPTY') {
        state = 'EXPECTING_OPERATOR';
        frames[frames.length - 1].lastBinaryOp = null;
      } else if (token.type === 'LPAREN') {
        frames[frames.length - 1].lastBinaryOp = null;
        frames.push({ lparen: token, lastBinaryOp: null });
        state = 'EXPECTING_OPERAND';
      } else if (token.type === 'STAR' || token.type === 'PLUS' || token.type === 'OPT') {
        return {
          code: 'NOTHING_TO_REPEAT',
          position: token.position,
          message: `Nothing to repeat before '${token.type === 'STAR' ? '*' : token.type === 'PLUS' ? '+' : '?'}'`,
          hint: 'Unary operators (*, +, ?) must follow an operand'
        };
      } else if (token.type === 'UNION') {
        const currentFrame = frames[frames.length - 1];
        if (currentFrame.lastBinaryOp !== null) {
          return {
            code: 'MISSING_OPERAND',
            position: currentFrame.lastBinaryOp.position,
            message: `Missing operand after '${unionOpChar}'`,
            hint: 'Binary operator requires operands on both sides'
          };
        } else {
          return {
            code: 'MISSING_OPERAND',
            position: token.position,
            message: `Missing operand before '${unionOpChar}'`,
            hint: 'Binary operator requires operands on both sides'
          };
        }
      } else if (token.type === 'RPAREN') {
        const currentFrame = frames[frames.length - 1];
        if (currentFrame.lastBinaryOp !== null) {
          return {
            code: 'MISSING_OPERAND',
            position: currentFrame.lastBinaryOp.position,
            message: `Missing operand after '${unionOpChar}'`,
            hint: 'Binary operator requires operands on both sides'
          };
        } else {
          return {
            code: 'UNBALANCED_RPAREN',
            position: token.position,
            message: "Unbalanced ')' with no matching '('",
            hint: 'Remove extra closing parenthesis or add an opening parenthesis'
          };
        }
      }
    } else {
      // state === 'EXPECTING_OPERATOR'
      if (token.type === 'STAR' || token.type === 'PLUS' || token.type === 'OPT') {
        // Stacked unary operators allowed (e.g. a**, a+?)
        state = 'EXPECTING_OPERATOR';
        frames[frames.length - 1].lastBinaryOp = null;
      } else if (token.type === 'UNION') {
        state = 'EXPECTING_OPERAND';
        frames[frames.length - 1].lastBinaryOp = token;
      } else if (token.type === 'RPAREN') {
        if (frames.length === 1) {
          return {
            code: 'UNBALANCED_RPAREN',
            position: token.position,
            message: "Unbalanced ')' with no matching '('",
            hint: 'Remove extra closing parenthesis or add an opening parenthesis'
          };
        }
        frames.pop();
        state = 'EXPECTING_OPERATOR';
        frames[frames.length - 1].lastBinaryOp = null;
      } else if (token.type === 'SYMBOL' || token.type === 'EPSILON' || token.type === 'EMPTY') {
        // Implicit concatenation
        state = 'EXPECTING_OPERATOR';
        frames[frames.length - 1].lastBinaryOp = null;
      } else if (token.type === 'LPAREN') {
        // Implicit concatenation into '('
        frames.push({ lparen: token, lastBinaryOp: null });
        state = 'EXPECTING_OPERAND';
      }
    }
  }

  // End of input checks:
  // 1. Missing right operand
  for (let f = frames.length - 1; f >= 0; f--) {
    if (frames[f].lastBinaryOp !== null) {
      return {
        code: 'MISSING_OPERAND',
        position: frames[f].lastBinaryOp!.position,
        message: `Missing operand after '${unionOpChar}'`,
        hint: 'Binary operator requires operands on both sides'
      };
    }
  }

  // 2. Unclosed parenthesis: first unmatched '(' scanning left-to-right
  if (frames.length > 1) {
    return {
      code: 'UNBALANCED_LPAREN',
      position: frames[1].lparen!.position,
      message: "Unbalanced '(' that was never closed",
      hint: 'Add closing parenthesis or remove extra opening parenthesis'
    };
  }

  return null;
}

function canEndOperand(token: Token): boolean {
  return (
    token.type === 'SYMBOL' ||
    token.type === 'EPSILON' ||
    token.type === 'EMPTY' ||
    token.type === 'RPAREN' ||
    token.type === 'STAR' ||
    token.type === 'PLUS' ||
    token.type === 'OPT'
  );
}

function canBeginOperand(token: Token): boolean {
  return (
    token.type === 'SYMBOL' ||
    token.type === 'EPSILON' ||
    token.type === 'EMPTY' ||
    token.type === 'LPAREN'
  );
}

function insertImplicitConcat(tokens: Token[]): Token[] {
  const result: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    result.push(tokens[i]);
    if (i + 1 < tokens.length) {
      if (canEndOperand(tokens[i]) && canBeginOperand(tokens[i + 1])) {
        result.push({
          type: 'CONCAT',
          position: tokens[i + 1].position
        });
      }
    }
  }
  return result;
}

function toPostfix(tokensWithConcat: Token[]): Token[] {
  const postfix: Token[] = [];
  const opStack: Token[] = [];

  const precedence: Record<string, number> = {
    UNION: 1,
    CONCAT: 2
  };

  for (const token of tokensWithConcat) {
    if (
      token.type === 'SYMBOL' ||
      token.type === 'EPSILON' ||
      token.type === 'EMPTY'
    ) {
      postfix.push(token);
    } else if (
      token.type === 'STAR' ||
      token.type === 'PLUS' ||
      token.type === 'OPT'
    ) {
      // Postfix unary operators bind tightest and apply to the immediately preceding operand
      postfix.push(token);
    } else if (token.type === 'CONCAT' || token.type === 'UNION') {
      const prec = precedence[token.type] ?? 0;
      while (opStack.length > 0) {
        const top = opStack[opStack.length - 1];
        if (top.type === 'LPAREN') break;
        const topPrec = precedence[top.type] ?? 0;
        if (topPrec >= prec) {
          postfix.push(opStack.pop()!);
        } else {
          break;
        }
      }
      opStack.push(token);
    } else if (token.type === 'LPAREN') {
      opStack.push(token);
    } else if (token.type === 'RPAREN') {
      while (opStack.length > 0 && opStack[opStack.length - 1].type !== 'LPAREN') {
        postfix.push(opStack.pop()!);
      }
      if (opStack.length > 0 && opStack[opStack.length - 1].type === 'LPAREN') {
        opStack.pop();
      }
    }
  }

  while (opStack.length > 0) {
    postfix.push(opStack.pop()!);
  }

  return postfix;
}

function wrapUnary(expr: string): string {
  if (expr.length <= 1) return expr;
  if (expr.startsWith('(') && expr.endsWith(')')) {
    let depth = 0;
    let isSingleGroup = true;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') depth--;
      if (depth === 0 && i < expr.length - 1) {
        isSingleGroup = false;
        break;
      }
    }
    if (isSingleGroup) return expr;
  }
  return `(${expr})`;
}

function buildNFA(
  postfix: Token[],
  concatenation: 'epsilon-link' | 'merge' = 'epsilon-link',
  notation: 'standard' | 'textbook' = 'standard'
): {
  steps: Step[];
  nfa: NFA;
  allStates: number[];
  allTransitions: Transition[];
} {
  let nextStateId = 0;
  const stack: Fragment[] = [];
  const steps: Step[] = [];
  const allStates: number[] = [];
  const allTransitions: Transition[] = [];

  for (let i = 0; i < postfix.length; i++) {
    const token = postfix[i];
    let rule = '';
    const newStates: number[] = [];
    const newTransitions: Transition[] = [];
    let mergedPair: { removed: number; into: number } | undefined;
    let produced: Fragment;
    let operands: Fragment[] = [];
    let description = '';

    switch (token.type) {
      case 'SYMBOL': {
        rule = 'symbol';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push({ from: s, to: f, label: token.symbol! });
        produced = makeFragment(s, f, token.symbol!);
        description = `symbol '${token.symbol}' (fragment ${s}→${f})`;
        stack.push(produced);
        break;
      }
      case 'EPSILON': {
        rule = 'epsilon';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push({ from: s, to: f, label: EPS });
        produced = makeFragment(s, f, EPS);
        description = `epsilon (fragment ${s}→${f})`;
        stack.push(produced);
        break;
      }
      case 'EMPTY': {
        rule = 'empty';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        produced = makeFragment(s, f, '∅');
        description = `empty (fragment ${s}→${f})`;
        stack.push(produced);
        break;
      }
      case 'CONCAT': {
        rule = 'concatenation';
        const B = stack.pop()!;
        const A = stack.pop()!;
        operands = [cloneFragment(A), cloneFragment(B)];
        const exprA = A.expression ?? '';
        const exprB = B.expression ?? '';
        if (concatenation === 'merge') {
          mergedPair = { removed: B.start, into: A.accept };
          // Invariant I2 guarantees no transition enters B.start
          if (allTransitions.some((tr) => tr.to === B.start)) {
            throw new Error('I2 violated: transition enters B.start before merge');
          }
          // Delete B.start from allStates
          const idx = allStates.indexOf(B.start);
          if (idx !== -1) {
            allStates.splice(idx, 1);
          }
          // Move outgoing transitions from B.start to A.accept
          for (const t of allTransitions) {
            if (t.from === B.start) {
              t.from = A.accept;
            }
          }
          produced = makeFragment(A.start, B.accept, `${exprA}${exprB}`);
          description = `concatenation of fragments ${A.start}→${A.accept} and ${B.start}→${B.accept} (merged states ${A.accept} and ${B.start} into ${A.accept})`;
          stack.push(produced);
        } else {
          newTransitions.push({ from: A.accept, to: B.start, label: EPS });
          produced = makeFragment(A.start, B.accept, `${exprA}${exprB}`);
          description = `concatenation of fragments ${A.start}→${A.accept} and ${B.start}→${B.accept}`;
          stack.push(produced);
        }
        break;
      }
      case 'UNION': {
        rule = 'union';
        const B = stack.pop()!;
        const A = stack.pop()!;
        operands = [cloneFragment(A), cloneFragment(B)];
        const exprA = A.expression ?? '';
        const exprB = B.expression ?? '';
        const op = notation === 'textbook' ? '+' : '|';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: s, to: B.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: B.accept, to: f, label: EPS }
        );
        produced = makeFragment(s, f, `(${exprA}${op}${exprB})`);
        description = `union of fragments ${A.start}→${A.accept} and ${B.start}→${B.accept}`;
        stack.push(produced);
        break;
      }
      case 'STAR': {
        rule = 'star';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: s, to: f, label: EPS },
          { from: A.accept, to: A.start, label: EPS }
        );
        produced = makeFragment(s, f, `${wrapUnary(exprA)}*`);
        description = `star of fragment ${A.start}→${A.accept}`;
        stack.push(produced);
        break;
      }
      case 'PLUS': {
        rule = 'plus';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: A.accept, to: A.start, label: EPS }
        );
        produced = makeFragment(s, f, `${wrapUnary(exprA)}+`);
        description = `plus of fragment ${A.start}→${A.accept}`;
        stack.push(produced);
        break;
      }
      case 'OPT': {
        rule = 'optional';
        const A = stack.pop()!;
        operands = [cloneFragment(A)];
        const exprA = A.expression ?? '';
        const s = nextStateId++;
        const f = nextStateId++;
        newStates.push(s, f);
        newTransitions.push(
          { from: s, to: A.start, label: EPS },
          { from: A.accept, to: f, label: EPS },
          { from: s, to: f, label: EPS }
        );
        produced = makeFragment(s, f, `${wrapUnary(exprA)}?`);
        description = `optional of fragment ${A.start}→${A.accept}`;
        stack.push(produced);
        break;
      }
      default:
        throw new Error(`Unexpected token in postfix: ${token.type}`);
    }

    allStates.push(...newStates);
    allTransitions.push(...newTransitions);

    const stackSnapshot: Fragment[] = stack.map((frag) => cloneFragment(frag));

    steps.push({
      index: i + 1,
      token: token.type,
      rule,
      description,
      newStates: [...newStates],
      newTransitions: newTransitions.map((t) => ({ ...t })),
      result: cloneFragment(produced),
      stackAfter: stackSnapshot,
      stackDepthAfter: stackSnapshot.length,
      operands: operands.map((o) => cloneFragment(o)),
      position: token.position,
      ...(mergedPair ? { mergedPair } : {})
    });
  }

  const finalFragment = stack.length > 0 ? stack[stack.length - 1] : makeFragment(0, 0, '');

  return {
    steps,
    nfa: {
      states: [...allStates],
      start: finalFragment.start,
      accept: finalFragment.accept,
      transitions: allTransitions.map((t) => ({ ...t }))
    },
    allStates,
    allTransitions
  };
}

function inferAlphabet(tokens: Token[]): string[] {
  const seen = new Set<string>();
  const alphabet: string[] = [];
  for (const token of tokens) {
    if (token.type === 'SYMBOL' && token.symbol !== undefined && !seen.has(token.symbol)) {
      seen.add(token.symbol);
      alphabet.push(token.symbol);
    }
  }
  return alphabet;
}

export function validateAlphabet(
  alphabet: string[],
  requiredSymbols: string[]
): { ok: true; alphabet: string[] } | { ok: false; message: string } {
  const disallowed = new Set(['@', 'ε', '#', '∅']);
  for (const sym of alphabet) {
    if (Array.from(sym).length !== 1) {
      return {
        ok: false,
        message: `'${sym}' must be exactly one code point`
      };
    }
    if (disallowed.has(sym)) {
      return {
        ok: false,
        message: `'${sym}' is not allowed in the alphabet`
      };
    }
  }

  const alphaSet = new Set(alphabet);
  for (const req of requiredSymbols) {
    if (!alphaSet.has(req)) {
      return {
        ok: false,
        message: `Cannot remove symbol '${req}' used in expression`
      };
    }
  }

  // Deduplicate while preserving order
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const sym of alphabet) {
    if (!seen.has(sym)) {
      seen.add(sym);
      deduped.push(sym);
    }
  }

  return { ok: true, alphabet: deduped };
}

function computeTransitionTable(
  states: number[],
  transitions: Transition[]
): Record<number, Record<string, number[]>> {
  const table: Record<number, Record<string, number[]>> = {};
  for (const state of states) {
    table[state] = {};
  }

  for (const t of transitions) {
    if (!table[t.from]) {
      table[t.from] = {};
    }
    if (!table[t.from][t.label]) {
      table[t.from][t.label] = [];
    }
    table[t.from][t.label].push(t.to);
  }

  // Ensure targets are sorted for stability
  for (const state of states) {
    for (const label of Object.keys(table[state])) {
      table[state][label].sort((a, b) => a - b);
    }
  }

  return table;
}

function computeEpsilonClosure(startStates: number[], transitions: Transition[]): number[] {
  const closure = new Set<number>(startStates);
  const queue = [...startStates];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of transitions) {
      if (t.from === current && t.label === EPS) {
        if (!closure.has(t.to)) {
          closure.add(t.to);
          queue.push(t.to);
        }
      }
    }
  }

  return Array.from(closure).sort((a, b) => a - b);
}

export function checkInvariants(nfa: NFA): InvariantsResult {
  const stateSet = new Set(nfa.states);
  const I1 = nfa.start !== nfa.accept && stateSet.has(nfa.start) && stateSet.has(nfa.accept);
  const I2 = nfa.transitions.every((t) => t.to !== nfa.start);
  const I3 = nfa.transitions.every((t) => t.from !== nfa.accept);

  const outgoing: Record<number, { symbol: number; epsilon: number }> = {};
  for (const s of nfa.states) {
    outgoing[s] = { symbol: 0, epsilon: 0 };
  }

  let noDanglingEdges = true;
  for (const t of nfa.transitions) {
    if (!stateSet.has(t.from) || !stateSet.has(t.to)) {
      noDanglingEdges = false;
    }
    if (outgoing[t.from]) {
      if (t.label === EPS) {
        outgoing[t.from].epsilon++;
      } else {
        outgoing[t.from].symbol++;
      }
    }
  }

  let I4 = true;
  for (const s of nfa.states) {
    const out = outgoing[s];
    const isSingleSymbol = out.symbol === 1 && out.epsilon === 0;
    const isEpsilonBranch = out.symbol === 0 && out.epsilon <= 2;
    if (!isSingleSymbol && !isEpsilonBranch) {
      I4 = false;
      break;
    }
  }

  return { I1, I2, I3, I4, noDanglingEdges };
}

// Build a parse tree from the postfix token list.
// Binary operators (CONCAT, UNION) are left-nested (left-associative).
function astFromPostfix(postfix: Token[]): ParseNode {
  const stack: ParseNode[] = [];
  for (const t of postfix) {
    switch (t.type) {
      case 'SYMBOL':
        stack.push({ k: 'sym', v: t.symbol! });
        break;
      case 'EPSILON':
        stack.push({ k: 'eps' });
        break;
      case 'EMPTY':
        stack.push({ k: 'empty' });
        break;
      case 'STAR': {
        const c = stack.pop()!;
        stack.push({ k: 'star', c });
        break;
      }
      case 'PLUS': {
        const c = stack.pop()!;
        stack.push({ k: 'plus', c });
        break;
      }
      case 'OPT': {
        const c = stack.pop()!;
        stack.push({ k: 'opt', c });
        break;
      }
      case 'UNION': {
        const r = stack.pop()!;
        const l = stack.pop()!;
        stack.push({ k: 'union', l, r });
        break;
      }
      case 'CONCAT': {
        const r = stack.pop()!;
        const l = stack.pop()!;
        stack.push({ k: 'cat', l, r });
        break;
      }
    }
  }
  return stack[0];
}

export function analyze(source: string, options: AnalyzeOptions = {}): AnalysisResult {
  const notation = options.notation ?? 'standard';
  const concatenation = options.concatenation ?? 'epsilon-link';
  const tokens = tokenize(source, notation);

  if (tokens.length === 0) {
    const error: AnalysisError = {
      code: 'EMPTY_INPUT',
      message: 'Enter a regular expression',
      hint: 'Enter a regular expression to build its NFA'
    };
    return {
      ok: false,
      code: error.code,
      message: error.message,
      hint: error.hint,
      error
    };
  }

  const engineLimit = options.caps?.engineTokens ?? CAPS.engineTokens;
  if (tokens.length > engineLimit) {
    const limitFormatted = engineLimit.toLocaleString();
    const error: AnalysisError = {
      code: 'EXCEEDED_TOKEN_CAP',
      message: `Expression exceeds the engine limit of ${limitFormatted} tokens (limit: ${limitFormatted}; received ${tokens.length.toLocaleString()})`,
      hint: `Reduce the expression size to ${limitFormatted} tokens or fewer`
    };
    return {
      ok: false,
      code: error.code,
      message: error.message,
      hint: error.hint,
      error
    };
  }

  const validationError = validateTokens(tokens, notation);
  if (validationError) {
    return {
      ok: false,
      code: validationError.code,
      position: validationError.position,
      message: validationError.message,
      hint: validationError.hint,
      error: validationError
    };
  }

  const tokensWithConcat = insertImplicitConcat(tokens);
  const postfix = toPostfix(tokensWithConcat);
  const { steps, nfa } = buildNFA(postfix, concatenation, notation);
  const inferredAlphabet = inferAlphabet(tokens);
  let alphabet = inferredAlphabet;

  if (options.alphabet !== undefined) {
    const alphaRes = validateAlphabet(options.alphabet, inferredAlphabet);
    if (!alphaRes.ok) {
      return {
        ok: false,
        code: 'INVALID_ALPHABET',
        message: alphaRes.message,
        hint: 'Alphabet must include all symbols used in the expression and cannot contain ε or ∅',
        error: {
          code: 'INVALID_ALPHABET',
          message: alphaRes.message,
          hint: 'Alphabet must include all symbols used in the expression and cannot contain ε or ∅'
        }
      };
    }
    alphabet = alphaRes.alphabet;
  }

  const transitionTable = computeTransitionTable(nfa.states, nfa.transitions);
  const initialClosure = computeEpsilonClosure([nfa.start], nfa.transitions);
  const invariants = checkInvariants(nfa);
  const parseTree = astFromPostfix(postfix);

  return {
    ok: true,
    tokens,
    postfix,
    parseTree,
    steps,
    nfa,
    alphabet,
    stats: {
      states: nfa.states.length,
      transitions: nfa.transitions.length
    },
    transitionTable,
    initialClosure,
    invariants
  };
}

export function run(nfa: NFA, alphabet: string[], input: string): RunResult {
  const initialClosure = computeEpsilonClosure([nfa.start], nfa.transitions);
  let current = initialClosure;
  const afterEachSymbol: number[][] = [];
  const trace: number[][] = [initialClosure];
  const codePoints = Array.from(input);

  const alphabetSet = new Set(alphabet);

  for (let i = 0; i < codePoints.length; i++) {
    const symbol = codePoints[i];

    if (!alphabetSet.has(symbol)) {
      return {
        accepted: false,
        verdict: 'REJECT',
        status: 'out_of_alphabet',
        initialClosure,
        afterEachSymbol,
        trace,
        position: i,
        symbol
      };
    }

    const moveTargets = new Set<number>();
    for (const s of current) {
      for (const t of nfa.transitions) {
        if (t.from === s && t.label !== EPS && t.label === symbol) {
          moveTargets.add(t.to);
        }
      }
    }

    current = computeEpsilonClosure(Array.from(moveTargets), nfa.transitions);
    afterEachSymbol.push(current);
    trace.push(current);

    if (current.length === 0) {
      return {
        accepted: false,
        verdict: 'REJECT',
        status: 'dead',
        initialClosure,
        afterEachSymbol,
        trace,
        position: i
      };
    }
  }

  const accepted = current.includes(nfa.accept);
  return {
    accepted,
    verdict: accepted ? 'ACCEPT' : 'REJECT',
    status: 'ok',
    initialClosure,
    afterEachSymbol,
    trace
  };
}

export function runLines(nfa: NFA, alphabet: string[], text: string): RunResult[] {
  const lines = text.split(/\r\n|\r|\n/);
  return lines.map((line) => run(nfa, alphabet, line));
}

export function getStepSnapshot(steps: Step[], stepIndex: number): StepSnapshot {
  if (stepIndex < 1 || stepIndex > steps.length) {
    throw new Error(`Invalid stepIndex: ${stepIndex}. Expected between 1 and ${steps.length}`);
  }

  const replayedStates = new Set<number>();
  let replayedTransitions: Transition[] = [];
  const stateCreators: Record<number, { step: number; rule: string }> = {};

  for (let i = 0; i < stepIndex; i++) {
    const s = steps[i];
    for (const q of s.newStates) {
      replayedStates.add(q);
      stateCreators[q] = { step: s.index, rule: s.rule };
    }
    if (s.mergedPair) {
      replayedStates.delete(s.mergedPair.removed);
      replayedTransitions = replayedTransitions.map((t) =>
        t.from === s.mergedPair!.removed ? { ...t, from: s.mergedPair!.into } : t
      );
    }
    for (const t of s.newTransitions) {
      replayedTransitions.push({ ...t });
    }
  }

  const currentStep = steps[stepIndex - 1];

  return {
    stepIndex,
    states: Array.from(replayedStates).sort((a, b) => a - b),
    transitions: replayedTransitions,
    stack: currentStep.stackAfter.map((frag) => cloneFragment(frag)),
    newStates: [...currentStep.newStates],
    newTransitions: currentStep.newTransitions.map((t) => ({ ...t })),
    operands: currentStep.operands ? currentStep.operands.map((frag) => cloneFragment(frag)) : [],
    stateCreators,
    ...(currentStep.mergedPair ? { mergedPair: { ...currentStep.mergedPair } } : {})
  };
}


