import type { MailActionId } from "./mail-actions";
import { executeMailBulkAction, type MailBulkTarget } from "./mail-bulk-actions";
import type { MailListOptimisticField } from "./mail-list-optimistic";

export type MailWorkspaceActionOptions = {
  targets?: MailBulkTarget[];
  destinationFolderId?: string;
  silent?: boolean;
};

export type MailAutoReadDecision = "ignore" | "wait" | "consume" | "read";

export type MailWorkspaceActionExecution = {
  correlationId: string;
  idempotencyKeys: Map<string, string>;
  targets?: MailBulkTarget[];
  destinationResolved?: boolean;
  destinationFolderId?: string | null;
};

export const decideMailAutoReadIntent = (params: {
  intent: number;
  consumedIntent: number;
  busy: boolean;
  unread: boolean;
  canSubmit: boolean;
}): MailAutoReadDecision => {
  if (params.intent === params.consumedIntent) return "ignore";
  if (params.busy) return "wait";
  return params.unread && params.canSubmit ? "read" : "consume";
};

type ActionFailure = {
  conversationId: string;
  label: string;
  message: string;
  submittedPlacements: number;
};

export type MailWorkspaceActionRunnerHost = {
  resolveTargets: (actionId: MailActionId) => MailBulkTarget[];
  chooseDestinationFolder: () => Promise<string | null>;
  applyOptimistic: (actionId: MailActionId, targets: readonly MailBulkTarget[]) => void;
  clearOptimistic: (conversationIds: readonly string[], fields: readonly MailListOptimisticField[]) => void;
  submit: (params: {
    actionId: MailActionId;
    target: MailBulkTarget;
    sourceFolderId: string;
    destinationFolderId?: string;
    correlationId: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }) => Promise<void>;
  pruneSelection: (succeededConversationIds: ReadonlySet<string>) => void;
  removesActiveConversation: (actionId: MailActionId, succeededConversationIds: ReadonlySet<string>) => boolean;
  refreshAfterSuccess: (params: { removesActiveConversation: boolean; succeededConversationIds: ReadonlySet<string> }) => Promise<void>;
  reconcile: () => Promise<void>;
  showMissingTarget: () => Promise<void>;
  showNothingToMove: () => void;
  showSuccess: (actionId: MailActionId, targetCount: number, successCount: number) => void;
  showFailures: (failures: readonly ActionFailure[], targetCount: number) => Promise<void>;
  showError: (error: unknown) => Promise<void>;
};

export const mailOptimisticFields = (actionId: MailActionId): MailListOptimisticField[] =>
  actionId === "mark_read" || actionId === "mark_unread" ? ["unread"] : actionId === "flag" || actionId === "unflag" ? ["flagged"] : [];

export const removeDestinationPlacements = (targets: readonly MailBulkTarget[], destinationFolderId: string): MailBulkTarget[] =>
  targets
    .map((target) => ({
      ...target,
      sourceFolderIds: target.sourceFolderIds.filter((sourceFolderId) => sourceFolderId !== destinationFolderId),
    }))
    .filter((target) => target.sourceFolderIds.length > 0);

export const runMailWorkspaceAction = async (
  actionId: MailActionId,
  options: MailWorkspaceActionOptions,
  host: MailWorkspaceActionRunnerHost,
  signal: AbortSignal,
  execution: MailWorkspaceActionExecution = {
    correlationId: crypto.randomUUID(),
    idempotencyKeys: new Map(),
  },
): Promise<void> => {
  const optimisticFields = mailOptimisticFields(actionId);
  let targets: MailBulkTarget[] = [];
  let optimisticApplied = false;

  try {
    execution.targets ??= options.targets ?? host.resolveTargets(actionId);
    targets = execution.targets;
    if (targets.length === 0) {
      if (!options.silent) await host.showMissingTarget();
      return;
    }
    if (actionId === "move" && !execution.destinationResolved) {
      execution.destinationFolderId = options.destinationFolderId ?? (await host.chooseDestinationFolder());
      execution.destinationResolved = true;
    }
    const destinationFolderId = actionId === "move" ? execution.destinationFolderId : undefined;
    if (signal.aborted || (actionId === "move" && !destinationFolderId)) return;
    if (actionId === "move") {
      targets = removeDestinationPlacements(targets, destinationFolderId!);
      if (targets.length === 0) {
        if (!options.silent) host.showNothingToMove();
        return;
      }
    }

    host.applyOptimistic(actionId, targets);
    optimisticApplied = true;
    const result = await executeMailBulkAction({
      actionId,
      targets,
      submit: (target, sourceFolderId) => {
        const key = `${actionId}:${target.conversationId}:${sourceFolderId}:${destinationFolderId ?? ""}`;
        let idempotencyKey = execution.idempotencyKeys.get(key);
        if (!idempotencyKey) {
          idempotencyKey = crypto.randomUUID();
          execution.idempotencyKeys.set(key, idempotencyKey);
        }
        return host.submit({
          actionId,
          target,
          sourceFolderId,
          destinationFolderId: destinationFolderId ?? undefined,
          correlationId: execution.correlationId,
          idempotencyKey,
          signal,
        });
      },
    });
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    host.clearOptimistic(
      result.failures.map((failure) => failure.conversationId),
      optimisticFields,
    );
    const succeeded = new Set(result.succeededConversationIds);
    host.pruneSelection(succeeded);

    if (succeeded.size > 0) {
      await host.refreshAfterSuccess({
        removesActiveConversation: host.removesActiveConversation(actionId, succeeded),
        succeededConversationIds: succeeded,
      });
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!options.silent) host.showSuccess(actionId, targets.length, succeeded.size);
    } else if (optimisticFields.length > 0) {
      await host.reconcile();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    }
    if (result.failures.length > 0) await host.showFailures(result.failures, targets.length);
  } catch (error) {
    if (optimisticApplied) {
      host.clearOptimistic(
        targets.map((target) => target.conversationId),
        optimisticFields,
      );
      try {
        await host.reconcile();
      } catch {
        // Preserve the action failure as the primary error.
      }
    }
    if (!signal.aborted && !(error instanceof Error && error.name === "AbortError") && !options.silent) await host.showError(error);
    throw error;
  }
};
