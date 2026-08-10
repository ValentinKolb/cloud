import type { DndController } from "@k2b/stdlib/solid";
import { For, type JSX, Show } from "solid-js";
import type { CustomAppBlock, CustomAppDefinition, CustomAppPage } from "../../custom-apps/contracts";
import { customAppPageHref } from "../../custom-apps/routing";
import {
  type CustomAppBlockDropIntent,
  type CustomAppBlockDropSegment,
  customAppColumnRangeNeedsDropZone,
} from "../_components/custom-apps/custom-app-builder-dnd";

export type CustomAppBlockDragMeta = { blockId: string; label: string };
export type CustomAppBlockDropMeta = {
  intent: CustomAppBlockDropIntent | null;
  label: string;
  priority: number;
  segment: CustomAppBlockDropSegment;
};

type CustomAppDropZone =
  | "before"
  | "after"
  | "left"
  | "right"
  | "column-left"
  | "column-right"
  | "pair-left"
  | "pair-right"
  | "row-before"
  | "row-after";

const customAppBlockDragId = (blockId: string) => `custom-app-block-drag:${blockId}`;
const customAppDropZoneId = (targetId: string, zone: CustomAppDropZone) => `custom-app-block-drop:${targetId}:${zone}`;
const customAppDropSegment = (zone: CustomAppDropZone): CustomAppBlockDropSegment => {
  if (zone === "before" || zone === "after" || zone === "row-before" || zone === "row-after") return "horizontal";
  return zone.endsWith("left") ? "left" : "right";
};

type EditorProps = {
  selectedBlockId: () => string | null;
  onSelectBlock: (blockId: string) => void;
  onSelectPage: (pageId: string) => void;
  dnd: DndController<CustomAppBlockDragMeta, CustomAppBlockDropMeta, CustomAppBlockDropIntent>;
};

const blockLabel: Record<CustomAppBlock["type"], string> = {
  actions: "Actions",
  chart: "Chart",
  comments: "Comments",
  form: "Form",
  markdown: "Markdown",
  metrics: "Metrics",
  record: "Record",
  records: "Records",
};

const intentTargets = (intent: CustomAppBlockDropIntent | null, activeBlockId: string | null) => {
  if (!activeBlockId || !intent) return false;
  if (intent.kind === "stack") return intent.targetBlockId === activeBlockId;
  if (intent.kind === "beside") return intent.firstBlockId === activeBlockId || intent.lastBlockId === activeBlockId;
  return false;
};

