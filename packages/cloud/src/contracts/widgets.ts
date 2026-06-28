/**
 * Widget JSON contract — what an app's widget endpoint must return when the
 * dashboard fetches it. Each block maps 1:1 to a `<Widget*>` SolidJS component
 * (see `packages/cloud/src/ui/widgets/`).
 *
 * The dashboard fetches each widget endpoint with the user's cookie forwarded;
 * the endpoint is responsible for permission gating:
 *   - `200` + body  → render
 *   - `204`         → skip silently (user has no permission / no content)
 *   - anything else → log and skip
 */

export type WidgetTone = "emerald" | "amber" | "red" | "blue" | "zinc";

export type WidgetAccent = {
  tone: WidgetTone;
  /** Tabler icon class, e.g. `"ti ti-trending-up"`. */
  icon: string;
  /** When set, renders as a pill with bg+text. Without text, plain colored icon. */
  text?: string;
};

export type WidgetStatBlock = {
  kind: "stat";
  value: string | number;
  label: string;
  sub?: string;
  /** Override the default value colour, e.g. `"text-amber-600 dark:text-amber-400"`. */
  valueClass?: string;
  accent?: WidgetAccent;
  /** Block fills remaining vertical space inside the widget and centres its content. */
  grow?: boolean;
};

export type WidgetListItem = {
  icon?: string;
  /** Override the default dimmed icon colour with a tone — useful for
   *  conveying priority, status, or category at a glance. */
  iconTone?: WidgetTone;
  label: string;
  sub?: string;
  /** Right-aligned trailing meta (timestamp, count). */
  meta?: string;
  /** When set, the row becomes a clickable link. */
  href?: string;
};

export type WidgetListBlock = {
  kind: "list";
  items: WidgetListItem[];
  /** Shown when `items` is empty. */
  emptyMessage?: string;
  /** Block fills remaining vertical space (with internal scroll if needed). */
  grow?: boolean;
};

export type WidgetStatusBlock = {
  kind: "status";
  tone: "ok" | "warn" | "error" | "info";
  title: string;
  message?: string;
  /** Override the tone-default icon. */
  icon?: string;
  /** Block fills remaining vertical space and centres its content. */
  grow?: boolean;
};

export type WidgetPill = {
  label: string;
  value: string | number;
  tone?: WidgetTone;
  href?: string;
};

export type WidgetPillsBlock = {
  kind: "pills";
  pills: WidgetPill[];
  /** Block fills remaining vertical space and centres its content. */
  grow?: boolean;
};

/**
 * Hero block — single big centred message. Use for spotlight content like a
 * quote, a single weather location, or empty-state messages ("All clear",
 * "No locations saved yet"). Always grows to fill available space.
 */
export type WidgetHeroBlock = {
  kind: "hero";
  /** Big centred line, e.g. quote text, "14°C · partly cloudy", "All caught up". */
  title: string;
  /** Smaller dimmed line below the title, e.g. author, city, hint. */
  subtitle?: string;
  /** Tabler icon class shown above the title. */
  icon?: string;
  /** Tone for the icon. Defaults to dimmed. */
  tone?: WidgetTone;
};

/** Discriminated union of every block type the dashboard can render. */
export type WidgetBlock = WidgetStatBlock | WidgetListBlock | WidgetStatusBlock | WidgetPillsBlock | WidgetHeroBlock;

/**
 * Top-level shape returned by a widget endpoint. The dashboard renders the
 * `<Widget>` container with the given title/icon/href/meta, then stacks the
 * blocks vertically — composition is open: any number, any order.
 */
export type WidgetResponse = {
  title: string;
  /** Tabler icon class for the widget header. */
  icon?: string;
  /** When set, the widget header becomes a link to this URL. */
  href?: string;
  /** Tiny meta string in the header (e.g. "last 24h"). */
  meta?: string;
  blocks: WidgetBlock[];
};
