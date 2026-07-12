# Mail

Use `cld mail` to configure Cloud mailboxes and operate mirrored IMAP mail through the same permission-checked HTTP APIs as the Mail app.

## Safety

- Run `cld mail help` and confirm that the Mail module is available before changing a mailbox.
- Use `--json` when a later command needs an id or cursor.
- Pass provider credentials with `--secret-stdin` or `--secret-file`. Credentials are write-only and are never returned by the API.
- Read a message and its folder ids before changing flags, moving, copying, or deleting it.
- `sync`, `rediscover`, and `repair` create durable maintenance commands. A confirmed maintenance command proves that work was accepted or the repair transaction completed; folder sync progress remains visible through `status` and `mailbox wait`.
- Do not delete remote messages, revoke credentials, or delete mailbox resources without an explicit user request.

## Configure a mailbox

Create a mailbox and make it the default for later commands:

```bash
cld --json mail create "Support" --policy shared_connection
cld mail use <mailbox-id>
cld --json mail current
```

Store and verify a generic IMAP/SMTP connection. Supply the password through stdin; never place it in the command arguments:

```bash
cld --json mail provider add \
  --name "Support provider" \
  --email support@example.com \
  --username support@example.com \
  --imap-host imap.example.com \
  --imap-port 993 \
  --imap-tls implicit \
  --smtp-host smtp.example.com \
  --smtp-port 587 \
  --smtp-tls starttls \
  --secret-stdin
```

Attach the returned connection and inspect the discovered binding:

```bash
cld --json mail binding attach <connection-id>
cld --json mail binding list
```

If attachment reports `requiresConfirmation: true`, confirm the returned binding explicitly:

```bash
cld --json mail binding confirm <binding-id>
```

Wait for initial discovery and list provider-backed folders:

```bash
cld --json mail mailbox wait --health active --timeout-seconds 300
cld --json mail folders
```

Inspect the aggregate backend state, including bindings, discovery generations, missing folders, sync runs, hydration, commands, outbox, and search health:

```bash
cld --json mail status
```

Create and verify a sender identity. Verification submits a real message to the recipient:

```bash
cld --json mail identity add --address support@example.com --name "Support" --default
cld --json mail identity verify <identity-id> <binding-id> --recipient support@example.com
cld --json mail identity list
```

Pass `--provider-saves-sent` during verification only when the provider stores SMTP submissions in Sent itself. Otherwise Cloud appends the sent copy through IMAP.

## Read and search mail

Queue a durable sync command, then wait for a unique expected message:

```bash
cld --json mail sync --wait
cld --json mail message wait \
  --subject "cloud-smoke-<unique-id>" \
  --match exact \
  --timeout-seconds 300
```

Search fields independently. Repeated fields use AND by default; pass `--or` to combine them with OR:

```bash
cld --json mail search --from sender@example.com --subject invoice --match contains --sort newest
cld --json mail search --body overdue --body reminder --or --cursor <next-cursor>
```

For nested AND, OR, and NOT expressions, pass the shared search contract through a file or stdin:

```json
{
  "and": [
    { "field": "subject", "query": "invoice", "match": "contains" },
    { "not": { "field": "from", "query": "bot@example.com", "match": "exact" } }
  ]
}
```

```bash
cld --json mail search --expression-file query.json --sort newest
```

Inspect conversations and messages:

```bash
cld --json mail conversation list --status open
cld --json mail conversation messages <conversation-id>
cld --json mail message get <message-id>
```

## Draft and send

Create or replace a revision-checked shared draft:

```bash
cld --json mail draft create \
  --identity <identity-id> \
  --to recipient@example.com \
  --subject "Draft subject" \
  --body-file body.md

cld --json mail draft update <draft-id> \
  --revision <current-revision> \
  --identity <identity-id> \
  --to recipient@example.com \
  --subject "Updated subject" \
  --body-file body.md
```

Send immediately and wait for the durable command to succeed:

```bash
cld --json mail send \
  --identity <identity-id> \
  --to recipient@example.com \
  --subject "Message subject" \
  --body-file body.md \
  --undo 0 \
  --wait \
  --timeout-seconds 180
```

Set `--conversation <conversation-id>` when replying so Mail adds the correct `In-Reply-To` and `References` headers.

Schedule a send with an ISO timestamp. For long-dated sends, inspect the returned command later instead of keeping a CLI process open:

```bash
cld --json mail send \
  --identity <identity-id> \
  --to recipient@example.com \
  --subject "Scheduled message" \
  --body-file body.md \
  --schedule <ISO-timestamp> \
  --undo 0
```

To exercise Undo Send, queue with an undo window and cancel the returned command id before submission starts:

```bash
cld --json mail send --identity <identity-id> --to recipient@example.com --subject "Undo test" --body "Cancel me" --undo 60
cld --json mail command cancel <command-id>
```

Inspect or wait for durable commands:

```bash
cld --json mail command list
cld --json mail command get <command-id>
cld --json mail command wait <command-id> --timeout-seconds 180
```

## Provider-backed operations

Rediscover namespaces, subscriptions, and effective folder rights for every active binding, or target one binding:

```bash
cld --json mail rediscover --wait --timeout-seconds 300
cld --json mail rediscover --binding <binding-id> --wait --timeout-seconds 300
```

After replacing provider credentials, explicitly reverify the pending binding. An ambiguous resource match remains pending until `binding confirm` is called:

```bash
cld --json mail binding verify <binding-id> --wait --timeout-seconds 300
cld --json mail binding confirm <binding-id>
```

Queue one canonical folder without synchronizing the entire mailbox:

```bash
cld --json mail sync folder <folder-id> --wait
```

Rebuild a folder only after a confirmed `UIDVALIDITY` or remote identity change. The command retains message content but invalidates stale remote placements before resynchronizing:

```bash
cld --json mail repair folder <folder-id> --yes --wait --timeout-seconds 300
```

Retry messages whose body or attachment hydration exhausted its normal retry budget:

```bash
cld --json mail repair hydration --wait
```

Maintenance commands require mailbox `admin`. Use `--idempotency-key` when an external script may retry the same request.

Use `remoteMessageRefId` and `folderId` from `message get` or `conversation messages`:

```bash
cld --json mail message flags <remote-message-ref-id> --folder <folder-id> --flag '\\Seen'
cld --json mail message copy <remote-message-ref-id> --source <folder-id> --destination <folder-id>
cld --json mail message move <remote-message-ref-id> --source <folder-id> --destination <folder-id>
```

Remote deletion requires `--yes`:

```bash
cld mail message delete <remote-message-ref-id> --folder <folder-id> --yes
```

Download a complete attachment or an explicit byte range:

```bash
cld --json mail attachment download <message-id> <attachment-id> --out attachment.bin
cld --json mail attachment download <message-id> <attachment-id> --offset 0 --length 1048576 --out first-megabyte.bin
```

## Two-account smoke test

Use a unique marker for every run and keep both mailbox ids explicit:

1. Configure and verify mailbox A and mailbox B.
2. Send A to B with `--undo 0 --wait` and the marker in the exact subject.
3. Queue B sync and use `message wait` for the marker.
4. Read the message and its conversation, then reply B to A with `--conversation`.
5. Queue A sync and verify that the reply appears in the same conversation.
6. Test flags, copy, and move on the marker message using discovered folder ids.
7. Download a known attachment and compare its bytes with the source.
8. Test Undo Send with a second marker and `command cancel`.

Do not automatically delete provider mail after the run. The marker keeps test messages easy to inspect or remove later with explicit approval.
