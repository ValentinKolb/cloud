import { TIMEZONE_COOKIE } from "@valentinkolb/cloud/shared";
import { cookies } from "@valentinkolb/stdlib/browser";
import { onMount } from "solid-js";

export default function PublicTimezoneCookie() {
  onMount(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone || cookies.readCookie(TIMEZONE_COOKIE) === timeZone) return;
    cookies.writeCookie(TIMEZONE_COOKIE, timeZone);
    try {
      if (sessionStorage.getItem("grids.public.timezone.reload") === timeZone) return;
      sessionStorage.setItem("grids.public.timezone.reload", timeZone);
      window.location.reload();
    } catch {
      // The cookie is enough; the next navigation renders with the browser timezone.
    }
  });

  return null;
}
