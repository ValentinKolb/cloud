import { expect } from "bun:test";
import { sql } from "bun";
import { postgresTest } from "../integration-test-utils";
import { migrate } from "../migrate";
import { create, get, update } from "./email-templates";

const uuid = () => Bun.randomUUIDv7();
const shortId = () => `B${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

postgresTest("email templates persist and update nested preview sample data", async () => {
  await migrate();
  const baseId = uuid();
  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId()}, 'Email template sample data')
  `;

  try {
    const created = await create(
      baseId,
      {
        name: "Loan agreement ready",
        subject: "Loan {{ data.loanNumber }}",
        html: "<p>Hello {{ data.requester.name }}</p>",
        sampleData: {
          loanNumber: "LOAN-42",
          requester: { name: "Alex Morgan" },
        },
      },
      null,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;
    expect((await get(created.data.id))?.sampleData).toEqual({
      loanNumber: "LOAN-42",
      requester: { name: "Alex Morgan" },
    });

    const updated = await update(created.data.id, { sampleData: { requester: { name: "Grace Hopper" } } }, null);
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw updated.error;
    expect(updated.data.sampleData).toEqual({ requester: { name: "Grace Hopper" } });
  } finally {
    await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
  }
});
