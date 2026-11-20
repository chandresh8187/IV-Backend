const test = require("node:test"),
  assert = require("node:assert/strict");
const { PDFParse } = require("pdf-parse");
const { maintenancePdf } = require("../services/unit1MaintenancePdf");

test("readable maintenance details keep record identity on continuation pages and retain the final fields", async () => {
  const bytes = await maintenancePdf({
    filters: {},
    summary: { valid_count: 2, cost_total: 500, downtime_total: 60 },
    rows: [
      {
        id: 41,
        machine_code: "M1",
        machine_name: "Former",
        service_date: "2026-10-29",
        maintenance_reason: "Bearing noise",
        work_done:
          "Detailed repair and verification steps. ".repeat(250) +
          " END OF REPAIR DETAILS",
        parts_used: "Bearing kit",
        cost: 500,
        cost_basis: "approximate",
        notes: "FINAL REMARK RETAINED",
      },
      {
        id: 42,
        machine_code: "P1",
        machine_name: "Punch machine",
        service_date: "2026-10-29",
        work_done: "Second record completed",
      },
    ],
  });
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    result.text = result.text.replace(/\s+/g, " ");
    assert.ok(result.total >= 3);
    assert.match(result.text, /END OF REPAIR DETAILS/);
    assert.match(result.text, /FINAL REMARK RETAINED/);
    assert.match(result.text, /Second record completed/);
    assert.match(result.text, /500 \(approx\.\)/);
    for (const page of result.pages) {
      assert.match(page.text, /COMPLETED MAINTENANCE REPORT/);
      assert.match(page.text, /#(41|42)/);
    }
  } finally {
    await parser.destroy();
  }
});
test("maintenance PDFs preserve unknown measurements, void reasons and multipage notes", async () => {
  const bytes = await maintenancePdf({
    filters: { from: "2026-01-01" },
    summary: {
      valid_count: 0,
      cost_total: null,
      cost_recorded: 0,
      downtime_total: null,
      downtime_recorded: 0,
    },
    rows: [
      {
        id: 1,
        service_date: "2026-01-02",
        machine_code: "M1",
        machine_name: "Former",
        task: "Inspect bearings",
        technician: "Service engineer",
        maintenance_type: "inspection",
        work_done: "Long maintenance description. ".repeat(180),
        parts_used: "Bearing kit",
        notes: "Verified end note",
        cost: null,
        downtime_minutes: null,
        recorded_at: "2026-01-02 12:30:00",
        recorded_by: "Manager",
        voided_at: "2026-01-03",
        void_reason: "Duplicate record",
        version: 2,
      },
    ],
  });
  const parser = new PDFParse({ data: bytes });
  try {
    const report = await parser.getText();
    report.text = report.text.replace(/\s+/g, " ");
    assert.ok(report.total > 1);
    assert.match(report.text, /Not recorded/);
    assert.match(report.text, /Duplicate record/);
    assert.match(report.text, /Verified end note/);
    assert.match(report.text, /CONTINUED/);
  } finally {
    await parser.destroy();
  }
  const schedule = await maintenancePdf(
    {
      asOf: "2026-01-02",
      summary: { overdue: 0, due_today: 0, due_soon: 0, unscheduled: 1 },
      plans: [],
      unscheduled: [{ code: "M2", name: "Punch machine" }],
    },
    "schedule"
  );
  const p = new PDFParse({ data: schedule });
  try {
    assert.match((await p.getText()).text, /Punch machine/);
  } finally {
    await p.destroy();
  }
});
