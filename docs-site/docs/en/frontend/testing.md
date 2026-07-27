---
title: Frontend testing
navTitle: Frontend testing
section: Frontend
order: 900
description: Test server-rendered pages, interactive islands, navigation, and application states.
tags: [testing, frontend, accessibility]
updated: 2026-07-27
---

# Frontend testing

Test the boundary that owns each behavior.

## Test SSR pages

Request the route through Hono and inspect the response.

Cover:

- anonymous, allowed, and denied identities;
- resource permissions;
- query parsing and invalid values;
- empty, populated, and failed service results;
- canonical links and form actions;
- page title and essential content.

Verify denied records do not appear in HTML.

## Test islands

Test pure state and mapping functions without a browser when possible.

For DOM behavior, cover:

- initial serialized props;
- keyboard and pointer interaction;
- loading, success, error, abort, and retry;
- newer mutations replacing stale results;
- dialog close and focus behavior;
- cleanup of listeners, timers, and sockets.

Mock the typed API boundary. Do not mock the component's own state transitions.

## Test URL behavior

Verify parsing and link building together.

Test reload, copy and paste, Back, Forward, and browser-opened links. The server
must render the same selected resource and filters.

When navigation is enhanced, verify the fallback anchor produces the same
result without JavaScript.

## Test realtime recovery

Cover:

- subscribe from the SSR cursor;
- reconnect from the last applied cursor;
- duplicate events;
- cursor overflow and snapshot reload;
- access revocation;
- disposal on unmount.

Do not advance the stored cursor before an event is applied.

## Run a visual and accessibility pass

Check narrow and wide layouts in light and dark mode.

Complete the primary flow with the keyboard. Verify focus order, accessible
names, dialog focus return, status announcements, and contrast.

Use the shared [component catalog](/ui) as the expected behavior for platform
primitives.
