# Frontend Patterns

## 1) SSR + Island Split

- SSR pages fetch/prepare initial data.
- Islands handle interaction/mutation-only behavior.
- Keep SSR usable when JS is delayed.

Pattern sources:

- Files app pages + islands
- Notebooks editor/sidebar/settings islands
- Spaces detail/edit/filter islands

## 2) Mutations via `mutation.create`

Use `mutation.create` for async UI state and consistent error handling.

```ts
const requestMutation = mutation.create({
  mutation: async (data: Payload) => {
    const res = await api.app.example.$post({ json: data });
    if (!res.ok) throw new Error("Failed to save");
    return res.json();
  },
  onSuccess: () => { /* update UI or navigate */ },
  onError: (err) => prompts.error(err.message),
});
```

Where:

- `mutation.create`: `cloud/packages/lib/src/browser/mutation.ts`

## 3) User Feedback via `prompts.*`

Use shared prompts instead of ad-hoc dialogs/alerts.

- `prompts.error(message)`
- `prompts.confirm(message, options)`
- `prompts.dialog((close) => <CustomUI />)`

Where:

- `cloud/packages/lib/src/ui/prompts.tsx`

## 4) URL As Source of Truth

Keep page state in URL when state matters across reload/back/forward:

- search
- filters
- pagination
- selected detail item

Use replace-state selection pattern for hybrid detail panels:

- `cloud/packages/lib/src/browser/detail-panel.ts`
- Files context pattern source:
  `cloud/packages/apps/src/files/frontend/_components/context.ts`

## 5) Shared Components First

Prefer:

- `TextInput`, `Select`, `Switch`, `Checkbox`, `ColorInput`
- `Dropdown`, `RemoveBtn`, `PermissionEditor`, `ProgressBar`, `Pagination`
- island wrappers: `SearchBar` (`@valentinkolb/cloud/lib/islands`)
- UI components: `EntitySearch`, `CopyButton`, `Lightbox`

Only create local components when shared primitives cannot model the interaction.

### Common Form Stack

- `TextInput`, `Select`, `Checkbox`, `Switch`, `DateTimeInput`, `ColorInput`
- `RemoveBtn` for destructive row removal controls
- `SearchBar` for searchable list headers (enter-to-search + clear UX)
- `PermissionEditor` for ACL screens

Use shared props (`label`, `description`, `error`, `required`) before custom wrappers.

### Disabled + Visual Contract

- Build interactive UI with semantic `button`/`input` elements and native `disabled`.
- Do not fake disabled with parent opacity wrappers.
- If an action callback is missing, disable related actions automatically.
- UI Lab disabled behavior is canonical for reusable primitives; do not override locally unless the primitive itself is being updated.

## 6) Design Language (Refined)

- Favor clean spacing and grouping over heavy bordering.
- Use subtle hover transitions and clear focus states.
- Avoid Bootstrap-like noisy UI stacks.
- Prefer icon-only utility actions where context is obvious.
- Keep destructive actions visually distinct and confirmable.
- Segmented controls should keep one active emphasis layer only (no stacked ring+border effects).
- Keep segmented dividers CSS-first and show them only between inactive neighbors.

This is guidance, not a lockstep template; new visual compositions are welcome when consistency and accessibility stay intact.

## 7) Interaction Hierarchy

1. Primary page actions: explicit text button (stable location).
2. Contextual utility actions: icon-only or subtle button.
3. Destructive actions: clear danger style + confirm prompt.
4. High-frequency list actions should avoid visual clutter.

## 8) Accessibility Checklist

- Interactive elements keyboard reachable.
- Clear `aria-label` for icon-only actions.
- Focus indicators remain visible.
- Labels/field descriptions are present and meaningful.
- Avoid accidental text selection for rapid toggles/checkbox labels.
