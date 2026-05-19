/**
 * Read-mode script enhancer.
 *
 * The marked `code` renderer (`cloud/.../extensions/code.ts`) emits
 * each ```script block as:
 *
 *   <div class="md-script-block" data-script-source="<base64>">
 *     <pre class="md-script-source"> ... source ... </pre>
 *     <div class="md-script-output"></div>
 *   </div>
 *
 * This runs on the client AFTER the rendered HTML is mounted (see
 * `ReadonlyNote.island.tsx`). For each block it decodes the source
 * and, when scripts are enabled for this notebook, evaluates it and
 * mounts UI into `.md-script-output`. The `.md-script-source` `<pre>`
 * is hidden in the active path (CSS `.md-script-block.md-script-active
 * .md-script-source { display: none }`) so the user sees only the
 * widget — but a screen reader / view-source still has the raw code.
 *
 * When scripts are DISABLED, the enhancer is a no-op — the source
 * fence stays visible exactly as the markdown renderer produced it.
 */
import { createKit } from "./kit";
import type { KitNoteSnapshot } from "./kit";
import { runScript } from "./runner";

export type ReadModeScriptsConfig = {
  /** Per-notebook opt-in. When false this entire pass is a no-op. */
  scriptsEnabled: boolean;
  /** Notebook short-id — used both as the `current.notebook.id`
   *  value and as the `:id` API param for kit-driven calls. */
  notebookId: string;
  /** Snapshot of the note these blocks live in — feeds the
   *  read-only kit getters (no Y.Doc in read-mode, so all reads
   *  are point-in-time at script-run). */
  note: KitNoteSnapshot;
};

/**
 * Walk `container` for every `.md-script-block[data-script-source]`,
 * decode the source, evaluate, and mount output. Idempotent — guarded
 * by a `data-script-state` attribute so re-running this on the same
 * container (e.g. on theme switch / re-render) doesn't duplicate
 * output.
 */
export const enhanceReadModeScripts = (container: HTMLElement, config: ReadModeScriptsConfig): void => {
  if (!config.scriptsEnabled) return;

  const blocks = Array.from(container.querySelectorAll(".md-script-block[data-script-source]")) as HTMLElement[];
  for (const block of blocks) {
    // Already enhanced — skip. Idempotent re-run is a no-op.
    if (block.dataset.scriptState === "active") continue;

    const sourceB64 = block.dataset.scriptSource;
    if (!sourceB64) continue;

    let source: string;
    try {
      source = decodeScriptSource(sourceB64);
    } catch {
      // Malformed base64 — leave the source visible as-is.
      continue;
    }

    const outputEl = block.querySelector(".md-script-output") as HTMLElement | null;
    if (!outputEl) continue;

    block.classList.add("md-script-active");
    block.dataset.scriptState = "active";

    const kit = createKit({
      mode: "read",
      notebookId: config.notebookId,
      note: config.note,
      outputEl,
    });
    void runScript(source, kit, outputEl);
  }
};

/** Inverse of `encodeScriptSource` in `cloud/.../extensions/code.ts`. */
const decodeScriptSource = (b64: string): string => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};
