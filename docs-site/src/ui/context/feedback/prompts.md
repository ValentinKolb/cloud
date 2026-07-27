# Prompts

`prompts` opens modal alert, confirmation, input, search, form, and custom-dialog flows. Every method returns a promise, so the calling action can continue from the result.

The application owns the decision, validation rules, and side effect. The prompt owns modal stacking, focus, dismissal, and shared presentation.

## Use prompts

Use a prompt when the user must acknowledge information, choose a result, or provide a small amount of data before work continues.

Use a toast for non-blocking feedback. Use `PanelDialog` for a persistent editor with tabs, sections, or a larger application workflow.

## Import

```tsx
import {
  DialogHeader,
  openSpotlightSearch,
  prompts,
  SpotlightButton,
  type PromptSearchItem,
} from "@valentinkolb/cloud/ui";
```

## Properties

### Choose a prompt

| Method | Result | Use |
| --- | --- | --- |
| `prompts.alert(content, options)` | resolves when closed | Information that requires acknowledgement. |
| `prompts.success(content, options)` | resolves when closed | Successful result that requires acknowledgement. |
| `prompts.error(content, options)` | resolves when closed | Failure details that must be read. |
| `prompts.confirm(content, options)` | `boolean` | One confirm-or-cancel decision. |
| `prompts.prompt(content, defaultValue, options)` | `string \| null` | One text value. |
| `prompts.promptNumber(content, defaultValue, options)` | `number \| null` | One numeric value with optional `min` and `max`. |
| `prompts.form(config)` | typed values or `null` | A small declarative form. |
| `prompts.search(resolver, options)` | selected item or `undefined` | An asynchronous picker. |
| `prompts.dialog(component, options)` | caller-defined result | Custom content and actions. |

Cancellation returns `false`, `null`, or `undefined` according to the method. Handle it before starting a mutation.

### Dialog options

| Property | Purpose |
| --- | --- |
| `title`, `icon` | Name the dialog and add a Tabler icon. |
| `confirmText`, `cancelText` | Override action labels. `cancelText: false` hides the cancel button in `prompts.form`. |
| `variant` | Selects `primary`, `success`, or `danger` action treatment. |
| `size` | Selects `small`, `medium`, `large`, or `wide`. |
| `surface` | Uses the standard panel or a caller-owned `bare` surface. |
| `header` | Set to `false` when a custom dialog owns its header. |

Use `surface: "bare"` with `header: false` only when the custom content supplies complete visible panel structure and a close control.

## Forms

`prompts.form` infers its return type from the field schema. Supported field types are:

- `text`, including multiline, password, and markdown options;
- `number`;
- `image`;
- `pin`;
- `select`;
- `tags`;
- `boolean`;
- `datetime`, with optional date-only mode;
- `info`, which displays content and is excluded from the result.

Fields share `label`, `description`, `placeholder`, `required`, `default`, and a `validate` function where applicable. Validation returns an error string or `null`.

```tsx
const values = await prompts.form({
  title: "Add member",
  icon: "ti ti-user-plus",
  fields: {
    name: {
      type: "text",
      label: "Name",
      required: true,
    },
    role: {
      type: "select",
      label: "Role",
      options: [
        { id: "admin", label: "Admin" },
        { id: "user", label: "User" },
      ],
    },
    active: {
      type: "boolean",
      label: "Active",
      default: true,
    },
  },
});

if (!values) return;
```

## Search

The search resolver receives the current query and an `AbortSignal`. It returns items with a `label` and optional `desc`, `icon`, `previewUrl`, `value`, or `onClick`.

Search options include `placeholder`, `initialQuery`, `minQueryLength`, `debounceMs`, `emptyText`, and `noResultsText`.

Honor the abort signal when the resolver calls a remote API:

```tsx
const selected = await prompts.search(
  async ({ query, abortSignal }) => {
    const response = await fetch(`/api/users?q=${encodeURIComponent(query)}`, {
      signal: abortSignal,
    });
    const users = await response.json();

    return users.map((user) => ({
      label: user.name,
      desc: user.email,
      value: user,
      icon: "ti ti-user",
    }));
  },
  {
    title: "Assign owner",
    minQueryLength: 1,
    noResultsText: "No matching people.",
  },
);
```

Use `openSpotlightSearch` for application or workspace navigation. It supplies search-oriented defaults around `prompts.search`. `SpotlightButton` provides matching triggers for ordinary, compact, chip, sidebar, mobile-sidebar, and icon placements.

## Custom dialogs

`prompts.dialog` passes a typed `close(result)` callback to the component. Use it when the standard methods cannot express the content or actions.

`DialogHeader` supplies the shared title, icon, and close row for custom bodies that set `header: false`.

```tsx
const result = await prompts.dialog<"publish" | "draft">(
  (close) => (
    <>
      <DialogHeader
        title="Publish changes"
        icon="ti ti-rocket"
        close={() => close(undefined)}
      />
      <div class="flex justify-end gap-2">
        <button class="btn-secondary btn-sm" onClick={() => close("draft")}>
          Save draft
        </button>
        <button class="btn-primary btn-sm" onClick={() => close("publish")}>
          Publish
        </button>
      </div>
    </>
  ),
  { header: false },
);
```

## Accessibility

Use specific titles and action labels. Destructive confirmations should name the object and consequence. Do not hide the cancel action when cancellation is a valid path.

The shared dialog core owns focus and Escape handling. Custom bodies still need semantic headings, labelled controls, native buttons, and an explicit close path.

Search results need unique, descriptive labels. A preview or icon may supplement the label but cannot replace it.

## Runtime

Prompts are browser interactions and must be called from hydrated code. Their content is mounted into the shared modal dialog stack at runtime.

Do not call a prompt during server rendering. Await it from an event handler, then start the mutation only after a confirmed result.

## Example

```tsx
const removeProject = async () => {
  const confirmed = await prompts.confirm(
    "Delete Project Atlas and its stored data?",
    {
      title: "Delete project",
      confirmText: "Delete project",
      variant: "danger",
    },
  );

  if (!confirmed) return;
  await deleteProject("atlas");
};
```
