/**
 * Records page for `/app/grids/<base>/table/<table>`. Hono dispatches
 * this file when the URL ends at the table segment (no /view/ or /edit/
 * suffix). The actual render logic lives in the base-level page.tsx —
 * we re-export its default handler. The handler reads `tableId` from
 * `c.req.param("tableId")`, which Hono populates from the path-segment
 * directory name `[tableId]`.
 *
 * Why re-export rather than duplicate or compose: every records-page
 * surface (base home, ?table=, /table/<x>) shares the same SSR
 * pipeline (resolveLevel → list records → render). Having one handler
 * keeps the side-effects single-sourced; routing is purely a URL-shape
 * concern that Hono handles via the [param] folder names.
 */
export { default } from "../../page";
