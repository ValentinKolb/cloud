import { markdown } from "@valentinkolb/cloud/shared";
import { DateRangePicker, ImageInput, MarkdownView, Placeholder, prompts, SegmentedControl, TextInput } from "@valentinkolb/cloud/ui";
import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import type { PublicSection, PublicSectionInput } from "../../../contracts";
import { DialogFrame } from "./schedule";

type MenuItemDraft = {
  id: string;
  name: string;
  description: string;
  info: string;
  price: string;
  image: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
};

type LinkDraft = {
  id: string;
  label: string;
  href: string;
};

export const sectionKindIcon = (kind: PublicSection["kind"]): string => {
  if (kind === "menu") return "ti ti-tools-kitchen-2";
  if (kind === "notice") return "ti ti-speakerphone";
  if (kind === "links") return "ti ti-link";
  return "ti ti-markdown";
};

const sectionText = (section: PublicSection, key: "markdown" | "text"): string => {
  const value = section.content[key];
  return typeof value === "string" ? value : "";
};

const readMenuItems = (section: PublicSection | null): MenuItemDraft[] => {
  const items = Array.isArray(section?.content.items) ? section.content.items : [];
  return items
    .map((raw, index) => {
      const item = raw as Record<string, unknown>;
      return {
        id: String(index + 1),
        name: String(item.name ?? ""),
        description: String(item.description ?? ""),
        info: String(item.info ?? item.allergens ?? ""),
        price: String(item.price ?? ""),
        image: typeof item.image === "string" ? item.image : null,
        availableFrom: typeof item.availableFrom === "string" ? item.availableFrom : null,
        availableUntil: typeof item.availableUntil === "string" ? item.availableUntil : null,
      };
    })
    .filter((item) => item.name || item.description || item.info || item.price || item.image);
};

const readLinks = (section: PublicSection | null): LinkDraft[] => {
  const links = Array.isArray(section?.content.links) ? section.content.links : [];
  return links
    .map((raw, index) => {
      const link = raw as Record<string, unknown>;
      return {
        id: String(index + 1),
        label: String(link.label ?? ""),
        href: String(link.href ?? ""),
      };
    })
    .filter((link) => link.label || link.href);
};

const menuContent = (items: MenuItemDraft[]) => ({
  items: items
    .map((item) => ({
      name: item.name.trim(),
      description: item.description.trim(),
      info: item.info.trim(),
      price: item.price.trim(),
      image: item.image || null,
      availableFrom: item.availableFrom,
      availableUntil: item.availableUntil,
    }))
    .filter((item) => item.name),
});

const linksContent = (links: LinkDraft[]) => ({
  links: links.map((link) => ({ label: link.label.trim(), href: link.href.trim() })).filter((link) => link.label && link.href),
});

const buildPublicSectionContent = (
  kind: PublicSection["kind"],
  text: string,
  items: MenuItemDraft[],
  links: LinkDraft[],
): { content: PublicSectionInput["content"]; error: null } | { content: null; error: string } => {
  if (kind === "menu") {
    const invalidRange = items.find((item) => item.availableFrom && item.availableUntil && item.availableFrom > item.availableUntil);
    if (invalidRange) {
      return { content: null, error: `${invalidRange.name.trim() || "Menu item"}: availability ends before it starts.` };
    }
    const content = menuContent(items);
    return content.items.length > 0 ? { content, error: null } : { content: null, error: "Add at least one menu item." };
  }

  if (kind === "links") {
    const content = linksContent(links);
    return content.links.length > 0 ? { content, error: null } : { content: null, error: "Add at least one link." };
  }

  return { content: { markdown: text, text }, error: null };
};

