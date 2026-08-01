import { IconButton, prompts } from "@k2b/ui";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { listenForContactFavoriteChanges, saveContactFavorite } from "./contacts-favorites";

type Props = {
  bookId: string;
  contactId: string;
  initialFavorite: boolean;
  class?: string;
};

export default function ContactFavoriteButton(props: Props) {
  const [favorite, setFavorite] = createSignal(props.initialFavorite);
  const [saving, setSaving] = createSignal(false);

  createEffect(() => {
    void props.bookId;
    void props.contactId;
    setFavorite(props.initialFavorite);
  });

  onMount(() => {
    const stop = listenForContactFavoriteChanges((change) => {
      if (change.bookId === props.bookId && change.contactId === props.contactId) setFavorite(change.favorite);
    });
    onCleanup(stop);
  });

  const toggle = async () => {
    if (saving()) return;
    const next = !favorite();
    setFavorite(next);
    setSaving(true);
    try {
      await saveContactFavorite({ bookId: props.bookId, contactId: props.contactId, favorite: next });
    } catch (error) {
      setFavorite(!next);
      await prompts.error(error instanceof Error ? error.message : "Could not update favorite");
    } finally {
      setSaving(false);
    }
  };

  return (
    <IconButton
      label={favorite() ? "Remove from favorites" : "Add to favorites"}
      class={props.class}
      classList={{ "app-accent-text": favorite(), "text-dimmed": !favorite() }}
      aria-pressed={favorite()}
      disabled={saving()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggle();
      }}
    >
      <i class="ti ti-star" />
    </IconButton>
  );
}
