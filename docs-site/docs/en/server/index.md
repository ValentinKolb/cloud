---
title: Server requests
navTitle: Overview
section: Server
order: 200
description: Follow one request from the gateway to a typed response.
tags: [server, hono, requests]
updated: 2026-07-27
---

# Server requests

The gateway forwards a request to the application. The application's Hono
router then owns the request.

## Request path

| Layer | Responsibility |
| --- | --- |
| Gateway | Forward the original path to the registered service |
| App middleware | Load request context and apply transport policies |
| Route policy | Require an accepted caller or role |
| Validator | Convert untrusted input into typed values |
| Domain service | Check resource access and run business rules |
| Response helper | Convert `Result<T>` into JSON and a status code |

Authentication protects the route. The service still decides whether the caller
may read that item.

## Continue by task

| Task | Page |
| --- | --- |
| Mount middleware and choose the request context | [Request middleware](/en/docs/server/middleware) |
| Validate input and expose a typed endpoint | [Typed HTTP APIs](/en/docs/server/http) |
| Keep transport code separate from domain rules | [Services and Result](/en/docs/server/services-and-results) |
| Build stable list endpoints | [Pagination and filtering](/en/docs/server/pagination-and-filtering) |
| Declare the paths the gateway may forward | [Routes and discovery](/en/docs/build/routing) |
| Identify callers and enforce access | [Identity and access](/en/docs/identity) |
