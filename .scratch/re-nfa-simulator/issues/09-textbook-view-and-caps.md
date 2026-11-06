# 09: Textbook view and size caps

**What to build:** Large expressions stay readable: finished sub-automata are drawn as labelled boxes and only the newest operator is expanded. Expressions above the stepping cap still build.

**Blocked by:** 07: Construction stepper

**Status:** ready-for-agent

- [ ] `view-toggle` switches between flat and textbook. The textbook view draws each finished fragment as a box labelled with its sub-expression, with an in-port and an out-port, and expands only the newest operator's states and edges.
- [ ] Flat stepping is available up to 150 postfix tokens and textbook up to 400. Beyond 400 the diagram is off but the table, simulation and tests still work. Beyond 2,000 the build is refused. Each message states its limit, and the limits live in one config object.
- [ ] Diagram seam tests cover the boxes (ids, ports, labels) and the three cap boundaries.
- [ ] The browser smoke builds a 160-token expression, sees the textbook view offered and flat stepping disabled with the message.
