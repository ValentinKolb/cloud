# Rule Matrix

Use this matrix when deciding between competing implementations.

## Decision Order

1. Correctness and safety
2. Simplicity and readability
3. Consistency with existing cloud patterns
4. Reuse (only when it improves clarity)

## Language and Typing

- Prefer `type` aliases for object shapes.
- Let TypeScript infer return types unless inference is poor.
- Avoid `any`; use specific types or `unknown`.
- Model missing values with `null`, not sentinel empty strings.

## Function and Module Style

- Prefer small arrow functions with one clear responsibility.
- Keep side effects explicit and local.
- Document only non-obvious behavior or assumptions.
- Split long files into clear sections (types, helpers, public API).

## Async and Error Handling

- Prefer `async/await` over chained `.then()`.
- Handle expected errors through `Result` and `respond(...)`.
- Throw only for truly unexpected/broken states.

## Data and State

- Default to immutable updates.
- Pass dependencies/state explicitly.
- Avoid hidden module-level mutable state unless required by runtime lifecycle.

## API and Service Boundary

- Service owns domain logic.
- API validates, authorizes, calls service, and maps response only.
- Keep auth and validation at route boundary.

## Frontend and Accessibility

- SSR-first with islands for interaction.
- Reuse shared client components and prompts/mutation helpers.
- Keyboard and focus behavior must match click behavior.
- Labels must be associated correctly, or use semantic text elements when no form control exists.

## Practical Anti-Patterns

- Do not add "future options" without active use case.
- Do not introduce abstraction layers for one-time usage.
- Do not duplicate shared constants/types across packages.
- Do not bypass package boundaries with deep imports.
