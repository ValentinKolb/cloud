/**
 * Autocomplete für `#tag` Referenzen im Notebook.
 *
 * Trigger: cursor sits right after a `#<partial>` sequence (`#`,
 * followed by at least one word char) anywhere mid-text. Suggestions
 * are the existing tags in the current notebook, pulled from
 * `/api/notebooks/:id/tags` — the same endpoint `kit.tags.list()`
 * uses, so the autocomplete reflects exactly what the rest of the
 * app sees.
 *
 * # Why "at least one word char"?
 *
 * `#` alone is ambiguous: at line start it could be a heading
 * (` # Heading`), mid-line it could be the start of a tag, or it
 * could just be a literal hash character. Requiring at least one
 * word char (`/#\w+/`) means we only fire once the user has
 * committed to "this is a tag" — no noise during heading typing
 * or when `#` appears in code-like text.
 *
 * # Server-tag cache
 *
 * Fetching every keystroke would hammer the API. We cache the tag
 * list per notebook with a short TTL — typing rapidly only hits
 * the network once, subsequent triggers reuse the cached list. The
 * TTL is short enough (45s) that tags added in other tabs / by
 * other collaborators show up within a minute without manual
 * refresh.
 *
 * # Scope
 *
 * Skip inside FencedCode blocks — `#` in code is just literal text
 * (CSS selectors, shell comments, Python decorators, etc.), and
 * surfacing tag suggestions there would be confusing.
 */
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  pickedCompletion,
} from "@codemirror/autocomplete";
import { createNotebookFetchCache } from "./_lib/notebook-fetch-cache";
import { isInsideFencedCode } from "./editor-scope";
import { withIcon } from "./kit-autocomplete";

/** Server response shape — matches `KitTagSummary` in `kit-types.ts`. */
type TagSummary = { tag: string; count: number };

/** Pre-built Completion array lives alongside the raw tags so we
 *  don't rebuild N Completion objects + re-sort them on every
 *  keystroke that triggers the popup. */
type CachedTags = { tags: TagSummary[]; completions: Completion[] };

const EMPTY_CACHED: CachedTags = { tags: [], completions: [] };

const tagCache = createNotebookFetchCache<CachedTags>(
  async (notebookId) => {
    const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/tags`);
    if (!res.ok) return EMPTY_CACHED;
    const tags = (await res.json()) as TagSummary[];
    return { tags, completions: buildCompletions(tags) };
  },
  { fallback: EMPTY_CACHED },
);

/** Build the Completion list from server data. Pre-format the
 *  `detail` so we don't re-allocate strings on every keystroke
 *  inside the popup filter. */
const buildCompletions = (tags: TagSummary[]): Completion[] => {
  return tags
    .slice()
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map((t) => {
      // Custom `apply` to (a) append a trailing space so the user
      // can keep typing prose without manually hitting space, and
      // (b) skip that space when the next char is already
      // whitespace so we don't produce double-spaces mid-sentence.
      // The result's `from` is anchored AFTER the `#` the user
      // already typed, so inserting just the tag body (no leading
      // `#`) produces the correct `#tag` result. (Earlier revision
      // shipped `apply: \`#${t.tag}\`` which double-inserted the
      // hash → `##tag`.)
      const c: Completion = {
        label: t.tag,
        type: "constant",
        detail: t.count === 1 ? "1 note" : `${t.count} notes`,
        apply: (view, completion, from, to) => {
          const charAfter = view.state.sliceDoc(to, Math.min(to + 1, view.state.doc.length));
          const insert = charAfter === "" || !/\s/.test(charAfter) ? `${t.tag} ` : t.tag;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
            annotations: pickedCompletion.of(completion),
            userEvent: "input.complete",
          });
        },
      };
      withIcon(c, "ti-hash");
      return c;
    });
};

/** Result-builder shared by sync + async branches. Pulls `from`
 *  one past the `#` so CM filters by tag body, not by the literal
 *  `#`-prefixed string. */
