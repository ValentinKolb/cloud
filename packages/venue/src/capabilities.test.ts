import { describe, expect, test } from "bun:test";
import {
  type CapabilityActionDefinition,
  type CapabilityExecutionContext,
  type CapabilityQueryDefinition,
  capabilityResultSchema,
  type User,
} from "@valentinkolb/cloud/contracts";
import { sql } from "bun";
import { venueCapabilities } from "./capabilities";
import { VenueListDataSchema } from "./capability-contracts";

const testUser = (id: string, suffix: string): User => ({
  id,
  uid: `venue-capability-${suffix}`,
  roles: ["user", "local", "local/user"],
  provider: "local",
  profile: "user",
  givenname: "Venue",
  sn: "Capability",
  displayName: "Venue Capability",
  mail: `venue-capability-${suffix}@example.test`,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: null,
});

const userContext = (user: User): CapabilityExecutionContext => ({
  actor: { kind: "user", user },
  accessSubject: { type: "user", userId: user.id },
  user,
  signal: new AbortController().signal,
});

test("keeps shift commitments on fresh approval", () => {
  const rememberable = (Object.values(venueCapabilities.actions) as CapabilityActionDefinition[]).filter(
    (action) => action.approval === "rememberable",
  );
  expect(rememberable).toEqual([]);
});

const invokeQuery = (localId: string, input: unknown, context: CapabilityExecutionContext) => {
  const operation = (venueCapabilities.queries as unknown as Readonly<Record<string, CapabilityQueryDefinition>>)[localId];
  if (!operation) throw new Error(`Missing Venue query ${localId}`);
  const parsed = operation.input.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid test input for ${localId}: ${parsed.error.message}`);
  return Promise.resolve(operation.run(parsed.data, context)).then((result) => {
    if (result.ok) {
      const validated = capabilityResultSchema(operation.data).safeParse(result.data);
      if (!validated.success) throw new Error(`Invalid test result for ${localId}: ${validated.error.message}`);
    }
    return result;
  });
};

const invokeAction = (localId: string, input: unknown, context: CapabilityExecutionContext) => {
  const operation = (venueCapabilities.actions as unknown as Readonly<Record<string, CapabilityActionDefinition>>)[localId];
  if (!operation) throw new Error(`Missing Venue action ${localId}`);
  const parsed = operation.input.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid test input for ${localId}: ${parsed.error.message}`);
  return Promise.resolve(operation.run(parsed.data, context)).then((result) => {
    if (result.ok) {
      const validated = capabilityResultSchema(operation.data).safeParse(result.data);
      if (!validated.success) throw new Error(`Invalid test result for ${localId}: ${validated.error.message}`);
    }
    return result;
  });
};

const canUseDatabase = async (): Promise<boolean> => {
  try {
    const [row] = await sql<{ venues: string | null; users: string | null }[]>`
      SELECT to_regclass('venue.venues')::text AS venues, to_regclass('auth.users')::text AS users
    `;
    return Boolean(row?.venues && row.users);
  } catch {
    return false;
  }
};

