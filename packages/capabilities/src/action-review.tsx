import type { CapabilityClientError, CapabilityReviewClientResult } from "@valentinkolb/cloud/capabilities";
import type { CapabilityActionManifest, CapabilityActionReview, CapabilitySemanticLink } from "@valentinkolb/cloud/contracts";
import { For, type JSX, Show } from "solid-js";

export type ActionRunDecision = { kind: "approved" } | { kind: "cancelled" } | { kind: "failed"; error: CapabilityClientError };

type ConfirmActionRunInput = {
  appId: string;
  operation: CapabilityActionManifest;
  input: Record<string, unknown>;
  signal?: AbortSignal;
};

type ConfirmActionRunDependencies = {
  review: (input: {
    appId: string;
    capabilityId: string;
    input: Record<string, unknown>;
    signal?: AbortSignal;
  }) => Promise<CapabilityReviewClientResult>;
  confirmReview: (review: CapabilityActionReview, operation: CapabilityActionManifest) => Promise<boolean | undefined>;
  confirmDestructive: (operation: CapabilityActionManifest) => Promise<boolean | undefined>;
};

export const confirmActionRun = async (
  input: ConfirmActionRunInput,
  dependencies: ConfirmActionRunDependencies,
): Promise<ActionRunDecision> => {
  if (input.operation.review) {
    let reviewed: CapabilityReviewClientResult;
    try {
      reviewed = await dependencies.review({
        appId: input.appId,
        capabilityId: input.operation.localId,
        input: input.input,
        signal: input.signal,
      });
    } catch (cause) {
      return {
        kind: "failed",
        error:
          cause instanceof Error && cause.name === "AbortError"
            ? { code: "REQUEST_CANCELLED", message: "Action review was cancelled.", status: 499 }
            : { code: "APP_UNAVAILABLE", message: "Could not load the action review.", status: 503 },
      };
    }
    if (!reviewed.ok) return { kind: "failed", error: reviewed.error };
    return (await dependencies.confirmReview(reviewed.data, input.operation)) ? { kind: "approved" } : { kind: "cancelled" };
  }

  if (input.operation.destructive) {
    return (await dependencies.confirmDestructive(input.operation)) ? { kind: "approved" } : { kind: "cancelled" };
  }

  return { kind: "approved" };
};

const linkLabel = (link: CapabilitySemanticLink): string =>
  link.title ??
  (link.rel === "edit"
    ? "Edit"
    : link.rel === "status"
      ? "Status"
      : link.rel === "preview"
        ? "Preview"
        : link.rel === "download"
          ? "Download"
          : "Open");

export function ActionReviewContent(props: { review: CapabilityActionReview }): JSX.Element {
  return (
    <div class="flex flex-col gap-4">
      <p class="m-0 whitespace-pre-wrap">{props.review.message}</p>
      <Show when={props.review.details?.length}>
        <dl class="m-0 grid gap-2">
          <For each={props.review.details}>
            {(detail) => (
              <div>
                <dt class="text-xs font-medium text-dimmed">{detail.label}</dt>
                <dd class="m-0 whitespace-pre-wrap text-sm text-primary">{detail.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </Show>
      <Show when={props.review.links?.length}>
        <div class="flex flex-wrap gap-2">
          <For each={props.review.links}>
            {(link) => (
              <a class="text-sm font-medium text-accent hover:underline" href={link.href}>
                {linkLabel(link)}
              </a>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
