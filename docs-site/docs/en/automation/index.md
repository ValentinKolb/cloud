---
title: Automation
navTitle: Overview
section: Automation
order: 600
description: Choose between lifecycle work, distributed primitives, and durable workflows.
tags: [automation, jobs, workflows]
updated: 2026-07-27
---

# Automation

Choose the smallest runtime that preserves the work you cannot lose.

## Choose an execution model

| Need | Use |
| --- | --- |
| Start and stop a process-local loop | [Lifecycle work](/docs/en/automation/lifecycle-background-work) |
| Retry one process-local operation | [Retry](/docs/en/automation/jobs-and-queues#retry-an-operation) |
| Run one durable task with retries | [Jobs](/docs/en/automation/jobs-and-queues#run-a-job) |
| Distribute messages across workers | [Queues](/docs/en/automation/jobs-and-queues#use-a-queue) |
| Run recurring work | [Schedulers](/docs/en/automation/schedulers) |
| Replay events or stream live updates | [Topics and live events](/docs/en/automation/topics-and-live-events) |
| Coordinate app instances | [Coordination primitives](/docs/en/automation/coordination-primitives) |
| Let users define multi-step durable automation | [Workflow overview](/docs/en/automation/workflow-overview) |

Lifecycle callbacks belong to the Cloud application contract.

Retries, jobs, queues, schedules, topics, rate limits, mutexes, and ephemeral
state come from `@k2b/sync`. Distributed primitives use Valkey. These
primitives do not use the Cloud workflow tables.

The workflow kernel comes from `@valentinkolb/cloud/workflows`. It owns
versioned plans, runs, leases, outcomes, effects, and operator visibility.

The task page owns the reliability rules for its runtime. Use
[Workflow observability and testing](/docs/en/automation/workflow-observability-and-testing)
for workflow diagnostics, or the shared [Observability](/docs/en/operations/observability)
guide for application processes.
