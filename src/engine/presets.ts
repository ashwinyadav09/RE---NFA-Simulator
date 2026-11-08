export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly regex: string;
  readonly notation: 'standard' | 'textbook';
  readonly concatenation?: 'epsilon-link' | 'merge';
  readonly testInput?: string;
  readonly description?: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'worked-example',
    name: '(a|b)*a (Worked example)',
    regex: '(a|b)*a',
    notation: 'standard',
    concatenation: 'epsilon-link',
    testInput: 'ba\na\nbb\n',
    description: 'The M1 hand-solved example: 10 states, 12 transitions'
  },
  {
    id: 'classic-abb',
    name: '(a|b)*abb (Classic textbook)',
    regex: '(a|b)*abb',
    notation: 'standard',
    concatenation: 'epsilon-link',
    testInput: 'abb\naabb\nbabb\nabab\n',
    description: 'Classic textbook example: 14 states (ε-link) or 11 states (merge)'
  },
  {
    id: 'star-b',
    name: 'a*b (Zero-or-more then b)',
    regex: 'a*b',
    notation: 'standard',
    concatenation: 'epsilon-link',
    testInput: 'b\nab\naaab\na\n',
    description: 'Classic single-star sequence: 6 states, 7 transitions'
  },
  {
    id: 'textbook-union',
    name: '(a+b)*a (Textbook union)',
    regex: '(a+b)*a',
    notation: 'textbook',
    concatenation: 'epsilon-link',
    testInput: 'ba\na\n',
    description: 'Textbook notation using + for union'
  },
  {
    id: 'textbook-merge',
    name: '(a+b)*abb (Textbook merge)',
    regex: '(a+b)*abb',
    notation: 'textbook',
    concatenation: 'merge',
    testInput: 'abb\naabb\n',
    description: 'Textbook notation with merge concatenation: 11 states, 13 transitions'
  },
  {
    id: 'plus-optional',
    name: 'a+? (Plus and optional)',
    regex: 'a+?',
    notation: 'standard',
    concatenation: 'epsilon-link',
    testInput: 'a\naa\n\n',
    description: 'Stacked unary operators: (a+)?'
  },
  {
    id: 'nested-stars',
    name: 'a** (Nested stars)',
    regex: 'a**',
    notation: 'standard',
    concatenation: 'epsilon-link',
    testInput: 'a\naaa\n\n',
    description: 'Nested stars: (a*)*'
  },
  {
    id: 'binary-pattern',
    name: '(0|1)*(00|11) (Binary repeated bit)',
    regex: '(0|1)*(00|11)',
    notation: 'standard',
    concatenation: 'epsilon-link',
    testInput: '00\n11\n0100\n0101\n',
    description: 'Binary strings ending in 00 or 11'
  },
  {
    id: 'textbook-eps',
    name: '(a+ε)b (Textbook optional via ε)',
    regex: '(a+ε)b',
    notation: 'textbook',
    concatenation: 'epsilon-link',
    testInput: 'ab\nb\n',
    description: 'Textbook notation with explicit ε transition'
  }
];
