import { mutation as mutations, query } from "@k2b/stdlib/solid";
import { Button, dialogCore, InlineGuidance, NoticeCard, PanelDialog, Placeholder, panelDialogOptions, prompts } from "@k2b/ui";
import { Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { PublicDurableHistoryStatus } from "../../../api/durable-history";
import type { PublicRecordFinalizationStatus } from "../../../api/record-finalization";
import { errorMessage } from "../utils/api-helpers";

export const openHistoryProtectionDialog = (args: { tableId: string; tableName: string }) =>
  dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title="History and protection" subtitle={args.tableName} icon="ti ti-history" close={close} />
        <HistoryProtectionBody tableId={args.tableId} />
      </PanelDialog>
    ),
    panelDialogOptions,
  );

function HistoryProtectionBody(props: { tableId: string }) {
  const statusQuery = query.create({
    source: () => props.tableId,
    load: async (tableId, { abortSignal }) => {
      const [historyResponse, finalizationResponse] = await Promise.all([
        apiClient.tables[":tableId"]["durable-history"].$get({ param: { tableId } }, { init: { signal: abortSignal } }),
        apiClient.tables[":tableId"].finalization.$get({ param: { tableId } }, { init: { signal: abortSignal } }),
      ]);
      if (!historyResponse.ok) throw new Error(await errorMessage(historyResponse, "Could not load durable history status"));
      if (!finalizationResponse.ok) throw new Error(await errorMessage(finalizationResponse, "Could not load finalization status"));
      return {
        history: await historyResponse.json(),
        finalization: await finalizationResponse.json(),
      } satisfies { history: PublicDurableHistoryStatus; finalization: PublicRecordFinalizationStatus };
    },
  });
  const historyStatus = () => statusQuery.data()?.history ?? null;
  const enabledHistoryStatus = () => {
    const status = historyStatus();
    return status?.enabled ? status : null;
  };
  const finalizationStatus = () => statusQuery.data()?.finalization ?? null;
  const enabledFinalizationStatus = () => {
    const status = finalizationStatus();
    return status?.enabled ? status : null;
  };

  const historyMut = mutations.create<PublicDurableHistoryStatus, "enable" | "continue">({
    mutation: async (operation) => {
      let response =
        operation === "enable"
          ? await apiClient.tables[":tableId"]["durable-history"].enable.$post({ param: { tableId: props.tableId } })
          : await apiClient.tables[":tableId"]["durable-history"].continue.$post({ param: { tableId: props.tableId } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not activate durable history"));
      let status = await response.json();
      while (status.enabled && status.status === "activating") {
        const captured = status.baseline.captured;
        response = await apiClient.tables[":tableId"]["durable-history"].continue.$post({ param: { tableId: props.tableId } });
        if (!response.ok) throw new Error(await errorMessage(response, "Could not continue the history baseline"));
        status = await response.json();
        if (status.enabled && status.status === "activating" && status.baseline.captured <= captured) {
          throw new Error("The baseline is waiting for records that are currently changing. Try Continue baseline again.");
        }
      }
      return status;
    },
    onSuccess: () => void statusQuery.refresh(),
    onError: (error) => {
      void statusQuery.refresh();
      prompts.error(error.message);
    },
  });

  const enableHistory = async () => {
    const confirmed = await prompts.confirm(
      "History starts with the records as they are now. Earlier changes are not added later. Future versions and their files are kept permanently, storage use increases, and this cannot be disabled.",
      { title: "Enable durable history?", confirmText: "Enable durable history" },
    );
    if (confirmed) historyMut.mutate("enable");
  };

  const finalizationMut = mutations.create<PublicRecordFinalizationStatus, "enable" | "disable">({
    mutation: async (operation) => {
      const response =
        operation === "enable"
          ? await apiClient.tables[":tableId"].finalization.enable.$post({ param: { tableId: props.tableId } })
          : await apiClient.tables[":tableId"].finalization.disable.$post({ param: { tableId: props.tableId } });
      if (!response.ok) throw new Error(await errorMessage(response, `Could not ${operation} finalization`));
      return response.json();
    },
    onSuccess: () => void statusQuery.refresh(),
    onError: (error) => prompts.error(error.message),
  });

  const changeFinalization = async (operation: "enable" | "disable") => {
    const confirmed = await prompts.confirm(
      operation === "enable"
        ? "Records stay drafts until someone finalizes them. A finalized record, its files and relations can never be changed or removed."
        : "Draft records remain editable. You can enable Finalization again later.",
      {
        title: operation === "enable" ? "Enable record finalization?" : "Disable record finalization?",
        confirmText: operation === "enable" ? "Enable finalization" : "Disable finalization",
        ...(operation === "disable" ? { variant: "danger" as const } : {}),
      },
    );
    if (confirmed) finalizationMut.mutate(operation);
  };

  return (
    <PanelDialog.Body>
      <NoticeCard
        tone="info"
        title="Keep a history, then lock finished records"
        detail="Durable history lets you look back at earlier versions of records and their files. Finalization lets you lock a finished record so its values, files, and relations can no longer be changed or removed. Durable history must be enabled first and cannot be turned off later."
      />
      <Show when={!statusQuery.loading()} fallback={<Placeholder state="loading" align="left" title="Loading history and protection…" />}>
        <Show
          when={!statusQuery.error()}
          fallback={
            <Placeholder
              state="error"
              align="left"
              title="History and protection are unavailable"
              description={statusQuery.error()?.message}
              action={
                <Button variant="secondary" size="sm" type="button" onClick={() => void statusQuery.refresh()}>
                  Retry
                </Button>
              }
            />
          }
        >
          <Show when={statusQuery.data()}>
            <PanelDialog.Section
              title="Durable history"
              subtitle="Review earlier versions of records and their files."
              icon="ti ti-history"
            >
              <Show
                when={enabledHistoryStatus()}
                fallback={
                  <div class="flex flex-col items-start gap-3">
                    <InlineGuidance>
                      History begins with the records as they are now. Changes made before you enable it are not added later.
                    </InlineGuidance>
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      onClick={() => void enableHistory()}
                      loading={historyMut.loading()}
                      loadingLabel="Enabling durable history"
                    >
                      <i class="ti ti-history" aria-hidden="true" /> Enable durable history
                    </Button>
                  </div>
                }
              >
                {(status) => (
                  <div class="flex flex-col items-start gap-3">
                    <NoticeCard
                      tone={status().status === "active" ? "success" : "warning"}
                      title={status().status === "active" ? "Durable history is on" : "Preparing durable history"}
                      detail={
                        status().status === "active"
                          ? `Active since ${new Date(status().activatedAt).toLocaleString()}. It cannot be turned off.`
                          : `${status().baseline.captured} of ${status().baseline.total} existing records are ready.`
                      }
                    />
                    <Show when={status().status === "activating"}>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() => historyMut.mutate("continue")}
                        loading={historyMut.loading()}
                        loadingLabel="Saving existing records"
                      >
                        Continue setup
                      </Button>
                    </Show>
                  </div>
                )}
              </Show>
            </PanelDialog.Section>

            <PanelDialog.Section title="Record finalization" subtitle="Lock finished records against future changes." icon="ti ti-lock">
              <Show when={finalizationStatus()}>
                {(status) => (
                  <Show
                    when={enabledFinalizationStatus()}
                    fallback={
                      <div class="flex flex-col items-start gap-3">
                        <InlineGuidance tone={status().durableHistory === "active" ? "neutral" : "warning"}>
                          {status().durableHistory === "active"
                            ? "Finalization is off. Records remain editable until you explicitly finalize them."
                            : "Turn on Durable History before enabling finalization."}
                        </InlineGuidance>
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          disabled={status().durableHistory !== "active"}
                          onClick={() => void changeFinalization("enable")}
                          loading={finalizationMut.loading()}
                          loadingLabel="Enabling finalization"
                        >
                          <i class="ti ti-lock" /> Enable finalization
                        </Button>
                      </div>
                    }
                  >
                    {(enabled) => (
                      <div class="flex flex-col items-start gap-3">
                        <NoticeCard
                          tone="success"
                          title="Finalization is on"
                          detail={
                            enabled().finalizedCount === 0
                              ? "Records stay editable until someone explicitly finalizes them."
                              : `${enabled().finalizedCount} record(s) are finalized and can no longer be changed.`
                          }
                        />
                        <Show when={enabled().canDisable}>
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={() => void changeFinalization("disable")}
                            loading={finalizationMut.loading()}
                            loadingLabel="Disabling finalization"
                          >
                            Disable finalization
                          </Button>
                        </Show>
                      </div>
                    )}
                  </Show>
                )}
              </Show>
            </PanelDialog.Section>
          </Show>
        </Show>
      </Show>
    </PanelDialog.Body>
  );
}
