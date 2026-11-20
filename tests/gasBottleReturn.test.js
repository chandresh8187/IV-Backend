const test = require("node:test"),
  assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const { normalizeReturn } = require("../services/gasBottleReturnService");
test("gas returns require a position, exact bottle, reason, stable request key and a real nonfuture time", () => {
  const body = {
    bottle_id: 2,
    request_key: "return_request_12345",
    reason: "Wrong position",
    returned_at: "2026-10-01 12:00:00",
  };
  const now = DateTime.fromISO("2026-10-02", { zone: "Asia/Kolkata" });
  assert.equal(normalizeReturn(2, body, now).bottle_id, 2);
  for (const change of [
    { bottle_id: 0 },
    { reason: "" },
    { request_key: "bad" },
    { returned_at: "2026-10-03 12:00:00" },
    { returned_at: "wrong" },
  ])
    assert.throws(() => normalizeReturn(2, { ...body, ...change }, now), {
      status: 400,
    });
  assert.throws(() => normalizeReturn(5, body, now), { status: 400 });
});
