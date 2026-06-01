import { sql } from "bun";
import icalGenerator from "ical-generator";
import type { Space, Priority } from "@/contracts";
import { coreSettings } from "@valentinkolb/cloud/services";

// ==========================
// iCal Service
// ==========================

type DbSpace = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  ical_token: string | null;
  created_at: Date;
  updated_at: Date;
};

type DbItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  all_day: boolean;
  deadline: Date | null;
  priority: string | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * Converts one space row into the shared `Space` type for iCal token lookup and feed metadata.
 */
const mapToSpace = (row: DbSpace): Space => ({
  id: row.id,
  name: row.name,
  description: row.description,
  color: row.color,
  icalToken: row.ical_token,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/**
 * Get a space by its iCal token
 */
export const getByToken = async (params: { token: string }): Promise<Space | null> => {
  const [row] = await sql<DbSpace[]>`
    SELECT id, name, description, color, ical_token, created_at, updated_at
    FROM spaces.spaces
    WHERE ical_token = ${params.token}
  `;
  return row ? mapToSpace(row) : null;
};

/**
 * Generate iCal content for a space
 */
export const generate = async (params: { spaceId: string; baseUrl: string }): Promise<string> => {
  // Get space
  const [space] = await sql<DbSpace[]>`
    SELECT id, name, description, color, ical_token, created_at, updated_at
    FROM spaces.spaces
    WHERE id = ${params.spaceId}
  `;

  if (!space) {
    throw new Error("Space not found");
  }

  // Get all non-completed items with time data
  const items = await sql<DbItem[]>`
    SELECT id, title, description, location, url, starts_at, ends_at, all_day, deadline, priority, created_at, updated_at
    FROM spaces.items
    WHERE space_id = ${params.spaceId}
      AND completed_at IS NULL
      AND (starts_at IS NOT NULL OR deadline IS NOT NULL)
    ORDER BY COALESCE(starts_at, deadline)
  `;

  // Create calendar
  const calendar = icalGenerator({
    name: space.name,
    description: space.description ?? undefined,
    prodId: {
      company: (await coreSettings.get<string>("app.name")) || "App",
      product: "Spaces",
      language: "DE",
    },
    timezone: "Europe/Berlin",
  });

  // Add events
  for (const item of items) {
    if (item.starts_at && item.ends_at) {
      // Event with time range
      calendar.createEvent({
        id: item.id,
        start: item.starts_at,
        end: item.ends_at,
        allDay: item.all_day,
        summary: item.title,
        description: item.description ?? undefined,
        location: item.location ?? undefined,
        url: item.url ?? `${params.baseUrl}/app/spaces/${space.id}?item=${item.id}`,
        created: item.created_at,
        lastModified: item.updated_at,
        priority: priorityToIcal(item.priority as Priority | null),
      });
    } else if (item.deadline) {
      // Todo/deadline as all-day event
      calendar.createEvent({
        id: item.id,
        start: item.deadline,
        allDay: true,
        summary: `[Deadline] ${item.title}`,
        description: item.description ?? undefined,
        location: item.location ?? undefined,
        url: item.url ?? `${params.baseUrl}/app/spaces/${space.id}?item=${item.id}`,
        created: item.created_at,
        lastModified: item.updated_at,
        priority: priorityToIcal(item.priority as Priority | null),
      });
    }
  }

  return calendar.toString();
};

/**
 * Convert priority to iCal priority (1-9, where 1 is highest)
 */
const priorityToIcal = (priority: Priority | null): number | undefined => {
  switch (priority) {
    case "urgent":
      return 1;
    case "high":
      return 3;
    case "medium":
      return 5;
    case "low":
      return 9;
    default:
      return undefined;
  }
};
