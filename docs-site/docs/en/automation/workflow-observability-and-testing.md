---
title: Workflow observability and testing
navTitle: Workflow testing
section: Automation
order: 730
description: Inspect workflow runs and verify application actions without hiding runtime failures.
tags: [workflows, testing, observability]
updated: 2026-07-27
---

# Workflow observability and testing

Use the shared workflow operations data. Do not build a second run history in
the application.

## Inspect runtime state

The store exports queries for:

- runs and run families;
- run detail, steps, and timelines;
- stranded effects;
- undispatched events;
- application workflow health.

The shared operations UI is at `/admin/observability/workflows`.

The `cld admin workflows` commands cover runs, detail, effects, resolution,
events, and health.

Run states are:

`queued`, `running`, `waiting`, `succeeded`, `failed`, `canceled`, and
`needs_attention`.

Step states use a different vocabulary:

`running`, `completed`, `waiting`, `failed`, `needs_attention`, `terminal`,
`planned`, `unsupported`, `indeterminate`, and `canceled`.

Keep those terms distinct in application UI.

## Connect a trace port

The worker trace port receives run and step transitions. Events identify the
run and transition. Read current store state when a consumer needs detail.

Trace delivery is best effort. A trace failure never changes a run outcome.

Map workflow transitions to [Cloud tracing](/docs/en/platform/tracing) when the
deployment needs one operations timeline.

## Test action declarations

Test each action class at its boundary:

- config schema accepts and rejects the expected values;
- `authorize` refuses revoked access;
- `run` returns stable codes for domain failures;
- `plan` reports the same effect cost as execution;
- idempotent actions reuse `effectKey`;
- ambiguous actions reconcile every provider state;
- transactional actions use the supplied transaction.

## Test complete processes

Use the exports from `@valentinkolb/cloud/workflows/testing` to run shared
process fixtures.

The fixtures cover direct invocation, launchers, schedules, record events, and
bulk launchers. They verify the application integration against the same
workflow process contract.

Add database integration tests for publication, event deduplication, worker
recovery, waiting, budget limits, and scope deletion.

A dry run is useful product behavior, not a substitute for tests. Verify that
its planned outputs and issues match the real action declarations.
