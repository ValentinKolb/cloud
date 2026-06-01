import { cookies } from "@valentinkolb/stdlib/browser";
import { onMount } from "solid-js";
import { TIMEZONE_COOKIE } from "../shared/time";

export default function TimezoneCookie() {
  onMount(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const current = cookies.readCookie(TIMEZONE_COOKIE);
    if (timeZone && current !== timeZone) {
      cookies.writeCookie(TIMEZONE_COOKIE, timeZone);
      try {
        if (sessionStorage.getItem("cloud.timezone.reload") !== timeZone) {
          sessionStorage.setItem("cloud.timezone.reload", timeZone);
          window.location.reload();
        }
      } catch {
        // Cookie persistence still succeeds; the next navigation will render with the browser timezone.
      }
    }
  });

  return null;
}
