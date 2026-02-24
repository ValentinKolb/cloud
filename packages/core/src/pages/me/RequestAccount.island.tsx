import { apiClient } from "@/api/api-client";
import { mutation as mutations } from "@valentinkolb/cloud-lib/browser";
import { prompts } from "@valentinkolb/cloud-lib/ui";


type RequestAccountProps = {
  givenname: string;
  sn: string;
  displayName: string;
  phone: string | null;
  agbUrl?: string;
  privacyUrl?: string;
  appName?: string;
};

export default function RequestAccount(props: RequestAccountProps) {
  const mutation = mutations.create<
    { id: string },
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
      // First: save profile data on the user via PATCH /me
      const profileRes = await apiClient.me.$patch({
        json: {
          givenname: vars.firstName,
          sn: vars.lastName,
          displayName: vars.displayName || `${vars.firstName} ${vars.lastName}`,
          phone: vars.phone,
        },
      });
      if (!profileRes.ok) {
        const data = await profileRes.json();
        throw new Error((data as { message: string }).message ?? "Failed to update profile.");
      }

      // Then: create account request with only comment + AGB
      const res = await fetch("/api/ipa/account-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment: vars.comment,
          acceptedAgb: vars.acceptedAgb,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { message: string }).message ?? "Failed to submit request.");
      }
      return data as unknown as { id: string };
    },
    onSuccess: () => {
      prompts.alert("Your account request has been submitted. You will be notified once it has been reviewed.", {
        title: "Request Submitted",
        icon: "ti ti-check",
      });
      window.location.reload();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: `Request ${props.appName || ""} Account`,
      icon: "ti ti-user-plus",
      confirmText: "Submit Request",
      fields: {
        info: {
          type: "info",
          content: () => (
            <div class="info-block-info text-xs">
              Please verify your information and explain why you need a{props.appName ? ` ${props.appName}` : "n"} account.
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
          label: "Why do you need an account?",
          placeholder: "I am part of ... and need access to ...",
          description: "Please explain your role in the organization and why you need access.",
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

    if (result) {
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
    }
  };

  return (
    <button type="button" onClick={handleClick} disabled={mutation.loading()} class="btn-success text-xs px-4 py-2 shrink-0">
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-user-plus" />}
      <span>Request Access</span>
    </button>
  );
}