export function CustomAppPageLayout(props: {
  definition: CustomAppDefinition;
  page: CustomAppPage;
  shortId: string;
  renderBlock: (block: CustomAppBlock) => JSX.Element;
  editor?: EditorProps;
}) {
  const navigation = () =>
    props.definition.pages
      .map((page, index) => ({ page, index }))
      .filter(({ page }) => page.navigation.visible)
      .sort((left, right) => left.page.navigation.order - right.page.navigation.order || left.index - right.index);
  const activeBlockId = () => {
    const activeId = props.editor?.dnd.activeId();
    return activeId?.startsWith("custom-app-block-drag:") ? activeId.slice("custom-app-block-drag:".length) : null;
  };
  const selectFromCanvas = (event: PointerEvent, blockId: string) => {
    if (!props.editor || event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('a, button, input, select, textarea, [contenteditable="true"], [data-custom-app-dnd-handle]')
    ) {
      return;
    }
    event.stopPropagation();
    props.editor.onSelectBlock(blockId);
  };

  const DropZone = (zoneProps: {
    id: string;
    zone: CustomAppDropZone;
    label: string;
    priority: number;
    pair?: { side: "left" | "right"; gridRow: string };
    betweenColumns?: boolean;
    intent: () => CustomAppBlockDropIntent | null;
  }) => (
    <div
      ref={(element) => {
        const controller = props.editor?.dnd;
        if (!controller) return;
        controller.droppable(element, () => {
          const intent = zoneProps.intent();
          return {
            id: zoneProps.id,
            meta: {
              intent,
              label: zoneProps.label,
              priority: zoneProps.priority,
              segment: customAppDropSegment(zoneProps.zone),
            },
            disabled: !intent || intentTargets(intent, activeBlockId()),
          };
        });
      }}
      class={zoneProps.pair ? "custom-app-pair-drop-zone" : "custom-app-drop-zone"}
      data-zone={zoneProps.zone}
      data-side={zoneProps.pair?.side}
      data-between-columns={zoneProps.betweenColumns ? "true" : undefined}
      data-active={props.editor?.dnd.overId() === zoneProps.id ? "true" : undefined}
      style={zoneProps.pair ? { "grid-row": zoneProps.pair.gridRow } : undefined}
      aria-hidden="true"
    >
      <span class={zoneProps.pair ? "custom-app-pair-indicator" : "custom-app-drop-indicator"} />
    </div>
  );

  const EditorHandle = (handleProps: { block: CustomAppBlock }) => (
    <button
      type="button"
      class="custom-app-editor-control custom-app-block-control"
      aria-label={`Select and move ${blockLabel[handleProps.block.type]}`}
      aria-pressed={props.editor?.selectedBlockId() === handleProps.block.id}
      data-custom-app-dnd-handle="block"
      onPointerDown={() => props.editor?.onSelectBlock(handleProps.block.id)}
      onFocus={() => props.editor?.onSelectBlock(handleProps.block.id)}
      onClick={(event) => event.stopPropagation()}
    >
      <span class="custom-app-drag-preview" data-dnd-preview>
        <i class="ti ti-grip-vertical" aria-hidden="true" />
        {blockLabel[handleProps.block.type]}
      </span>
    </button>
  );

  return (
    <main
      class="custom-app-page mx-auto flex w-full max-w-[96rem] flex-col gap-8 p-4 sm:p-6 lg:p-8"
      data-dnd-dragging={props.editor?.dnd.isDragging() ? "true" : undefined}
    >
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          {props.definition.icon ? <i class={`ti ti-${props.definition.icon} text-2xl text-accent`} aria-hidden="true" /> : null}
          <div>
            <p class="text-sm text-secondary">{props.definition.name}</p>
            <h1 class="text-2xl font-semibold">{props.page.title}</h1>
          </div>
        </div>
        <Show when={navigation().length > 1}>
          <nav aria-label="App pages" class="flex flex-wrap items-center gap-1 rounded-xl bg-subtle p-1">
            <For each={navigation()}>
              {({ page }) =>
                props.editor ? (
                  <button
                    type="button"
                    aria-current={page.id === props.page.id ? "page" : undefined}
                    class={`rounded-lg px-3 py-1.5 text-sm font-medium ${page.id === props.page.id ? "bg-surface text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
                    onClick={() => props.editor?.onSelectPage(page.id)}
                  >
                    {page.title}
                  </button>
                ) : (
                  <a
                    href={customAppPageHref(props.shortId, page.id)}
                    aria-current={page.id === props.page.id ? "page" : undefined}
                    class={`rounded-lg px-3 py-1.5 text-sm font-medium ${page.id === props.page.id ? "bg-surface text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
                  >
                    {page.title}
                  </a>
                )
              }
            </For>
          </nav>
        </Show>
      </header>

      <div class="flex flex-col gap-8">
        <For each={props.page.rows}>
          {(row, rowIndex) => {
            const multiColumnRow = row.columns.length > 1;
            const previousRow = () => props.page.rows[rowIndex() - 1];
            const rowIntent = (edge: "before" | "after") => () =>
              ({ kind: "row", targetRowId: row.id, edge }) satisfies CustomAppBlockDropIntent;
            return (
              <div class="custom-app-row relative flex flex-wrap gap-6">
                {props.editor && multiColumnRow && rowIndex() === 0 ? (
                  <DropZone
                    id={customAppDropZoneId(row.id, "row-before")}
                    zone="row-before"
                    label="in a full-width row above"
                    priority={2}
                    intent={rowIntent("before")}
                  />
                ) : null}
                {props.editor && multiColumnRow ? (
                  <DropZone
                    id={customAppDropZoneId(row.id, "row-after")}
                    zone="row-after"
                    label="in a full-width row below"
                    priority={2}
                    intent={rowIntent("after")}
                  />
                ) : null}
                <For each={row.columns}>
                  {(column, columnIndex) => {
                    const columnRange = (side: "left" | "right") => () => {
                      const candidates = column.blocks.filter((block) => block.id !== activeBlockId());
                      const first = candidates[0];
                      const last = candidates.at(-1);
                      return first && last
                        ? ({ kind: "beside", firstBlockId: first.id, lastBlockId: last.id, side } satisfies CustomAppBlockDropIntent)
                        : null;
                    };
                    const showColumnRange = () =>
                      multiColumnRow ||
                      customAppColumnRangeNeedsDropZone(
                        column.blocks.map((block) => block.id),
                        activeBlockId(),
                      );
                    return (
                      <section class="custom-app-column relative min-w-0 basis-80" style={{ flex: `${column.span} 1 20rem` }}>
                        {props.editor && showColumnRange() ? (
                          <>
                            <DropZone
                              id={customAppDropZoneId(column.id, "column-left")}
                              zone="column-left"
                              label="left of this stack"
                              priority={1}
                              betweenColumns={multiColumnRow && columnIndex() > 0}
                              intent={columnRange("left")}
                            />
                            {!multiColumnRow || columnIndex() === row.columns.length - 1 ? (
                              <DropZone
                                id={customAppDropZoneId(column.id, "column-right")}
                                zone="column-right"
                                label="right of this stack"
                                priority={1}
                                intent={columnRange("right")}
                              />
                            ) : null}
                          </>
                        ) : null}
                        <div class="custom-app-block-stack">
                          <For each={column.blocks}>
                            {(block, blockIndex) => {
                              const nextBlock = () => column.blocks[blockIndex() + 1];
                              const intent = (value: CustomAppBlockDropIntent) => () => value;
                              const pairLeftId = customAppDropZoneId(block.id, "pair-left");
                              const pairRightId = customAppDropZoneId(block.id, "pair-right");
                              const previousRowOwnsBoundary =
                                !multiColumnRow && blockIndex() === 0 && previousRow() !== undefined && previousRow()!.columns.length > 1;
                              return (
                                <>
                                  <article
                                    ref={(element) => {
                                      const controller = props.editor?.dnd;
                                      if (!controller) return;
                                      controller.draggable(element, () => ({
                                        id: customAppBlockDragId(block.id),
                                        meta: { blockId: block.id, label: blockLabel[block.type] },
                                        focusable: false,
                                        keyboard: true,
                                        handleSelector: '[data-custom-app-dnd-handle="block"]',
                                      }));
                                    }}
                                    class="custom-app-block relative min-w-0"
                                    style={{ "grid-row": `${blockIndex() + 1}` }}
                                    data-editing={props.editor ? "true" : undefined}
                                    data-selected={props.editor?.selectedBlockId() === block.id ? "true" : undefined}
                                    onPointerDown={(event) => selectFromCanvas(event, block.id)}
                                  >
                                    {props.editor ? (
                                      <>
                                        <EditorHandle block={block} />
                                        {!previousRowOwnsBoundary ? (
                                          <DropZone
                                            id={customAppDropZoneId(block.id, "before")}
                                            zone="before"
                                            label={`before ${blockLabel[block.type]}`}
                                            priority={3}
                                            intent={intent({ kind: "stack", targetBlockId: block.id, edge: "before" })}
                                          />
                                        ) : null}
                                        {blockIndex() === column.blocks.length - 1 ? (
                                          <DropZone
                                            id={customAppDropZoneId(block.id, "after")}
                                            zone="after"
                                            label={`after ${blockLabel[block.type]}`}
                                            priority={3}
                                            intent={intent({ kind: "stack", targetBlockId: block.id, edge: "after" })}
                                          />
                                        ) : null}
                                        {!multiColumnRow ? (
                                          <>
                                            <DropZone
                                              id={customAppDropZoneId(block.id, "left")}
                                              zone="left"
                                              label={`left of ${blockLabel[block.type]}`}
                                              priority={3}
                                              intent={intent({
                                                kind: "beside",
                                                firstBlockId: block.id,
                                                lastBlockId: block.id,
                                                side: "left",
                                              })}
                                            />
                                            <DropZone
                                              id={customAppDropZoneId(block.id, "right")}
                                              zone="right"
                                              label={`right of ${blockLabel[block.type]}`}
                                              priority={3}
                                              intent={intent({
                                                kind: "beside",
                                                firstBlockId: block.id,
                                                lastBlockId: block.id,
                                                side: "right",
                                              })}
                                            />
                                          </>
                                        ) : null}
                                      </>
                                    ) : null}
                                    {block.title && block.type !== "comments" ? (
                                      <h2 class="mb-3 text-base font-semibold">{block.title}</h2>
                                    ) : null}
                                    {props.renderBlock(block)}
                                  </article>
                                  {props.editor && !multiColumnRow && nextBlock() ? (
                                    <>
                                      <DropZone
                                        id={pairLeftId}
                                        zone="pair-left"
                                        label={`left of ${blockLabel[block.type]} and ${blockLabel[nextBlock()!.type]}`}
                                        priority={4}
                                        pair={{ side: "left", gridRow: `${blockIndex() + 1} / span 2` }}
                                        intent={intent({
                                          kind: "beside",
                                          firstBlockId: block.id,
                                          lastBlockId: nextBlock()!.id,
                                          side: "left",
                                        })}
                                      />
                                      <DropZone
                                        id={pairRightId}
                                        zone="pair-right"
                                        label={`right of ${blockLabel[block.type]} and ${blockLabel[nextBlock()!.type]}`}
                                        priority={4}
                                        pair={{ side: "right", gridRow: `${blockIndex() + 1} / span 2` }}
                                        intent={intent({
                                          kind: "beside",
                                          firstBlockId: block.id,
                                          lastBlockId: nextBlock()!.id,
                                          side: "right",
                                        })}
                                      />
                                    </>
                                  ) : null}
                                </>
                              );
                            }}
                          </For>
                        </div>
                      </section>
                    );
                  }}
                </For>
              </div>
            );
          }}
        </For>
      </div>
    </main>
  );
}
