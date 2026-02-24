# Decision Priorities

Use this order for implementation decisions:

1. Contract and boundary correctness.
2. Readability and simplicity.
3. Reuse before adding abstraction.
4. Smallest change that solves the current problem.

## Anti-Patterns to Avoid

- Designing for hypothetical use cases.
- App code importing package internals.
- Business logic buried in API handlers.
- Copy-paste logic across apps without shared helper extraction.

## Good Tradeoffs

- Repeat tiny local code if abstraction would reduce clarity.
- Introduce helpers only after repeated and stable pattern appears.
- Prefer explicit data flow over hidden global state.

## Practical Review Questions

- Is the same business rule now implemented twice?
- Can a new contributor understand this file in one pass?
- Did we preserve existing contract behavior?
- Is any new complexity justified by real current need?