export function PublicSectionDialog(props: {
  close: (value: PublicSectionInput | null) => void;
  nextPosition: number;
  initial?: PublicSection;
  title?: string;
  submitLabel?: string;
}) {
  let nextItemId = 1;
  const newItem = (): MenuItemDraft => ({
    id: String(nextItemId++),
    name: "",
    description: "",
    info: "",
    price: "",
    image: null,
    availableFrom: null,
    availableUntil: null,
  });
  let nextLinkId = 1;
  const newLink = (): LinkDraft => ({ id: String(nextLinkId++), label: "", href: "" });
  const initialItems = readMenuItems(props.initial ?? null);
  const initialLinks = readLinks(props.initial ?? null);
  nextItemId = initialItems.length + 1;
  nextLinkId = initialLinks.length + 1;
  const [kind, setKind] = createSignal<PublicSection["kind"]>(props.initial?.kind ?? "markdown");
  const [title, setTitle] = createSignal(props.initial?.title ?? "");
  const [contentText, setContentText] = createSignal(
    props.initial ? sectionText(props.initial, props.initial.kind === "markdown" ? "markdown" : "text") : "",
  );
  const [items, setItems] = createStore<MenuItemDraft[]>(initialItems.length > 0 ? initialItems : [newItem()]);
  const [links, setLinks] = createStore<LinkDraft[]>(initialLinks.length > 0 ? initialLinks : [newLink()]);

  const updateItem = (id: string, patch: Partial<MenuItemDraft>) => {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) setItems(index, patch);
  };
  const updateLink = (id: string, patch: Partial<LinkDraft>) => {
    const index = links.findIndex((link) => link.id === id);
    if (index >= 0) setLinks(index, patch);
  };

  const addItem = () => setItems(items.length, newItem());
  const removeItem = (id: string) => {
    if (items.length > 1) setItems(items.filter((item) => item.id !== id));
  };
  const addLink = () => setLinks(links.length, newLink());
  const removeLink = (id: string) => {
    if (links.length > 1) setLinks(links.filter((link) => link.id !== id));
  };

  const submit = () => {
    if (!title().trim()) {
      prompts.error("Title is required.");
      return;
    }

    const result = buildPublicSectionContent(kind(), contentText(), Array.from(items), Array.from(links));
    if (result.error || !result.content) {
      prompts.error(result.error ?? "Section content is invalid.");
      return;
    }

    props.close({
      kind: kind(),
      title: title().trim(),
      content: result.content,
      enabled: true,
      position: props.nextPosition,
    });
  };

  return (
    <DialogFrame
      title={props.title ?? "Add public section"}
      icon={sectionKindIcon(kind())}
      submitLabel={props.submitLabel ?? "Add section"}
      onCancel={() => props.close(null)}
      onSubmit={submit}
    >
      <div class="grid gap-3">
        <Show
          when={!props.initial}
          fallback={
            <div class="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-secondary dark:bg-zinc-900">
              <i class={sectionKindIcon(kind())} />
              <span>
                {kind()[0]?.toUpperCase()}
                {kind().slice(1)} section
              </span>
            </div>
          }
        >
          <SegmentedControl
            value={kind}
            onChange={setKind}
            options={[
              { value: "markdown", label: "Markdown", icon: "ti ti-markdown" },
              { value: "menu", label: "Menu", icon: "ti ti-tools-kitchen-2" },
              { value: "notice", label: "Notice", icon: "ti ti-speakerphone" },
              { value: "links", label: "Links", icon: "ti ti-link" },
            ]}
          />
        </Show>
        <TextInput label="Title" description="Shown as the section heading on the public page." value={title} onInput={setTitle} required />
        <Show
          when={kind() === "menu"}
          fallback={
            <Show
              when={kind() === "links"}
              fallback={
                <TextInput
                  label="Content"
                  description="Text visitors see in this section."
                  value={contentText}
                  onInput={setContentText}
                  multiline
                  markdown={kind() === "markdown"}
                  lines={8}
                />
              }
            >
              <div class="grid gap-2">
                <For each={links}>
                  {(link, index) => (
                    <div class="paper p-3">
                      <div class="mb-3 flex items-center justify-between gap-2">
                        <p class="text-xs font-semibold uppercase tracking-wide text-dimmed">Link {index() + 1}</p>
                        <button type="button" class="btn-secondary btn-sm px-2 py-1 text-xs" onClick={() => removeLink(link.id)}>
                          <i class="ti ti-trash" /> Remove
                        </button>
                      </div>
                      <div class="grid gap-3 sm:grid-cols-2">
                        <TextInput
                          label="Label"
                          description="Visible text for this link."
                          value={() => link.label}
                          onInput={(value) => updateLink(link.id, { label: value })}
                          required
                        />
                        <TextInput
                          label="URL"
                          description="Destination opened when visitors click."
                          value={() => link.href}
                          onInput={(value) => updateLink(link.id, { href: value })}
                          placeholder="https://example.com"
                          required
                        />
                      </div>
                    </div>
                  )}
                </For>
                <button type="button" class="btn-secondary btn-sm justify-center" onClick={addLink}>
                  <i class="ti ti-plus" /> Add link
                </button>
              </div>
            </Show>
          }
        >
          <div class="grid gap-2">
            <For each={items}>
              {(item, index) => (
                <div class="paper p-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <p class="text-xs font-semibold uppercase tracking-wide text-dimmed">Item {index() + 1}</p>
                    <button type="button" class="btn-secondary btn-sm px-2 py-1 text-xs" onClick={() => removeItem(item.id)}>
                      <i class="ti ti-trash" /> Remove
                    </button>
                  </div>
                  <div class="grid gap-3">
                    <ImageInput
                      label="Image"
                      description="Optional square image for this menu item."
                      value={() => item.image}
                      onChange={(value) => updateItem(item.id, { image: value })}
                      variant="small"
                    />
                    <div class="grid gap-3 sm:grid-cols-2">
                      <TextInput
                        label="Name"
                        description="Main label for this item."
                        value={() => item.name}
                        onInput={(value) => updateItem(item.id, { name: value })}
                        required
                      />
                      <TextInput
                        label="Price"
                        description="Optional visible price or price range."
                        value={() => item.price}
                        onInput={(value) => updateItem(item.id, { price: value })}
                      />
                    </div>
                    <TextInput
                      label="Description"
                      description="Short explanation shown below the name."
                      value={() => item.description}
                      onInput={(value) => updateItem(item.id, { description: value })}
                      multiline
                      lines={2}
                    />
                    <TextInput
                      label="Allergens / info"
                      description="Optional allergens or dietary notes."
                      value={() => item.info}
                      onInput={(value) => updateItem(item.id, { info: value })}
                      placeholder="Contains nuts"
                    />
                    <DateRangePicker
                      label="Availability"
                      description="Optional. The item is public from the first through the last selected day in the venue timezone."
                      value={() => ({ start: item.availableFrom, end: item.availableUntil })}
                      onChange={(value) => updateItem(item.id, { availableFrom: value.start, availableUntil: value.end })}
                      clearable
                    />
                  </div>
                </div>
              )}
            </For>
            <button type="button" class="btn-secondary btn-sm justify-center" onClick={addItem}>
              <i class="ti ti-plus" /> Add menu item
            </button>
          </div>
        </Show>
      </div>
    </DialogFrame>
  );
}

