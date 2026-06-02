import { For, Show } from "solid-js";
import type { ContactTree, ContactTreeNode } from "../../service";
import { resolveContactName } from "../../shared";

type Props = {
  tree: ContactTree;
  onSelect: (node: ContactTreeNode) => void;
  onBack: () => void;
};

const nodeMeta = (node: ContactTreeNode) => [node.companyName, node.jobTitle].filter(Boolean).join(" · ");

function ContactOrgTreeNode(props: {
  node: ContactTreeNode;
  selectedId: string;
  depth: number;
  isFirst: boolean;
  isLast: boolean;
  onSelect: (node: ContactTreeNode) => void;
}) {
  const selected = () => props.node.id === props.selectedId;
  const hasChildren = () => props.node.children.length > 0;
  const lineColor = "border-zinc-300 dark:border-zinc-700";

  return (
    <li class="relative">
      <Show when={props.depth > 0}>
        <span class="absolute left-0 top-0 bottom-0 w-4" aria-hidden="true">
          <span
            class={`absolute left-0 border-l ${lineColor} ${
              props.isFirst ? "top-0" : "-top-1"
            } ${props.isLast ? (props.isFirst ? "h-5" : "h-6") : "bottom-[-0.25rem]"}`}
          />
          <span class={`absolute left-0 top-5 w-4 border-t ${lineColor}`} />
        </span>
      </Show>
      <div class={`relative flex items-start ${props.depth > 0 ? "pl-5" : ""}`}>
        <button
          type="button"
          class={`group relative flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
            selected()
              ? "bg-blue-50/80 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300"
              : "text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
          onClick={() => props.onSelect(props.node)}
          aria-current={selected() ? "true" : undefined}
        >
          <span
            class={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              selected()
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            }`}
          >
            {(resolveContactName(props.node) || "?").charAt(0).toUpperCase()}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-semibold leading-tight">{resolveContactName(props.node)}</span>
            <Show when={nodeMeta(props.node)}>
              <span class="block truncate text-[11px] leading-tight text-dimmed">{nodeMeta(props.node)}</span>
            </Show>
          </span>
          <Show when={hasChildren()}>
            <span
              class={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                selected() ? "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200" : "bg-zinc-100 text-dimmed dark:bg-zinc-800"
              }`}
              title={`${props.node.children.length} direct report${props.node.children.length === 1 ? "" : "s"}`}
            >
              {props.node.children.length}
              <i class="ti ti-users text-[10px]" />
            </span>
          </Show>
        </button>
      </div>
      <Show when={hasChildren()}>
        <div class={props.depth === 0 ? "ml-3.5 pl-3.5" : "ml-9 pl-3.5"}>
          <ul class="mt-1 flex flex-col gap-1">
            <For each={props.node.children}>
              {(child, index) => (
                <ContactOrgTreeNode
                  node={child}
                  selectedId={props.selectedId}
                  depth={props.depth + 1}
                  isFirst={index() === 0}
                  isLast={index() === props.node.children.length - 1}
                  onSelect={props.onSelect}
                />
              )}
            </For>
          </ul>
        </div>
      </Show>
    </li>
  );
}

export default function ContactOrgTreeView(props: Props) {
  return (
    <div class="flex h-full min-h-0 flex-col gap-2">
      <section class="detail-section" style="view-transition-name: contacts-org-tree-panel">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h2 class="truncate text-lg font-semibold leading-tight text-primary">Org Tree</h2>
            <p class="mt-1 text-xs text-dimmed">Hierarchy of this contact.</p>
          </div>
          <button type="button" class="btn-secondary btn-sm" onClick={props.onBack}>
            <i class="ti ti-arrow-left" /> Details
          </button>
        </div>
      </section>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <section class="detail-section">
          <ul class="flex flex-col gap-1">
            <ContactOrgTreeNode
              node={props.tree.root}
              selectedId={props.tree.selectedId}
              depth={0}
              isFirst={true}
              isLast={true}
              onSelect={props.onSelect}
            />
          </ul>
        </section>
      </div>
    </div>
  );
}
