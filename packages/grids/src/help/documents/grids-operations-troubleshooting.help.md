---
id: grids-operations-troubleshooting
title: Operations & troubleshooting
icon: ti ti-bolt
description: Operations, live refresh, common symptoms, and what to check first.
order: 150
---
Operate a Grids base by keeping repeated work explicit, checking the current view and permissions first, and using workflows, documents, files, and live refresh only where they support the table model.

### Routine operations

- **Workflows:** Use direct invocation, saved scanner, bulk, or dashboard launchers, and automatic record events or schedules. Inspect run history before retrying failures.
- **HTTP requests:** Send explicit JSON payloads to another system. Receivers should handle duplicate sends safely.
- **Files:** Attach files to records. Store searchable metadata in normal fields when users need filters or exports.
- **Documents:** Generate PDFs from records. Grids stores document run metadata and renders the PDF bytes again when redownloaded.
- **Live refresh:** Tables, views, and dashboards can refresh after record changes. Current filters still decide what appears.

### Common checks

- **Chart source is missing:** Choose a grouped saved view or enter a grouped GQL query with at least one aggregation in the chart widget.
- **Record edit fails:** Reload the record and try again. A version mismatch usually means another user or tab changed it first.
- **Search misses a value:** Check whether the value is searchable. Use a filter for formula output, lookups, files, and exact rules.
- **Dashboard form will not submit:** Check the form permission and target table write permission. Dashboard access alone is not enough to write records.
- **Document preview fails:** Open the Source tab, check the rendered GQL, then use the Data tab to copy exact Liquid paths instead of guessing object names.

### HTTP request payload idea

```text
{
  "event": "record.created",
  "recordId": "019e...",
  "tableId": "32b8...",
  "changedFields": ["status"]
}
```
