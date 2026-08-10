import { mutation as mutations } from "@k2b/stdlib/solid";
import { IconButton, prompts } from "@k2b/ui";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  contactFavoriteKey,
  createContactFavoriteMutationLifecycle,
  listenForContactFavoriteChanges,
  saveContactFavorite,
} from "./contacts-favorites";

type Props = {
  bookId: string;
  contactId: string;
  initialFavorite: boolean;
  class?: string;
};

export default function ContactFavoriteButton(props: Props) {
  const [favorite, setFavorite] = createSignal(props.initialFavorite);
  const [saving, setSaving] = createSignal(false);
  const lifecycle = createContactFavoriteMutationLifecycle(contactFavoriteKey(props.bookId, props.contactId));

  const saveMutation = mutations.create<
    void,
    { bookId: string; contactId: string; favorite: boolean },
    { sourceKey: string; previous: boolean; optimisticFavorite: boolean }
  >({
    onBefore: (change) => {
      const previous = favorite();
      setFavorite(change.favorite);
      return {
        sourceKey: contactFavoriteKey(change.bookId, change.contactId),
        previous,
        optimisticFavorite: change.favorite,
      };
    },
    mutation: (change, { abortSignal }) => saveContactFavorite(change, abortSignal),
    onError: (error, context) => {
      if (!context || lifecycle.owns(context.sourceKey)) {
        if (context && favorite() === context.optimisticFavorite) setFavorite(context.previous);
        void prompts.error(error.message);
      }
    },
    onAbort: (context) => {
      if (context && lifecycle.owns(context.sourceKey) && favorite() === context.optimisticFavorite) {
        setFavorite(context.previous);
      }
    },
    onFinally: (context) => {
      if (context && lifecycle.settle(context.sourceKey)) setSaving(false);
    },
  });

  createEffect(() => {
    const sourceKey = contactFavoriteKey(props.bookId, props.contactId);
    const sourceChanged = sourceKey !== lifecycle.sourceKey();
    const shouldAbort = lifecycle.switchSource(sourceKey);
    if (shouldAbort) saveMutation.abort();
    if (sourceChanged) setSaving(false);
    setFavorite(props.initialFavorite);
  });

  onMount(() => {
    const stop = listenForContactFavoriteChanges((change) => {
      if (change.bookId === props.bookId && change.contactId === props.contactId) setFavorite(change.favorite);
    });
    onCleanup(stop);
  });

  onCleanup(() => saveMutation.abort());

  const toggle = () => {
    const sourceKey = contactFavoriteKey(props.bookId, props.contactId);
    if (!lifecycle.begin(sourceKey)) return;
    setSaving(true);
    void saveMutation.mutate({ bookId: props.bookId, contactId: props.contactId, favorite: !favorite() });
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
        toggle();
      }}
    >
      <i class="ti ti-star" />
    </IconButton>
  );
}
