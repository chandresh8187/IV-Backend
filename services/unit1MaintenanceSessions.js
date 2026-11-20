const {
  startNote,
  normalizeStartNote,
  maintenanceReason,
} = require("./unit1MaintenanceNote");
const { DateTime } = require("luxon");
const { normalizeRecord } = require("./unit1Maintenance");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const id = (value) => {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    fail("Invalid machine or maintenance ID.");
  return Number(value);
};
const iso = (value) =>
  value ? DateTime.fromSQL(value, { zone: "utc" }).toISO() : null;
const auditSession = (row) => ({
  ...row,
  started_at: iso(row.started_utc),
  ended_at: iso(row.ended_utc),
});
async function activeSessions(db) {
  const [rows] =
    await db.query(`SELECT s.id,s.machine_id,s.plan_id,s.original_input,m.name machine_name,m.code machine_code,p.title task,u.name started_by_name,
 DATE_FORMAT(s.started_at,'%Y-%m-%d %H:%i:%s.%f') started_utc FROM unit1_maintenance_sessions s JOIN unit1_machines m ON m.id=s.machine_id LEFT JOIN unit1_maintenance_plans p ON p.id=s.plan_id LEFT JOIN users u ON u.id=s.started_by WHERE s.active_machine_id IS NOT NULL ORDER BY s.started_at`);
  return rows.map(({ started_utc, original_input, ...r }) => ({
    ...r,
    started_at: iso(started_utc),
    start_note: startNote(original_input),
    maintenance_reason: maintenanceReason(original_input),
  }));
}
async function startMaintenance(db, body, actor) {
  const machine_id = id(body.machine_id),
    plan_id = body.plan_id ? id(body.plan_id) : null;
  const request_key = String(body.request_key || "");
  if (!/^[a-zA-Z0-9_-]{10,80}$/.test(request_key))
    fail("Invalid start request. Reopen the form.");
  const note = normalizeStartNote(body.note);
  const reason =
    body.maintenance_reason === undefined
      ? undefined
      : normalizeStartNote(body.maintenance_reason, "Maintenance reason");
  if (reason !== undefined && !reason) fail("Maintenance reason is required.");
  const original = JSON.stringify({
    machine_id,
    plan_id,
    ...(note ? { note } : {}),
    ...(reason !== undefined ? { maintenance_reason: reason } : {}),
  });
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await c.query(
      "SELECT id FROM unit1_maintenance_lock WHERE id=1 FOR UPDATE"
    );
    const [[prior]] = await c.query(
      "SELECT id,original_input FROM unit1_maintenance_sessions WHERE request_key=?",
      [request_key]
    );
    if (prior) {
      if (prior.original_input !== original)
        fail("Start request already used with different details.", 409);
      await c.commit();
      return { id: prior.id, machine_id };
    }
    const [runs] = await c.query(
      "SELECT id,status FROM unit1_production_runs WHERE machine_id=? AND status IN ('setup','running','paused') FOR UPDATE",
      [machine_id]
    );
    if (runs.some((r) => r.status === "running"))
      fail(
        "Pause production on this machine before starting maintenance.",
        409
      );
    const [[machine]] = await c.query(
      "SELECT id,is_active FROM unit1_machines WHERE id=? FOR UPDATE",
      [machine_id]
    );
    if (!machine?.is_active) fail("Choose an active machine.");
    const [[active]] = await c.query(
      "SELECT id FROM unit1_maintenance_sessions WHERE active_machine_id=? FOR UPDATE",
      [machine_id]
    );
    if (active)
      fail(
        "This machine is already under maintenance. Refresh to see it.",
        409
      );
    if (plan_id) {
      const [[plan]] = await c.query(
        "SELECT machine_id,is_active FROM unit1_maintenance_plans WHERE id=?",
        [plan_id]
      );
      if (!plan?.is_active || Number(plan.machine_id) !== machine_id)
        fail("Choose an active schedule for this machine.");
    }
    const [result] = await c.query(
      "INSERT INTO unit1_maintenance_sessions (machine_id,active_machine_id,plan_id,started_at,started_by,request_key,original_input) VALUES (?,?,?,UTC_TIMESTAMP(3),?,?,?)",
      [machine_id, machine_id, plan_id, actor, request_key, original]
    );
    const [[after]] = await c.query(
      "SELECT *,DATE_FORMAT(started_at,'%Y-%m-%d %H:%i:%s.%f') started_utc,DATE_FORMAT(ended_at,'%Y-%m-%d %H:%i:%s.%f') ended_utc FROM unit1_maintenance_sessions WHERE id=?",
      [result.insertId]
    );
    await c.query(
      "INSERT INTO unit1_maintenance_revisions (entity_type,entity_id,actor_user_id,reason,before_data,after_data) VALUES (?,?,?,?,NULL,?)",
      [
        "sessions",
        result.insertId,
        actor,
        "Maintenance started",
        JSON.stringify(auditSession(after)),
      ]
    );
    await c.commit();
    return { id: result.insertId, machine_id };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
function completionInput(body) {
  const normalized = normalizeRecord({
    ...body,
    machine_id: 1,
    plan_id: null,
    service_date: DateTime.now().setZone("Asia/Kolkata").toISODate(),
    maintenance_type: "preventive",
    technician: "Completion validation",
    downtime_minutes: null,
  });
  if (normalized.cost === null)
    fail("Enter the maintenance cost. Enter 0 only if there was no cost.");
  if (body.cost_basis != null && body.cost_basis !== "approximate")
    fail("Invalid maintenance cost basis.");
  return {
    ...(body.cost_basis ? { cost_basis: body.cost_basis } : {}),
    work_done: normalized.work_done,
    cost: normalized.cost,
    parts_used: normalized.parts_used,
    notes: normalized.notes,
  };
}
async function finishMaintenance(db, sessionId, body, actor) {
  const session_id = id(sessionId),
    input = completionInput(body);
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await c.query(
      "SELECT id FROM unit1_maintenance_lock WHERE id=1 FOR UPDATE"
    );
    const [[session]] = await c.query(
      "SELECT *,DATE_FORMAT(started_at,'%Y-%m-%d %H:%i:%s.%f') started_utc,DATE_FORMAT(ended_at,'%Y-%m-%d %H:%i:%s.%f') ended_utc FROM unit1_maintenance_sessions WHERE id=? FOR UPDATE",
      [session_id]
    );
    if (!session) fail("Maintenance not found.", 404);
    if (session.record_id) {
      if (
        session.completed_input !== JSON.stringify(input) ||
        Number(session.completed_by) !== Number(actor)
      )
        fail("Maintenance was already completed. Refresh its history.", 409);
      await c.commit();
      return {
        id: session.id,
        record_id: session.record_id,
        machine_id: session.machine_id,
      };
    }
    const [[clock]] = await c.query(
      "SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f') ended_utc"
    );
    const started = DateTime.fromSQL(session.started_utc, { zone: "utc" }),
      ended = DateTime.fromSQL(clock.ended_utc, { zone: "utc" });
    if (ended < started)
      fail(
        "Server clock is earlier than the maintenance start. Try again later.",
        409
      );
    const duration_seconds = Math.floor(ended.diff(started, "seconds").seconds);
    const [[user]] = await c.query("SELECT name FROM users WHERE id=?", [
      actor,
    ]);
    if (!user) fail("User not found.", 403);
    const value = normalizeRecord({
      ...input,
      machine_id: session.machine_id,
      plan_id: session.plan_id,
      service_date: ended.setZone("Asia/Kolkata").toISODate(),
      maintenance_type: maintenanceReason(session.original_input)
        ? "breakdown"
        : "preventive",
      technician: user.name,
      downtime_minutes: Math.floor(duration_seconds / 60),
    });
    const [record] = await c.query(
      `INSERT INTO unit1_maintenance_records (${Object.keys(value).join(
        ","
      )},request_key,original_input,created_by) VALUES (${Object.keys(value)
        .map(() => "?")
        .join(",")},?,?,?)`,
      [
        ...Object.values(value),
        `timed_session_${session.id}`,
        JSON.stringify(value),
        actor,
      ]
    );
    await c.query(
      "UPDATE unit1_maintenance_sessions SET active_machine_id=NULL,record_id=?,ended_at=?,duration_seconds=?,completed_by=?,completed_input=? WHERE id=?",
      [
        record.insertId,
        clock.ended_utc,
        duration_seconds,
        actor,
        JSON.stringify(input),
        session.id,
      ]
    );
    const [[after]] = await c.query(
      "SELECT *,DATE_FORMAT(started_at,'%Y-%m-%d %H:%i:%s.%f') started_utc,DATE_FORMAT(ended_at,'%Y-%m-%d %H:%i:%s.%f') ended_utc FROM unit1_maintenance_sessions WHERE id=?",
      [session.id]
    );
    const [[savedRecord]] = await c.query(
      "SELECT * FROM unit1_maintenance_records WHERE id=?",
      [record.insertId]
    );
    await c.query(
      "INSERT INTO unit1_maintenance_revisions (entity_type,entity_id,actor_user_id,reason,before_data,after_data) VALUES (?,?,?,?,?,?)",
      [
        "sessions",
        session.id,
        actor,
        "Maintenance completed",
        JSON.stringify(auditSession(session)),
        JSON.stringify(auditSession(after)),
      ]
    );
    await c.query(
      "INSERT INTO unit1_maintenance_revisions (entity_type,entity_id,actor_user_id,reason,before_data,after_data) VALUES (?,?,?,?,NULL,?)",
      [
        "records",
        record.insertId,
        actor,
        "Completed timed maintenance",
        JSON.stringify(savedRecord),
      ]
    );
    await c.commit();
    return {
      id: session.id,
      record_id: record.insertId,
      machine_id: session.machine_id,
      duration_seconds,
    };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
async function assertMachineAvailable(db, machineId) {
  const [[active]] = await db.query(
    "SELECT id FROM unit1_maintenance_sessions WHERE active_machine_id=? FOR UPDATE",
    [machineId]
  );
  if (active)
    fail(
      "This machine is under maintenance. Mark maintenance Done before starting or resuming production.",
      409
    );
}
module.exports = {
  activeSessions,
  startMaintenance,
  finishMaintenance,
  completionInput,
  assertMachineAvailable,
  iso,
};
