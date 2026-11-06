# 0003 Two independent front-ends, specified error messages

Status: proposed, 3 Nov 2026

## Context
The M1 pipeline (insert concatenation, shunting-yard, stack build) accepts and rejects exactly the same inputs as an independent recursive-descent parser: 0 disagreements on 2.16 million inputs, and identical parse trees on every valid one (`docs/research/evidence/02-frontend-fuzz.txt`). But on invalid inputs the two name a different error for about 70% of cases and a different position for about 50%, and the pipeline sometimes reports the synthetic concatenation token or no position (for example `a(|b)c` is blamed on position 1, while the real problem is the `|` at position 2).

## Decision
- The product keeps shunting-yard, because the postfix form is something students are meant to see.
- A pre-validation pass runs first and produces the error table in `.agents/skills/thompson-rules/SKILL.md`, always pointing at the offending token.
- A recursive-descent parser lives in test support only. It is an independent oracle for the parse tree. It does not ship.

## Consequences
- Accepting or rejecting an input has two independent implementations that must agree, which is checked by a property test.
- Error wording and positions are specified and tested against golden cases, not left to whatever the algorithm happens to do.
- The taxonomy is a product decision; changing it means changing the golden cases, not the parser.
