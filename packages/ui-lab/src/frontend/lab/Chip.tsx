import { copyToClipboard } from "@valentinkolb/stdlib/browser";
import { toast } from "@valentinkolb/cloud/ui";

/**
 * Provenance chip shown on every DemoCard — also doubles as the
 * card's visual title.
 *
 *   - `component` — TypeScript export from a `@valentinkolb/cloud/...`
 *     package. Click copies the import statement.
 *   - `utility` — Tailwind utility class defined in
 *     `packages/cloud/src/styles/`. Click copies the class name.
 *
 * The two flavours share size + alignment — only the icon and accent
 * colour differ. `text-xs` for both the name and the secondary path /
 * "CSS utility" hint so the baseline lines up cleanly.
 */
type ChipProps = { kind: "component"; name: string; from: string } | { kind: "utility"; name: string };

export default function Chip(props: ChipProps) {
  const copy = async (): Promise<void> => {
    if (props.kind === "component") {
      await copyToClipboard(`import { ${props.name} } from "${props.from}";`);
      toast.success(`Copied import of ${props.name}`);
    } else {
      await copyToClipboard(props.name);
      toast.success(`Copied class ${props.name}`);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      class="inline-flex items-baseline gap-1.5 px-2 py-1 rounded-md text-xs font-mono transition-colors"
      classList={{
        "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40":
          props.kind === "component",
        "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700": props.kind === "utility",
      }}
      title={props.kind === "component" ? `Copy import from ${props.from}` : `Copy class .${props.name}`}
    >
      <i
        class={props.kind === "component" ? "ti ti-code" : "ti ti-hash"}
        aria-hidden="true"
        // Inline-block + relative tweak so the icon sits on the same
        // baseline as the surrounding text instead of floating above it.
        style="line-height: 1"
      />
      <span>{props.name}</span>
      <span class="text-dimmed font-sans">·</span>
      <span class="text-dimmed font-sans">{props.kind === "component" ? props.from : "CSS utility"}</span>
    </button>
  );
}
