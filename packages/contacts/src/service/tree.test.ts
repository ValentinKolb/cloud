import { describe, expect, test } from "bun:test";
import { buildContactTree, type ContactTreeRow } from "./tree";

const row = (overrides: Partial<ContactTreeRow>): ContactTreeRow => ({
  id: "root",
  label: null,
  first_name: null,
  last_name: null,
  company_name: null,
  job_title: null,
  parent_contact_id: null,
  ...overrides,
});

describe("buildContactTree", () => {
  test("builds a sorted hierarchy around the selected contact", () => {
    const tree = buildContactTree({
      bookId: "book-1",
      selectedId: "child-b",
      rows: [
        row({ id: "child-b", label: "Beta", parent_contact_id: "root" }),
        row({ id: "grandchild", first_name: "Charlie", parent_contact_id: "child-b" }),
        row({ id: "root", company_name: "Root Co" }),
        row({ id: "child-a", label: "Alpha", parent_contact_id: "root" }),
      ],
    });

    expect(tree).toEqual({
      bookId: "book-1",
      selectedId: "child-b",
      root: {
        id: "root",
        label: null,
        firstName: null,
        lastName: null,
        companyName: "Root Co",
        jobTitle: null,
        parentContactId: null,
        children: [
          {
            id: "child-a",
            label: "Alpha",
            firstName: null,
            lastName: null,
            companyName: null,
            jobTitle: null,
            parentContactId: "root",
            children: [],
          },
          {
            id: "child-b",
            label: "Beta",
            firstName: null,
            lastName: null,
            companyName: null,
            jobTitle: null,
            parentContactId: "root",
            children: [
              {
                id: "grandchild",
                label: null,
                firstName: "Charlie",
                lastName: null,
                companyName: null,
                jobTitle: null,
                parentContactId: "child-b",
                children: [],
              },
            ],
          },
        ],
      },
    });
  });

  test("returns null when selected contact is missing", () => {
    expect(buildContactTree({ bookId: "book-1", selectedId: "missing", rows: [row({ id: "root" })] })).toBeNull();
  });
});
