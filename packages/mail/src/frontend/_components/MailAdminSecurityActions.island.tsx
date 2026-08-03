import { mutation } from "@k2b/stdlib/solid";
import { Button, IconButton, NoticeCard, prompts } from "@k2b/ui";
import { apiClient } from "../../api/client";
import type { MailProtectedIdentity, MailSecurityPolicy, MailSecurityReport } from "../../security-contracts";
import { readApiError } from "./api-response";

const refresh = () => window.location.reload();

type PolicyForm = {
  disposition: "deny" | "trust";
  target: "sender_address" | "sender_domain" | "link_domain";
  value: string;
  note?: string;
};

type ProtectedIdentityForm = { name: string; domains: string[]; note?: string };
type AuthenticationForm = { servers?: string[] };
type ResolutionForm = { note?: string };

function MailAdminSecurityToolbar(props: { trustedAuthservIds: string[] | null }) {
  const createPolicy = mutation.create<boolean, void>({
    mutation: async (_, { abortSignal }) => {
      const values = (await prompts.form({
        title: "Add Mail security rule",
        icon: "ti ti-shield-plus",
        fields: {
          guidance: {
            type: "info",
            content: () => (
              <NoticeCard
                tone="info"
                title="Rules affect every mailbox"
                detail="Block only a known bad address or domain. Trust only a known sender that also passes authentication from a configured receiving server; trust never overrides a block."
              />
            ),
          },
          disposition: {
            type: "select",
            label: "Rule",
            required: true,
            default: "deny",
            options: [
              { id: "deny", label: "Block" },
              { id: "trust", label: "Trust authenticated sender" },
            ],
          },
          target: {
            type: "select",
            label: "Match",
            required: true,
            default: "sender_domain",
            options: [
              { id: "sender_address", label: "Sender address" },
              { id: "sender_domain", label: "Sender domain" },
              { id: "link_domain", label: "Link destination domain (block only)" },
            ],
          },
          value: { type: "text", label: "Address or domain", required: true },
          note: {
            type: "text",
            multiline: true,
            label: "Reason",
            description: "Optional internal context for other administrators.",
          },
        },
        confirmText: "Add rule",
      })) as PolicyForm | null;
      if (!values || abortSignal.aborted) return false;
      const response = await apiClient.admin.security.policies.$post(
        {
          json: {
            disposition: values.disposition,
            target: values.target,
            value: values.value,
            note: values.note?.trim() || null,
            enabled: true,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not add the Mail security rule"));
      return true;
    },
    onSuccess: (changed) => changed && refresh(),
    onError: (error) => prompts.error(error.message),
  });
  const createIdentity = mutation.create<boolean, void>({
    mutation: async (_, { abortSignal }) => {
      const values = (await prompts.form({
        title: "Protect a sender identity",
        icon: "ti ti-user-shield",
        fields: {
          guidance: {
            type: "info",
            content: () => (
              <NoticeCard
                tone="info"
                title="Visible sender names can be copied"
                detail="Enter the exact name readers normally see and the domains that may legitimately use it. Mail warns on a mismatch but does not delete or move the message."
              />
            ),
          },
          name: { type: "text", label: "Visible sender name", required: true },
          domains: {
            type: "tags",
            label: "Allowed sending domains",
            description: "A warning appears when this exact visible name arrives from another domain.",
            required: true,
            maxTags: 20,
          },
          note: { type: "text", multiline: true, label: "Reason" },
        },
        confirmText: "Protect identity",
      })) as ProtectedIdentityForm | null;
      if (!values || abortSignal.aborted) return false;
      const response = await apiClient.admin.security["protected-identities"].$post(
        { json: { name: values.name, allowedDomains: values.domains, note: values.note?.trim() || null, enabled: true } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not protect this identity"));
      return true;
    },
    onSuccess: (changed) => changed && refresh(),
    onError: (error) => prompts.error(error.message),
  });
  const editAuthentication = mutation.create<boolean, void>({
    mutation: async (_, { abortSignal }) => {
      const values = (await prompts.form({
        title: "Trusted authentication results",
        icon: "ti ti-certificate",
        fields: {
          guidance: {
            type: "info",
            content: () => (
              <NoticeCard
                tone="info"
                title="These are receiving-server names, not sender domains"
                detail="Add only the Authentication-Results server names confirmed by your mail administrator. An incorrect value could make legitimate verification evidence unavailable."
              />
            ),
          },
          servers: {
            type: "tags",
            label: "Authentication server names",
            description: "Leave empty unless your receiving mail system writes Authentication-Results headers with a stable server name.",
            default: props.trustedAuthservIds ?? [],
            maxTags: 20,
          },
        },
        confirmText: "Save",
      })) as AuthenticationForm | null;
      if (!values || abortSignal.aborted) return false;
      const response = await apiClient.admin.security.settings.$patch(
        { json: { trustedAuthservIds: values.servers ?? [] } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not save trusted authentication results"));
      return true;
    },
    onSuccess: (changed) => changed && refresh(),
    onError: (error) => prompts.error(error.message),
  });
  const busy = () => createPolicy.loading() || createIdentity.loading() || editAuthentication.loading();
  return (
    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={busy()} onClick={() => createPolicy.mutate()}>
        <i class="ti ti-shield-plus" aria-hidden="true" /> Add rule
      </Button>
      <Button size="sm" variant="secondary" disabled={busy()} onClick={() => createIdentity.mutate()}>
        <i class="ti ti-user-shield" aria-hidden="true" /> Protect identity
      </Button>
      <Button
        size="sm"
        variant="subtle"
        disabled={busy() || props.trustedAuthservIds === null}
        title={props.trustedAuthservIds === null ? "Authentication settings could not be loaded" : undefined}
        onClick={() => editAuthentication.mutate()}
      >
        <i class="ti ti-certificate" aria-hidden="true" /> Authentication
      </Button>
    </div>
  );
}

function MailAdminReportActions(props: { report: MailSecurityReport }) {
  const resolve = mutation.create<boolean, MailSecurityReport["status"]>({
    mutation: async (status, { abortSignal }) => {
      const values = (await prompts.form({
        title: status === "confirmed" ? "Confirm phishing report" : status === "dismissed" ? "Dismiss phishing report" : "Review report",
        icon: status === "confirmed" ? "ti ti-shield-check" : "ti ti-shield-search",
        fields: { note: { type: "text", multiline: true, label: "Internal note", default: props.report.resolutionNote ?? "" } },
        confirmText: status === "confirmed" ? "Confirm" : status === "dismissed" ? "Dismiss" : "Start review",
      })) as ResolutionForm | null;
      if (!values || abortSignal.aborted) return false;
      const response = await apiClient.admin.security.reports[":reportId"].$patch(
        {
          param: { reportId: props.report.id },
          json: { status: status as "in_review" | "confirmed" | "dismissed", resolutionNote: values.note?.trim() || null },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not update the report"));
      return true;
    },
    onSuccess: (changed) => changed && refresh(),
    onError: (error) => prompts.error(error.message),
  });
  const blockSender = mutation.create<boolean, void>({
    mutation: async (_, { abortSignal }) => {
      if (!props.report.senderAddress) return false;
      const confirmed = await prompts.confirm(
        "New and existing matching messages are contained in the Mail reader. Authentication trust never overrides this exact block.",
        {
          title: `Block ${props.report.senderAddress}?`,
          confirmText: "Block sender",
          variant: "danger",
        },
      );
      if (!confirmed || abortSignal.aborted) return false;
      const response = await apiClient.admin.security.policies.$post(
        {
          json: {
            disposition: "deny",
            target: "sender_address",
            value: props.report.senderAddress,
            note: `Phishing report ${props.report.id}`,
            enabled: true,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not block the reported sender"));
      return true;
    },
    onSuccess: (changed) => changed && refresh(),
    onError: (error) => prompts.error(error.message),
  });
  const busy = () => resolve.loading() || blockSender.loading();
  return (
    <div class="flex justify-end gap-1">
      {props.report.status === "new" ? (
        <IconButton size="sm" label="Start review" disabled={busy()} onClick={() => resolve.mutate("in_review")}>
          <i class="ti ti-shield-search" aria-hidden="true" />
        </IconButton>
      ) : null}
      {props.report.senderAddress ? (
        <IconButton size="sm" label="Block reported sender" disabled={busy()} onClick={() => blockSender.mutate()}>
          <i class="ti ti-user-x" aria-hidden="true" />
        </IconButton>
      ) : null}
      <IconButton size="sm" label="Confirm phishing" disabled={busy()} onClick={() => resolve.mutate("confirmed")}>
        <i class="ti ti-shield-check" aria-hidden="true" />
      </IconButton>
      <IconButton size="sm" label="Dismiss report" disabled={busy()} onClick={() => resolve.mutate("dismissed")}>
        <i class="ti ti-shield-off" aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function MailAdminPolicyActions(props: { policy: MailSecurityPolicy }) {
  const update = mutation.create<boolean, "toggle" | "delete">({
    mutation: async (operation, { abortSignal }) => {
      if (operation === "delete") {
        const confirmed = await prompts.confirm("Messages are re-evaluated without this rule the next time they are opened.", {
          title: `Delete ${props.policy.value}?`,
          confirmText: "Delete rule",
          variant: "danger",
        });
        if (!confirmed) return false;
        const response = await apiClient.admin.security.policies[":policyId"].$delete(
          { param: { policyId: props.policy.id } },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) throw new Error(await readApiError(response, "Could not delete the rule"));
      } else {
        const response = await apiClient.admin.security.policies[":policyId"].$patch(
          { param: { policyId: props.policy.id }, json: { enabled: !props.policy.enabled } },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) throw new Error(await readApiError(response, "Could not update the rule"));
      }
      return true;
    },
    onSuccess: (changed) => changed && refresh(),
    onError: (error) => prompts.error(error.message),
  });
  return (
    <div class="flex justify-end gap-1">
      <IconButton size="sm" label={props.policy.enabled ? "Disable rule" : "Enable rule"} onClick={() => update.mutate("toggle")}>
        <i class={`ti ${props.policy.enabled ? "ti-player-pause" : "ti-player-play"}`} aria-hidden="true" />
      </IconButton>
      <IconButton size="sm" label="Delete rule" onClick={() => update.mutate("delete")}>
        <i class="ti ti-trash" aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function MailAdminProtectedIdentityActions(props: { identity: MailProtectedIdentity }) {
  const remove = mutation.create<boolean, void>({
    mutation: async (_, { abortSignal }) => {
      const confirmed = await prompts.confirm("Mail will stop checking this visible sender name.", {
        title: `Stop protecting ${props.identity.name}?`,
        confirmText: "Remove",
        variant: "danger",
      });
      if (!confirmed) return false;
      const response = await apiClient.admin.security["protected-identities"][":identityId"].$delete(
        { param: { identityId: props.identity.id } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not remove the protected identity"));
      return true;
    },
    onSuccess: (changed) => changed && refresh(),
    onError: (error) => prompts.error(error.message),
  });
  return (
    <IconButton size="sm" label="Remove protected identity" onClick={() => remove.mutate()}>
      <i class="ti ti-trash" aria-hidden="true" />
    </IconButton>
  );
}

type MailAdminSecurityActionsProps =
  | { kind: "toolbar"; trustedAuthservIds: string[] | null }
  | { kind: "report"; report: MailSecurityReport }
  | { kind: "policy"; policy: MailSecurityPolicy }
  | { kind: "protected-identity"; identity: MailProtectedIdentity };

export default function MailAdminSecurityActions(props: MailAdminSecurityActionsProps) {
  if (props.kind === "toolbar") {
    return <MailAdminSecurityToolbar trustedAuthservIds={props.trustedAuthservIds} />;
  }
  if (props.kind === "report") {
    return <MailAdminReportActions report={props.report} />;
  }
  if (props.kind === "policy") {
    return <MailAdminPolicyActions policy={props.policy} />;
  }
  return <MailAdminProtectedIdentityActions identity={props.identity} />;
}
