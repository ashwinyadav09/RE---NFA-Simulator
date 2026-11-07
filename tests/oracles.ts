import type { ParseNode } from '../src/engine/index';

export interface OracleToken {
  type:
    | 'SYMBOL'
    | 'EPSILON'
    | 'EMPTY'
    | 'UNION'
    | 'STAR'
    | 'PLUS'
    | 'OPT'
    | 'LPAREN'
    | 'RPAREN';
  value: string;
  pos: number;
}

export function tokenizeOracle(
  src: string,
  { notation = 'standard' }: { notation?: 'standard' | 'textbook' } = {}
): OracleToken[] {
  const toks: OracleToken[] = [];
  const chars = Array.from(src);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) continue;
    let type: OracleToken['type'] = 'SYMBOL';
    if (ch === '(') type = 'LPAREN';
    else if (ch === ')') type = 'RPAREN';
    else if (ch === '*') type = 'STAR';
    else if (ch === '+') type = notation === 'standard' ? 'PLUS' : 'UNION';
    else if (ch === '?') type = 'OPT';
    else if (ch === '@' || ch === 'ε') type = 'EPSILON';
    else if (ch === '#' || ch === '∅') type = 'EMPTY';
    else if (ch === '|') {
      if (notation === 'standard') type = 'UNION';
      else throw new Error(`'|' is not an operator in textbook mode at position ${i}`);
    }
    toks.push({ type, value: ch, pos: i });
  }
  return toks;
}

/**
 * Oracle 4 (SKILL.md §8): Independent recursive-descent parser.
 * Produces the ParseNode AST directly from the grammar without shunting-yard.
 */
export function parseRD(
  src: string,
  { notation = 'standard' }: { notation?: 'standard' | 'textbook' } = {}
): ParseNode {
  const toks = tokenizeOracle(src, { notation });
  let i = 0;

  const peek = (): OracleToken | undefined => toks[i];
  const startsAtom = (t?: OracleToken): boolean =>
    t !== undefined && ['SYMBOL', 'EPSILON', 'EMPTY', 'LPAREN'].includes(t.type);
  const isPost = (t?: OracleToken): boolean =>
    t !== undefined && ['STAR', 'PLUS', 'OPT'].includes(t.type);

  const parseUnion = (): ParseNode => {
    let left = parseConcat();
    while (peek() && peek()!.type === 'UNION') {
      i++;
      const right = parseConcat();
      left = { k: 'union', l: left, r: right };
    }
    return left;
  };

  const parseConcat = (): ParseNode => {
    const t = peek();
    if (!startsAtom(t)) {
      throw new Error(`Expected operand at position ${t?.pos ?? src.length}`);
    }
    let left = parsePostfix();
    while (startsAtom(peek())) {
      const right = parsePostfix();
      left = { k: 'cat', l: left, r: right };
    }
    return left;
  };

  const parsePostfix = (): ParseNode => {
    let a = parseAtom();
    while (isPost(peek())) {
      const t = toks[i++];
      const k = t.type.toLowerCase() as 'star' | 'plus' | 'opt';
      a = { k, c: a };
    }
    return a;
  };

  const parseAtom = (): ParseNode => {
    const t = toks[i++];
    if (!t) throw new Error('Unexpected end of input');
    switch (t.type) {
      case 'SYMBOL':
        return { k: 'sym', v: t.value };
      case 'EPSILON':
        return { k: 'eps' };
      case 'EMPTY':
        return { k: 'empty' };
      case 'LPAREN': {
        const e = parseUnion();
        const close = toks[i++];
        if (!close || close.type !== 'RPAREN') {
          throw new Error(`Unclosed '(' at position ${t.pos}`);
        }
        return e;
      }
      default:
        throw new Error(`Unexpected token '${t.value}' at position ${t.pos}`);
    }
  };

  if (toks.length === 0) {
    throw new Error('Empty expression');
  }

  const ast = parseUnion();
  if (i < toks.length) {
    throw new Error(`Unmatched '${toks[i].value}' at position ${toks[i].pos}`);
  }
  return ast;
}

/**
 * Generates all strings over an alphabet up to length maxLen in shortlex order.
 */
export function allStrings(alphabet: string[], maxLen: number): string[] {
  let out: string[] = [''];
  let layer: string[] = [''];
  for (let len = 1; len <= maxLen; len++) {
    layer = layer.flatMap((s) => alphabet.map((a) => s + a));
    out = out.concat(layer);
  }
  return out;
}

/**
 * Oracle 1: Bounded-language enumerator (semantics executed literally, up to length k).
 */
