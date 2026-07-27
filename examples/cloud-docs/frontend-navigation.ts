import { listenPopState } from "@valentinkolb/ssr/nav";

export const listenForSelectedItem = (select: (itemId: string | null) => void): (() => void) =>
  listenPopState(({ url }) => {
    select(url.searchParams.get("item"));
  });