export function PublicSectionPreview(props: { section: PublicSection }) {
  const items = () => (Array.isArray(props.section.content.items) ? props.section.content.items : []);
  const links = () => (Array.isArray(props.section.content.links) ? props.section.content.links : []);

  return (
    <div class="grid gap-3">
      <Show when={props.section.kind === "markdown"}>
        <MarkdownView html={markdown.renderSync(sectionText(props.section, "markdown"))} class="text-sm" smallHeadings />
      </Show>
      <Show when={props.section.kind === "notice"}>
        <div class="info-block-warning">
          {sectionText(props.section, "text") || sectionText(props.section, "markdown") || "No notice text yet."}
        </div>
      </Show>
      <Show when={props.section.kind === "links"}>
        <div class="grid gap-2">
          <For
            each={links()}
            fallback={
              <Placeholder align="left" class="px-0 py-2">
                {sectionText(props.section, "text") || "No links yet."}
              </Placeholder>
            }
          >
            {(raw) => {
              const link = raw as Record<string, unknown>;
              return (
                <a class="paper flex items-center gap-3 p-3 no-underline hover:paper-highlighted" href={String(link.href ?? "#")}>
                  <i class="ti ti-link text-dimmed" />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary">{String(link.label ?? link.href ?? "Link")}</span>
                  <i class="ti ti-external-link text-dimmed" />
                </a>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={props.section.kind === "menu"}>
        <div class="grid gap-2">
          <For
            each={items()}
            fallback={
              <Placeholder align="left" class="px-0 py-2">
                No menu items yet.
              </Placeholder>
            }
          >
            {(raw) => {
              const item = raw as Record<string, unknown>;
              const image = typeof item.image === "string" ? item.image : "";
              return (
                <div class="px-1 py-2 text-sm">
                  <div class="flex items-start justify-between gap-3">
                    <Show when={image}>
                      <img src={image} alt="" class="h-14 w-14 shrink-0 rounded-lg object-cover" />
                    </Show>
                    <div class="min-w-0 flex-1">
                      <p class="font-medium text-primary">{String(item.name ?? "Item")}</p>
                      <Show when={item.description}>
                        <p class="text-xs text-dimmed">{String(item.description)}</p>
                      </Show>
                      <Show when={item.info || item.allergens}>
                        <p class="mt-1 text-xs text-dimmed">({String(item.info ?? item.allergens)})</p>
                      </Show>
                    </div>
                    <span class="shrink-0 text-sm font-semibold text-primary">{String(item.price ?? "")}</span>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
