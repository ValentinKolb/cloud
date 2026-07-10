import { toast } from "@valentinkolb/cloud/ui";
import { onMount } from "solid-js";

const ACTION_PARAM = "job_action";
const MESSAGE_PARAM = "job_message";

export default function JobsActionToast() {
  onMount(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(ACTION_PARAM) !== "accepted") return;

    toast.success(url.searchParams.get(MESSAGE_PARAM) || "Schedule run accepted.");
    url.searchParams.delete(ACTION_PARAM);
    url.searchParams.delete(MESSAGE_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  });

  return null;
}
