# Assistant CLI

Use `cld assistant` for non-interactive Assistant workflows. It can start or continue chats, stream responses, manage chat state and files, resolve pending actions, edit preferences, and synchronize Cloud skills. An interactive terminal chat is not part of this interface yet.

## One-shot chat

Start a new chat and stream only the assistant response to stdout:

```bash
cld assistant ask "Summarize my open work"
printf '%s' "Summarize this carefully" | cld assistant ask --stdin
```

Continue an existing chat by stable ID:

```bash
cld assistant ask --chat <chat-id> "What changed since then?"
```

Useful options:

- `--title <title>` names a newly created chat.
- `--model <profile-id>` selects a model from `cld assistant models`.
- Repeat `--attach <local-file>` for images or documents.
- `--detach` submits the turn and returns its ID without waiting.
- Repeat `--approve <exact-tool-name>` to approve only those tools for that turn. There is deliberately no approve-all flag.

Normal mode writes assistant text to stdout and tool progress to stderr. `--json` waits and prints one final aggregate. `--jsonl` emits versioned stream events such as text deltas, tool state changes, attention requests, and turn completion.

If a turn needs an approval or frontend tool result that was not supplied, the command exits with status `2`. Inspect and resolve it explicitly:

```bash
cld assistant actions list <chat-id> <turn-id>
cld assistant actions approve <chat-id> <turn-id> <call-id>
cld assistant actions reject <chat-id> <turn-id> <call-id>
cld assistant actions submit <chat-id> <turn-id> <call-id> --result-file result.json
cld assistant turns watch <chat-id> <turn-id>
```

## Chats and turns

```bash
cld assistant chats list
cld assistant chats list --status needs_attention --json
cld assistant chats get <chat-id>
cld assistant messages list <chat-id>
cld assistant chats timeline <chat-id>
cld assistant turns steer <chat-id> <turn-id> "Focus on the migration risk"
cld assistant turns stop <chat-id> <turn-id>
```

Chat management includes `chats create`, `update`, `pin`, `unpin`, `archive`, `restore`, `mark-read`, `compact`, `reindex`, and `index-status`. Message operations include `messages retry` and `messages fork`. Archiving requires `--yes`.

## Conversation files

Conversation uploads under `/input` represent immutable user inputs. Files under `/files` are the editable agent workspace.

```bash
cld assistant files list <chat-id>
cld assistant files upload <chat-id> ./report.pdf
cld assistant files upload <chat-id> ./draft.md --workspace
cld assistant files download <chat-id> /files/draft.md --out ./draft.md
printf '%s' '# Revised' | cld assistant files write <chat-id> /files/draft.md --stdin
cld assistant files rename <chat-id> /files/draft.md /files/final.md
cld assistant files delete <chat-id> /files/final.md --yes
```

## Preferences and memory

```bash
cld assistant prefs get
cld assistant prefs set --instructions-file ./instructions.md
cld assistant prefs set --memory-file ./memory.md
cld assistant prefs memory enable
cld assistant prefs memory disable
cld assistant prefs system-prompt
```

`prefs system-prompt` previews the same composed prompt path used for a fresh Assistant chat. Treat memory and instructions as user data; read before replacing them.

## Cloud skills

Discover and manage skills:

```bash
cld assistant skills list
cld assistant skills list --managed
cld assistant skills get <skill-id-or-slug>
cld assistant skills create release-notes --description "Summarize release changes"
cld assistant skills enable <skill-id-or-slug>
cld assistant skills disable <skill-id-or-slug>
```

Use `skills files`, `skills events`, and `skills access` for individual files, audit history, and sharing. Workspace-skill code review is available through `skills code-review`, `code-approve`, and `code-revoke` to users with the corresponding rights.

Synchronize an entire local skill directory explicitly:

```bash
cld assistant skills push ./release-notes --dry-run
cld assistant skills push ./release-notes
cld assistant skills pull release-notes ./release-notes --dry-run
cld assistant skills pull release-notes ./release-notes
```

The local directory must contain a root `SKILL.md` and cannot contain symlinks. Push is additive by default: remote-only files remain. Deleting those files requires both `--prune` and `--yes`. Pull leaves unrelated local files alone and refuses to replace differing files unless `--force` is passed. A concurrent remote change causes push to fail instead of partially updating the skill.

Run `cld assistant <group> help` or `cld assistant <group> <command> --help` for the complete accepted flags.
