const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePlan,
  normalizeRecord,
  decoratePlan,
} = require("../services/unit1Maintenance");
const plan = {
  machine_id: 1,
  title: "Lubricate bearings",
  interval_days: 30,
  first_due_date: "2026-10-28",
  remind_before_days: 3,
  priority: "high",
  instructions: "Use manual-approved lubricant",
  is_active: true,
};
const record = {
  machine_id: 1,
  plan_id: 1,
  service_date: "2026-10-25",
  maintenance_type: "preventive",
  technician: "Service engineer",
  work_done: "Replaced bearing",
  cost: "",
  downtime_minutes: "",
};
test("maintenance validates actual dates, optional measurements and schedule inputs", () => {
  assert.equal(normalizePlan(plan).interval_days, 30);
  assert.equal(normalizeRecord(record, "2026-10-28").cost, null);
  assert.equal(
    normalizeRecord({ ...record, cost: 0, downtime_minutes: 0 }, "2026-10-28")
      .cost,
    0
  );
  for (const b of [
    { interval_days: 0 },
    { first_due_date: "2026-02-30" },
    { remind_before_days: -1 },
    { priority: "unknown" },
    { is_active: "false" },
    { title: "" },
  ])
    assert.throws(() => normalizePlan({ ...plan, ...b }), { status: 400 });
  for (const b of [
    { service_date: "2026-10-29" },
    { service_date: "2026-02-30" },
    { cost: -1 },
    { cost: 1.234 },
    { downtime_minutes: 1.5 },
    { work_done: "" },
  ])
    assert.throws(() => normalizeRecord({ ...record, ...b }, "2026-10-28"), {
      status: 400,
    });
});
test("due status uses calendar days, leap years, reminder boundary and paused machines", () => {
  const p = { ...normalizePlan(plan), machine_active: 1 };
  assert.equal(decoratePlan(p, "2026-10-28").status, "due_today");
  assert.equal(decoratePlan(p, "2026-10-29").status, "overdue");
  assert.equal(decoratePlan(p, "2026-10-25").status, "due_soon");
  assert.equal(decoratePlan(p, "2026-10-24").status, "upcoming");
  assert.equal(
    decoratePlan({ ...p, machine_active: 0 }, "2026-10-28").status,
    "paused"
  );
  assert.equal(
    decoratePlan({ ...p, is_active: 0 }, "2026-10-28").status,
    "paused"
  );
  assert.equal(
    decoratePlan(
      { ...p, last_service_date: "2028-02-28", interval_days: 1 },
      "2028-02-28"
    ).next_due_date,
    "2028-02-29"
  );
});
