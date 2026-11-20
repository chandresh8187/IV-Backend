const { DateTime } = require("luxon");
const zone = "Asia/Kolkata";
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const parse = (value) =>
  value instanceof Date
    ? DateTime.fromJSDate(value).setZone(zone)
    : String(value || "").includes("T")
    ? DateTime.fromISO(value, { zone })
    : DateTime.fromSQL(String(value || ""), { zone });
function normalizeReturn(position, body = {}, now = DateTime.now()) {
  const position_no = Number(position),
    bottle_id = Number(body.bottle_id);
  if (!Number.isSafeInteger(position_no) || position_no < 1 || position_no > 4)
    fail("Select GAS-1 to GAS-4.");
  if (!Number.isSafeInteger(bottle_id) || bottle_id < 1)
    fail("Select the bottle currently in this position.");
  const request_key = String(body.request_key || "");
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(request_key))
    fail("Invalid return request. Reopen the position and try again.");
  const reason = String(body.reason || "").trim();
  if (!reason || reason.length > 255)
    fail("Enter a return reason of at most 255 characters.");
  const at = parse(body.returned_at);
  if (!at.isValid || at.toMillis() > now.toMillis())
    fail("Return time must be valid and cannot be in the future.");
  return {
    position_no,
    bottle_id,
    request_key,
    reason,
    returned_at: at.toFormat("yyyy-MM-dd HH:mm:ss"),
  };
}
async function returnBottleToStock(
  db,
  position,
  body,
  actor,
  now = DateTime.now()
) {
  const input = normalizeReturn(position, body, now);
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [bottles] = await c.query(
      "SELECT * FROM gas_bottles ORDER BY id FOR UPDATE"
    );
    const [[prior]] = await c.query(
      "SELECT * FROM gas_bottle_returns WHERE request_key=?",
      [input.request_key]
    );
    if (prior) {
      if (
        prior.original_input !== JSON.stringify(input) ||
        Number(prior.actor_user_id) !== Number(actor)
      )
        fail(
          "This return request has already been used with different details.",
          409
        );
      await c.commit();
      return {
        id: prior.id,
        was_used: Boolean(prior.was_used),
        position_no: input.position_no,
      };
    }
    const bottle = bottles.find(
      (b) => Number(b.position_no) === input.position_no
    );
    if (!bottle || Number(bottle.id) !== input.bottle_id)
      fail(
        "This position changed. Refresh Gas Stock before returning its bottle.",
        409
      );
    if (bottle.status !== "ready")
      fail(
        "Only a bottle that is ready to start can be returned. Running gas positions cannot be returned or removed.",
        409
      );
    const [runs] = await c.query(
      "SELECT * FROM gas_bottle_runs WHERE bottle_id=? ORDER BY started_at,id FOR UPDATE",
      [bottle.id]
    );
    const active = runs.filter((r) => !r.finished_at);
    if (active.length)
      fail("Bottle running state changed. Refresh and try again.", 409);
    if (
      runs.some(
        (r) =>
          parse(r.finished_at || r.started_at).toMillis() >
          parse(input.returned_at).toMillis()
      )
    )
      fail(
        "Return time cannot be before this bottle’s latest recorded gas use."
      );
    // A return is a stock transfer, not a measurement or an empty-bottle declaration.
    await c.query(
      "UPDATE gas_bottles SET status='filled',position_no=NULL WHERE id=?",
      [bottle.id]
    );
    const [[after]] = await c.query("SELECT * FROM gas_bottles WHERE id=?", [
      bottle.id,
    ]);
    const [result] = await c.query(
      "INSERT INTO gas_bottle_returns (request_key,bottle_id,position_no,run_id,was_used,returned_at,reason,actor_user_id,before_data,after_data,original_input) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        input.request_key,
        bottle.id,
        input.position_no,
        null,
        runs.length ? 1 : 0,
        input.returned_at,
        input.reason,
        actor,
        JSON.stringify({ bottle, runs }),
        JSON.stringify(after),
        JSON.stringify(input),
      ]
    );
    await c.commit();
    return {
      id: result.insertId,
      was_used: Boolean(runs.length),
      position_no: input.position_no,
    };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { normalizeReturn, returnBottleToStock };