export function lang(ast: ParseNode, k: number): Set<string> {
  if (k < 0) return new Set();
  switch (ast.k) {
    case 'empty':
      return new Set();
    case 'eps':
      return new Set(['']);
    case 'sym':
      return k >= 1 ? new Set([ast.v]) : new Set();
    case 'union':
      return new Set([...lang(ast.l, k), ...lang(ast.r, k)]);
    case 'cat': {
      const A = lang(ast.l, k);
      const B = lang(ast.r, k);
      const R = new Set<string>();
      for (const x of A) {
        for (const y of B) {
          if (x.length + y.length <= k) {
            R.add(x + y);
          }
        }
      }
      return R;
    }
    case 'star': {
      const A = lang(ast.c, k);
      let S = new Set<string>(['']);
      while (true) {
        const next = new Set<string>(S);
        for (const x of A) {
          for (const y of S) {
            if (x.length + y.length <= k) {
              next.add(x + y);
            }
          }
        }
        if (next.size === S.size) {
          return S;
        }
        S = next;
      }
    }
    case 'plus': {
      const A = lang(ast.c, k);
      const St = lang({ k: 'star', c: ast.c }, k);
      const R = new Set<string>();
      for (const x of A) {
        for (const y of St) {
          if (x.length + y.length <= k) {
            R.add(x + y);
          }
        }
      }
      return R;
    }
    case 'opt': {
      const S = new Set<string>(lang(ast.c, k));
      S.add('');
      return S;
    }
  }
}

/**
 * Oracle 2: Brzozowski derivatives with smart constructors.
 */
const E0: ParseNode = { k: 'empty' };
const E1: ParseNode = { k: 'eps' };

function sameNode(x: ParseNode, y: ParseNode): boolean {
  return JSON.stringify(x) === JSON.stringify(y);
}

function U(x: ParseNode, y: ParseNode): ParseNode {
  if (x.k === 'empty') return y;
  if (y.k === 'empty') return x;
  if (sameNode(x, y)) return x;
  return { k: 'union', l: x, r: y };
}

function C(x: ParseNode, y: ParseNode): ParseNode {
  if (x.k === 'empty' || y.k === 'empty') return E0;
  if (x.k === 'eps') return y;
  if (y.k === 'eps') return x;
  return { k: 'cat', l: x, r: y };
}

export function nullable(r: ParseNode): boolean {
  switch (r.k) {
    case 'empty':
    case 'sym':
      return false;
    case 'eps':
    case 'star':
    case 'opt':
      return true;
    case 'union':
      return nullable(r.l) || nullable(r.r);
    case 'cat':
      return nullable(r.l) && nullable(r.r);
    case 'plus':
      return nullable(r.c);
  }
}

export function deriv(r: ParseNode, a: string): ParseNode {
  switch (r.k) {
    case 'empty':
    case 'eps':
      return E0;
    case 'sym':
      return r.v === a ? E1 : E0;
    case 'union':
      return U(deriv(r.l, a), deriv(r.r, a));
    case 'cat': {
      const d = C(deriv(r.l, a), r.r);
      return nullable(r.l) ? U(d, deriv(r.r, a)) : d;
    }
    case 'star':
      return C(deriv(r.c, a), r);
    case 'plus':
      return C(deriv(r.c, a), { k: 'star', c: r.c });
    case 'opt':
      return deriv(r.c, a);
  }
}

export function derivMatch(ast: ParseNode, w: string): boolean {
  let r = ast;
  for (const a of Array.from(w)) {
    r = deriv(r, a);
  }
  return nullable(r);
}

/**
 * Oracle 3: Wrapping RegExp translator.
 * Wraps EVERY operand in a non-capturing group.
 */
export function toJs(ast: ParseNode): string {
  switch (ast.k) {
    case 'sym':
      return ast.v.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    case 'eps':
      return '(?:)';
    case 'empty':
      return '(?!)';
    case 'union':
      return `(?:${toJs(ast.l)}|${toJs(ast.r)})`;
    case 'cat':
      return `(?:${toJs(ast.l)}${toJs(ast.r)})`;
    case 'star':
      return `(?:${toJs(ast.c)})*`;
    case 'plus':
      return `(?:${toJs(ast.c)})+`;
    case 'opt':
      return `(?:${toJs(ast.c)})?`;
  }
}

/**
 * Worker runner for RegExp with a 2-second timeout cap per expression.
 */
import { Worker } from 'node:worker_threads';

export interface RegExpResult {
  matches?: boolean[];
  timeout: boolean;
  error?: string;
}

export class RegExpRunner {
  private worker: Worker | null = null;
  private idSeq = 0;

  constructor() {
    this.spawn();
  }

  private spawn(): void {
    const workerUrl = new URL('./regexp-worker.cjs', import.meta.url);
    this.worker = new Worker(workerUrl);
  }

  public testMatches(pattern: string, strings: string[], timeoutMs = 2000): Promise<RegExpResult> {
    return new Promise((resolve) => {
      const id = ++this.idSeq;
      let settled = false;

      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        this.spawn();
        resolve({ timeout: true });
      }, timeoutMs);

      const onMessage = (msg: any) => {
        if (msg && msg.id === id) {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          if (this.worker) {
            this.worker.off('message', onMessage);
          }
          resolve({ matches: msg.matches, timeout: false, error: msg.error });
        }
      };

      if (this.worker) {
        this.worker.on('message', onMessage);
        this.worker.postMessage({ id, pattern, strings });
      } else {
        clearTimeout(timeoutTimer);
        resolve({ timeout: false, error: 'Worker not available' });
      }
    });
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}
