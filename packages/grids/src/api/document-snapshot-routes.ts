import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, getDateConfig, jsonResponse, respond } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { CreateRecordSnapshotResponseSchema, RecordSnapshotListResponseSchema, RecordSnapshotSchema } from "../contracts";
import { gridsService } from "../service";
import { snapshotRelatedTableGuard, uuidParam } from "./documents-api-shared";
import { currentActorUserId, gateAt } from "./permissions";

export const createDocumentSnapshotRoutes = () =>
  new Hono<AuthContext>()
    .get(
      "/snapshots/by-record/:tableId/:recordId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List standalone record snapshots for a record",
        responses: {
          200: jsonResponse(RecordSnapshotListResponseSchema, "Record snapshots"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        const recordId = uuidParam(c, "recordId");
        if (!tableId || !recordId) return c.json({ message: "Record not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json({ items: await gridsService.document.listSnapshotsForRecord(tableId, recordId) });
      },
    )

    .post(
      "/snapshots/by-record/:tableId/:recordId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Create a standalone recursive record snapshot",
        responses: {
          200: jsonResponse(CreateRecordSnapshotResponseSchema, "Record snapshot"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        const recordId = uuidParam(c, "recordId");
        if (!tableId || !recordId) return c.json({ message: "Record not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const snapshot = await gridsService.document.createRecordSnapshot({
          baseId: table.baseId,
          tableId,
          recordId,
          actorId: currentActorUserId(c),
          canReadRelatedTable: snapshotRelatedTableGuard(c),
          dateConfig: await getDateConfig(c),
        });
        if (!snapshot.ok) return c.json({ message: snapshot.error.message }, snapshot.error.status);
        return c.json({ snapshot: snapshot.data });
      },
    )

    .get(
      "/snapshots/:snapshotId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Get a record snapshot",
        responses: {
          200: jsonResponse(RecordSnapshotSchema, "Record snapshot"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const snapshotId = uuidParam(c, "snapshotId");
        if (!snapshotId) return c.json({ message: "Record snapshot not found" }, 404);
        const snapshot = await gridsService.document.getSnapshot(snapshotId);
        if (!snapshot) return c.json({ message: "Record snapshot not found" }, 404);
        const gate = await gateAt(c, { baseId: snapshot.baseId, tableId: snapshot.tableId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json(await gridsService.document.filterSnapshotRelatedRecords(snapshot, snapshotRelatedTableGuard(c)));
      },
    );
