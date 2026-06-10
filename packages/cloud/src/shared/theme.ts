export type CloudTheme = "light" | "dark";

const THEME_COOKIE = "theme";
const COOKIE_MAX_AGE_SECONDS = 31536000;

const isCloudTheme = (value: string): value is CloudTheme => value === "light" || value === "dark";

const decodeCookieValue = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Resolve the persisted theme from a Cookie header.
 *
 * Browsers can send duplicate cookie names when legacy path-specific cookies
 * exist. RFC ordering puts more specific paths first, so the root preference
 * written by the current app is usually the last valid `theme` entry.
 */
export const readThemeFromCookieHeader = (cookieHeader: string | null | undefined): CloudTheme => {
  let resolved: CloudTheme = "light";
  for (const part of (cookieHeader ?? "").split(";")) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    if (trimmed.slice(0, separatorIndex) !== THEME_COOKIE) continue;

    const value = decodeCookieValue(trimmed.slice(separatorIndex + 1));
    if (isCloudTheme(value)) resolved = value;
  }
  return resolved;
};

export const themeBootstrapScript = `!function(){var e=document.documentElement;if(!e.hasAttribute("data-theme-fixed")){var t="light";document.cookie.split(";").forEach(function(e){var r=e.trim(),i=r.indexOf("=");if(i>0&&r.slice(0,i)==="theme"){var o;try{o=decodeURIComponent(r.slice(i+1))}catch(e){o=r.slice(i+1)}(o==="light"||o==="dark")&&(t=o)}});e.classList.remove("light","dark");e.classList.add(t)}}();`;

const legacyThemeCookiePaths = (pathname: string): string[] => {
  const paths = new Set(["/", "/me", "/app", "/admin"]);
  if (pathname) paths.add(pathname);
  const parts = pathname.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    paths.add(current);
  }
  return [...paths];
};

export const setThemePreference = (mode: CloudTheme): CloudTheme => {
  if (typeof document === "undefined") return mode;

  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(mode);

  const secure = location.protocol === "https:" ? "; Secure" : "";
  for (const path of legacyThemeCookiePaths(location.pathname)) {
    document.cookie = `${THEME_COOKIE}=; path=${path}; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secure}`;
  }
  document.cookie = `${THEME_COOKIE}=${encodeURIComponent(mode)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  return mode;
};

export const getCurrentThemePreference = (): CloudTheme => {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
};
