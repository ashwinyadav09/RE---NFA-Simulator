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
