import type { MailActionId } from "./mail-actions";
import { executeMailBulkAction, type MailBulkTarget } from "./mail-bulk-actions";
import type { MailListOptimisticField } from "./mail-list-optimistic";

export type MailWorkspaceActionOptions = {
  targets?: MailBulkTarget[];
  destinationFolderId?: string;
  silent?: boolean;
};

export type MailAutoReadDecision = "ignore" | "wait" | "consume" | "read";

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

export type MailWorkspaceActionHost = {
  canRun: () => boolean;
  resolveTargets: (actionId: MailActionId) => MailBulkTarget[];
  chooseDestinationFolder: () => Promise<string | null>;
  isDisposed: () => boolean;
  begin: (controller: AbortController) => void;
  isCurrent: (controller: AbortController) => boolean;
  finish: (controller: AbortController) => void;
  isAbortError: (error: unknown) => boolean;
  applyOptimistic: (actionId: MailActionId, targets: readonly MailBulkTarget[]) => void;
  clearOptimistic: (conversationIds: readonly string[], fields: readonly MailListOptimisticField[]) => void;
  submit: (params: {
    actionId: MailActionId;
    target: MailBulkTarget;
    sourceFolderId: string;
    destinationFolderId?: string;
    correlationId: string;
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
  host: MailWorkspaceActionHost,
): Promise<void> => {
  if (!host.canRun()) return;
  let targets = options.targets ?? host.resolveTargets(actionId);
  if (targets.length === 0) {
    if (!options.silent) await host.showMissingTarget();
    return;
  }

  const controller = new AbortController();
  const optimisticFields = mailOptimisticFields(actionId);
  let optimisticApplied = false;
  host.begin(controller);

  try {
    const destinationFolderId = actionId === "move" ? (options.destinationFolderId ?? (await host.chooseDestinationFolder())) : undefined;
    if (!host.isCurrent(controller) || host.isDisposed() || (actionId === "move" && !destinationFolderId)) return;
    if (actionId === "move") {
      targets = removeDestinationPlacements(targets, destinationFolderId!);
      if (targets.length === 0) {
        if (!options.silent) host.showNothingToMove();
        return;
      }
    }

    const correlationId = crypto.randomUUID();
    host.applyOptimistic(actionId, targets);
    optimisticApplied = true;
    const result = await executeMailBulkAction({
      actionId,
      targets,
      submit: (target, sourceFolderId) =>
        host.submit({
          actionId,
          target,
          sourceFolderId,
          destinationFolderId: destinationFolderId ?? undefined,
          correlationId,
          signal: controller.signal,
        }),
    });
    if (!host.isCurrent(controller)) return;

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
      if (!host.isCurrent(controller)) return;
      if (!options.silent) host.showSuccess(actionId, targets.length, succeeded.size);
    } else if (optimisticFields.length > 0) {
      await host.reconcile();
      if (!host.isCurrent(controller)) return;
    }
    if (result.failures.length > 0) await host.showFailures(result.failures, targets.length);
  } catch (error) {
    if (!host.isCurrent(controller) || host.isAbortError(error)) return;
    if (optimisticApplied) {
      host.clearOptimistic(
        targets.map((target) => target.conversationId),
        optimisticFields,
      );
      await host.reconcile();
      if (!host.isCurrent(controller)) return;
    }
    if (!options.silent) await host.showError(error);
  } finally {
    host.finish(controller);
  }
};
