import { cookies } from "@valentinkolb/stdlib/browser";
import { onMount } from "solid-js";
import { TIMEZONE_COOKIE } from "../shared/time";

export default function TimezoneCookie() {
  onMount(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone && cookies.readCookie(TIMEZONE_COOKIE) !== timeZone) {
      cookies.writeCookie(TIMEZONE_COOKIE, timeZone);
    }
  });

  return null;
}
