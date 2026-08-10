import { createMemo, createSignal } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import type { CustomAppDefinition } from "../../../custom-apps/contracts";

const clone = (definition: CustomAppDefinition): CustomAppDefinition => structuredClone(unwrap(definition));

export const createCustomAppBuilderState = (initial: CustomAppDefinition) => {
  const [definition, setDefinition] = createStore(clone(initial));
  const [saved, setSaved] = createSignal(JSON.stringify(initial));
  const [version, setVersion] = createSignal(0);
  const dirty = createMemo(() => JSON.stringify(definition) !== saved());

  const set = (next: CustomAppDefinition) => {
    setDefinition(reconcile(clone(next), { key: "id" }));
    setVersion((current) => current + 1);
  };

  return {
    draft: () => definition,
    snapshot: () => clone(definition),
    version,
    dirty,
    set,
    updateBlock: (
      pageId: string,
      blockId: string,
      update: (
        block: CustomAppDefinition["pages"][number]["rows"][number]["columns"][number]["blocks"][number],
      ) => CustomAppDefinition["pages"][number]["rows"][number]["columns"][number]["blocks"][number],
    ) => {
      const pageIndex = definition.pages.findIndex((page) => page.id === pageId);
      const page = definition.pages[pageIndex];
      if (!page) return;
      for (const [rowIndex, row] of page.rows.entries()) {
        for (const [columnIndex, column] of row.columns.entries()) {
          const blockIndex = column.blocks.findIndex((block) => block.id === blockId);
          if (blockIndex < 0) continue;
          setDefinition("pages", pageIndex, "rows", rowIndex, "columns", columnIndex, "blocks", blockIndex, (block) =>
            update(structuredClone(unwrap(block))),
          );
          setVersion((current) => current + 1);
          return;
        }
      }
    },
    replace: (next: CustomAppDefinition) => {
      setDefinition(reconcile(clone(next), { key: "id" }));
      setSaved(JSON.stringify(next));
      setVersion((current) => current + 1);
    },
    markSaved: (snapshot: CustomAppDefinition) => setSaved(JSON.stringify(snapshot)),
  };
};
