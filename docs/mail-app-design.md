# Cloud Mail app design

Cloud Mail is a production-oriented shared inbox with a feature-complete IMAP/SMTP baseline, a provider-neutral domain model, local collaboration, structured automation, fast PostgreSQL search, and permission-bound agents.

Status: Draft. Last consistency review: 2026-07-16. This document records accepted direction, implementation progress, and remaining delivery work. External attachment-link defaults are the only newly opened product-policy topic in this revision.

## Contents

- [Decision status](#decision-status)
- [Implementation progress](#implementation-progress)
- [Product direction](#product-direction)
- [System boundaries](#system-boundaries)
- [Connector architecture](#connector-architecture)
- [Domain model](#domain-model)
- [IMAP baseline synchronization](#imap-baseline-synchronization)
- [Commands and sending](#commands-and-sending)
- [Shared namespaces and sender identities](#shared-namespaces-and-sender-identities)
- [Search](#search)
- [Collaboration](#collaboration)
- [Workflow automation](#workflow-automation)
- [Agents and AI](#agents-and-ai)
- [Compose and rendering](#compose-and-rendering)
- [Application experience](#application-experience)
- [API and CLI](#api-and-cli)
- [Permissions and security](#permissions-and-security)
- [Background work](#background-work)
- [Operations](#operations)
- [Verification](#verification)
- [Delivery plan](#delivery-plan)
- [Alternatives](#alternatives)
- [References](#references)

## Decision status

This document uses two decision states:

- **Accepted direction** constrains the architecture unless a later decision explicitly replaces it.
- **Proposed contract** is concrete enough to implement but still needs review before migrations or public APIs freeze it.

| Area | Status | Direction |
| --- | --- | --- |
| Mail authority | Accepted direction | The connected provider owns portable mail state; PostgreSQL is a durable mirror and owns Cloud collaboration state. IMAP/SMTP is the mandatory baseline connector. |
| Primary resource | Accepted direction | Permissions, settings, automation, sender identities, and AI policy attach to a Cloud mailbox. Private connector bindings provide upstream access behind it. |
| Connector strategy | Accepted direction | Ship the complete generic IMAP/SMTP product first. Add JMAP as the first enhanced connector, then Microsoft Graph and Gmail API without changing domain contracts. |
| Search and tags | Accepted direction | Field-specific structured search, native PostgreSQL FTS, and Cloud-local tags are mandatory; `pg_textsearch` is an optional ranking backend. |
| Conversations | Accepted direction | Original messages and replies form one mailbox-scoped conversation using provider IDs, RFC reply headers, conservative fallback, and explicit manual corrections. |
| Collaboration | Accepted direction | Assignment, work state, internal comment chat, shared drafts, activity, and presence are first-class mailbox features. |
| Draft continuity | Accepted direction | PostgreSQL owns the collaborative draft, a durable browser journal prevents lost typing, and one writer edits through a soft lease and revision checks. IMAP/JMAP drafts are reconciled external snapshots, never a second silent authority. The first implementation does not use Yjs or another CRDT. |
| Application experience | Accepted direction | The default workspace combines dense one-line conversation rows with a reader and at most one optional right detail panel. The conversation list can be hidden without leaving the workspace; only the composer has a dedicated full-size focus mode. Received attachments stay with their history message; outgoing attachments stay with the composer. |
| Automation | Accepted direction | Deterministic decision trees are the default; AI is an optional typed decision node. Live mail and backfill use the same evaluator. Guarded automatic replies and reference allocation are workflow actions, not a separate ticket subsystem. |
| Bulk actions | Accepted direction | Agents compile broad mailbox requests into previewable one-shot workflow plans; direct unbounded mutation loops are not an execution path. |
| Shared folders | Accepted direction | A mailbox has one remote resource and a pool of verified private provider bindings. Its connection policy chooses shared credentials or each actor's provider account. Background sync may fail over between eligible bindings; actor mutations and sends never borrow another user's identity. |
| Agent access | Accepted direction | UI, API, CLI, workflows, service accounts, and AI tools use the same permission-checked domain services. |
| Permissions | Accepted direction | `read` includes mail reading and internal comments; `write` includes all mail and collaboration operations; `admin` additionally owns connections, sharing, settings, workflows, rules, and mailbox deletion. |
| Storage and retention | Accepted direction | PostgreSQL stores all mirrored message bodies and attachment bytes. Mail content, collaboration history, tombstones, AI artifacts, commands, and workflow runs are retained indefinitely. First-release mailbox deletion is a reversible soft deletion and does not purge durable data. |
| External attachment links | Proposed contract | Large outgoing files may be shared through revocable opaque links on the configured Cloud app URL, optionally protected by a password. Link lifetime and the per-file upload limit require review; aggregate link-storage quotas are out of the initial scope. |
| Storage observability | Accepted direction | Cloud administrators get a non-enforcing `/admin/mail` overview of logical message, attachment, draft-upload, and link-share usage per mailbox plus global physical Mail database storage. Quotas, billing, and content drilldown remain out of scope. |
| Security boundary | Accepted direction | Only provider credentials receive application-level encryption. Mail and collaboration data rely on normal enterprise database, backup, and access controls so search remains possible. Credentials are write-only and never retrievable, including by mailbox admins. |
| Release scope | Accepted direction | The first release supports generic IMAP/SMTP only. Provider-specific presets may improve setup but do not create separate support contracts. |
| Connector and sync contracts | Proposed contract | Typed capabilities and remote identities, ImapFlow, Nodemailer, durable commands, recent-first backfill, and capability-driven fallbacks. |
| Data model and API names | Proposed contract | The `mail.*` responsibilities and mailbox-scoped routes in this document. |
| Work states | Proposed contract | One assignee and `open`/`waiting`/`done`; `done` is local collaboration state and never archives or moves mail implicitly. |

## Implementation progress

This snapshot records the verified Mail backend, CLI, and core application experience on 2026-07-13. It tracks delivered behavior, not architectural decisions; the delivery plan remains the source of truth for unfinished scope.

| Delivery slice | State | Implemented | Remaining |
| --- | --- | --- | --- |
| 1. Foundation contracts | In progress | Mail package and schema; mailbox access adapter; encrypted write-only provider connections; mailbox remote resource and binding pool; capability model; central execution resolver; durable command, outbox, job, lease, and fencing paths; conversation grouping with durable manual overrides; collaboration persistence; connector conformance harness; typed API and CLI. | Conversation references and response schedules. |
| 2. IMAP onboarding, sync, and search | Backend core implemented | Generic manual IMAP/SMTP setup and live verification; namespace, folder, subscription, and ACL discovery; recent-first resumable sync; periodic reconciliation; UIDVALIDITY reset handling; body and attachment hydration into PostgreSQL; repair and health operations; field-specific structured search with keyset pagination, native FTS, optional `pg_textsearch`, and explicit 20,000- and 100,000-message performance gates. | Provider presets, RFC 6186 and Thunderbird autoconfiguration, OAuth setup, and setup UX. |
| 3. Core mail operations | Backend, CLI, and core UI substantially implemented | Provider-backed folder administration and semantic roles; additive flags and keywords; move, copy, trash, archive, and delete commands; bounded atomic conversation triage; revision-safe drafts and streamed attachments; sender lifecycle; send, Undo Send, Scheduled Send, SMTP delivery, streamed Sent append, ambiguous-outcome reconciliation, threaded message detail, manual conversation merge and split, and compose/reply/forward with frontend attachments. | Message-operation UI, quote collapsing, selected-text reply quoting, and origin-bound attachment UX. |
| 4. Collaboration | Backend feature set implemented; UI integration in progress | Revision-safe assignment, watchers, open/waiting/done, response-needed and snooze state; inbound reopen; chronological internal comments with replies, immutable revisions, tombstones, and access-rechecked mention delivery; personal reminders; durable cursor activity; built-in and private/mailbox saved views; horizontally safe ephemeral presence and advisory draft leases; mailbox-scoped live invalidation; permission-safe API and CLI; responsive queue, detail, collaboration, and comment UI. | Saved-view, reminder, presence, and draft-lease UI integration plus shared-draft conflict UX. |
| 5. Deterministic workflows | Shared-kernel backend and CLI implemented | Canonical YAML compiled and bound through `@valentinkolb/cloud/workflows`; metadata outside source; immutable saved versions; `messageReceived` and schedule activation; direct, one-shot, backfill, and durable dry-run records; frozen targets and preconditions; configurable effect budgets; permission and credential rechecks; durable command waiting; fenced recovery; typed API and CLI. | Visual editor, richer Mail actions, guarded automatic replies, and AI decision nodes. |
| 6. AI decisions and agents | Not started | Mail is exposed through typed API and CLI operations suitable for later tools. | Mail AI resource, tools, approvals, workflow decision nodes, summaries, classification, suggested drafts, and bulk-plan generation. |
| 7. Product-speed pass | Core workspace implemented | Cloud-native mailbox overview; responsive queue, folder, list, and conversation workspace; scan-oriented rows; URL-backed navigation and search; contained compose; permission-aware settings; shared empty and error states; desktop/mobile and light/dark verification. | Adopt the accepted calm workspace hierarchy, toggleable conversation list, combined Details panel, full-size and pop-out composer, message-operation commands, keyboard shortcuts, prefetch, saved views, and explicit frontend performance gates. |
| 8-9. Enhanced connectors | Not started | Provider-neutral connector, capability, identity, and command boundaries are established. | JMAP, Microsoft Graph, and Gmail API connectors and their conformance suites. |

Verification consists of package type checks, default tests, PostgreSQL integration tests, explicit large-mailbox performance gates, connector conformance, and authenticated browser smokes. The workflow suite covers immutable versions, preflight commitments, idempotent materialization, waiting, cancellation, recovery, authorization changes, event deduplication, and schedule fencing. The exact test counts are intentionally not duplicated here; the package scripts and CI output are authoritative.

## Product direction

Cloud Mail is not a thin webmail client and not a ticket system that happens to ingest email. The mailbox remains the primary resource, the provider remains authoritative for portable mail state, and Cloud adds a collaboration and automation layer around conversations.

The first release must use the production architecture. Later releases may expose more features, but they must not replace the sync model, permission model, search representation, or command journal.

### Primary users

- Individuals who need a fast general-purpose mail client.
- Teams that operate a shared office, support, recruiting, or administrative mailbox.
- Service accounts and agents that search, classify, route, draft, and act within explicit mailbox permissions.
- Administrators who configure connections, policies, shared signatures, workflows, and operational limits.

### Product principles

1. **IMAP baseline.** Generic IMAP/SMTP provides the complete first product, not a reduced compatibility mode. Portable actions stay visible in other clients where the server supports them.
2. **Provider-neutral core.** Remote IDs, cursors, rights, and submissions pass through connector contracts. Domain services never branch directly on IMAP, JMAP, Graph, or Gmail.
3. **Mailbox scoped.** Permissions, settings, workflows, sender identities, and AI policies attach to a mailbox resource. Transport credentials and OAuth grants are private bindings, never shareable resources.
4. **Collaborative by default.** Assignment, status, internal comments, shared drafts, presence, and activity are core domain concepts.
5. **Agent first.** UI, CLI, service accounts, workflows, and AI tools call the same typed domain queries and commands.
6. **Rules before models.** Deterministic conditions and actions work without AI. AI is an optional typed decision node in the same workflow pipeline.
7. **Fast by structure.** PostgreSQL mirrors searchable content, list queries use keyset pagination, and the UI keeps dimensions and focus stable.
8. **Every side effect is attributable.** User, service-account, workflow, agent, and system actions share command, permission, and audit boundaries.
9. **Read and send identities are separate.** Access to remote mail does not imply permission to send from its address.

### Goals

- Connect existing IMAP/SMTP mailboxes and remain usable during a resumable historical backfill.
- Deliver the same fast search, collaboration, workflow, AI, and command-first UX on a generic IMAP server.
- Handle at least 20,000 messages per mailbox without special operation, with verification fixtures at 100,000 messages and above.
- Preserve mail operations across compatible clients.
- Provide field-specific AND/OR/NOT search, saved views, labels, filters, and optional BM25 ranking.
- Let several people triage one mailbox without duplicate replies or hidden work.
- Group the original message and replies into a correctable conversation with an internal team-comment stream.
- Support deterministic workflows for new messages and historical backfill.
- Support generic conversation references and policy-bound automatic acknowledgements or out-of-office replies without introducing a separate ticket mode.
- Turn natural-language mailbox reorganization requests into bounded, previewable bulk-action plans.
- Support shared and other-user IMAP namespaces, per-folder rights, and separately authorized sender identities.
- Add JMAP, Microsoft Graph, and Gmail API as optional capability improvements without migrating Cloud mail data.
- Expose safe CLI and agent tools for the full mailbox workflow.
- Add summaries, classification, routing, and suggested replies without making the domain dependent on AI.

### Non-goals

- Running an SMTP or IMAP server.
- Replacing provider spam, antivirus, DKIM, SPF, or DMARC infrastructure.
- Pretending Cloud-only assignments, comments, and references are portable IMAP metadata.
- Exactly-once delivery over SMTP; the protocol cannot guarantee it after ambiguous disconnects.
- A general-purpose cross-application workflow framework in the first implementation.
- Simultaneous CRDT-based email drafting in the first implementation.
- Tracking pixels or external read receipts as a core feature.
- Physical purge or configurable retention expiry in the first release.
- Automatic sending or destructive actions without an explicit policy.
- Requiring JMAP, Graph, Gmail API, or provider administration for the first complete Mail experience.

## System boundaries

The architecture separates remote mail truth, durable Cloud truth, and transient coordination.

```text
                         +-----------------------+
                         |  UI / CLI / AI tools  |
                         +-----------+-----------+
                                     |
                            typed queries/commands
                                     |
                 +-------------------v-------------------+
                 |             Mail service              |
                 | authz | commands | workflows | audit  |
                 +-----+------------+-----------+--------+
                       |            |           |
             +---------v--+   +-----v------+   +v----------------+
             | PostgreSQL |   | Valkey     |   | Connector layer |
             | durable    |   | jobs/live  |   | IMAP/JMAP/APIs  |
             +------------+   +------------+   +--------+--------+
                                                         |
                                                +--------v--------+
                                                | Remote provider |
                                                +-----------------+
```

### Sources of truth

| Concern | Authority | Notes |
| --- | --- | --- |
| Container hierarchy and placement | Connected provider | PostgreSQL mirrors folders, labels, mailbox membership, and remote placement metadata. |
| Effective remote rights | Connected provider | IMAP ACLs, JMAP rights, Graph permissions, or Gmail scopes are mirrored per binding. |
| Standard flags and keywords | Connected provider | Capability-dependent and visibly distinguished from Cloud-only state. |
| Current remote existence and placement | Connected provider | The provider decides whether a message currently exists remotely and where it is placed. |
| Retained message content | PostgreSQL after import | Original headers, MIME structure and parts, normalized text, sanitized HTML, and attachment bytes remain durable even after provider deletion or access loss. |
| Submission acceptance | SMTP or provider submission API | Acceptance does not prove final delivery. |
| Allowed sender identity | Provider policy plus Cloud configuration | IMAP access alone never authorizes a `From` or envelope sender. |
| Assignment, status, comments, references, watchers | PostgreSQL | Cloud collaboration state. |
| Rules, signatures, snippets, saved views | PostgreSQL | Mailbox-owned configuration. |
| Permissions and approval policies | Cloud/PostgreSQL | Rechecked when commands execute. |
| Audit and activity | PostgreSQL | Append-only durable history. |
| Presence and reply indicators | Valkey | TTL-based and never authoritative. |

### Non-negotiable invariants

- Every remote object has a connector-scoped typed identity. IMAP uses folder identity, `UIDVALIDITY`, and UID; JMAP, Graph, and Gmail use their stable provider IDs. `Message-ID` is never a unique key.
- Every remote mutation originates from a durable command with an idempotency key and actor.
- Permission is checked when an operation is requested and again when delayed work executes.
- User expressions never contain or weaken the mailbox authorization predicate.
- Workflow and agent actions call domain commands; they do not call IMAP or SMTP directly.
- Agent-authored bulk plans are validated workflow definitions. The model cannot bypass preview, approval, effect budgets, or the command journal.
- Effective remote operations are the intersection of Cloud permission, current binding rights, sender-identity policy, and tool or automation scope.
- One central execution resolver selects the provider binding for every remote operation. Domain services and connectors never implement their own binding-selection rules.
- Human operations in personal-provider mode use only the acting user's binding. They never fall back to another user's credential or remote identity.
- Background sync may fail over only between bindings that independently verified the same remote resource. A command is pinned to one binding when it starts and never changes bindings during a retry or ambiguous outcome.
- Remote identities, folder projections, sync cursors, and command history belong to the mailbox remote resource, not to the transient binding used for one operation.
- Live events invalidate or refresh durable state. Missing a live event never loses data.
- Audit metadata excludes credentials, full message bodies, attachment contents, and hidden model reasoning.
- AI output is untrusted until it passes a schema and the normal command policy.

## Connector architecture

Connectors translate provider state into one mail domain. The first release implements generic IMAP/SMTP completely. Optional connectors improve discovery, synchronization, and provider fidelity; they do not define separate product modes.

### Connector contract

The service layer depends on a typed connector interface with operations equivalent to:

```ts
interface MailConnector {
  discoverAccounts(): Promise<RemoteAccount[]>;
  discoverContainers(account: RemoteAccountRef): Promise<RemoteContainer[]>;
  discoverIdentities(account: RemoteAccountRef): Promise<RemoteIdentity[]>;
  getCapabilities(account: RemoteAccountRef): Promise<MailCapabilities>;
  syncChanges(cursor: SyncCursor | null): AsyncIterable<RemoteChangeBatch>;
  fetchMessages(ids: RemoteMessageIdentity[]): AsyncIterable<RemoteMessage>;
  apply(command: PortableMailCommand): Promise<RemoteCommandResult>;
  submit(command: SubmitCommand): Promise<RemoteSubmissionResult>;
}
```

The names are proposed, but the boundary is accepted. Domain commands never receive ImapFlow clients, JMAP method payloads, Graph objects, or Gmail resources.

Remote identity is a discriminated union:

```ts
type RemoteMessageIdentity =
  | {
      kind: "imap";
      folderId: string;
      uidValidity: string;
      uid: number;
    }
  | { kind: "jmap"; accountId: string; emailId: string }
  | { kind: "graph"; mailboxId: string; messageId: string }
  | { kind: "gmail"; userId: string; messageId: string };
```

Connector cursors and error metadata are similarly typed. Provider IDs remain opaque outside the connector and persistence mapping.

### Connector priority

| Connector | Product role | Initial scope |
| --- | --- | --- |
| Generic IMAP/SMTP | Mandatory baseline | Full mail UX, portable mutations, shared namespaces when advertised, and capability fallbacks. |
| JMAP | First enhanced connector after the generic release | Stalwart and Fastmail; stable IDs, state-based sync, push, multiple accounts, rights, identities, and native submission. |
| Microsoft Graph | Later provider connector | Exchange shared mailboxes, delegated folders, delta sync, and Send As/Send on Behalf semantics. |
| Gmail API | Later provider connector | Native labels, threads, history sync, sender settings, and Workspace administration paths. |

IMAP is not labelled legacy in the API or UI. The selected connector is operational metadata; users see available actions and clear setup requirements.

### Capability model

Connectors report typed capabilities such as:

- incremental state or cursor support;
- push or low-latency change hints;
- move, copy, delete, expunge, and folder administration;
- remote keywords, labels, and native thread IDs;
- shared account or namespace discovery;
- effective remote rights;
- sender identity discovery and native submission;
- server-side filter management.

Capabilities are persisted with verification time and source. Services ask for a capability and use a defined fallback; they do not branch on provider names.

| Capability | Preferred path | Baseline fallback |
| --- | --- | --- |
| Move | IMAP MOVE or provider move | Copy and mark the source deleted. Use UID EXPUNGE with UIDPLUS; otherwise leave the source `\Deleted` as `expunge_pending`. Never issue a mailbox-wide EXPUNGE. |
| Incremental sync | JMAP/Graph/Gmail cursor or QRESYNC | UID ranges, flag reconciliation, and periodic UID-set comparison. |
| Push | JMAP push, provider webhook, or IMAP IDLE | Adaptive polling plus scheduled reconciliation. |
| Folder roles | Provider role or IMAP SPECIAL-USE | One-time user mapping with remembered choices. |
| Remote tags | IMAP keywords or a connector-native non-container tag primitive | Cloud local tags. |
| Shared resources | JMAP account, Graph mailbox, or IMAP namespace | Explicit remote root selection; no inferred sharing. |
| Sender identities | Provider identity API | Explicit allowlisted identity and verification send. |
| Submission | JMAP or provider API | SMTP plus Sent-folder reconciliation. |
| Server rules | JMAP Sieve or provider filters | Cloud workflow engine. |

### Provider mapping

Stalwart Group principals expose a group inbox to members through IMAP and JMAP. That is the preferred Stalwart primitive for a functional shared mailbox. A Stalwart mailing list only distributes messages; an alias adds an address to an account or group. Neither is treated as a shared inbox. Stalwart's JMAP management extensions may later provision these objects, but that is an optional administrative integration.

Stalwart also supports JMAP for Sieve. Cloud workflows remain authoritative because they add backfill, collaboration actions, AI decisions, audit, and recovery. A deterministic subset may be compiled to Sieve only after semantic equivalence and ownership are defined; the initial release does not maintain two active rule engines.

Microsoft shared mailboxes are Exchange resources with separate Full Access, Send As, and Send on Behalf rights. Graph is the preferred enhanced connector. OAuth IMAP remains a valid compatibility path, including the shared-mailbox login form supported by Exchange Online.

Google has two distinct collaboration models. Gmail delegation grants access to one Gmail account. Google Groups Collaborative Inbox is a separate conversation product with assignments and resolution state, not a normal IMAP mailbox. The initial Gmail path is generic IMAP/SMTP; a later Gmail API connector adds native labels, threads, history, sender settings, and administrator-authorized access. Google Groups synchronization is outside the initial mail connector scope.

JMAP Core and JMAP Mail are stable IETF standards. JMAP Sharing defines common principals and notifications, while configurable JMAP Mail Sharing is still an active specification effort. Cloud may consume server-exposed shared accounts and rights without depending on unfinished client-side ACL management.

## Domain model

The schema lives under `mail.*`. Names below define responsibilities rather than final migration syntax.

### Mailbox and access

`mail.mailboxes` is the only top-level Cloud resource. A newly created mailbox initially grants `admin` only to its creator and is shared through the normal Cloud permission system. It stores the user-visible name, collaboration and connection policies, sync policy, search backend, default behavior, and aggregate health. It never stores provider credentials or provider-specific IDs directly.

`mail.provider_connections` stores one encrypted provider authentication context. A connection is owned by one user, one service account, or the mailbox itself, is never a shareable or navigable Cloud resource, and may be reused by that owner for several remote roots. Its secret fields are write-only: APIs and administrators can see only whether a value is set, its verification state, and non-secret connection metadata. There are no global mail credentials.

`mail.remote_resources` stores the mailbox-owned canonical remote account, mailbox, namespace root, or folder subtree. It owns the connector kind, typed remote locator, discovered folder tree, sync state, and reconciliation generation independently of whichever credential currently reaches it.

`mail.provider_bindings` proves that one provider connection can reach one remote resource. It stores the authenticated provider principal, current capabilities and rights, verification evidence, health, and last use. Binding states are `pending`, `verifying`, `active`, `degraded`, and `revoked`.

Eligibility is derived centrally from binding state, verified scope, current rights, connection policy, operation, and sender identity; it is not copied into independent sync, automation, mutation, and submission flags. In personal-provider mode, every active complete-scope binding is a sync candidate. Attaching the binding is the explicit consent for Cloud to use it as mailbox transport; disconnecting it removes it from the pool. Automation additionally requires the rights needed by the concrete action and, for sending, a current identity verification.

A mailbox has one connection policy, not a different resource type:

- `shared_connection`: a mailbox-owned provider connection is intentionally used for collaborators. Cloud permission authorizes the actor, while the selected binding's remote rights cap every operation.
- `personal_provider_account`: each collaborator attaches a private provider connection that independently proves access to the same remote resource. Cloud permission grants collaboration access but does not replace provider authorization.

The setup UI names these choices **Shared connection** and **Personal provider account**. Discovery of an IMAP Other Users or Shared Namespace recommends **Personal provider account**. A normal team account with one deliberately shared login uses **Shared connection**. The choice can be changed only through a verified rebinding flow; it does not migrate mailbox content or create a second mailbox type.

In personal-provider mode, cached mail reads and remote operations require both Cloud permission and an active binding for the acting user. A principal who can see only a subtree links that subtree as a separate Cloud mailbox instead of receiving a partial view of conversations, comments, or search documents. Target-specific write, move, delete, and send rights remain checked per container and identity.

`mail.mailbox_access` links a mailbox to Cloud `auth.access` entries. The resource adapter follows the existing Cloud pattern for users, groups, and service accounts.

`mail.mailbox_capabilities` projects the capabilities advertised by active bindings. Authorization always resolves the acting user, selected binding, operation, and target container; capabilities from several bindings are never unioned into broader effective rights. Capability discovery is data, not scattered conditionals.

`mail.remote_namespaces` stores personal, other-user, and shared IMAP namespace prefixes and delimiters as connector metadata for one binding. Binding-specific effective folder rights, their source, and verification time live on `mail.binding_folder_refs`; JMAP and provider connectors populate the same projection without inventing IMAP ACL strings.

`mail.sender_identities` stores an exact display name and `From` address, optional reply-to and envelope sender, signature, compose policy, default Sent/Drafts behavior, and an authentication policy with `interactive: mailbox | actor` plus `automation: disabled | mailbox | pool`. `mail.sender_identity_bindings` records which binding and provider principal passed the verification send. Identities belong to a mailbox, but authorization is verified per binding.

One resolver owns binding selection:

```ts
type MailExecutionOperation =
  | "backgroundSync"
  | "actorRead"
  | "actorMutation"
  | "actorSend"
  | "automation";

resolveMailExecution({
  mailboxId,
  actorId,
  operation,
  target,
  senderIdentityId,
}): Promise<ResolvedMailExecution>;
```

`backgroundSync` may select any active sync-eligible binding for the same verified remote resource. Actor reads and mutations select the mailbox-owned binding in shared-connection mode or only the actor's binding in personal-provider mode. Interactive sending follows `interactive`: `actor` requires the acting user or service account's own verified binding, while `mailbox` requires a mailbox-owned verified binding. Autonomous sending follows `automation`: `disabled` rejects the action, `mailbox` requires a mailbox-owned verified binding, and `pool` selects any healthy remote-resource binding that passed verification for the exact identity. No policy falls back outside its declared binding set. `automation` has no Cloud principal: it is attributed to the immutable workflow version and separately records the provider binding used as transport.

The resolver writes the selected binding ID and rights snapshot to the command before transport starts. The binding remains pinned for the command lifetime. Failover happens only between completed sync batches; an ambiguous mutation or submission is reconciled through its original binding and is never retried through another principal.

### Remote mail

`mail.folders` is the canonical mailbox-owned product projection of remote containers. It stores an internal folder ID, parent, user-visible name, role, discovery generation, and current sync cursor where the connector uses a container cursor. Connector-native mailbox or label membership maps to placements; a Gmail label is never duplicated as both a folder placement and a remote keyword.

`mail.binding_folder_refs` maps each canonical folder to one binding-specific remote locator. It stores the provider object ID or IMAP path, delimiter, namespace, `UIDVALIDITY`, server subscription state, effective rights, and last verification. The execution resolver translates canonical targets through this table, so different principals may expose the same shared folder under different paths without leaking path assumptions into commands or failover.

`mail.message_contents` stores immutable normalized message content:

- internal immutable content identity;
- RFC `Message-ID`, `In-Reply-To`, and `References`;
- envelope, internal date, size, selected headers, and MIME structure;
- normalized plain text and sanitized HTML;
- selected original headers and MIME structure;
- source hash, content hash, and hydration status.

`mail.message_part_blobs` stores each retained text, HTML, inline, and attachment MIME part once in content-addressed PostgreSQL chunks. Message and attachment rows reference these blobs instead of duplicating a complete raw MIME object and decoded attachment bytes. A source export is reconstructed from retained headers, structure, and parts; byte-for-byte preservation of the original transport source is not a first-release contract.

`mail.remote_message_refs` maps typed connector identities to mirrored content. For IMAP this includes folder identity, `UIDVALIDITY`, UID, and mod-sequence. JMAP, Graph, and Gmail store their opaque stable IDs and change metadata.

`mail.message_placements` stores remote container membership, flags, keywords or labels, and deletion state. One content row may have several placements. When a connector cannot prove cross-container identity, correctness wins over deduplication.

`mail.message_addresses` stores normalized sender, reply-to, to, cc, and bcc addresses with display names. This supports exact filters, fuzzy search, Contacts linking, and participant views.

`mail.attachments` stores MIME part identity, filename, content type, disposition, content ID, checksum, size, and a `mail.message_part_blobs` reference. Every attachment body remains in PostgreSQL indefinitely. Import, download, indexing, and backup paths stream chunks and never buffer a complete large attachment in one worker.

### Conversations and work

`mail.conversations` is a durable collaboration entity with rebuildable thread membership. It includes:

- derived subject and participant summary;
- latest inbound and outbound timestamps;
- optional primary human-readable reference projection;
- current assignee and status;
- snooze/reminder state;
- optimistic revision;
- last activity and response-needed indicators.

`mail.conversation_messages` links messages to one mailbox-scoped conversation. Threading prefers a connector's native thread ID, then RFC `References` and `In-Reply-To`, then a conservative normalized-subject fallback constrained by participants and time. A duplicate `Message-ID` never merges conversations by itself.

`mail.conversation_thread_overrides` stores audited manual merge and split decisions and outranks later heuristic rebuilds. A connector change or reindex therefore cannot silently undo a human correction.

A merge moves comments, notification delivery state, and non-conflicting personal reminders to the target conversation. If the same user has a reminder on both conversations, the target reminder wins and the discarded source delivery is retained as skipped audit state. A split keeps reminders on the source conversation and moves mention deliveries only with comments that follow the selected messages.

`mail.conversation_watchers`, `mail.conversation_comments`, and `mail.drafts` store collaboration data. A comment contains Markdown/plain text, author, revision, optional parent comment, optional referenced message, and a deletion tombstone. Comment replies remain in one chronological stream rather than creating deeply nested trees. Draft revisions preserve authorship and prevent silent overwrites.

Every conversation also has an opaque technical ID used by storage, APIs, and URLs. It is never derived from or replaced by a human-readable reference.

`mail.reference_schemes` stores mailbox-scoped human-reference formats such as `SUP-{year}-{sequence:6}`. `mail.conversation_references` stores an immutable allocated value, scheme, conversation, allocation actor, and primary/alias role. The initial UI exposes at most one default scheme per mailbox. A merge preserves both references, selects one primary, and keeps the other searchable as an alias. A split keeps the reference on the original conversation and gives the new conversation no reference until the user or workflow allocates one. The data model does not hard-code tickets as a product mode.

`mail.activity_events` is append-only user-facing history. `mail.commands` is the durable side-effect journal. These tables are related but not interchangeable: activity explains work to people; commands recover transport operations.

### Configuration and automation

`mail.saved_views` stores named structured searches and sort/group preferences. `mail.local_tags` stores Cloud-only tags. Remote keywords remain on placements.

`mail.signatures` and `mail.snippets` store versioned Liquid templates, Markdown, CSS references, ownership, and sharing scope.

`mail.response_schedules` stores a mailbox timezone, active date ranges, recurring office hours, and explicit holiday exceptions. Workflows use named schedules as conditions; scheduling is not embedded in template text.

`mail.workflows`, `mail.workflow_versions`, `mail.workflow_runs`, and `mail.workflow_step_runs` store immutable automation definitions and execution history.

One-shot bulk actions use the same workflow tables with an `agent`, `user`, or `cli` origin and a non-recurring lifecycle. They do not introduce a second bulk-operation model.

`mail.ai_artifacts` stores summaries, classifications, routing suggestions, and reply suggestions with source revision, model profile, provenance, and invalidation state.

## IMAP baseline synchronization

The generic IMAP/SMTP connector is the complete baseline implementation. Synchronization is a resumable state machine, not a periodic full import, and the application reads normal lists, conversations, and search results from PostgreSQL rather than blocking on live IMAP calls.

### Connector stack

- Nodemailer sends through SMTP.
- ImapFlow discovers folders, reads mail, watches changes, and performs IMAP mutations.
- MailParser's streaming API parses complete MIME sources when needed. Bulk paths must not use a buffering parser for large attachments.
- Provider-specific behavior is capability-driven. Gmail label support uses `X-GM-LABELS` and provider IDs when advertised.

### Connection onboarding

Setup begins with the email address and authentication method, not an IMAP form. The connector attempts, in order:

1. a maintained provider preset with OAuth where available;
2. DNS SRV discovery according to RFC 6186;
3. Thunderbird-style autoconfiguration and known-provider metadata;
4. a compact manual IMAP/SMTP form.

IMAP and SMTP verification run in parallel and report separate, actionable results. A successful test records TLS posture, capabilities, namespaces, special-use folders, and the authenticated principal. Credentials are encrypted only after verification succeeds.

After authentication, the user sees discovered personal and shared accounts or roots. The setup flow asks only for unresolved choices: the remote scope to mirror, ambiguous Inbox/Sent/Drafts/Trash/Archive mappings, and an optional sender identity. Advanced host, port, TLS, namespace, and folder fields stay collapsed unless discovery fails.

Missing protocol extensions change implementation details, not the available Cloud experience. For example, absent `SPECIAL-USE` triggers a remembered folder-mapping step, absent `IDLE` enables adaptive polling, and absent remote keywords leaves Cloud local tags available.

### Mailbox states

```text
disconnected -> verifying -> bootstrapping -> active
                     |              |           |
                     v              v           v
                auth_required    degraded    reconnecting
                     |              |           |
                     +--------------+-----------+
                                    |
                          connection_required
                                    |
                                  paused
```

Each state has a user-visible reason, last successful operation, and recovery action. A generic `sync failed` state is insufficient.

### Initial synchronization

1. Verify TLS, authentication, server identity, and advertised capabilities.
2. Discover folders and special-use roles.
3. Import current folder metadata and recent envelopes first.
4. Make the latest conversations usable while backfill continues.
5. Hydrate searchable body parts and attachment bytes in bounded, separately resumable batches from newest to oldest.
6. Record a durable cursor after each committed batch.
7. Reconcile flags, deleted UIDs, and folder counts before marking a folder current.

Bodies and attachment bytes have separate cursors so ordinary mail becomes usable before large attachments finish. Both are eventually mirrored to PostgreSQL and retained indefinitely. A body-dependent workflow waits for body hydration; it does not silently evaluate missing text as an empty body.

### Incremental synchronization

- Prefer QRESYNC and CONDSTORE with `HIGHESTMODSEQ` and `VANISHED` when available.
- Fall back to UID range fetch, flag reconciliation, and periodic UID-set comparison.
- Treat IDLE as a low-latency hint, not a durable event source.
- Keep one selected folder per IMAP connection. Active INBOX connections receive priority; other folders use bounded polling.
- Cap connections globally, per provider host, and per mailbox.
- Run periodic full reconciliation to heal missed events and provider anomalies.

### Binding leadership and failover

One active binding holds a short distributed lease and monotonically increasing fencing token for each remote resource synchronization generation. PostgreSQL stores the current fence. Every batch transaction compares its token and updates projections and the durable cursor under the same row lock; a stale worker cannot pass a preflight check and commit afterward. Losing the lease stops further remote reads and commits; the next eligible binding starts after the last transaction committed by the previous fence.

Binding selection is deterministic and health based. It prefers an already active healthy binding, then another active binding that verified the same remote resource and required rights. It never combines partial rights from several bindings. Removing or revoking Alice's binding therefore does not interrupt Bob or Carol when either can independently reach the complete resource.

An in-flight command remains pinned to its original binding even when that binding degrades. Known-safe reads may be retried after normal resolver selection. Mutations and submissions with an ambiguous result never issue a retry through another principal. Read-only observational reconciliation may use canonical state synchronized through another verified binding to the same resource; if that evidence cannot prove the outcome and the original binding is unavailable, the command transitions to `needs_attention`. If no eligible binding remains, local data and collaboration history stay available according to the mailbox connection policy, background synchronization and remote commands pause, and mailbox health becomes `connection_required`.

### Folder discovery and subscriptions

IMAP namespace membership, mailbox visibility, and subscription are separate concepts. `NAMESPACE` identifies personal, other-user, and shared roots; `LIST` discovers currently visible mailboxes; `SUBSCRIBE` controls the server-side subscribed-name set returned by `LIST (SUBSCRIBED)` or legacy `LSUB`. A subscription is a display preference, not proof of read or write access.

Cloud never treats the subscribed list as the complete remote tree. Initial setup and periodic reconciliation list the selected namespace or subtree, compare it with the mailbox-owned folder projection, refresh effective rights, and classify each name as discovered, subscribed, selected for sync, unavailable, or removed. When `LIST-EXTENDED` is available, one listing may return subscription and child metadata; otherwise the connector combines ordinary `LIST`, subscription listing, and capability-safe probes.

Mailbox create, rename, delete, visibility changes involving lookup rights, and subscription notifications through IMAP `NOTIFY` are optional low-latency hints. For each binding, the connector registers `MailboxName` and `SubscriptionChange` on `subtree` using that binding's verified root locator, or explicit `mailboxes` locators when the selected scope has no selectable root. The separate `selected` group contains only message events. `NOTIFY` is not a complete `MYRIGHTS` change stream. Scheduled discovery, pre-command rights refresh, and explicit refresh remain authoritative, and a rejected or overflowed registration falls back without changing behavior. A newly visible child folder under the selected remote resource is synchronized automatically by default; users do not have to repeat Thunderbird's manual subscribe-and-refresh workflow. A mailbox admin may exclude folders from Cloud sync without issuing `UNSUBSCRIBE` unless they explicitly choose to change the provider-side subscription.

IMAP does not update subscriptions automatically when a mailbox is renamed, including child names. Rename reconciliation therefore matches stable provider identity where available, otherwise uses a bounded old/new-path comparison, updates the Cloud projection, and offers a separate idempotent provider-subscription repair. A path match alone never proves that two users' bindings address the same remote resource.

### UIDVALIDITY and folder changes

A `UIDVALIDITY` change marks old placements stale and starts a controlled folder rebuild. The app attempts reconciliation through provider object IDs or conservative content metadata before removing stale rows.

Folder rename and deletion use provider object IDs when available. Path-only servers require a reconciliation window so a rename is not mistaken for delete plus unrelated create.

## Commands and sending

The provider-neutral command journal gives UI, workflows, CLI, and agents one recovery model. Connectors translate portable desired-state commands into the strongest supported remote operation.

### Command states

```text
queued -> executing -> confirmed
                  |-> failed
                  |-> ambiguous -> reconciled
                               |-> needs_attention
```

Commands contain actor, mailbox, target, desired end state, expected revision, idempotency key, correlation IDs, selected binding ID, rights snapshot, and transport metadata. Mutations express desired state rather than toggles, for example `seen = true` instead of `toggle seen`.

### Portable mutations

- IMAP uses UID-based operations exclusively and `MOVE` plus `COPYUID` when available.
- Without MOVE, IMAP copies and marks the source `\Deleted`. With UIDPLUS it uses UID EXPUNGE. Without UIDPLUS the first release leaves the source `\Deleted`, records `expunge_pending`, and reports degraded completion; no worker issues mailbox-wide `EXPUNGE` or `CLOSE` that could remove another client's deleted messages.
- JMAP and provider connectors use stable IDs, state preconditions, and native batch operations when available.
- Serialize conflicting commands per placement or conversation.
- Reconcile an ambiguous move before retrying; blind retry can duplicate mail.
- Activity records requested, confirmed, failed, and reconciled outcomes.

### Sending

Outgoing mail uses a durable outbox and a stable generated `Message-ID`.

```text
draft -> scheduled -> undo_window -> sending -> accepted -> sent_sync_pending -> sent
                                      |  |
                                      |  +-> failed
                                      +----> unknown -> reconciled_accepted -> sent_sync_pending
                                                   |-> reconciled_unsent -> failed
                                                   +-> needs_attention
```

The submission provider accepting a message does not prove final delivery. A disconnect near acceptance may leave the app uncertain. Before retrying an `unknown` send, the app searches remote Sent state for the stable `Message-ID` and provider identifiers. It retries only after proving the message was not accepted; an unresolved outcome moves to `needs_attention`.

The sender-identity binding records whether the provider saves sent messages automatically. For the IMAP/SMTP baseline, Cloud otherwise appends the exact generated MIME source to the detected Sent folder. This avoids duplicate sent copies.

Undo Send is a short durable delay before submission starts. Scheduled Send uses the same outbox with a future execution time. Both survive process restarts.

## Shared namespaces and sender identities

Shared folders are a standard IMAP concern, while sending as a functional address is a separate SMTP/provider concern. Cloud models both without pretending that one grants the other or that one user's provider session authorizes another user.

### Remote namespace model

IMAP `NAMESPACE` distinguishes personal mailboxes, other users' mailboxes, and shared mailboxes. Servers may expose several roots with different prefixes and delimiters. When `NAMESPACE` is unavailable, folder listing plus an optional administrator-supplied root provides a controlled fallback.

Folder discovery must not assume that every visible path belongs to the personal namespace or that `INBOX/` is the hierarchy root. A Cloud mailbox selects one discovered root or explicit subtree and recursively mirrors only that scope.

ImapFlow already performs namespace discovery and exposes normal folder listing. Standard ACL evaluation may require a small connector adapter if the pinned library version does not expose `MYRIGHTS` publicly. That adapter stays behind typed connector discovery and rights methods; no service, workflow, or agent uses undocumented protocol calls directly.

### Effective folder rights

When the server advertises the IMAP ACL extension, the connector reads `MYRIGHTS` for each selected folder and maps rights to typed capabilities such as:

- list and read messages;
- change seen or other flags;
- insert, copy, or move messages into the folder;
- mark deleted and expunge;
- create, rename, or delete child folders;
- administer ACLs.

Cloud does not need to edit upstream ACLs initially. It only consumes effective rights. If ACL is unavailable, successful read-only or read-write selection provides a conservative capability signal; destructive folder administration remains disabled unless explicitly verified.

Rights are refreshed per binding during discovery, before delayed mutations, and after permission errors. In personal-provider mode, losing upstream access disables that principal's binding and therefore its cached mail reads and remote commands. In shared-connection mode, Cloud permission authorizes cached reads while remote operations remain capped by the mailbox binding. A stale PostgreSQL mirror must not become an ACL bypass.

When several people expose the same shared root through different private connections, Cloud never deduplicates solely by path. A mailbox admin links a candidate binding only after the connector verifies server identity, namespace metadata, resource structure, and a stable remote account or mailbox identifier where available. On generic IMAP without a stable identifier, the proof also compares root and child `UIDVALIDITY` values plus a bounded fingerprint of overlapping immutable messages. An empty or otherwise ambiguous resource requires explicit admin confirmation after a read-only comparison; otherwise the roots stay separate.

In personal-provider mode, cached mail reads and actor mutations resolve against the acting user's private binding. In shared-connection mode, they resolve against the mailbox-owned binding. Background synchronization independently elects one healthy sync-eligible binding from the pool and may fail over at batch boundaries. Workflows have no Cloud principal; their audit actor is the workflow version, while the execution record separately identifies the provider transport binding.

### Sender identities

A sender identity is an allowlisted configuration, not a free-form `From` field. It contains:

- display name and exact `From` address;
- optional `Reply-To` and envelope sender;
- interactive and automation authentication policy, verified submission binding, and authenticated provider principal;
- default signature and compose policy;
- Drafts and Sent folder mappings;
- verification state and last provider rejection.

The provider decides whether a binding may submit mail using an identity. SMTP has no portable discovery command for this authorization. Configuration requires an exact `From` allowlist entry and a successful test send through each eligible binding; a successful IMAP `MYRIGHTS` check never marks a sender identity as authorized. A later provider rejection invalidates that binding's verification until it is tested again.

The envelope sender defaults to the visible `From` address. A different envelope sender is allowed only through a provider preset or a separately tested exact configuration; it is never free-form compose input.

Reply defaults use the identity whose address received the original message and whose mailbox root contains the conversation. The composer always shows the selected identity. Changing it is limited to configured identities; arbitrary sender spoofing is not supported.

Sent-copy behavior belongs to the identity. A functional address can therefore authenticate to SMTP with a person's account while placing the resulting sent copy in a shared Sent folder when the provider permits both operations.

### University of Ulm case

The University of Ulm explicitly supports functional, non-personal addresses delivered into IMAP Shared Folders. Alice and Bob each see the shared root through their own university account. Cloud represents this as:

1. one private provider connection and verified binding for Alice;
2. a second private provider connection and verified binding for Bob;
3. one Cloud mailbox with `personal_provider_account` policy and one mailbox-owned remote resource rooted at the functional Shared Folder, excluding both personal namespaces;
4. effective read/write capabilities derived independently for each binding;
5. a functional sender identity with `interactive: actor` and, when automatic replies are enabled, `automation: pool`, with every eligible binding verified through the university SMTP service;
6. explicit Drafts and Sent mappings under the shared root where supported;
7. background sync leadership elected from the healthy binding pool with a lease and fencing token;
8. automatic discovery of new or renamed children inside the selected Shared Folder, without requiring users to repeat Thunderbird folder subscription steps in Cloud.

Cloud collaboration state is shared, but neither personal credential is. If Alice's university account expires, her binding becomes revoked, the sync lease moves to Bob or another healthy binding after the current batch, and other collaborators continue without recreating the mailbox. Alice's binding no longer authorizes mail reads or remote commands. If every binding becomes invalid, Cloud retains all PostgreSQL data indefinitely, marks the mailbox `connection_required`, and pauses remote operations until a new binding verifies the same resource. The same model covers public folders, delegated user folders, Stalwart Group inboxes, and Microsoft shared mailboxes without assuming identical provider semantics.

## Search

Search supports a simple global query and a structured Thunderbird-style expression over separate fields.

### Search expression

```ts
type MailSearchExpression =
  | { all: MailSearchExpression[] }
  | { any: MailSearchExpression[] }
  | { not: MailSearchExpression }
  | {
      field:
        | "any"
        | "body"
        | "subject"
        | "sender"
        | "to"
        | "cc"
        | "bcc"
        | "recipients"
        | "participants"
        | "attachmentName"
        | "comment"
        | "reference"
        | "folder"
        | "tag"
        | "keyword"
        | "date"
        | "size"
        | "state";
      operator: string;
      value: unknown;
    };
```

The public schema defines field-specific operators and values. The API limits nesting depth, clause count, and string size. It never accepts raw SQL, PostgreSQL query syntax, or regular expressions in the initial surface.

The simple search box compiles to an `any` group over subject, body, sender, recipients, attachment names, internal comments, and conversation references. Advanced search exposes field, operator, value, and match-all/match-any controls. Saved views store the same AST.

Authorization always wraps the user expression:

```sql
WHERE mailbox_id = ANY($authorized_mailbox_ids)
  AND (<compiled search expression>)
```

`$authorized_mailbox_ids` is an effective-access set, not a caller-provided filter. In shared-connection mode it follows current Cloud permission. In personal-provider mode it also requires the acting user to have an active complete-scope binding. Search never turns a valid Cloud share plus a revoked or partial personal binding into access to mirrored mail.

### Search documents

Search storage keeps body, subject, sender, to, cc, bcc, combined recipients, participants, attachment names, internal comments, and conversation references separately. Reference lookup uses an exact index; comment text participates only for users who can read the parent mailbox. A combined `search_text` projection powers broad relevance ranking.

Native PostgreSQL search is mandatory:

- weighted `tsvector` columns with GIN indexes;
- `websearch_to_tsquery` and phrase predicates;
- `pg_trgm` for addresses, names, subjects, and typo tolerance;
- exact B-tree indexes for structured filters;
- keyset pagination by date, rank bucket, and stable ID.

### Optional pg_textsearch

If `pg_textsearch` is already installed, preloaded, and healthy, `mail.search_backend = auto` selects its BM25 index. The modes are `auto`, `postgres`, and `pg_textsearch`.

The app does not install extensions or edit `shared_preload_libraries`. It keeps the native GIN path in every environment and does not combine `pg_textsearch` with another competing `bm25` access-method extension.

Implementation targets the latest stable PostgreSQL release supported by the latest stable `pg_textsearch` release at the time the schema is frozen. CI pins that resolved pair and records the exact database, extension, dataset, and hardware profile used for reproducible search benchmarks; development branches or unreleased extension builds are not release gates.

BM25 ranks broad text candidates. Native indexes still implement field-specific filters, phrases, facets, and exact predicates. Backend-specific scores stay internal because BM25 and `ts_rank` are not comparable contracts.

### Result behavior

- Search can sort by relevance or date.
- Results state whether historical body indexing is still incomplete.
- Facet counts respect the same mailbox permission and search expression.
- A backend fallback may change ranking but not matching, permission, or pagination semantics.

## Collaboration

Collaboration state attaches to a conversation, not to individual messages.

### Work states

The initial states are:

- `open`: the team needs to review or act;
- `waiting`: the team is waiting for an external or scheduled event;
- `done`: no current action remains.

A new inbound message reopens a done conversation. Marking a conversation `done` is always local collaboration state: it never moves or archives remote mail. Unread remains a separate IMAP flag and is never used as a task state.

One user is the current assignee. Watchers receive updates without sharing ownership. The mailbox itself is the team queue, so multiple assignees are not required initially.

### Collaboration views

Built-in saved views include Inbox, Mine, Unassigned, Waiting, Done, Snoozed, and Recently Active. Counts represent conversations requiring work, not only unread messages.

Custom views store the same bounded filter contract. Private views belong to one user; mailbox views are shared and require `write` to create, edit, or delete. Dynamic filters such as `assignee: me` resolve for the current actor when the view runs.

### Comment chat and mentions

Internal comments are never sent to recipients or stored as remote message bodies. They form a permission-scoped chronological chat attached to the conversation. Comments support mentions, revisions, deletion tombstones, and an optional reply or message reference. Reply references provide context without turning the chat into a nested discussion tree.

New comments and mentions invalidate the durable conversation projection through the live topic. The mention picker contains only principals with current mailbox access, and notification delivery rechecks that access. Mention notifications link to the exact comment. Editing or deleting a comment preserves actor and revision history in activity without storing every keystroke.

The UI must make internal comments visually unmistakable from email. A comment composer can never address an external recipient, and the mail reply composer can never silently switch into comment mode.

### Shared drafts

Drafts store source Markdown/plain text, rendered MIME preview, intent, source-message context, authorship, last editor, and revision. They belong to the mailbox rather than their creator: a reader can inspect the complete draft, including Bcc recipients, and comment on its conversation; a writer can edit, take over, discard, schedule, or send it. Draft creation and autosave do not notify the mailbox. Review requests use the existing internal comment and mention flow.

Opening an empty composer does not create durable clutter. The first meaningful change allocates a draft ID, writes every subsequent edit immediately to a durable browser recovery journal, and saves a coalesced revision to PostgreSQL. Navigation, switching conversations, changing composer surface, reload, browser restart, and temporary network loss never discard a draft. Closing a composer only closes the surface; discard is a separate explicit soft-deletion action with recovery. The UI distinguishes saving, saved, offline, and conflict states without announcing routine successful autosaves.

PostgreSQL is the authoritative collaborative state after a revision is accepted. The browser journal covers edits that have not reached PostgreSQL and is removed when the draft is sent, explicitly discarded after its recovery period, or becomes inaccessible. Access revocation closes active editors and clears their local readable copy. A best-effort save on blur or page hide improves convergence but is never the only recovery mechanism.

The first implementation has one active editor per draft, not simultaneous multi-cursor editing. Opening a reply publishes ephemeral presence; starting to edit acquires a soft lease. Other collaborators see the latest accepted revision read-only and may explicitly **Take over**. A takeover makes the prior editor read-only; any unaccepted local text remains a recoverable copy instead of being merged or overwritten. Inline, full-size, pop-out, and same-user browser tabs are surfaces for one logical editing session rather than competing collaborators.

Presence and reply leases use distributed TTL state. Every heartbeat and snapshot rechecks current mailbox access; revoked users disappear immediately, and another eligible writer may recover their stale lease without waiting for the TTL.

Saving requires the expected draft revision. A stale save produces a typed conflict that preserves the user's version as a copy and offers the latest accepted revision; the first implementation does not merge text automatically and does not use Yjs or another CRDT. Routine autosaves update draft revision history but do not create one user-facing activity event per save. Activity records meaningful lifecycle events such as creation, requested review, takeover, discard or restore, scheduling, and send.

Send, Reply, Reply all, and Forward operate on one exact frozen draft revision. Permission, sender identity, provider binding, recipients, rendered signature, and conversation context are rechecked before submission. The first successful idempotent submission wins; every other surface becomes read-only. Activity distinguishes authorship from delivery, for example **Drafted by Alice, sent by Bob**. A newer inbound message or another collaborator's sent reply marks the draft context as changed and requires review rather than silently deleting or rewriting the draft.

### Activity

Every user-visible collaboration lifecycle mutation appends one `mail.activity_events` row in the same database transaction as the projection update. Draft text autosaves remain in draft revision history and do not emit activity per revision. Remote actions append requested and terminal events around the durable command.

Actors support:

- user;
- service account;
- agent with optional delegated user;
- mailbox workflow;
- system reconciliation.

Events include target, before/after metadata, outcome, timestamp, and correlation IDs. A short user-visible reason is allowed. Hidden reasoning and message bodies are not.

Activity and comment chat remain separate projections. Routine assignments, moves, and sync events belong to activity and do not flood the human conversation. A relevant activity subset may be shown inline behind a filter.

Credential changes, binding changes, mailbox sharing, sender-identity changes, workflow or automatic-send activation, and bulk-plan approval also write a security-relevant event through the Cloud platform audit service. Mail activity remains the user-facing operational history; platform audit does not replace it.

## Workflow automation

Mail workflows are deterministic programs compiled from canonical YAML by the shared Cloud workflow kernel. Mail owns authoring metadata, immutable versions, mailbox permissions, target selection, preflight commitments, persistence, trigger delivery, domain actions, and audit. The shared kernel owns strict YAML parsing, diagnostics, expressions, recursive control flow, bound plans, dry-run traversal, step execution, waiting, and restoration.

### Canonical source and metadata

YAML contains only `inputs`, optional automatic `triggers`, and `steps`. Name, description, numeric ordering priority, activation state, immutable version IDs, and effect budgets are stored outside source.

```yaml
inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true

triggers:
  messageReceived:
    with:
      message: "${{ trigger.message }}"
      conversation: "${{ trigger.conversation }}"

steps:
  - if:
      all:
        - contains:
            - "${{ inputs.message.subject }}"
            - invoice
        - not:
            equals:
              - "${{ inputs.conversation.workStatus }}"
              - done
    then:
      - addKeyword:
          message: "${{ inputs.message }}"
          keyword: Finance
      - moveMessage:
          message: "${{ inputs.message }}"
          folder: Invoices
      - setConversationStatus:
          conversation: "${{ inputs.conversation }}"
          status: waiting
```

Source is preserved exactly, while the immutable version also stores source, manifest, catalog, and compiler hashes plus the compiled IR and bound plan. Literal accessible folder and user references bind to stable IDs. Creating new source creates a new immutable version and does not rewrite the active version or historical runs.

### Inputs, conditions, and actions

The current inputs are `mailMessage` and `mailConversation`. Message fields include subject, sender/recipients, hydrated bodies and attachments, folder, flags, keywords, direction, and timestamps. Conversation fields include assignment, open/waiting/done state, response-needed state, and latest-message time. The binder checks reference roots, paths, and value kinds before a version is stored.

Conditions use the shared recursive operators `equals`, `notEquals`, `contains`, `startsWith`, `endsWith`, `exists`, `all`, `any`, and `not`. Steps support actions, `if`/`then`/`else`, and `switch`/`cases`/`default`. The shared parser understands bounded `forEach`, but Mail rejects it because mailbox target batches belong in the durable target coordinator.

The implemented action vocabulary is deliberately small:

- `addKeyword` and `removeKeyword` create durable provider commands;
- `moveMessage` creates a durable provider move command against a bound accessible folder;
- `assignConversation` performs a revision-checked collaboration transaction and accepts `null` to unassign;
- `setConversationStatus` sets `open`, `waiting`, or `done` transactionally;
- `succeed` and `fail` stop the current target with an operator-facing message.

Copy/archive/trash, standard flags, local tags, comments, drafts, references, automatic replies, notifications, lower-priority pipeline control, and AI decisions are not current workflow actions.

### Invocation and triggers

Omitting `triggers` creates a direct-only workflow. Any saved workflow, including one with automatic triggers, can be invoked manually through UI/API/CLI channels. Mail exposes `invoke`, `oneShot`, and `backfill` run kinds; they currently share the same version-pinned query, preflight, frozen-target, and execution path, with the kind retained for audit and caller intent.

`messageReceived` is the implemented automatic path. Live incremental sync records one deduplicated event only after a stable inbound message is linked to a conversation. Historical sync/backfill does not emit the trigger. Dispatch selects active registrations by mailbox and trigger kind, ordered by ascending numeric priority and stable IDs, and materializes at most one run per activation and delivery key.

The language manifest accepts `schedule` with a five-field cron and optional IANA timezone. Activation reconciles stable Mail-prefixed scheduler registrations. Every due slot revalidates the active revision and schedule, derives a deterministic slot key, and enters the same authorization-aware materialization path as event triggers. Scheduler delivery is transport; PostgreSQL activation and run state remain authoritative.

### Preflight, dry-run, and effect budgets

Mail preflight is the supported no-effects review contract. It runs in a repeatable-read, read-only transaction and uses the shared dry-run traversal against frozen message and conversation snapshots. It keyset-pages the mailbox-scoped target query, rejects required body/attachment data that is not hydrated, counts only planned changes, and enforces the immutable version's effect budget.

The response contains the version ID and identity, source and query hashes, effect budget, action counts, target count, and a `preflightHash`. Execution repeats preflight before creating the run and rejects a stale hash. Large backfills then keyset-page the same target query in bounded transactions, persist the cursor and rolling digest after every batch, and publish targets only after the final count and digest match the commitment. The hash commits the caller to the version, bound catalog, inputs, query, target identities, source preconditions, planned action counts, and budget.

Default version budgets are 1,000 targets, 1,000 moves, 2,000 keyword changes, and 2,000 collaboration changes. Schema ceilings are 50,000 targets and moves and 100,000 keyword or collaboration changes; preflight also caps total planned effects at 50,000. The API accepts an explicit complete budget object. The CLI exposes the same bounds on workflow and version creation.

The shared runtime `dryRun` mode is exposed through the Mail API and CLI. It creates a durable run with frozen targets and per-target planning results, but action planners receive no effect-capable ports. Preflight remains the stateless execution commitment; a durable dry run is the auditable no-effects record.

### Authorization and activation

Reading and validation require mailbox `read`. Creating versions and activating or deactivating require `admin`. Preflight, execution, and cancellation require mutation access. Creation and execution require a durable current user or service-account credential.

Activation requires the expected current version ID, replaces the workflow's trigger registrations, records who activated it, and grants the active version mailbox-owned automation authority. Deactivation requires the expected active version ID, clears the active pointer, and disables its registrations without changing existing runs. Manual runs retain actor-bound durable credentials and recheck current mailbox access. Automatic runs do not depend on the activating administrator retaining personal access; they remain authorized only while the exact workflow version is active. Each provider or collaboration effect rechecks mailbox identity, active-version fencing, capabilities, and mutable preconditions.

### Waiting, recovery, and audit

Provider actions create idempotent commands keyed by target and step. A non-terminal command parks the step on a `mail.command` dependency. Body, HTML, and attachment references can park automatic runs on `mail.hydration`. Completion events wake parked targets quickly; PostgreSQL reconciliation remains authoritative when an event is missed.

Targets and trigger events use leases and monotonically increasing execution generations. Stale workers cannot finish a step after losing a lease. Completed outcomes are restored instead of repeated. Periodic recovery resumes stale keyset materialization checkpoints, requeues queued targets and expired claims, and resolves terminal command or hydration dependencies. Revoked actors or mailbox permissions cancel unfinished materialization. Failed commands fail the step; ambiguous provider outcomes become `needs_attention` and are not blindly retried.

Runs retain pinned source identity, target progress, inputs/query, actor authorization snapshot, outcomes, and error state. Activity and platform audit record lifecycle requests and effects with workflow, version, trigger, run, and action attribution.

### Current product gaps

The backend and CLI are ahead of the Mail UI. There is no visual workflow editor, in-app workflow help, pause/resume, or per-target retry UI. Guarded automatic replies, AI decisions, temporal windows, richer actions, conflict analysis, and generated bulk-plan UX remain product work and must not be presented as available behavior.

## Agents and AI

Agent access is a projection of the same mail domain, not a parallel backend.

### Interactive chat

The mailbox registers a `defineAiResource` definition. Its access hook resolves the current mailbox permission for every request. Resource hooks define the system prompt, model policy, and tools.

`defineAiTool` wraps typed mail services. The existing Cloud AI runtime owns Nessi streaming, resumable turns, frontend tools, approvals, persisted always-allow preferences, and AI tool-call audit.

An AI tool attempt and approval share agent-loop and tool-call correlation IDs with the resulting mail command and activity event. The AI audit proves what was proposed and approved; the mail command proves what actually executed.

### CLI and service accounts

The first agent-facing surface is the typed Mail API and CLI. Service accounts receive the lower of mailbox permission and service-account scope. Tools and command handlers never receive raw provider credentials; a service-account owner may configure its own provider connection only through the same write-only secret API used by users.

Initial queries and commands:

- search conversations with the structured search AST;
- get a bounded conversation projection;
- list activity;
- assign, tag, move, and set status;
- create and update shared drafts;
- add internal comments and mentions;
- read or ensure a conversation reference where policy allows;
- send or delete with policy checks;
- draft, validate, and preview bulk-action workflow plans;
- execute a specifically approved one-shot plan;
- save, activate, and run recurring workflows where permission allows.

All commands accept an idempotency key. Mutations that depend on current collaboration state accept an expected revision.

### Tool approvals

Default policies:

| Tool class | Default |
| --- | --- |
| Search, read, summarize, suggest | No approval |
| Generate or preview a bulk-action plan | No approval |
| Assign, tag, status, comment, create draft | User-configurable resource approval |
| Move, archive, trash | One-time approval, optionally resource-configurable |
| Execute a bulk-action plan | One-time approval bound to plan hash, target snapshot, and effect budget |
| Send and permanent delete | One-time approval; no implicit always-allow |
| Background assignment, local tag, status, comment, or draft | Mailbox-admin policy bound to workflow version and action scope |
| Background flags, move, archive, or trash | Mailbox-admin policy with folder scope, target constraints, and effect limits |
| Automatic reply | Separate automatic-send policy and hard Core ceilings |
| Background arbitrary send or permanent delete | No blanket authorization; requires a specifically approved bounded plan or later dedicated policy |

Interactive remembered approvals remain bound to user, app, mailbox resource, tool, and approval scope. Interactive agents execute as their caller or explicit delegated principal. Autonomous workflows and background agent runs have no Cloud principal; an immutable mailbox policy authorizes a workflow version and bounded action scope, while activity records the workflow and provider transport separately.

### AI artifacts

Summaries, labels, routing suggestions, and reply suggestions record:

- source conversation revision and content hash;
- model profile and workflow/tool provenance;
- created and invalidated timestamps;
- output schema version;
- optional short explanation and confidence metadata.

A new message invalidates stale summaries and suggestions. Generated drafts remain visible as drafts but show that their source context changed.

### Prompt injection boundary

Email content and attachments are untrusted data. They cannot alter system prompts, permissions, tool policy, approval state, recipient validation, or workflow definitions.

AI decision nodes have no tools. Agent tools expose bounded, paginated results and fetch bodies or attachments explicitly. The app never stores hidden chain-of-thought.

### Skills and external agents

Mail skills are versioned workflow instructions such as:

- morning briefing;
- end-of-day wrap-up;
- batch draft writer;
- unanswered-thread review;
- contact or organization history;
- mailbox cleanup proposal.

An MCP adapter can later expose the same tool contracts to external agents. It does not get a broader permission model than the native CLI or AI resource.

## Compose and rendering

Compose starts with plain text and Markdown while producing standards-compatible MIME.

### Draft representation

- Store source plain text or Markdown in PostgreSQL with revision history and keep only unsynchronized recovery state in the browser journal.
- Generate `text/plain` and sanitized `text/html` MIME alternatives from an exact accepted revision.
- Preserve remote IMAP draft placement and `\Draft` state through coalesced complete MIME snapshots. A successful new snapshot is recorded before the prior remote snapshot is deleted or marked deleted.
- Treat Cloud-to-provider synchronization as projection and provider-to-Cloud synchronization as import and reconciliation. The flow is bidirectional but intentionally asymmetric: PostgreSQL remains the collaborative authority.
- Persist connector-scoped remote identity and the last projected Cloud revision. IMAP uses mailbox identity, `UIDVALIDITY`, UID, and a content fingerprint; JMAP uses its stable email ID and state tokens where available.
- Import a draft created in another client as a Cloud draft. If only the remote version changed, import it as a new revision. If Cloud and the provider both changed, retain the remote version as a conflict copy instead of merging or choosing a winner silently.
- Treat remote deletion as a Cloud soft discard only when the provider still represents the last projected Cloud revision. If Cloud has newer work, preserve it and expose a synchronization conflict.
- Attribute changes that arrive through an external client to that external provider binding when the protocol cannot identify the human editor. Never claim a specific Cloud actor without evidence.
- JMAP may improve identity and state-based conflict detection, but it does not change the PostgreSQL authority, permission, activity, or frozen-send contracts.

### Reply quoting, draft intents, and composer surfaces

A reply can quote a complete prior message or selected lines from any message in the conversation. Selecting text exposes **Quote in reply** and inserts a localized attribution plus a standards-compatible quote block at the current composer cursor:

```text
Am 11.07.26 um 18:12 schrieb Valentin Kolb:
> Der 30.07. nachmittags passt bei mir gut. Teilst du mir dann noch Ort und genaue Uhrzeit mit?

Der genaue Prüfungstermin ist:

30.07., 15:05 Uhr, Raum O27/341.
```

Users can write before, after, or between several quoted fragments. Plain-text output uses `>` prefixes; sanitized HTML uses semantic quote markup. The draft keeps enough source-message metadata to regenerate attribution without modifying the retained message or changing `In-Reply-To` and `References` behavior.

Each mail draft has one explicit intent: `new`, `reply`, `replyAll`, or `forward`. Intent is independent of where the draft is edited:

- `new` starts without a source message or recipients;
- `reply` addresses the selected message's reply target and preserves reply headers;
- `replyAll` adds the selected message's visible recipients, removes the active sender identity and actor addresses, and deduplicates normalized addresses;
- `forward` starts with empty recipients, a `Fwd:` subject, and the selected message as forwarded content. It includes that message's non-inline attachments by default, but each attachment can be excluded before sending.

Forward acts on the selected message, not the entire conversation. **Forward as attachment** is an explicit advanced action. A reply or forward may be opened from a message action, keyboard command, or command palette; changing the editing surface never changes its intent.

The compact reply composer is the default in the split workspace. Expanding it opens a full-size mail composer with explicit From, To, Cc, Bcc, Subject, attachments, body, and its intent-specific primary action. The same draft can open in a dedicated browser window. Inline, full-size, and pop-out surfaces share one draft ID, revision stream, draft lease, permission checks, upload state, and send command; opening another surface never clones the draft. Internal comments are collaboration records edited only in the Details panel. They are never a mail draft intent and never appear as an option in compact, full-size, or pop-out mail composers.

The default composer keeps only frequent controls visible: sender and recipients, subject on demand in compact mode, body, the primary intent action, delivery options, attachments, and focus or pop-out controls. Formatting and Markdown preview, signatures and snippets, scheduling, AI drafting, subject editing on replies, and discard live in focused toolbar or overflow actions. Provider-dependent priority flags and **Forward as attachment** remain advanced actions. Undo send is a post-send action, not another composer mode.

The primary commit action mirrors the draft intent on every surface: **Send** for a new message, **Reply** for reply, **Reply all** for reply-all, and **Forward** for forward. Its icon follows the same intent. The adjacent secondary control is consistently named **Delivery options** and contains scheduling or delivery behavior; it never changes recipients or draft intent.

### Signatures and snippets

Mailbox signatures and team snippets use the existing restricted Liquid engine: strict variables and filters, output escaping, tag allowlist, no dynamic partials, and size limits.

Variables include explicit mailbox, actor, recipient, contact, conversation, and optional conversation-reference fields. Missing required variables block sending and identify the field.

Signatures, snippets, and CSS are versioned. A sent message stores the rendered snapshot and template version so later edits do not rewrite history.

### Mailbox CSS

Mailbox CSS styles outgoing Markdown HTML only. The app validates an allowlist, rejects imports and unsafe URLs, and inlines supported declarations for email-client compatibility. Preview renders through the same pipeline as send.

Incoming HTML never uses mailbox compose CSS.

## Application experience

The app uses `AppWorkspace` as a dense operational workspace, not a landing page. The default is calm through progressive disclosure: capabilities remain available without occupying the screen until needed.

```text
+----------------+---------------------------+--------------------------+------------------+
| Mailbox nav    | Conversation list         | Reader                   | Optional detail  |
| Views/folders  | sender · subject · preview | thread · reply composer  | one panel only   |
| Settings       | state · assignee · time    | message actions          | resizable        |
+----------------+---------------------------+--------------------------+------------------+
```

### Workspace hierarchy

The left navigation selects the mailbox, saved view, or provider folder. Navigation and conversation-list widths are resizable, collapsible, and remembered per user. The conversation list favors Notion Mail-style one-line rows so users can scan many messages without changing context. A row keeps sender, subject, preview, unread state, timestamp, attachment indicator, and compact collaboration signals such as assignee or waiting state. Secondary labels yield before sender, subject, or work state disappears.

Selecting a row opens the conversation beside the list. Search, filter, and view controls stay compact. Row actions appear on selection or hover, but consequential state and commands remain keyboard-accessible and never depend on hover alone.

### Thread view

The conversation view shows the original message and every inbound or outbound reply in chronological order. The newest relevant message is expanded; older messages remain compact but preserve sender, recipients, timestamp, attachment presence, and delivery direction. Recognized quoted history is collapsed for readability, while the unmodified raw body remains available.

The selected message exposes familiar **Reply**, **Reply all**, and **Forward** actions without opening a generic action drawer. Reply may continue in the compact composer; Reply all and Forward can open the same draft in full-size or pop-out form when more recipient or source context is useful.

Internal comments do not enter the email chronology. They live in the optional Details panel beside ownership, followers, compact mail metadata, and recent activity. Its comment input cannot address external recipients. The mail composer cannot silently switch into internal-comment mode.

A stable conversation reference, when allocated, appears as a compact copyable label in the header and search results. Manual merge and split commands are available only when threading is wrong, require confirmation, and append an activity event. Merge previews the primary reference and retained aliases. Split previews which conversation keeps the reference and whether the new conversation receives one.

### Detail panels

The reader can open one resizable `AppWorkspace.Detail` panel at a time. A single **Details** panel combines ownership, followers, internal comments, recent activity, workflow state, participants, routing metadata, labels, and compact message metadata. Team and Mail details are not separate panels. Technical headers remain an advanced disclosure inside Details rather than occupying another panel.

Contact context and contextual AI may replace Details in the same optional panel region. The AI panel hosts contextual chat and actions; the quiet inline summary remains in the reader. Attachments remain with their source message and do not become another generic detail panel.

A badge on Details represents unread internal comments only, uses the exact unread count, and disappears at zero. Participant, follower, attachment, and activity counts are not mixed into that badge.

Closing a panel restores reader width. Panel choice, width, and visibility are user preferences, not conversation data. On narrow screens a detail panel becomes a dedicated overlay or route and keeps an explicit path back to the conversation.

### Attachment placement

Attachments remain visually bound to their origin. Received files appear beneath the exact history message that carried them, including filename, type, size, availability, and actions. Files being sent appear only inside the active composer with upload progress, retry, remove, and failure state. The UI never combines received and outgoing files in one generic drawer.

Each attachment group has a stable source label such as **Received with this message**, **Attached to this reply**, or **Included from original message**. The label remains visible in ordinary reading mode and is not dependent on opening an attachment-specific state.

Opening a received file starts from its message row and may use an inline preview, a focused preview surface, or a new browser tab according to file type. Opening or downloading still rechecks current mailbox permission. The attachment's source message remains visible or directly reachable from the preview.

### Reader width and compose focus

The normal split workspace is optimized for moving between conversations. The conversation list can be hidden and restored independently while mailbox navigation, conversation actions, and the compact composer stay in place. Hiding the list closes the optional detail panel and lets the reader use the remaining workspace width; it is not a separate reader mode. List visibility and width are remembered per user, and restoring the list preserves the selected conversation and reader scroll position.

**Full-size composer** is a separate editing surface for substantial new messages, replies, reply-all drafts, and forwards. It occupies the complete app viewport: mailbox navigation, conversation list, reader, conversation toolbar, detail panels, and other workspace chrome disappear. The composer header is the topmost UI, identifies the current mail intent, and provides both Exit full size and **Open in new window**. It never offers Internal note as a mode. The dedicated browser window contains the same composer-only surface for comparison with other mail or applications. Returning to split view preserves cursor, selection, scroll position, uploads, and draft revision.

### Command-first interaction

One command registry powers buttons, menus, the shared Spotlight-style command palette, and keyboard shortcuts. Commands declare availability, required permission, label, icon, shortcut, and execution handler.

Shortcuts are discoverable and configurable. Keyboard and pointer interaction have parity. International keyboard layouts are part of verification.

Triage actions advance focus to the next conversation without resizing the list. Adjacent conversation data is prefetched. Optimistic feedback appears immediately, while durable command state exposes sync failures and recovery.

Dragging a conversation onto a provider folder invokes the same checked move command as menus, keyboard shortcuts, CLI, and agents. The drop target shows whether the operation moves, copies, or is unsupported before release. Every drag action has an equivalent keyboard and command-palette path.

### Split views

Superhuman-style Split Inboxes become saved views over the structured search AST, not folders. Built-in and team templates may combine ordinary filters and AI-produced local tags.

The UI recommends a small visible set and lets users reorder or hide empty views. A conversation may appear in several views because views are queries.

This is selective product inspiration, not protocol emulation. Cloud keeps its own mailbox permissions, audit model, IMAP portability, collaboration semantics, and accessible keyboard/pointer parity.

### Summary placement

An AI summary appears as one quiet line below the subject and expands in place. It does not occupy a separate card or panel. The summary shows stale or unavailable state without blocking the thread.

### Reminders

Snooze returns a conversation at a time. Conditional reminders return it only if no reply arrives. A new inbound response cancels an `if no reply` reminder and reopens the conversation.

### Automatic-response setup

Mailbox settings offer acknowledgement and out-of-office presets, but saving a preset creates an ordinary versioned workflow. There is no second responder engine or hidden provider rule.

Setup selects a verified sender identity, template, reference scheme if needed, timezone and schedule, deduplication policy, and suppression defaults. Before activation, the UI previews the exact subject and body with sample data and summarizes which automated or list messages will be suppressed. An active absence window is visible in mailbox settings and can be disabled with one audited action.

### Contact context

Normalized addresses link to Contacts without copying contact ownership into Mail. The conversation can show contact details, related history, and linked Spaces when permission allows.

### Intentionally deferred UX

- External guest sharing of full conversations.
- Tracking pixels and recipient read-status feeds.
- Simultaneous real-time text merging.
- Smart Send timing.
- Calendar scheduling inside Mail.
- A cross-mailbox unified inbox beyond permission-scoped saved views.

## API and CLI

The Mail package owns a typed Hono API and service layer. Frontend islands use the generated client; internal JSON calls do not use raw `fetch`.

### Resource shape

Proposed top-level routes:

```text
/api/mail/provider-connections
/api/mail/provider-connections/:connectionId/accounts
/api/mail/mailboxes
/api/mail/mailboxes/:mailboxId/bindings
/api/mail/mailboxes/:mailboxId/folders
/api/mail/mailboxes/:mailboxId/identities
/api/mail/mailboxes/:mailboxId/conversations
/api/mail/mailboxes/:mailboxId/conversations/:conversationId/messages
/api/mail/mailboxes/:mailboxId/conversations/:conversationId/messages/:messageId/attachments
/api/mail/mailboxes/:mailboxId/conversations/:conversationId/comments
/api/mail/mailboxes/:mailboxId/conversations/:conversationId/references
/api/mail/mailboxes/:mailboxId/search
/api/mail/mailboxes/:mailboxId/commands
/api/mail/mailboxes/:mailboxId/workflows
/api/mail/mailboxes/:mailboxId/activity
/api/mail/mailboxes/:mailboxId/ai
```

Conversation and message routes remain under a mailbox so authorization cannot be omitted accidentally.

### CLI shape

```text
cloud mail provider-connection discover --connection university
cloud mail mailbox add --connection university --account shared --root "Shared Folders/functional-address"
cloud mail mailbox binding add --mailbox functional-address --connection university-bob --account shared --root "Shared Folders/functional-address"
cloud mail identity add --mailbox functional-address --from functional-address@example.org
cloud mail mailbox list
cloud mail search --mailbox support --query query.json --json
cloud mail conversation get --mailbox support --id ...
cloud mail conversation merge --mailbox support --into ... --conversation ... --confirm
cloud mail conversation split --mailbox support --conversation ... --message ... --confirm
cloud mail assign --mailbox support --conversation ... --user ... --idempotency-key ...
cloud mail comment add --mailbox support --conversation ... --file comment.md
cloud mail reference ensure --mailbox support --conversation ... --scheme default
cloud mail draft create --mailbox support --conversation ... --file reply.md
cloud mail send --mailbox support --draft ... --confirm
cld mail workflow validate --source-file route-mail.yml --mailbox support
cld --json mail workflow preflight <workflow-id> --version-id <version-id> --mailbox support --query-file query.yml
cld --json mail workflow run backfill <workflow-id> --version-id <version-id> --mailbox support --query-file query.yml --yes
```

Human output is concise; `--json` returns stable machine-readable contracts. Commands never print credentials or unrestricted message bodies by default.

Natural-language organization commands and generated bulk-plan approval are future AI/product surfaces, not shipped CLI commands.

The authoritative workflow command reference is `skills/cloud-cli/references/mail.md`; executable help from `cld mail workflow help` defines the shipped command grammar.

## Permissions and security

The mailbox is a Cloud resource with standard permission levels.

### Permission mapping

Accepted mapping:

| Permission | Capabilities |
| --- | --- |
| `read` | List, search, and read mail and shared drafts; download permitted attachments; view activity; write, edit, and delete own internal comments; mention collaborators. Draft access includes envelope fields and Bcc because drafts are mailbox content. |
| `write` | Read plus every ordinary message and collaboration operation: flags, keywords, moves, copy, archive, trash, message deletion, local tags, assignment, status, references, draft creation and editing, takeover, discard, and send. |
| `admin` | Write plus mailbox-owned provider connections, all mailbox binding links, sender identities, remote folder creation/rename/deletion, mailbox settings, sharing, workflows, rules, policies, signatures, and reversible mailbox deletion. |

Service-account credential scopes can only reduce resource permission. Tool and automation policies can reduce it further.

A private provider connection remains controlled by its owner. A mailbox admin may see redacted binding health and unlink another user's binding from the mailbox, but cannot inspect, replace, export, or revoke that user's credential. For a mailbox-owned shared connection, admins may replace or remove secret values but can never retrieve an existing value.

### Layered authorization

An operation is allowed only when every relevant layer permits it:

```text
Cloud mailbox permission
  intersect current rights and scopes of the selected binding
  intersect sender-identity authorization when sending
  intersect tool, workflow, or service-account scope
  intersect approved bulk-action effect budget
```

In personal-provider mode, an acting user or service account must also have its own current binding for cached mail reads and actor remote operations. In shared-connection mode, Cloud deliberately authorizes use of the mailbox-owned binding. In both policies, remote operations can never exceed the binding's current provider rights. Conversely, provider access does not grant Cloud access unless the mailbox resource is shared with the principal.

One-shot bulk plans may be executed by a writer only for actions that writer could perform individually. Recurring rules, connection changes, sender identities, and autonomous-action policies require mailbox administration permission.

Manual conversation merge and split require `write` and an expected conversation revision. Activating automatic replies, selecting their sender identity, or changing deduplication and schedule policy requires `admin`; execution then uses the frozen workflow version and a resolver-selected eligible transport binding.

### Revocation

Every request, attachment fetch, stream reconnect, delayed command, workflow action, and agent tool execution resolves current access. Revocation blocks new work immediately. Existing live clients refetch and lose inaccessible state; draft editors close and clear their durable browser recovery journal for that resource.

Binding rights, scopes, and remote resource visibility are also rechecked. If a shared root disappears or a user's personal binding loses read rights, that binding no longer authorizes cached mail even if the Cloud ACL itself did not change. Other healthy bindings and collaborators remain unaffected.

System sync jobs resolve an eligible binding from the mailbox pool and hold a fenced sync lease; they are not owned by the user whose binding currently transports bytes. User-configured workflows become mailbox-owned when an admin activates an immutable version. They have no Cloud principal, but every execution records the workflow version, trigger, selected transport binding, provider principal, and resulting command.

### Credential security

- Apply application-level encryption only to provider password, app-password, OAuth token, and equivalent secret fields in provider connections. Connections never become mailbox permissions.
- Return only redacted configuration state such as `isSet`, verification status, provider principal, and last verified time. No API, CLI, UI, administrator, or original creator can retrieve a stored secret.
- Support password/app-password and OAuth2 token forms without exposing tokens to the browser.
- Require TLS and certificate validation by default.
- Redact protocol logs and disable raw wire logging in production.
- Audit credential create, replace, verify, and revoke operations.

### Endpoint SSRF

Mail setup is self-service, including custom IMAP and SMTP endpoints. Every configured endpoint passes through a central outbound policy that rejects private, loopback, metadata, and disallowed DNS targets.

DNS rebinding and redirects must be considered; hostname validation alone is insufficient.

### Message rendering

- Parse incoming HTML as untrusted content.
- Sanitize server-side and render with isolation and a restrictive content policy.
- Block remote images by default and offer per-message or per-sender loading.
- Disable scripts, forms, objects, imports, and active URL schemes.
- Serve CID images and attachments through permission-checked endpoints.
- Set safe download headers and never infer trust from filename extensions.

### Searchable content encryption

Native PostgreSQL full-text search requires the database engine to read message text. Message bodies, attachments, search documents, comments, activity, and workflow data therefore use normal PostgreSQL storage without application-level field encryption. The enterprise deployment relies on database access controls, infrastructure encryption where configured, backups, and limited operational access; this is not a zero-trust storage design.

## Background work

`@valentinkolb/sync` supplies coordination; PostgreSQL stores domain progress and audit.

| Primitive | Use |
| --- | --- |
| `scheduler` | Periodic mailbox discovery, reconciliation, reminders, cleanup, and repair scans. |
| `job` | Folder backfill, body hydration, workflow target, AI artifact, and outgoing-send work. |
| `mutex` | One conflicting sync or command pipeline per mailbox/folder/placement and one sync-leader election per remote resource. |
| `ratelimit` | Provider-host and mailbox request budgets. |
| `topic` | Best-effort UI invalidation with cursor replay. |
| `ephemeral` | Viewing, composing, and reply-presence leases. |
| `retry` | Bounded transport retries for known retryable failures. |

Jobs are at-least-once. Inputs contain IDs and version keys, not full message bodies. Processors load current permission, state, and definition from PostgreSQL.

Nessi handles model loops, structured output, tool execution events, and approvals. It does not replace queue claims, workflow runs, idempotency, or mail audit.

## Operations

### Mailbox health

Each mailbox exposes:

- connector kind, remote account, and connection state per binding;
- authentication and token-refresh state per binding;
- selected remote root, effective rights or scopes, and last verification per binding;
- connection policy, active binding count, degraded or revoked bindings, and redundancy warning;
- current fenced sync leader, lease age, and last failover reason;
- folder discovery generation, subscribed/discovered/synchronized counts, and unresolved rename or ACL changes;
- configured sender identities and their verification state;
- last successful sync and current lag;
- active and failed folder backfills;
- indexed versus discovered message counts;
- pending, ambiguous, and failed commands;
- outgoing queue state;
- workflow backlog and failures;
- active automatic-reply policies, schedule state, suppressions, and failures;
- conversation-reference allocator state;
- active bulk-action plans, approved effect budgets, and remaining targets;
- connector capabilities, fallback paths, and quota where available;
- selected search backend and index health.

### Repair operations

Administrative operations include:

- verify connection;
- rediscover remote accounts, containers, rights, identities, and capabilities;
- link or unlink a private binding after explicit remote-resource verification;
- force sync-leader re-election after invalidating the current lease;
- reconcile provider subscriptions separately from Cloud folder selection;
- reverify a sender identity and its Sent/Drafts mappings;
- reconcile one folder;
- rebuild one folder after UIDVALIDITY change;
- hydrate missing bodies;
- rebuild search documents or indexes;
- rebuild heuristic conversation grouping while preserving manual overrides;
- inspect an automatic-reply suppression or deduplication decision;
- reconcile ambiguous moves and sends;
- replay or cancel a workflow backfill;
- pause, resume, cancel, or generate an inverse plan for a bulk-action run;
- inspect and retry failed commands.

Every manual operation is audited and uses the same scheduler/job handlers as automatic work.

### Observability

Metrics must cover sync duration and lag, fetch bytes, reconnects, parser failures, connector discovery and rights refreshes, binding failures, command latency, ambiguous outcomes, search latency, index size, workflow and bulk-action throughput, automatic-reply suppression and send outcomes, reference allocation failures, AI calls and cost metadata, approval wait time, and identity rejections.

Logs use IDs and counts rather than subjects, addresses, bodies, or credentials. Traces carry mailbox, command, workflow-run, agent-loop, and request correlation IDs.

The `/admin/mail` storage view is Cloud-admin-only and observational. Its mailbox table reports message count, logical message bytes, received-attachment bytes, draft and ordinary outgoing-upload bytes, external-link bytes, logical total, and last calculation time. It supports search and sorting by total without exposing subjects, addresses, filenames, or attachment content.

Mailbox rows report logical referenced bytes, not attributed physical disk usage. Content-addressed blobs can be referenced by more than one mailbox, so assigning their physical bytes to one mailbox would be misleading. A separate global summary reports physical Mail relation and blob storage. A durable aggregate projection is updated from known byte lengths and periodically reconciled; the admin page never scans message or blob tables synchronously. No value in this view blocks upload, sync, or send in the initial release.

### Retention and backup

PostgreSQL stores mailbox settings, permissions, mirrored message content, all attachment bytes, assignments, watchers, comments, drafts, manual thread overrides, conversation references, response schedules, workflows, signatures, snippets, AI artifacts, activity, commands, and deletion tombstones. The initial policy retains these records indefinitely, including after a provider-side deletion or complete loss of provider access. First-release mailbox deletion disconnects transport, revokes ordinary access, and marks the resource deleted without physically purging this dataset; an admin may restore it.

Backups cover the same durable dataset, including chunked attachment blobs. Reindexing or reconnecting a provider must never be the only recovery path for collaboration history or attachment content.

The first release has no app-level mailbox byte quota and never truncates a provider message to satisfy local storage. Operators monitor PostgreSQL capacity and configure deployment-level admission backpressure. If a complete message or attachment batch cannot be committed, synchronization records a storage error, leaves the remote message and mailbox cursor unacknowledged, and retries after capacity is restored; list and collaboration features remain available from already committed data.

## Verification

Verification must prove recovery and authorization, not only happy-path API behavior.

### Protocol matrix

The matrix is cumulative. Only generic IMAP/SMTP behavior gates the first complete release. Named providers are interoperability fixtures, not separate first-release support promises. JMAP, Graph, and Gmail API rows become release gates only when their connector slices ship.

- Dovecot or another controllable generic IMAP/SMTP server.
- Generic IMAP without QRESYNC, CONDSTORE, MOVE, IDLE, or SPECIAL-USE.
- Server with personal, other-user, and shared namespaces plus standard ACLs.
- Generic IMAP fixture modeling a functional address delivered into a shared namespace.
- At least one independent generic IMAP implementation in addition to the controllable fixture.
- Optional interoperability runs for Stalwart, Gmail or Workspace, Microsoft 365, and the University of Ulm service without provider-specific release guarantees.
- Stalwart Group inbox through JMAP.
- Fastmail or another independent JMAP implementation.
- Microsoft 365 shared mailbox through Graph.
- Gmail or Workspace through the Gmail API.

### Onboarding scenarios

- Known-provider preset with OAuth.
- DNS SRV and Thunderbird-style autoconfiguration.
- App password and compact manual host configuration.
- IMAP succeeds while SMTP fails, and the reverse.
- Ambiguous or absent special-use folders require one remembered mapping step.
- Shared namespace selection never imports personal folders.
- Sender identity requires separate provider or verification-send authorization.

### Failure scenarios

- Process crash during every sync batch boundary.
- Sync leader loses its lease during a batch; the atomic PostgreSQL fence check rejects its projection and cursor commit after a replacement leader starts.
- Alice's active sync binding is revoked; Bob continues from the last mailbox-owned committed cursor without duplicate or missing changes.
- An actor mutation or send fails after binding selection and never falls back to another user's binding.
- An ambiguous command remains pinned to its original binding until reconciliation.
- Every binding becomes invalid; PostgreSQL data remains intact while remote work pauses in `connection_required`.
- Disconnect before and after IMAP MOVE completion.
- MOVE fallback on a server without UIDPLUS records `expunge_pending` and never issues mailbox-wide `EXPUNGE` or `CLOSE`.
- Disconnect after SMTP acceptance but before local confirmation.
- An unresolved send outcome reaches `needs_attention` without an automatic duplicate send.
- UIDVALIDITY change and folder rename/delete.
- Concurrent external client flag and move changes.
- Expired credentials and OAuth refresh failure.
- Duplicate `Message-ID` and missing threading headers.
- Duplicate workflow delivery and concurrent inbound messages attempting the same reference allocation or automatic reply.
- Automatic-reply send becomes ambiguous after provider acceptance.
- 100 MB MIME source with streamed attachments.
- PostgreSQL storage admission fails mid-import; no partial message or advanced cursor is committed, and sync resumes after capacity returns.
- Malformed MIME, unusual charset, malicious HTML, and tracking pixels.

### Permission scenarios

- User, group, service-account, and delegated-user access.
- Permission reduction between command request and execution.
- Revocation during search, attachment download, SSE reconnect, workflow run, and AI tool call.
- Cross-mailbox OR query attempts.
- In personal-provider mode, search, cached mail, attachments, and content-derived collaboration views are excluded after the acting user's private binding is revoked even while its Cloud ACL remains. Binding setup and mailbox administration remain available to authorized admins.
- A binding with read access to only part of the selected remote scope does not authorize the combined mailbox or its comments.
- Agent and workflow actions exceeding their allowed action scope.
- Remote shared-folder rights removed while content, a stream, and delayed commands are cached locally.
- Sender identity allowed in Cloud but rejected by the SMTP provider.
- A Cloud mailbox remains shared while one user's private binding is revoked.
- A shared-connection mailbox never exceeds its mailbox-owned binding's current rights.
- A mailbox admin can unlink but cannot read or mutate another user's private connection credential.
- A service account in personal-provider mode may act only through its own verified provider connection; delegated interactive execution uses the delegated user's binding.
- A writer moves messages between existing folders but cannot create, rename, or delete remote folders without `admin`.

### Shared-folder scenarios

- Discover multiple namespace roots with different prefixes and delimiters.
- Select and synchronize only one shared subtree without exposing personal folders.
- Represent two principals' materially different readable subtrees as separate Cloud mailboxes rather than partial views of one mailbox.
- Read-only, flag-only, insert, move, delete, and folder-administration ACL combinations.
- ACL extension absent with conservative capability fallback.
- Shared root renamed, removed, or revoked after initial synchronization.
- A new child folder appears without being subscribed and is discovered and synchronized automatically under the selected root.
- A folder rename leaves the old provider subscription unchanged; Cloud reconciles the folder identity and repairs subscriptions only through a separate idempotent action.
- `NOTIFY` absent or disconnected still converges through scheduled namespace, `LIST`, subscription, and rights discovery.
- `NOTIFY` registers binding-specific `subtree` or explicit `mailboxes` roots; `selected` contains message events only, and rejected or overflowed registration falls back to reconciliation.
- An ACL change makes a folder newly listable or removes list rights; discovery updates the projection without manual mailbox re-onboarding.
- Two authenticated principals expose the same path without unsafe automatic deduplication, then explicitly link to one mailbox after verification.
- One canonical folder maps to different binding-specific namespace paths and subscription states, and each resolved operation uses the correct locator.
- Interactive actions select only the actor's private binding in personal-provider mode.
- Background sync may elect another verified binding, but actor mutations and sends never borrow it.
- Revoking the current leader binding fails over at a committed batch boundary while retaining one remote resource and cursor history.
- Reply selects the functional identity while SMTP authenticates as the personal principal.
- Interactive `actor` authentication never falls back to a mailbox or another actor binding; `mailbox` authentication never borrows a user's private binding; autonomous `pool` sending selects only a binding verified for the exact identity.
- Sent copy lands in the configured shared Sent folder without duplication.

### Connector parity scenarios

- The same portable query and command contracts pass against generic IMAP, JMAP, Graph, and Gmail fixtures.
- Connector-specific IDs never escape into mailbox APIs, workflow definitions, or AI tools.
- Capability loss selects the documented fallback or returns one typed unsupported result.
- Replacing an IMAP binding with JMAP for the same mailbox requires no domain-data migration.

### Conversation scenarios

- Provider-native thread IDs group an original message and replies without duplicate placements.
- The opaque conversation ID remains stable and distinct from optional human references used in search and templates.
- `References` and `In-Reply-To` group replies when no provider thread ID exists.
- Missing or malformed headers use the conservative subject, participant, and time fallback without merging unrelated mail.
- Duplicate `Message-ID` values remain separate when other evidence disagrees.
- Manual merge and split survive reindexing and connector replacement and remain audited.
- Merge retains secondary references as searchable aliases; split never assigns the same reference to both conversations.
- A visible reference with matching participants may recover a broken thread; a reference without participant evidence only suggests a possible match.
- Recognized quoted history is collapsed visually while raw message content remains unchanged.
- Selecting lines from a history message inserts an attributed quote at the current reply cursor and produces correct plain-text `>` and HTML quote output.
- Received attachments remain attached to their source message; outgoing uploads remain attached to the active draft and never appear in one ambiguous drawer.
- Reply all excludes active sender and actor addresses, deduplicates recipients, and exposes the final To and Cc lists before sending.
- Forward starts without recipients, uses the selected message rather than the entire conversation, and lets the sender exclude original non-inline attachments.
- New, reply, reply-all, and forward composers use Send, Reply, Reply all, and Forward respectively as their primary action on every editing surface.
- Attachment groups retain a visible origin label in normal reader and composer states.
- The Details badge equals unread internal comments and disappears when no unread comments remain.
- Hiding and restoring the conversation list preserves the selected conversation, reader scroll position, draft, uploads, and permissions.
- New, reply, reply-all, and forward drafts retain their intent while inline, full-size, and pop-out surfaces edit one revision-safe draft and cannot send duplicate revisions.
- Draft text survives navigation, reload, browser restart, an interrupted autosave, and an offline interval without creating empty server drafts or duplicate editing sessions.
- Direct and resumable attachment uploads use the same durable upload state machine. Sending is rejected while an upload is incomplete, cancellation is retry-safe, and abandoned upload bytes are removed by bounded background cleanup.
- Readers can inspect mailbox drafts and request review without editing; writers can take over and send. Autosave does not notify the mailbox or flood user-facing activity.
- A stale editor preserves its local text as a recovery copy, while an explicit takeover and the first successful idempotent send make older surfaces read-only.
- A Cloud draft appears in the provider Drafts mailbox; a provider-created draft is imported; independent Cloud and external edits produce explicit conflict copies rather than silent last-write-wins behavior.
- Replacing an IMAP draft snapshot records the new UID before retiring the prior snapshot. Failure between those operations is reconciled without losing the accepted Cloud revision.
- Remote deletion soft-discards an unchanged projected draft but never deletes a newer Cloud revision. External-client activity is attributed only as precisely as the provider binding permits.
- Two collaborators add comments, replies, edits, mentions, and deletion tombstones concurrently without losing revisions.
- Internal comments remain in the Details panel and never appear as a mode in any mail composer.

### Workflow scenarios

Implemented verification covers:

- strict canonical YAML, source diagnostics, catalog binding, recursive conditions, `if`, `switch`, and Mail rejection of `forEach`;
- immutable version creation, expected-version activation/deactivation, metadata outside YAML, and authorization snapshots;
- read-only preflight, hydration requirements, frozen source preconditions, stale preflight rejection, target/effect budgets, keyset materialization, and automatic restart recovery;
- direct, one-shot, backfill, and durable dry-run records with paginated target progress, API/CLI cancellation, permission revocation, and restored step outcomes;
- durable keyword/move commands, transactional assignment/status actions, waiting, dependency wakeup, lease fencing, recovery, and `needs_attention`;
- deduplicated live incremental `messageReceived` delivery, historical-import suppression, revoked-actor skips, expired-trigger-claim recovery, and revision-fenced schedule slots.

Remaining product scenarios include pause/resume and targeted retry, workflow UI, richer action coverage, automatic replies, temporal policies, AI decisions, and generated bulk plans.

### Scale scenarios

- 20,000-message everyday mailbox.
- 100,000-message large mailbox.
- Multi-mailbox deployment with bounded connections and concurrent backfills.
- Search during active body indexing.
- Native FTS and `pg_textsearch` with equivalent match and permission semantics.

### Provisional targets

Targets require a documented reference environment before they become release gates.

- Warm list queries: p95 below 150 ms at 100,000 messages.
- Warm structured search: p95 below 500 ms at 100,000 messages.
- Local UI feedback after a command: below 100 ms.
- Durable collaboration update visible to another active client: below 1 second under normal load.
- No worker buffers an entire large attachment in memory.
- Every backfill and reindex can pause, resume, and recover after process restart.

## Delivery plan

The slices expose value incrementally while preserving the final architecture.

Slices 1 through 7 form the complete generic IMAP/SMTP product path. Slices 8 and 9 improve provider fidelity through the same contracts; they do not unlock Cloud search, collaboration, workflows, AI, or command-first UX that was withheld from IMAP users.

### 1. Foundation contracts

- Mail package, schema, mailbox resource adapter, private provider connections, mailbox-owned remote resources and sync state, provider binding pool and states, connection policies, encrypted credential fields, sender identities, and capability model.
- Central `resolveMailExecution` contract, command binding pinning, sync-leader lease, fencing token, and failover rules.
- Provider-neutral remote account, container, message-reference, cursor, command, submission, and error contracts.
- Conversation grouping, durable thread overrides, comments, reference schemes, response schedules, and atomic reference allocation.
- Connector conformance harness and protocol fixtures.
- Domain query/command contracts used by API and CLI.

Success: connect a test mailbox, discover remote accounts and roots, persist a resumable connector cursor, and prove that Cloud permission cannot exceed the selected binding's current remote rights.

### 2. Complete IMAP onboarding, sync, and search

- Email-first setup with provider presets, OAuth where available, RFC 6186, Thunderbird-style autoconfiguration, and compact manual fallback.
- Parallel IMAP/SMTP verification, remembered folder mapping, shared-subtree selection, and sender-identity verification.
- Staged recent-first sync, body and attachment hydration into PostgreSQL, namespace/folder/subscription discovery, ACL reconciliation, extension fallbacks, and repair.
- Native PostgreSQL search, structured AST, keyset pagination, and saved views.
- Optional `pg_textsearch` capability and health checks.

Success: a generic IMAP account is usable without expert protocol knowledge, and a 100,000-message fixture remains searchable during resumable backfill with no permission leakage.

### 3. Core mail operations

- Folder tree, dense one-line list, threaded conversation view, quote collapsing, selected-text reply quoting, manual merge/split, flags, keywords, move, archive, trash, compose, reply, drafts, multiple verified sender identities, send, Undo Send, and Scheduled Send.
- Safe HTML rendering plus received attachments on their source message and outgoing attachments in their draft composer.
- Provider-aware Sent behavior and ambiguous-outcome reconciliation.

Success: generic IMAP/SMTP delivers the complete portable mail-operation set; all portable actions appear correctly in a second mail client and survive injected crashes.

### 4. Collaboration

- Assignment, watchers, open/waiting/done, reminders, chronological comment chat, mentions, activity, presence, and shared draft revisions.
- Mine, Unassigned, Waiting, Done, and Recently Active views.

Success: two users can triage, comment, mention, draft, and reply without silent conflicts, with complete actor-attributed history and no risk of sending an internal comment externally.

### 5. Deterministic workflows

- Canonical shared-kernel YAML, validation/binding, immutable Mail versions, run history, preflight, and deterministic actions.
- Live `messageReceived`, revision-fenced schedules, direct/one-shot/backfill/dry-run execution, effect budgets, durable waiting, and fenced recovery.
- Next: richer run controls, visual editor, temporal policies, and guarded automatic replies.

Current success: a non-AI workflow can add/remove keywords, move mail, assign conversations, and change work state for live or historical targets with version-pinned preflight, current authorization, idempotent effects, recovery, and audit. The broader automatic-reply success criterion remains future scope.

### 6. AI decisions and agents

- Structured AI workflow nodes, caching, error branches, and cost preview.
- Mailbox AI resource, tools, approval policies, summaries, labels, and suggested drafts.
- Natural-language bulk-plan generation with immutable approval and optional conversion to a recurring rule.
- CLI/service-account workflows and initial Mail skills.

Success: an agent can search, classify, assign, draft, and execute a bounded mailbox-reorganization plan with current permissions; interactive agent send remains approval-bound and fully audited.

### 7. Product-speed pass

- Command registry, configurable shortcuts, focus preservation, prefetch, Split view templates, toggleable conversation list, combined Details panel, full-size and pop-out composer, shared snippets, and keyboard/pointer parity.
- Performance and accessibility gates.

Success: repeated triage is stable, measurable, and usable without a mouse or memorized shortcuts.

### 8. JMAP enhanced connector

- Implement the same connector contract with JMAP Core, Mail, Submission, push, and server-exposed rights.
- Validate Stalwart Group inboxes and one independent JMAP provider.
- Preserve mailbox, collaboration, search, workflow, command, and AI data while switching bindings.

Success: an existing Cloud mailbox can use JMAP without migration and gains state-based sync, stable IDs, push, and native submission where advertised.

### 9. Provider-native connectors

- Add Microsoft Graph for shared mailboxes, delegated access, delta sync, and separate Full Access, Send As, and Send on Behalf semantics.
- Add Gmail API for native labels, threads, history sync, sender settings, and administrator-authorized Workspace access.
- Keep OAuth IMAP/SMTP available when it is the user's preferred or only supported path.

Success: provider-native capabilities improve fidelity without changing the feature vocabulary, permission model, or stored collaboration state.

## Alternatives

### Thin IMAP client

A thin client with a transient cache minimizes initial code but makes search, collaboration, agent access, and recovery depend on live IMAP latency. It does not meet the product goals.

### PostgreSQL as mail authority

Making PostgreSQL authoritative for current remote existence, placement, or flags would break compatibility with other clients and create two-way synchronization conflicts. The provider remains authoritative for portable current state; PostgreSQL durably retains imported content and owns Cloud-only collaboration state.

### JMAP-only first

JMAP offers cleaner change tracking, stable IDs, and native submission, but its deployment base is much smaller than IMAP and excludes Google and Microsoft consumer and enterprise mail APIs. JMAP remains an early enhanced connector, while generic IMAP/SMTP ships first as a complete product.

### IMAP-shaped domain model

Persisting UID, `UIDVALIDITY`, namespace paths, and SMTP assumptions directly in domain commands would simplify the first connector but force migrations and leaky APIs for JMAP, Graph, and Gmail. These values remain typed connector metadata behind provider-neutral references.

### Reuse Grids workflows directly

Grids workflows already provide durable execution patterns but their schema and runtime depend on Grids records, documents, permissions, and references. Direct reuse would couple app domains. Mail borrows the patterns and extracts shared code only after a second compatible runtime exists.

### Generic workflow platform now

A generic cross-app workflow platform would require an abstract type system, capability registry, permission algebra, and editor before Mail has one stable workflow. This is premature. The Mail decision tree stays intentionally typed and bounded.

### AI-only automation

An AI-only router makes ordinary filters expensive, nondeterministic, hard to audit, and unavailable during provider outages. Deterministic rules remain the default; AI handles semantic decisions that ordinary conditions cannot express.

### Dedicated ticket or responder subsystems

A separate ticket store would duplicate conversations, assignment, comments, activity, and search. A separate automatic-response engine would duplicate workflow conditions, templates, policies, runs, and audit. Human references and guarded automatic replies therefore remain typed conversation and workflow capabilities rather than separate product modes.

## References

- [IMAP4rev2, RFC 9051](https://www.rfc-editor.org/rfc/rfc9051.html)
- [CONDSTORE and QRESYNC, RFC 7162](https://www.rfc-editor.org/rfc/rfc7162.html)
- [IMAP MOVE, RFC 6851](https://www.rfc-editor.org/rfc/rfc6851.html)
- [IMAP UIDPLUS, RFC 4315](https://www.rfc-editor.org/rfc/rfc4315.html)
- [IMAP SPECIAL-USE, RFC 6154](https://www.rfc-editor.org/rfc/rfc6154.html)
- [IMAP namespace, RFC 2342](https://www.rfc-editor.org/rfc/rfc2342.html)
- [IMAP ACL, RFC 4314](https://www.rfc-editor.org/rfc/rfc4314.html)
- [IMAP LIST command extensions, RFC 5258](https://www.rfc-editor.org/rfc/rfc5258.html)
- [IMAP NOTIFY extension, RFC 5465](https://www.rfc-editor.org/rfc/rfc5465.html)
- [Using SRV records to locate email services, RFC 6186](https://www.rfc-editor.org/rfc/rfc6186.html)
- [SMTP, RFC 5321](https://www.rfc-editor.org/rfc/rfc5321.html)
- [Internet Message Format, RFC 5322](https://www.rfc-editor.org/rfc/rfc5322.html)
- [Recommendations for automatic responses, RFC 3834](https://www.rfc-editor.org/rfc/rfc3834.html)
- [JMAP Core, RFC 8620](https://www.rfc-editor.org/rfc/rfc8620.html)
- [JMAP Mail, RFC 8621](https://www.rfc-editor.org/rfc/rfc8621.html)
- [JMAP Sharing, RFC 9670](https://www.rfc-editor.org/rfc/rfc9670.html)
- [JMAP Mail Sharing draft](https://datatracker.ietf.org/doc/draft-ietf-jmap-mail-sharing/)
- [ImapFlow documentation](https://imapflow.com/docs/)
- [Nodemailer documentation](https://nodemailer.com/)
- [MailParser documentation](https://nodemailer.com/extras/mailparser)
- [Thunderbird automatic account configuration](https://wiki.mozilla.org/Thunderbird:Autoconfiguration)
- [Stalwart email protocol overview](https://stalw.art/docs/email/)
- [Stalwart Group principals](https://stalw.art/docs/auth/principals/group/)
- [Stalwart mailing lists](https://stalw.art/docs/email/management/mailing-lists/)
- [Microsoft shared-mailbox permissions](https://learn.microsoft.com/en-us/exchange/collaboration/shared-mailboxes/create-shared-mailboxes)
- [Microsoft Graph shared sending](https://learn.microsoft.com/en-us/graph/outlook-send-mail-from-other-user)
- [Gmail delegation](https://support.google.com/mail/answer/138350)
- [Google Groups Collaborative Inbox](https://support.google.com/a/users/answer/10375787)
- [Gmail API overview](https://developers.google.com/workspace/gmail/api/guides)
- [pg_textsearch](https://github.com/timescale/pg_textsearch)
- [Superhuman Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005619081101-Default-Split-Inbox)
- [Superhuman shared conversations](https://help.superhuman.com/hc/en-us/articles/46005593675917-Shared-Conversations-and-Team-Comments)
- [Superhuman MCP server](https://help.superhuman.com/hc/en-us/articles/46005696690317-Superhuman-Mail-MCP-Server)
- [Thunderbird identities](https://support.mozilla.org/en-US/kb/using-identities)
- [University of Ulm email service and Shared Folders](https://www.uni-ulm.de/einrichtungen/kiz/service-katalog/e-mail-kalender-zusammenarbeit/e-mail/)
- [Cloud AI resource helper](../packages/cloud/src/ai/resource.ts)
- [Cloud AI tool and approval helper](../packages/cloud/src/ai/tools.ts)
- [Cloud Liquid rendering helper](../packages/cloud/src/shared/template-rendering.ts)
- [Grids workflow DSL](../packages/grids/src/workflows/dsl.ts)
