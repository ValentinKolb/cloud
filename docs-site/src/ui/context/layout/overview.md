# AppOverview

`AppOverview` is the landing-page shell for an application. It provides the app identity, a primary content column, an optional aside, and a shared empty state.

The application owns search, URL state, cards, creation, and mutations.

## Use AppOverview

Use it when an app opens with a resource collection and a small set of create actions.

Use `AppWorkspace` when the screen needs persistent navigation, contextual detail, drawers, or a fill-height work area.

## Import

```tsx
import { AppOverview } from "@valentinkolb/cloud/ui";
```

## Compose the page

Pass the application `title`, `subtitle`, and Tabler `icon` to the root.

Use `AppOverview.Main` for the collection. Its `toolbar` slot suits a search field or one compact filter.

Use `AppOverview.Aside` for a short create menu. Keep its title action-oriented, such as `Create`.

Use `AppOverview.EmptyState` inside the main collection when there are no matching resources. Put the relevant create or reset action in its children.

The component supplies responsive columns and a maximum page width. Do not wrap it in another page container.

## Accessibility

The root renders the page heading. Main and aside titles render section headings.

Every create card must be a real button or link with a specific label. Empty-state actions must state what they create or reset.

## Runtime

`AppOverview` renders on the server. Interactive search and create controls belong in islands.

Keep shareable search and filter state in the URL. The server should return the matching collection.

## Example

```tsx
<AppOverview
  title="Notebooks"
  subtitle="Shared notes and prompts"
  icon="ti ti-notebook"
>
  <AppOverview.Main
    title="Your notebooks"
    description={`${total} notebooks`}
    toolbar={<NotebookSearch value={search} />}
  >
    {notebooks.length > 0 ? (
      <NotebookGrid notebooks={notebooks} />
    ) : (
      <AppOverview.EmptyState
        title="No notebooks found"
        description="Create a notebook or reset the search."
        icon="ti ti-notebook-off"
      >
        <a class="btn-primary btn-sm" href="/app/notebooks/new">
          New notebook
        </a>
      </AppOverview.EmptyState>
    )}
  </AppOverview.Main>

  <AppOverview.Aside
    title="Create"
    description="Choose a starter, or start blank."
  >
    <NotebookStarters />
  </AppOverview.Aside>
</AppOverview>
```
