const test = require("node:test"),
  assert = require("node:assert/strict");
const { maintenancePdf } = require("../services/unit1MaintenancePdf");
const { PDFParse } = require("pdf-parse");
test("timed maintenance PDF includes automatic start, Done, duration, actual work and cost", async () => {
  const row = {
    id: 1,
    machine_code: "M1",
    machine_name: "Former",
    service_date: "2026-10-29",
    started_at: "2026-10-29T04:30:00.000Z",
    ended_at: "2026-10-29T05:01:30.000Z",
    duration_seconds: 1890,
    technician: "Supervisor",
    maintenance_reason: "Bearing noise",
    cost_basis: "approximate",
    start_note: "Earlier note retained",
    work_done: "Replaced bearing",
    cost: 450,
    parts_used: "Bearing kit",
    version: 1,
  };
  const data = {
    filters: {},
    summary: {
      valid_count: 1,
      cost_total: 450,
      cost_recorded: 1,
      downtime_total: 31.5,
      downtime_recorded: 1,
    },
    rows: [row],
  };
  const bytes = await maintenancePdf(data);
  const parser = new PDFParse({ data: bytes });
  try {
    const text = (await parser.getText()).text.replace(/\s+/g, " ");
    assert.match(text, /29[/]10[/]2026\s+10:00:00 AM/);
    assert.match(text, /29[/]10[/]2026\s+10:31:30 AM/);
    assert.match(text, /0h 31m 30s/);
    assert.match(text, /Replaced bearing/);
    assert.match(text, /Earlier note:[\s\S]*Earlier note retained/);
    assert.match(text, /Bearing noise/);
    assert.match(text, /450 \(approx.\)/);
  } finally {
    await parser.destroy();
  }
});
