import { cookies } from "./cookies";

export type ThemeMode = "light" | "dark";

const getCurrent = (): ThemeMode => {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
};

const set = (mode: ThemeMode): ThemeMode => {
  if (typeof document === "undefined") return mode;
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.classList.add(mode);
  cookies.writeCookie("theme", mode);
  return mode;
};

const toggle = (): ThemeMode => {
  const next = getCurrent() === "dark" ? "light" : "dark";
  return set(next);
};

export const theme = {
  getCurrent,
  set,
  toggle,
} as const;

