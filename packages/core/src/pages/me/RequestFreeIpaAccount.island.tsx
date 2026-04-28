import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@valentinkolb/cloud/clients/core";

type RequestFreeIpaAccountProps = {
  givenname: string;
  sn: string;
  displayName: string;
  phone: string | null;
  agbUrl?: string;
  privacyUrl?: string;
  appName?: string;
};

export default function RequestFreeIpaAccount(props: RequestFreeIpaAccountProps) {
const mutation = mutations.create<
    { id: string; message?: string },
    {
      firstName: string;
      lastName: string;
      displayName?: string;
      phone?: string;
      comment?: string;
      acceptedAgb: true;
    }
  >({
    mutation: async (vars) => {
      const profileRes = await apiClient.me.$patch({
        json: {
          givenname: vars.firstName,
          sn: vars.lastName,
          displayName: vars.displayName || `${vars.firstName} ${vars.lastName}`,
        },
      });
      if (!profileRes.ok) {
        const data = await profileRes.json();
        throw new Error((data as { message?: string }).message ?? "Failed to update profile.");
      }

      const res = await apiClient.me["account-request"].$post({
        json: {
          phone: vars.phone,
          comment: vars.comment,
          acceptedAgb: vars.acceptedAgb,
        },
      });
      const data = (await res.json()) as { id?: string; message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to submit request.");
      }
      return { id: data.id ?? "", message: data.message };
    },
    onSuccess: () => {
      prompts.alert("Your FreeIPA account request has been submitted. You will be notified once it has been reviewed.", {
        title: "Request Submitted",
        icon: "ti ti-check",
      });
      window.location.reload();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: `Request ${props.appName || ""} FreeIPA Account`.trim(),
      icon: "ti ti-building-fortress",
      confirmText: "Submit Request",
      fields: {
        info: {
          type: "info",
          content: () => (
            <div class="info-block-info text-xs">
              Please verify your details and explain why you need a centrally managed FreeIPA account.
            </div>
          ),
        },
        firstName: {
          type: "text",
          label: "First Name",
          placeholder: "Your first name...",
          icon: "ti ti-user",
          required: true,
          default: props.givenname,
        },
        lastName: {
          type: "text",
          label: "Last Name",
          placeholder: "Your last name...",
          icon: "ti ti-user",
          required: true,
          default: props.sn,
        },
        displayName: {
          type: "text",
          label: "Display Name",
          placeholder: "How should we call you?",
          icon: "ti ti-id-badge-2",
          default: props.displayName,
        },
        phone: {
          type: "text",
          label: "Phone (optional)",
          placeholder: "Your phone number...",
          icon: "ti ti-phone",
          default: props.phone ?? "",
        },
        comment: {
          type: "text",
          multiline: true,
          label: "Why do you need a FreeIPA account?",
          placeholder: "I need group-based access to ...",
          description: "Explain your role and which centrally managed access you need.",
        },
        agbNotice: {
          type: "info",
          content: () => (
            <div class="text-xs text-dimmed">
              By submitting this request, you agree to our{" "}
              {props.agbUrl ? (
                <a href={props.agbUrl} target="_blank" class="text-blue-500 hover:underline">
                  Terms of Service
                </a>
              ) : (
                <span>Terms of Service</span>
              )}{" "}
              and{" "}
              {props.privacyUrl ? (
                <a href={props.privacyUrl} target="_blank" class="text-blue-500 hover:underline">
                  Privacy Policy
                </a>
              ) : (
                <span>Privacy Policy</span>
              )}
              .
            </div>
          ),
        },
        acceptedAgb: {
          type: "boolean",
          label: "I accept the Terms of Service and Privacy Policy",
          required: true,
        },
      },
    });

    if (!result) return;
    if (!result.acceptedAgb) {
      prompts.error("You must accept the Terms of Service to continue.");
      return;
    }

    await mutation.mutate({
      firstName: result.firstName,
      lastName: result.lastName,
      displayName: result.displayName || undefined,
      phone: result.phone || undefined,
      comment: result.comment || undefined,
      acceptedAgb: true,
    });
  };

  return (
    <button type="button" onClick={handleClick} disabled={mutation.loading()} class="btn-primary btn-sm">
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-building-fortress" />}
      <span>Request FreeIPA Account</span>
    </button>
  );
}
