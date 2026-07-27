import { prompts, toast } from "@valentinkolb/cloud/ui";
import type { WorkflowJsonValue, WorkflowRunState } from "@valentinkolb/cloud/workflows";
import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation } from "@valentinkolb/stdlib/solid";
import { apiClient } from "../api-client";

type AttentionStep = {
  stepKey: string;
  action: string | null;
};

type Props = {
  runId: string;
  state: WorkflowRunState;
  attentionStep?: AttentionStep;
};

const responseError = async (response: Response, fallback: string): Promise<Error> => {
  const data = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return new Error(typeof data?.message === "string" ? data.message : fallback);
};

export default function WorkflowRunActions(props: Props) {
  const cancel = mutation.create<{ canceled: true }, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(
        "Completed external effects cannot be undone. Running work stops cooperatively at its next heartbeat.",
        {
          title: "Cancel workflow run?",
          icon: "ti ti-player-stop",
          confirmText: "Cancel run",
          variant: "danger",
        },
      );
      if (!confirmed) throw new DOMException("Canceled", "AbortError");

      const response = await apiClient.runs[":id"].cancel.$post({ param: { id: props.runId } });
      if (!response.ok) throw await responseError(response, "Could not cancel workflow run.");
      return response.json();
    },
    onSuccess: () => {
      toast.success("Workflow run canceled");
      refreshCurrentPath();
    },
    onError: (error) => {
      if (error.name !== "AbortError") prompts.error(error.message);
    },
  });

  const resolveSucceeded = mutation.create<{ resolved: true }, void>({
    mutation: async () => {
      const step = props.attentionStep;
      if (!step) throw new Error("This run has no effect awaiting resolution.");
      const values = await prompts.form({
        title: "Confirm effect succeeded",
        icon: "ti ti-check",
        confirmText: "Confirm and resume",
        variant: "success",
        fields: {
          output: {
            type: "text" as const,
            label: "Confirmed output (JSON, optional)",
            multiline: true,
            lines: 4,
            placeholder: '{"providerId":"..."}',
          },
        },
      });
      if (!values) throw new DOMException("Canceled", "AbortError");

      const raw = values.output?.trim() ?? "";
      let output: WorkflowJsonValue | undefined;
      if (raw) {
        try {
          output = JSON.parse(raw) as WorkflowJsonValue;
        } catch {
          throw new Error("Confirmed output must be valid JSON.");
        }
      }

      const response = await apiClient.runs[":id"].attention[":step"].$post({
        param: { id: props.runId, step: step.stepKey },
        json: output === undefined ? { state: "succeeded" } : { state: "succeeded", output },
      });
      if (!response.ok) throw await responseError(response, "Could not resolve workflow effect.");
      return response.json();
    },
    onSuccess: () => {
      toast.success("Effect confirmed; workflow resumed");
      refreshCurrentPath();
    },
    onError: (error) => {
      if (error.name !== "AbortError") prompts.error(error.message);
    },
  });

  const resolveFailed = mutation.create<{ resolved: true }, void>({
    mutation: async () => {
      const step = props.attentionStep;
      if (!step) throw new Error("This run has no effect awaiting resolution.");
      const values = await prompts.form({
        title: "Confirm effect failed",
        icon: "ti ti-x",
        confirmText: "Confirm failure",
        variant: "danger",
        fields: {
          message: {
            type: "text" as const,
            label: "Failure explanation",
            required: true,
            multiline: true,
            lines: 3,
            placeholder: "What provider evidence confirms the failure?",
          },
          code: {
            type: "text" as const,
            label: "Failure code (optional)",
            placeholder: "PROVIDER_REJECTED",
          },
        },
      });
      if (!values) throw new DOMException("Canceled", "AbortError");

      const code = values.code?.trim() ?? "";
      const response = await apiClient.runs[":id"].attention[":step"].$post({
        param: { id: props.runId, step: step.stepKey },
        json: {
          state: "failed",
          message: values.message.trim(),
          ...(code ? { code } : {}),
        },
      });
      if (!response.ok) throw await responseError(response, "Could not resolve workflow effect.");
      return response.json();
    },
    onSuccess: () => {
      toast.success("Effect confirmed failed");
      refreshCurrentPath();
    },
    onError: (error) => {
      if (error.name !== "AbortError") prompts.error(error.message);
    },
  });

  const cancelable = () => ["queued", "running", "waiting"].includes(props.state);

  return (
    <div class="flex flex-wrap items-center justify-end gap-1">
      {props.attentionStep ? (
        <>
          <button
            type="button"
            class="btn-success btn-sm"
            disabled={resolveSucceeded.loading() || resolveFailed.loading()}
            onClick={() => resolveSucceeded.mutate()}
            title="Confirm from provider evidence. The effect is not repeated."
          >
            <i class="ti ti-check" />
            Mark succeeded
          </button>
          <button
            type="button"
            class="btn-danger btn-sm"
            disabled={resolveSucceeded.loading() || resolveFailed.loading()}
            onClick={() => resolveFailed.mutate()}
            title="Confirm from provider evidence that the effect did not happen."
          >
            <i class="ti ti-x" />
            Mark failed
          </button>
        </>
      ) : null}
      {cancelable() ? (
        <button type="button" class="btn-danger btn-sm" disabled={cancel.loading()} onClick={() => cancel.mutate()}>
          <i class={cancel.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-player-stop"} />
          Cancel run
        </button>
      ) : null}
    </div>
  );
}
