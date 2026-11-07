import * as fc from 'fast-check';
import type { ParseNode } from '../src/engine/index';

export function astSize(ast: ParseNode): number {
  if (ast.k === 'union' || ast.k === 'cat') {
    return 1 + astSize(ast.l) + astSize(ast.r);
  }
  if (ast.k === 'star' || ast.k === 'plus' || ast.k === 'opt') {
    return 1 + astSize(ast.c);
  }
  return 1;
}

const prec: Record<ParseNode['k'], number> = {
  union: 1,
  cat: 2,
  star: 3,
  plus: 3,
  opt: 3,
  sym: 4,
  eps: 4,
  empty: 4,
};

export function printAst(ast: ParseNode, notation: 'standard' | 'textbook' = 'standard'): string {
  const wrap = (child: ParseNode, parent: ParseNode, side: 'l' | 'r' | 'c'): string => {
    const s = printAst(child, notation);
    const pc = prec[child.k];
    const pp = prec[parent.k];
    let paren = pc < pp;
    if (!paren && pc === pp && (parent.k === 'union' || parent.k === 'cat') && side === 'r') {
      paren = true;
    }
    return paren ? `(${s})` : s;
  };

  switch (ast.k) {
    case 'sym':
      return ast.v;
    case 'eps':
      return '@';
    case 'empty':
      return '#';
    case 'union':
      return wrap(ast.l, ast, 'l') + (notation === 'standard' ? '|' : '+') + wrap(ast.r, ast, 'r');
    case 'cat':
      return wrap(ast.l, ast, 'l') + wrap(ast.r, ast, 'r');
    case 'star':
      return wrap(ast.c, ast, 'c') + '*';
    case 'plus':
      return wrap(ast.c, ast, 'c') + '+';
    case 'opt':
      return wrap(ast.c, ast, 'c') + '?';
  }
}

export function attachFormat<T extends ParseNode>(node: T): T {
  Object.defineProperty(node, fc.toStringMethod, {
    value: function () {
      return printAst(this);
    },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(node, 'toString', {
    value: function () {
      return printAst(this);
    },
    enumerable: false,
    configurable: true,
  });
  return node;
}

export interface AstArbOptions {
  notation?: 'standard' | 'textbook';
  alphabet?: string[];
}

export function makeAstArb(options: AstArbOptions = {}): fc.Arbitrary<ParseNode> {
  const notation = options.notation ?? 'standard';
  const alphabet = options.alphabet ?? ['a', 'b'];

  const letterArb = fc.constantFrom(...alphabet).map(v => attachFormat({ k: 'sym', v } as ParseNode));
  const leafArb = fc.oneof(
    { weight: 6, arbitrary: letterArb },
    { weight: 1, arbitrary: fc.constant(attachFormat({ k: 'eps' } as ParseNode)) },
    { weight: 1, arbitrary: fc.constant(attachFormat({ k: 'empty' } as ParseNode)) }
  );

  const unaryOps = notation === 'standard'
    ? (['star', 'plus', 'opt'] as const)
    : (['star', 'opt'] as const);

  return fc.letrec<Record<'expr' | 'unary' | 'binary', ParseNode>>(tie => ({
    expr: fc.oneof(
      { depthSize: 'large', withCrossShrink: true, maxDepth: 6 },
      { weight: 2, arbitrary: leafArb },
      { weight: 3, arbitrary: tie('unary') },
      { weight: 5, arbitrary: tie('binary') }
    ),
    unary: fc.record({
      k: fc.constantFrom(...unaryOps),
      c: tie('expr'),
    }).map(u => attachFormat(u as ParseNode)),
    binary: fc.record({
      k: fc.constantFrom('union' as const, 'cat' as const),
      l: tie('expr'),
      r: tie('expr'),
    }).map(b => attachFormat(b as ParseNode)),
  })).expr.filter(ast => astSize(ast) <= 60);
}
