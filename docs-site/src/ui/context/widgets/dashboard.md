# Dashboard widgets

Dashboard widgets let an application contribute a small server-owned view to the shared dashboard. The app owns the endpoint, data, permissions, and links. The dashboard owns layout and rendering.

## Use dashboard widgets

Add a widget when users need a compact cross-application summary or a direct route into a common task.

Do not reproduce a complete application screen. Return a few useful blocks and link the widget or list rows to the owning application.

## Import

```ts
import type {
  WidgetBlock,
  WidgetResponse,
} from "@valentinkolb/cloud/contracts";
```

Applications register endpoints through `defineApp()`:

```ts
widgets: [
  {
    id: "recent",
    path: "/api/notebooks/widget/recent",
    presentation: {
      defaultZone: "overview",
      defaultSpan: "wide",
    },
  },
],
```

`presentation` is only the initial recommendation. Explicit user layout choices take precedence.

## Endpoint ownership

The dashboard forwards the user's session cookie when it fetches the registered path. The endpoint must authenticate the request and apply every role and resource permission needed by its query.

Return:

- `200` with `WidgetResponse` to render content;
- `204` when there is no relevant content and the widget should be skipped;
- `403` when the widget exists but the user lacks the required access;
- another error only for a real failure.

One slow or failed endpoint must not block the dashboard. Keep widget queries bounded and fast.

## Response blocks

`WidgetResponse` contains `title`, optional `icon`, `href`, and `meta`, plus an ordered `blocks` array.

Available blocks are:

- `stat` for one labeled value with optional context and accent;
- `list` for linked or static rows;
- `status` for health or state;
- `pills` for compact labeled values;
- `placeholder` for unavailable content inside a rendered widget;
- `hero` for one centered all-clear, empty, or spotlight message.

`grow` lets stat, list, status, or pills blocks fill remaining widget height. Compose only the blocks the response needs.

## Accessibility

Every stat needs a visible label and enough context to interpret its value. Status blocks include visible text; tone and icons are supplementary.

Widget and row links need labels that make sense at their destination. Do not encode a result only in color, icon, or block order.

## Runtime

The dashboard fetches widget endpoints during its server render with a bounded timeout, then renders the response through the shared widget components.

Widget response blocks are JSON. Application endpoints must not return Solid elements or presentation-specific HTML.

## Example

```ts
import type { WidgetResponse } from "@valentinkolb/cloud/contracts";
import {
  type AuthContext,
  auth,
  getUserBackedActor,
} from "@valentinkolb/cloud/server";
import { Hono } from "hono";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("*"))
  .get("/recent", async (c) => {
    const user = getUserBackedActor(c);
    if (!user) return c.body(null, 204);

    const notes = await notebooksService.note.recentForUser({
      userId: user.id,
      limit: 5,
    });
    if (notes.length === 0) return c.body(null, 204);

    const body: WidgetResponse = {
      title: "Recent notes",
      icon: "ti ti-notebook",
      href: "/app/notebooks",
      blocks: [
        {
          kind: "list",
          grow: true,
          items: notes.map((note) => ({
            label: note.title,
            sub: note.notebookName,
            href: `/app/notebooks/${note.notebookId}/notes/${note.id}`,
          })),
        },
      ],
    };

    return c.json(body);
  });
```
