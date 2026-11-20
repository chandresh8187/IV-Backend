const {
  startNote,
  maintenanceReason,
  costBasis,
} = require("./unit1MaintenanceNote");
const { DateTime } = require("luxon");
const zone = "Asia/Kolkata";
const today = () => DateTime.now().setZone(zone).toISODate();
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const text = (value, label, max, required = false) => {
  const s = String(value ?? "").trim();
  if ((required && !s) || s.length > max)
    fail(
      `${label} ${
        required ? "is required and " : ""
      }must be at most ${max} characters.`
    );
  return s;
};
const integer = (v, label, min, max) => {
  const n = Number(v);
  if (
    !["string", "number"].includes(typeof v) ||
    String(v).trim() === "" ||
    !Number.isSafeInteger(n) ||
    n < min ||
    n > max
  )
    fail(`${label} must be ${min}–${max}.`);
  return n;
};
const date = (v, label) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ||
    !DateTime.fromISO(v, { zone }).isValid
  )
    fail(`${label} must be a valid date.`);
  return v;
};
function normalizePlan(b) {
  return {
    machine_id: integer(b.machine_id, "Machine", 1, Number.MAX_SAFE_INTEGER),
    title: text(b.title, "Task", 150, true),
    interval_days: integer(b.interval_days, "Interval days", 1, 3650),
    first_due_date: date(b.first_due_date, "First due date"),
    remind_before_days: integer(b.remind_before_days, "Reminder days", 0, 365),
    priority: ["normal", "high", "critical"].includes(b.priority)
      ? b.priority
      : fail("Choose a priority."),
    instructions: text(b.instructions, "Instructions", 10000),
    is_active:
      b.is_active === true || b.is_active === 1
        ? 1
        : b.is_active === false || b.is_active === 0
        ? 0
        : fail("Choose active or paused."),
  };
}
function normalizeRecord(b, asOf = today()) {
  const service_date = date(b.service_date, "Service date");
  if (service_date > asOf) fail("Service date cannot be in the future.");
  const cost = b.cost === "" || b.cost == null ? null : Number(b.cost);
  if (
    cost !== null &&
    (!["string", "number"].includes(typeof b.cost) ||
      String(b.cost).trim() === "" ||
      !Number.isFinite(cost) ||
      cost < 0 ||
      cost > 999999999999.99 ||
      Math.abs(cost * 100 - Math.round(cost * 100)) > 0.001)
  )
    fail("Cost must be a non-negative amount with at most 2 decimals.");
  return {
    machine_id: integer(b.machine_id, "Machine", 1, Number.MAX_SAFE_INTEGER),
    plan_id: b.plan_id
      ? integer(b.plan_id, "Schedule", 1, Number.MAX_SAFE_INTEGER)
      : null,
    service_date,
    maintenance_type: ["preventive", "breakdown", "inspection"].includes(
      b.maintenance_type
    )
      ? b.maintenance_type
      : fail("Choose a service type."),
    technician: text(b.technician, "Technician", 150, true),
    work_done: text(b.work_done, "Work done", 10000, true),
    parts_used: text(b.parts_used, "Parts", 10000),
    cost,
    downtime_minutes:
      b.downtime_minutes === "" || b.downtime_minutes == null
        ? null
        : integer(b.downtime_minutes, "Downtime minutes", 0, 5256000),
    notes: text(b.notes, "Notes", 10000),
  };
}
function decoratePlan(p, asOf = today()) {
  const next_due_date = p.last_service_date
    ? DateTime.fromISO(p.last_service_date, { zone })
        .plus({ days: p.interval_days })
        .toISODate()
    : p.first_due_date;
  const days = Math.round(
    DateTime.fromISO(next_due_date, { zone }).diff(
      DateTime.fromISO(asOf, { zone }),
      "days"
    ).days
  );
  return {
    ...p,
    next_due_date,
    days_until_due: days,
    status: p.in_progress
      ? "in_progress"
      : !p.is_active || !p.machine_active
      ? "paused"
      : days < 0
      ? "overdue"
      : days === 0
      ? "due_today"
      : days <= p.remind_before_days
      ? "due_soon"
      : "upcoming",
  };
}
async function overview(db, asOf = today()) {
  const [machines] = await db.query(
    "SELECT id,code,name,is_active FROM unit1_machines ORDER BY is_active DESC,name,id"
  );
  const [rows] =
    await db.query(`SELECT p.*,m.name machine_name,m.code machine_code,m.is_active machine_active,
    DATE_FORMAT(p.first_due_date,'%Y-%m-%d') first_due_date,
    (SELECT DATE_FORMAT(MAX(r.service_date),'%Y-%m-%d') FROM unit1_maintenance_records r WHERE r.plan_id=p.id AND r.voided_at IS NULL) last_service_date
    FROM unit1_maintenance_plans p JOIN unit1_machines m ON m.id=p.machine_id ORDER BY m.name,p.title,p.id`);
  const activeSessions =
    await require("./unit1MaintenanceSessions").activeSessions(db);
  const plans = rows.map((p) => {
    const { original_input, ...visible } = p;
    return decoratePlan(
      {
        ...visible,
        in_progress: activeSessions.some(
          (s) => Number(s.plan_id) === Number(p.id)
        ),
      },
      asOf
    );
  });
  const unscheduled = machines.filter(
    (m) =>
      m.is_active && !plans.some((p) => p.machine_id === m.id && p.is_active)
  );
  const summary = Object.fromEntries(
    [
      "overdue",
      "due_today",
      "due_soon",
      "upcoming",
      "paused",
      "in_progress",
    ].map((s) => [s, plans.filter((p) => p.status === s).length])
  );
  return {
    asOf,
    serverTime: DateTime.utc().toISO(),
    activeSessions,
    machines,
    plans,
    unscheduled,
    summary: {
      ...summary,
      unscheduled: unscheduled.length,
      under_maintenance: activeSessions.length,
    },
  };
}
async function mutate(db, kind, id, body, actor, voiding = false) {
  if (!["plans", "records"].includes(kind)) fail("Invalid entity.");
  if (id) integer(id, "ID", 1, Number.MAX_SAFE_INTEGER);
  const value = voiding
    ? null
    : kind === "plans"
    ? normalizePlan(body)
    : normalizeRecord(body);
  const reason = id
    ? text(body.reason, "Correction reason", 1000, true)
    : "Created";
  const key = id ? null : text(body.request_key, "Request key", 80, true);
  if (key?.startsWith("timed_session_"))
    fail("Reserved maintenance request key.");
  if (key && !/^[a-zA-Z0-9_-]{10,80}$/.test(key)) fail("Invalid request key.");
  const table = `unit1_maintenance_${kind}`;
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await c.query(
      "SELECT id FROM unit1_maintenance_lock WHERE id=1 FOR UPDATE"
    );
    let before;
    if (id) {
      [[before]] = await c.query(
        `SELECT *,${
          kind === "plans"
            ? "DATE_FORMAT(first_due_date,'%Y-%m-%d') first_due_date"
            : "DATE_FORMAT(service_date,'%Y-%m-%d') service_date"
        } FROM ${table} WHERE id=? FOR UPDATE`,
        [id]
      );
      if (!before) fail("Record not found.", 404);
      if (Number(body.version) !== before.version)
        fail("This record changed. Refresh and try again.", 409);
      if (kind === "records" && !voiding) {
        const [[timed]] = await c.query(
          "SELECT id FROM unit1_maintenance_sessions WHERE record_id=?",
          [id]
        );
        if (
          timed &&
          (value.machine_id !== before.machine_id ||
            value.service_date !== before.service_date ||
            value.downtime_minutes !== before.downtime_minutes)
        )
          fail(
            "The machine, completion date and elapsed time were recorded automatically and cannot be changed."
          );
      }
      if (before.voided_at) fail("A voided service cannot be edited.", 409);
      if (kind === "plans" && value.machine_id !== before.machine_id)
        fail("A schedule cannot be moved to another machine.");
    } else {
      const [[existing]] = await c.query(
        `SELECT id,original_input FROM ${table} WHERE request_key=?`,
        [key]
      );
      if (existing) {
        if (existing.original_input !== JSON.stringify(value))
          fail("Request key already used with different values.", 409);
        await c.commit();
        return { id: existing.id };
      }
    }
    if (value) {
      const [[machine]] = await c.query(
        "SELECT id,is_active FROM unit1_machines WHERE id=? FOR UPDATE",
        [value.machine_id]
      );
      if (!machine) fail("Machine not found.");
      if (!id && !machine.is_active)
        fail("Choose an active machine for new maintenance.");
      if (value.plan_id) {
        const [[plan]] = await c.query(
          "SELECT machine_id FROM unit1_maintenance_plans WHERE id=?",
          [value.plan_id]
        );
        if (!plan || plan.machine_id !== value.machine_id)
          fail("Schedule does not belong to this machine.");
      }
    }
    if (voiding)
      await c.query(
        `UPDATE ${table} SET voided_at=CURRENT_TIMESTAMP(3),void_reason=?,version=version+1 WHERE id=?`,
        [reason, id]
      );
    else if (id)
      await c.query(
        `UPDATE ${table} SET ${Object.keys(value)
          .map((k) => `${k}=?`)
          .join(",")},version=version+1 WHERE id=?`,
        [...Object.values(value), id]
      );
    else {
      const [result] = await c.query(
        `INSERT INTO ${table} (${Object.keys(value).join(
          ","
        )},request_key,original_input,created_by) VALUES (${Object.keys(value)
          .map(() => "?")
          .join(",")},?,?,?)`,
        [...Object.values(value), key, JSON.stringify(value), actor]
      );
      id = result.insertId;
    }
    const [[after]] = await c.query(`SELECT * FROM ${table} WHERE id=?`, [id]);
    await c.query(
      "INSERT INTO unit1_maintenance_revisions (entity_type,entity_id,actor_user_id,reason,before_data,after_data) VALUES (?,?,?,?,?,?)",
      [
        kind,
        id,
        actor,
        reason,
        before ? JSON.stringify(before) : null,
        JSON.stringify(after),
      ]
    );
    await c.commit();
    return { id };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
async function history(db, f = {}, pdf = false) {
  const where = [],
    args = [];
  if (f.machine_id) {
    where.push("r.machine_id=?");
    args.push(integer(f.machine_id, "Machine", 1, Number.MAX_SAFE_INTEGER));
  }
  if (f.from) {
    where.push("r.service_date>=?");
    args.push(date(f.from, "From date"));
  }
  if (f.to) {
    where.push("r.service_date<=?");
    args.push(date(f.to, "To date"));
  }
  if (f.from && f.to && f.from > f.to)
    fail("From date must be before To date.");
  if (f.state !== "all")
    where.push(
      f.state === "voided" ? "r.voided_at IS NOT NULL" : "r.voided_at IS NULL"
    );
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[summary]] = await db.query(
    `SELECT COUNT(*) total,COUNT(CASE WHEN r.voided_at IS NULL THEN 1 END) valid_count,SUM(CASE WHEN r.voided_at IS NULL THEN r.cost END) cost_total,COUNT(CASE WHEN r.voided_at IS NULL THEN r.cost END) cost_recorded,SUM(CASE WHEN r.voided_at IS NULL THEN COALESCE(s.duration_seconds/60,r.downtime_minutes) END) downtime_total,COUNT(CASE WHEN r.voided_at IS NULL THEN COALESCE(s.duration_seconds,r.downtime_minutes) END) downtime_recorded FROM unit1_maintenance_records r LEFT JOIN unit1_maintenance_sessions s ON s.record_id=r.id ${clause}`,
    args
  );
  if (pdf && summary.total > 2000)
    fail("Narrow the report to 2,000 service records or fewer.");
  const page = integer(f.page || 1, "Page", 1, 1000000),
    limit = pdf ? 2000 : 30;
  const [rows] = await db.query(
    `SELECT s.id session_id,s.original_input session_input,s.completed_input completion_input,s.duration_seconds,DATE_FORMAT(s.started_at,'%Y-%m-%d %H:%i:%s.%f') started_utc,DATE_FORMAT(s.ended_at,'%Y-%m-%d %H:%i:%s.%f') ended_utc,r.id,r.machine_id,r.plan_id,DATE_FORMAT(r.service_date,'%Y-%m-%d') service_date,r.maintenance_type,r.technician,r.work_done,r.parts_used,r.cost,r.downtime_minutes,r.notes,r.version,r.voided_at,r.void_reason,DATE_FORMAT(r.created_at,'%Y-%m-%d %H:%i:%s') recorded_at,m.name machine_name,m.code machine_code,p.title task,u.name recorded_by FROM unit1_maintenance_records r LEFT JOIN unit1_maintenance_sessions s ON s.record_id=r.id JOIN unit1_machines m ON m.id=r.machine_id LEFT JOIN unit1_maintenance_plans p ON p.id=r.plan_id LEFT JOIN users u ON u.id=r.created_by ${clause} ORDER BY r.service_date DESC,r.id DESC LIMIT ? OFFSET ?`,
    [...args, limit, pdf ? 0 : (page - 1) * limit]
  );
  return {
    rows: rows.map(
      ({
        started_utc,
        ended_utc,
        session_input,
        completion_input,
        ...row
      }) => ({
        ...row,
        start_note: startNote(session_input),
        maintenance_reason: maintenanceReason(session_input),
        cost_basis: costBasis(completion_input),
        started_at: require("./unit1MaintenanceSessions").iso(started_utc),
        ended_at: require("./unit1MaintenanceSessions").iso(ended_utc),
      })
    ),
    summary,
    page,
    pages: Math.ceil(summary.total / limit),
    filters: f,
  };
}
module.exports = {
  today,
  normalizePlan,
  normalizeRecord,
  decoratePlan,
  overview,
  mutate,
  history,
};