const futureDateForWeekday = (weekday: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const postgresTest = (await canUseDatabase()) ? test : test.skip;

describe("Venue capabilities", () => {
  test("declares the curated agent surface", () => {
    expect(venueCapabilities.protocolVersion).toBe(1);
    expect(Object.keys(venueCapabilities.types ?? {}).sort()).toEqual(["assignment", "shift", "venue"]);
    expect(Object.keys(venueCapabilities.queries ?? {}).sort()).toEqual([
      "assignment.mine",
      "feedback.summary",
      "shift.list",
      "venue.get",
      "venue.list",
      "venue.search",
      "venue.status",
    ]);
    expect(Object.keys(venueCapabilities.actions ?? {}).sort()).toEqual([
      "assignment.cancel",
      "assignment.signup",
      "assignment.signup_free",
    ]);
    expect(venueCapabilities.actions?.["assignment.cancel"]?.destructive).toBe(true);
    expect(venueCapabilities.actions?.["assignment.cancel"]?.review).toBeFunction();
    expect(venueCapabilities.actions["assignment.signup"].review).toBeFunction();
    expect(venueCapabilities.actions["assignment.signup_free"].review).toBeFunction();
    expect(
      venueCapabilities.queries["shift.list"].input.safeParse({
        venueId: crypto.randomUUID(),
        startDate: "2026-02-30",
        days: 1,
        limit: 25,
      }).success,
    ).toBeFalse();
  });

  test("accepts item-local links for navigable Venue lists", () => {
    const venueId = crypto.randomUUID();
    const links = [{ rel: "open" as const, href: `/app/venue/${venueId}` }];
    expect(
      VenueListDataSchema.safeParse([
        {
          id: venueId,
          slug: "venue",
          name: "Venue",
          icon: "ti ti-building",
          description: null,
          timezone: "Europe/Berlin",
          openMode: "regular",
          signupMode: "both",
          publicEnabled: true,
          feedbackEnabled: true,
          permission: "read",
          createdAt: "2026-08-04T00:00:00.000Z",
          updatedAt: "2026-08-04T00:00:00.000Z",
          links,
        },
      ]).success,
    ).toBeTrue();
  });

  postgresTest(
    "supports safe discovery, status, shift, assignment, and feedback workflows",
    async () => {
      const suffix = crypto.randomUUID();
      const venueId = crypto.randomUUID();
      const publicVenueId = crypto.randomUUID();
      const templateId = crypto.randomUUID();
      const secondTemplateId = crypto.randomUUID();
      const [userRow] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail)
      VALUES (${`venue-capability-${suffix}`}, 'local', 'user', 'Venue capability test', ${`venue-capability-${suffix}@example.test`})
      RETURNING id
    `;
      const [otherUserRow] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail)
      VALUES (${`venue-capability-other-${suffix}`}, 'local', 'user', 'Venue capability other', ${`venue-capability-other-${suffix}@example.test`})
      RETURNING id
    `;
      if (!userRow || !otherUserRow) throw new Error("Failed to create Venue capability users");
      const user = testUser(userRow.id, suffix);
      const context = userContext(user);
      const otherContext = userContext(testUser(otherUserRow.id, `other-${suffix}`));
      const shiftDate = futureDateForWeekday(1);
      let accessId: string | null = null;

      try {
        await sql`
        INSERT INTO venue.venues (id, slug, name, description, timezone, signup_mode, public_enabled, feedback_enabled)
        VALUES (${venueId}::uuid, ${`agent-venue-${suffix}`}, 'Agent Venue', 'Private capability fixture', 'Europe/Berlin', 'both', false, true)
      `;
        await sql`
        INSERT INTO venue.venues (id, slug, name, description, timezone, public_enabled)
        VALUES (${publicVenueId}::uuid, ${`public-agent-venue-${suffix}`}, 'Public Agent Venue', 'Public capability fixture', 'Europe/Berlin', true)
      `;
        const [access] = await sql<{ id: string }[]>`
        INSERT INTO auth.access (user_id, permission) VALUES (${user.id}::uuid, 'write') RETURNING id
      `;
        if (!access) throw new Error("Failed to create Venue capability access");
        accessId = access.id;
        await sql`INSERT INTO venue.venue_access (venue_id, access_id) VALUES (${venueId}::uuid, ${access.id}::uuid)`;
        await sql`
        INSERT INTO venue.opening_rules (venue_id, weekday, start_time, end_time, note)
        VALUES (${venueId}::uuid, 1, '09:00', '17:00', 'Capability hours')
      `;
        await sql`
        INSERT INTO venue.shift_templates (id, venue_id, weekday, title, start_time, end_time, min_people, max_people, active)
        VALUES
          (${templateId}::uuid, ${venueId}::uuid, 1, 'Agent shift', '10:00', '11:00', 1, 2, true),
          (${secondTemplateId}::uuid, ${venueId}::uuid, 1, 'Second agent shift', '10:00', '11:00', 1, 2, true)
      `;
        await sql`
        INSERT INTO venue.feedback_entries (venue_id, rating, comment)
        VALUES (${venueId}::uuid, 5, 'Raw comment must not be exposed')
      `;

        const search = await invokeQuery("venue.search", { query: "Agent Venue", tags: [], limit: 10 }, context);
        expect(search.ok && search.data.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ ref: { type: "venue.venue", id: venueId } }),
            expect.objectContaining({ ref: { type: "venue.venue", id: publicVenueId } }),
          ]),
        );
        const list = await invokeQuery("venue.list", { limit: 25 }, context);
        expect(list.ok && list.data.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: venueId,
              links: [{ rel: "open", href: `/app/venue/${venueId}` }],
            }),
          ]),
        );
        expect(list.ok && list.data.data).toEqual([expect.objectContaining({ id: venueId, permission: "write" })]);
        const hiddenList = await invokeQuery("venue.list", { limit: 25 }, otherContext);
        expect(hiddenList.ok && hiddenList.data.data).toEqual([]);

        const publicVenue = await invokeQuery("venue.get", { venueId: publicVenueId }, otherContext);
        expect(publicVenue.ok && publicVenue.data.data).toMatchObject({ id: publicVenueId, permission: null, publicEnabled: true });
        if (publicVenue.ok) {
          expect(publicVenue.data.data).not.toHaveProperty("icalToken");
          expect(publicVenue.data.data).not.toHaveProperty("logoBase64");
          expect(publicVenue.data.links).toEqual([{ rel: "open", href: `/app/venue/public/public-agent-venue-${suffix}` }]);
        }
        const hiddenVenue = await invokeQuery("venue.get", { venueId }, otherContext);
        const missingVenue = await invokeQuery("venue.get", { venueId: crypto.randomUUID() }, otherContext);
        expect(hiddenVenue).toMatchObject({ ok: false, error: { code: "NOT_FOUND", status: 404 } });
        expect(missingVenue).toMatchObject({ ok: false, error: { code: "NOT_FOUND", status: 404 } });
        const status = await invokeQuery("venue.status", { venueId }, context);
        expect(status.ok && status.data.data).toMatchObject({ venueId, timezone: "Europe/Berlin" });

        const shifts = await invokeQuery("shift.list", { venueId, startDate: shiftDate, days: 1, limit: 25 }, context);
        expect(shifts.ok && shifts.data.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: `${templateId}:${shiftDate}`, assignedCount: 0, currentUserAssignmentId: null }),
            expect.objectContaining({ id: `${secondTemplateId}:${shiftDate}`, assignedCount: 0, currentUserAssignmentId: null }),
          ]),
        );
        if (shifts.ok) expect(shifts.data.data[0]).not.toHaveProperty("assignments");

        const firstShiftPage = await invokeQuery("shift.list", { venueId, startDate: shiftDate, days: 1, limit: 1 }, context);
        if (!firstShiftPage.ok || !firstShiftPage.data.page?.hasMore) throw new Error("Expected a second shift page");
        const secondShiftPage = await invokeQuery(
          "shift.list",
          { venueId, startDate: shiftDate, days: 1, limit: 1, cursor: firstShiftPage.data.page.nextCursor },
          context,
        );
        expect([firstShiftPage.data.data[0]?.id, secondShiftPage.ok ? secondShiftPage.data.data[0]?.id : undefined]).toEqual(
          [templateId, secondTemplateId].sort().map((id) => `${id}:${shiftDate}`),
        );

        const wrongDay = futureDateForWeekday(2);
        const rejectedWrongDay = await invokeAction("assignment.signup", { venueId, shiftId: `${templateId}:${wrongDay}` }, context);
        expect(rejectedWrongDay.ok).toBe(false);

        const deniedSignup = await invokeAction("assignment.signup", { venueId, shiftId: `${templateId}:${shiftDate}` }, otherContext);
        expect(deniedSignup.ok).toBe(false);

        const signupReview = venueCapabilities.actions["assignment.signup"].review;
        if (!signupReview) throw new Error("Template signup review missing");
        const reviewedSignup = await signupReview({ venueId, shiftId: `${templateId}:${shiftDate}` }, context);
        expect(reviewedSignup).toMatchObject({ ok: true, data: { message: "Sign up for Agent shift at Agent Venue." } });

        const signup = await invokeAction("assignment.signup", { venueId, shiftId: `${templateId}:${shiftDate}` }, context);
        expect(signup.ok && signup.data.data).toMatchObject({ venueId, templateId, venueName: "Agent Venue" });
        if (!signup.ok) throw new Error(signup.error.message);
        const assignedShifts = await invokeQuery("shift.list", { venueId, startDate: shiftDate, days: 1, limit: 25 }, context);
        expect(assignedShifts.ok && assignedShifts.data.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: `${templateId}:${shiftDate}`,
              assignedCount: 1,
              currentUserAssignmentId: signup.data.data.id,
            }),
          ]),
        );

        const freeStart = new Date(Date.now() + 14 * 86_400_000);
        freeStart.setUTCHours(14, 0, 0, 0);
        const freeEnd = new Date(freeStart.getTime() + 60 * 60 * 1_000);
        const freeSignupReview = venueCapabilities.actions["assignment.signup_free"].review;
        if (!freeSignupReview) throw new Error("Free signup review missing");
        const reviewedFreeSignup = await freeSignupReview(
          { venueId, startsAt: freeStart.toISOString(), endsAt: freeEnd.toISOString(), note: "Agent-created shift" },
          context,
        );
        expect(reviewedFreeSignup).toMatchObject({ ok: true, data: { message: "Create a free shift assignment at Agent Venue." } });
        const freeSignup = await invokeAction(
          "assignment.signup_free",
          { venueId, startsAt: freeStart.toISOString(), endsAt: freeEnd.toISOString(), note: "Agent-created shift" },
          context,
        );
        expect(freeSignup.ok && freeSignup.data.data).toMatchObject({ venueId, templateId: null, note: "Agent-created shift" });
        const duplicateFree = await invokeAction(
          "assignment.signup_free",
          { venueId, startsAt: freeStart.toISOString(), endsAt: freeEnd.toISOString(), note: "Duplicate" },
          context,
        );
        expect(duplicateFree.ok).toBe(false);

        const mine = await invokeQuery("assignment.mine", { venueId, days: 366, limit: 25 }, context);
        expect(mine.ok && mine.data.links).toEqual([{ rel: "open", href: `/app/venue/${venueId}/my-shifts` }]);
        expect(mine.ok && mine.data.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: signup.data.data.id, venueId }),
            expect.objectContaining({ id: freeSignup.ok ? freeSignup.data.data.id : "missing", venueId }),
          ]),
        );

        const feedback = await invokeQuery("feedback.summary", { venueId }, context);
        expect(feedback.ok && feedback.data.data).toMatchObject({ venueId, count: 1, averageRating: 5 });
        if (feedback.ok) expect(feedback.data.data).not.toHaveProperty("entries");

        const cancelled = await invokeAction("assignment.cancel", { venueId, assignmentId: signup.data.data.id }, context);
        expect(cancelled.ok && cancelled.data.data).toEqual({ assignmentId: signup.data.data.id, cancelled: true });
        const cancelledAgain = await invokeAction("assignment.cancel", { venueId, assignmentId: signup.data.data.id }, context);
        expect(cancelledAgain.ok).toBe(false);
      } finally {
        await sql`DELETE FROM venue.venues WHERE id IN (${venueId}::uuid, ${publicVenueId}::uuid)`;
        if (accessId) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
        await sql`DELETE FROM auth.users WHERE id IN (${user.id}::uuid, ${otherUserRow.id}::uuid)`;
      }
    },
    30_000,
  );

  postgresTest("confines resource-bound service accounts to their Venue", async () => {
    const suffix = crypto.randomUUID();
    const boundVenueId = crypto.randomUUID();
    const otherVenueId = crypto.randomUUID();
    const accessIds: string[] = [];
    const [serviceAccount] = await sql<{ id: string; createdAt: string }[]>`
      INSERT INTO auth.service_accounts (name, kind, app_id, resource_type, resource_id)
      VALUES ('Venue capability bound test', 'resource_bound', 'venue', 'venue', ${boundVenueId})
      RETURNING id::text AS id, created_at::text AS "createdAt"
    `;
    if (!serviceAccount) throw new Error("Failed to create resource-bound Venue fixture");

    try {
      await sql`
        INSERT INTO venue.venues (id, slug, name, public_enabled)
        VALUES
          (${boundVenueId}::uuid, ${`bound-agent-venue-${suffix}`}, 'Bound Agent Venue', false),
          (${otherVenueId}::uuid, ${`other-agent-venue-${suffix}`}, 'Other Public Agent Venue', true)
      `;
      for (const venueId of [boundVenueId, otherVenueId]) {
        const [access] = await sql<{ id: string }[]>`
          INSERT INTO auth.access (service_account_id, permission)
          VALUES (${serviceAccount.id}::uuid, 'admin'::auth.permission_level)
          RETURNING id::text AS id
        `;
        if (!access) throw new Error("Failed to create resource-bound Venue access");
        accessIds.push(access.id);
        await sql`INSERT INTO venue.venue_access (venue_id, access_id) VALUES (${venueId}::uuid, ${access.id}::uuid)`;
      }

      const context: CapabilityExecutionContext = {
        actor: {
          kind: "service_account",
          serviceAccount: {
            id: serviceAccount.id,
            name: "Venue capability bound test",
            kind: "resource_bound",
            status: "active",
            delegatedUserId: null,
            appId: "venue",
            resourceType: "venue",
            resourceId: boundVenueId,
            createdBy: null,
            createdAt: serviceAccount.createdAt,
          },
          delegatedUser: null,
          scopes: ["read"],
        },
        accessSubject: { type: "service_account", serviceAccountId: serviceAccount.id },
        user: null,
        signal: new AbortController().signal,
      };

      const listed = await invokeQuery("venue.list", { limit: 25 }, context);
      expect(listed.ok && listed.data.data).toEqual([expect.objectContaining({ id: boundVenueId, permission: "read" })]);
      const searched = await invokeQuery("venue.search", { query: "Agent Venue", tags: [], limit: 25 }, context);
      expect(searched.ok && searched.data.data).toEqual([expect.objectContaining({ ref: { type: "venue.venue", id: boundVenueId } })]);
      const crossVenue = await invokeQuery("venue.get", { venueId: otherVenueId }, context);
      expect(crossVenue).toMatchObject({ ok: false, error: { code: "FORBIDDEN", status: 403 } });
      const userOnlyAction = await invokeAction(
        "assignment.signup_free",
        {
          venueId: boundVenueId,
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        },
        context,
      );
      expect(userOnlyAction).toMatchObject({ ok: false, error: { code: "FORBIDDEN", status: 403 } });
    } finally {
      await sql`DELETE FROM venue.venues WHERE id IN (${boundVenueId}::uuid, ${otherVenueId}::uuid)`;
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
      await sql`DELETE FROM auth.service_accounts WHERE id = ${serviceAccount.id}::uuid`;
    }
  });
});
