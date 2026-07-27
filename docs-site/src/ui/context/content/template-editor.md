# Template editor

`TemplateEditor` edits HTML and Liquid source with syntax highlighting and completions. The caller owns the template value, allowed variables, rendering, validation, persistence, and delivery.

## Use the template editor

Use it for operator-managed email, document, or PDF templates.

Compose it with `TemplatePreview` and `TemplateSampleData` when editors need to compare source and output. `createTemplateEditorPanesValue()` provides the shared source-and-preview pane layout.

## Import

```tsx
import {
  createTemplateEditorPanesValue,
  TemplateEditor,
  TemplatePreview,
  TemplateSampleData,
  type TemplateVariable,
} from "@valentinkolb/cloud/ui";

import {
  renderLiquidTemplate,
  validateLiquidTemplate,
} from "@valentinkolb/cloud/shared";
```

## State and variables

`TemplateEditor` is controlled through a `value` accessor and `onInput`. `variables` supplies completion names and optional kinds:

```ts
type TemplateVariable = {
  name: string;
  kind?: "string" | "email" | "url" | "number" | "boolean" | "array" | "object";
};
```

Variables complete inside Liquid values and conditions. Array variables also complete as loops. HTML tag completions start with `<`.

`TemplateSampleData` edits string samples for the declared variables. The parent owns those values and passes the resulting rendered document to `TemplatePreview`.

## Rendering and composition

The editor does not render or save templates. Validate and render with the shared Liquid helpers. They use strict variables and filters, escape interpolated output by default, allow a bounded tag set, and enforce input and output limits.

`TemplatePreview` displays the caller's HTML in a sandboxed iframe. Keep preview rendering separate from the final delivery path and do not expose internal renderer errors to end users.

Use `fill` inside a stable pane or workspace. Use `lines` for a content-sized form.

## Accessibility

`TemplateEditor` inherits the keyboard, native textarea, composition, and toolbar behavior of `AutocompleteEditor`. Variable suggestions include visible names and kinds.

The preview iframe has the accessible name **Template preview**. Keep source editing available because the preview alone cannot communicate template structure.

## Runtime

Editing, completion, sample values, pane resizing, and reactive preview updates require hydration.

`renderLiquidTemplate()` is synchronous and can produce a local preview. PDF generation and final delivery remain server operations.

## Example

```tsx
const variables: TemplateVariable[] = [
  { name: "APP_NAME", kind: "string" },
  { name: "LOGIN_URL", kind: "url" },
];

const [template, setTemplate] = createSignal(
  '<p>Welcome to {{ APP_NAME }}.</p><a href="{{ LOGIN_URL }}">Sign in</a>',
);
const [sample, setSample] = createSignal({
  APP_NAME: "Cloud",
  LOGIN_URL: "https://cloud.example.org/auth/login",
});

const preview = createMemo(() =>
  renderLiquidTemplate(template(), sample()),
);

<TemplateEditor
  value={template}
  onInput={setTemplate}
  variables={variables}
/>

<TemplatePreview html={preview} />
```