const buildResult = (
  word: { from: number; to: number },
  completions: Completion[],
): CompletionResult | null => {
  if (completions.length === 0) return null;
  return {
    from: word.from + 1,
    to: word.to,
    options: completions,
    // Keep the popup open while the user is still typing word
    // chars. As soon as they type whitespace / punctuation /
    // anything non-word, the popup closes (correct — the tag is
    // committed at that point).
    validFor: /^\w*$/,
  };
};

/**
 * Factory — closes over the notebookId so the source can hit the
 * right tag endpoint. Mirrors `buildSlashSource(ctx)` so the wiring
 * in `slash-commands/index.ts` stays uniform.
 *
 * # Sync-when-cached pattern
 *
 * Earlier revision was `async (context) => ...` which made EVERY
 * invocation return a Promise even when it just did
 * `matchBefore` + early `return null`. CM autocomplete waits for
 * pending source promises before opening the popup — so an
 * unconditionally-async source delays the OTHER (sync) sources'
 * popups by one microtask per keystroke. Multiplied across all
 * non-matching keystrokes that's visible lag.
 *
 * The fix: stay synchronous on the hot path (no match, in code,
 * cache miss → null). Only return a Promise when we actually need
 * to await the fetch — i.e. cold cache AND the user is in `#word`
 * context. Once the cache is warm (after the first fetch), every
 * subsequent invocation is sync.
 *
 * We also kick off a background fetch in the factory itself so
 * by the time the user types their first `#`, the cache is usually
 * already populated.
 */
export const buildTagCompletionSource = (notebookId: string): CompletionSource => {
  // Warm the cache early — most editors will have completed this
  // fetch before the user types their first `#`. No await: we don't
  // care about the result here, just the side effect of populating
  // the cache.
  void tagCache.fetch(notebookId);

  return (context: CompletionContext): CompletionResult | Promise<CompletionResult | null> | null => {
    // Two regex modes — strict (implicit) and lenient (explicit).
    //
    // - IMPLICIT trigger (`activateOnTyping` fires on user input):
    //   Require `#\w+` — at least one word char after the hash.
    //   This prevents the popup from opening on a bare `#` typed
    //   in passing (a heading marker, a literal hash, etc.) and
    //   keeps autocomplete noise low.
    //
    // - EXPLICIT trigger (user invoked completion via Ctrl-Space
    //   or our `/tag` slash command, which calls startCompletion
    //   programmatically): allow bare `#` so the entire tag list
    //   surfaces immediately. CM sets `context.explicit = true`
    //   for these invocations.
    //
    // matchBefore does NOT use `^` so this fires mid-line as well
    // as at line start. The string `hello #pr` matches with
    // `from` at the `#` position (index 6), surfacing tag
    // suggestions exactly the same way as a line-start `#pr`.
    const word = context.matchBefore(context.explicit ? /#\w*/ : /#\w+/);
    if (!word) return null;
    if (isInsideFencedCode(context)) return null;
    // Align with `extractTags` semantics: the `#` must be preceded
    // by whitespace OR be at the very start of the document. This
    // matches what the tag-indexer treats as a tag — `abc#foo` in
    // mid-word is just literal text, not a tag, so the autocomplete
    // shouldn't fire there either.
    if (word.from > 0) {
      const prev = context.state.sliceDoc(word.from - 1, word.from);
      if (!/\s/.test(prev)) return null;
    }

    const fresh = tagCache.getFresh(notebookId);
    if (fresh) {
      // Cache hit — fully synchronous path. No microtask, no
      // Promise allocation. Completions are pre-built once when
      // the cache was warmed; we just hand the array back here.
      return buildResult(word, fresh.completions);
    }

    // Cold/stale cache — return a Promise. CM handles it gracefully
    // (popup may briefly delay opening or update once data lands).
    return tagCache.fetch(notebookId).then((data) => buildResult(word, data.completions));
  };
};
