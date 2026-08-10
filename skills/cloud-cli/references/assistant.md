# Assistant CLI

Use `cld assistant` for interactive chat and Assistant automation. The root command starts or continues a chat; named management commands inspect chat state and files, resolve pending actions, edit preferences, and manage Projects.

## Interactive and print modes

Start a line-oriented terminal session:

```bash
cld assistant
cld assistant "Summarize my open work"
cld assistant --chat <chat-id>
```

The startup line shows the effective model. New chats print their stable resume command, and the CLI repeats it when the session ends. Blue `Info:` messages confirm non-error state changes. The interactive commands are deliberately small: `/help`, `/exit`, `/attach`, `/files`, and `/model`. Run `/model` without an argument to choose from the visible options by number. A selected model remains active for the session.

Enable local computer access explicitly:

```bash
cld assistant --allow-bash
```

This adds the predefined `local_bash` client tool only to turns from that
interactive session. The CLI prints the exact command and startup directory and
requires `Y/n` before every execution. It runs `/bin/bash` as the current OS
user with closed stdin, a fixed timeout, and bounded stdout/stderr. Tool calls
and results are stored in Cloud and remain visible in web chat history. The web
app cannot execute them. Do not use this mode for untrusted prompts without
reviewing each command carefully.

Use `--print` or `-p` to stream one response and exit:

```bash
cld assistant -p "Summarize my open work"
cld assistant -p --chat <chat-id> "What changed since then?"
printf '%s' "Summarize this carefully" | cld assistant -p
cld assistant -p --project <project-id> "Summarize the latest changes"
```

Useful options:

- `--title <title>` names a newly created chat.
- `--model <profile-id>` selects a model from `cld assistant models`.
- `--project <project-id>` creates the new chat in an accessible Project.
- Repeat `--attach <local-file>` for images or documents.
- `--detach` submits the turn and returns its ID without waiting in print mode.
- Repeat `--approve <exact-tool-name>` in print mode to approve only those tools for that turn. There is deliberately no approve-all flag.

Print mode writes assistant text to stdout and tool progress to stderr. `--json` waits and prints one final aggregate. `--jsonl` emits versioned stream events such as text deltas, tool state changes, attention requests, and turn completion. Structured output, detached submission, and piped input require `--print`.
`--allow-bash` is deliberately rejected with `--print`, structured output, and
detached execution.

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

## Preferences

```bash
cld assistant prefs get
cld assistant prefs system-prompt
```

`prefs system-prompt` previews the same composed prompt path used for a fresh
Assistant chat. Personal facts and preferences are managed in the Assistant
Personalization tab; the CLI does not expose personalization mutations yet.

## Projects

Projects combine shared instructions, knowledge, files, Cloud references, model defaults, and Cloud access grants. Chats created in a Project remain private.

```bash
cld assistant projects list
cld assistant projects create "Release notes" --instructions-file ./release-notes.md
cld assistant projects knowledge add "Release notes" "Editorial guidelines" --content-file ./guidelines.md
cld assistant projects files put "Release notes" ./glossary.csv
cld assistant projects references add "Release notes" grids record <record-id> --label "Current catalog"
cld assistant projects access grant "Release notes" <group-id> --type group --permission write
cld assistant chats create --project <project-id>
```

Project names and stable IDs are accepted by management commands. Access grants use `read`, `write`, or `admin`; the Project owner is always an administrator.

Run `cld assistant <group> help` or `cld assistant <group> <command> --help` for the complete accepted flags.
