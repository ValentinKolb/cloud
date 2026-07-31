import type { JSX } from "solid-js";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const normalizeHexColor = (value: string | null | undefined): string | undefined => {
  const color = value?.trim();
  return color && HEX_COLOR.test(color) ? color : undefined;
};

export const hexWithAlpha = (value: string, alpha: string): string => {
  const hex = value.slice(1);
  const expanded = hex.length === 3 ? [...hex].map((digit) => `${digit}${digit}`).join("") : hex;
  return `#${expanded}${alpha}`;
};

export const colorTintStyle = (value: string | null | undefined): JSX.CSSProperties | undefined => {
  const color = normalizeHexColor(value);
  return color
    ? {
        "--k2b-choice-color": color,
        "--k2b-choice-background": hexWithAlpha(color, "1f"),
      }
    : undefined;
};
