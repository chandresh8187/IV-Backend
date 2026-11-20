const { isPunchFace, sectionProfileForTemplate, expandPunchFaces } = require('./unit1SectionPunchFaces');
const { isBeamPunchProfile } = require('./unit1BeamPunchProfiles');
const {normalizeAllowedCoilSizes,allowedCoilSizes}=require('./unit1AllowedCoilSizes');
const { DateTime } = require("luxon");
const { PRODUCTS, positiveId } = require("./unit1ProductionValidation");
const { editJobCard } = require("./unit1EditJobCard");
const {
  getSelections,
  saveSelections,
  normalizeSelections,
} = require("./unit1JobCoils");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const text = (value, max, required = true) => {
  const s = String(value ?? "").trim();
  if ((required && !s) || s.length > max || /[\x00-\x08]/.test(s))
    fail("Enter valid material and planning details.");
  return s;
};
const fields = [
  "structureType",
  "memberName",
  "sectionSize",
  "cutLengthMm",
  "materialType",
  "coilWidthMm",
  "coilThicknessMm",
  "punchSize",
  "holes",
  "allowedCoilSizes",
];
function material(input) {
  input = { ...input, holes: expandPunchFaces(input.holes, sectionProfileForTemplate(input)) };
  input={...input,structureType:input.structureType||'solar_mounting_structure',punchSize:input.punchSize||input.holes?.[0]?.punchSize};
  const v = {};
  const labels={structureType:'material profile',memberName:'Structure Type',sectionSize:'Section size',materialType:'Coil material',punchSize:'Punch size'};
  for (const key of [
    "structureType",
    "memberName",
    "sectionSize",
    "materialType",
    "punchSize",
  ])
    {const value=String(input[key]??'').trim(),limit=key==='memberName'?120:100;
    if(!value)fail(`Enter ${labels[key]}.`);
    if(value.length>limit)fail(`${labels[key]} must be at most ${limit} characters.`);
    v[key]=text(value,limit);}
  if (
    !PRODUCTS.some((p) => p.key === v.structureType) ||
    !["MS", "GL", "GP", "Posmac"].includes(v.materialType)
  )
    fail("Select a valid coil material and material profile.");
  v.allowedCoilSizes=normalizeAllowedCoilSizes(input);
  if (input.sectionProfile != null) {
    const profiles = v.structureType === 'w_beam_crash_barrier'
      ? ['w_beam'] : ['c_lip', 'z_lip', 'gl_hat_purlin', 'channel', 'angle', 'flat'];
    if (!profiles.includes(input.sectionProfile)) fail("Select a valid section profile.");
    v.sectionProfile = input.sectionProfile;
  }
  v.coilWidthMm=v.allowedCoilSizes[0].widthMm;v.coilThicknessMm=v.allowedCoilSizes[0].thicknessMm;
  for (const key of ["cutLengthMm"]) {
    v[key] = Number(input[key]);
    if (!Number.isFinite(v[key]) || v[key] <= 0 || v[key] >= 1000000)
      fail("Material dimensions must be positive numbers.");
  }
  if (
    !Array.isArray(input.holes) ||
    !input.holes.length ||
    input.holes.length > 100
  )
    fail("Add 1 to 100 punch positions.");
  const sectionProfile = v.structureType === 'w_beam_crash_barrier' ? 'w_beam' : v.sectionProfile;
  if (v.sectionProfile && input.holes.some(hole => !isPunchFace(hole?.profile, sectionProfile))) {
    fail("Choose a punch face supported by the selected section profile.");
  }
  v.holes = input.holes.map((h, i) => ({
    sequenceNo: i + 1,
    punchName: h.punchName==null||h.punchName===''?null:h.punchName,
    profile: v.structureType === 'w_beam_crash_barrier' ? (isBeamPunchProfile(h.profile) ? h.profile : 'beam') : h.profile,
    punchSize: text(h.punchSize || v.punchSize, 100),
    targetMm: Number(h.targetMm),
    ...(v.structureType !== "w_beam_crash_barrier" && h.profile === "web" && h.centerOffsetMm != null && h.centerOffsetMm !== ""
      ? {centerOffsetMm: require("./unit1WebPunchOffset").parseCenterOffset(h.centerOffsetMm)} : {}),
  }));
  if (
    v.holes.some(
      (h, i) =>
        input.holes[i].targetMm == null ||
        input.holes[i].targetMm === "" ||
        !(v.structureType === "w_beam_crash_barrier" ? isBeamPunchProfile(h.profile) : isPunchFace(h.profile, sectionProfile) && !isBeamPunchProfile(h.profile)) ||
        !Number.isFinite(h.targetMm) ||
        h.targetMm < 0 ||
        h.targetMm > v.cutLengthMm
    )
  )
    fail("Enter valid punch positions within cut length.");
  v.holes = require("./unit1PunchNames").withPunchNames(v.holes);
  return v;
}
function planInput(body) {
  const date = String(body.planDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid)
    fail("Enter a valid planning date.");
  if (!["day", "night"].includes(body.shift)) fail("Select a shift.");
  if (
    !Array.isArray(body.lines) ||
    !body.lines.length ||
    body.lines.length > 50
  )
    fail("Add 1 to 50 material lines.");
  return {
    partyName: text(body.partyName, 150),
    projectName: text(body.projectName, 180, false),
    planDate: date,
    shift: body.shift,
    lines: body.lines.map((l) => {
      const templateId = positiveId(l.templateId),
        machineId = positiveId(l.machineId),
        quantity = positiveId(l.quantity),
        id = l.id ? positiveId(l.id) : null;
      if (
        !templateId ||
        !machineId ||
        !quantity ||
        quantity > 10000000 ||
        (l.id && !id)
      )
        fail(
          "Every material needs a Job Card template, machine and valid quantity."
        );
      return {
        id,
        templateId,
        machineId,
        quantity,
        selectedCoils: Array.isArray(l.selectedCoils) && l.selectedCoils.length ? normalizeSelections(l.selectedCoils) : [],
      };
    }),
  };
}
const jobSelect = `SELECT j.id,j.job_date jobDate,j.customer_name customerName,j.project_name_capacity projectNameCapacity,j.production_qty productionQty,j.structure_type structureType,j.member_name memberName,j.section_size sectionSize,j.shift,j.cut_length_mm cutLengthMm,j.planned_machine_id plannedMachineId,j.machine_id machineId,j.material_type materialType,j.coil_width_mm coilWidthMm,j.coil_thickness_mm coilThicknessMm,j.allowed_coil_sizes allowedCoilSizes,j.punch_size punchSize,j.status,j.archived_at archivedAt FROM unit1_job_cards j`;
async function job(db, id) {
  const [[r]] = await db.query(jobSelect + " WHERE j.id=?", [id]);
  if (!r) fail("Planning material not found.", 404);
  const [holes] = await db.query(
    "SELECT id,sequence_no sequenceNo,profile,punch_size punchSize,punch_name punchName,target_mm AS targetMm, center_offset_mm AS centerOffsetMm FROM unit1_job_card_holes WHERE job_card_id=? AND is_active=1 ORDER BY sequence_no",
    [id]
  );
  return { ...r, allowedCoilSizes:allowedCoilSizes(r), holes, selectedCoils: await getSelections(db, id) };
}
async function revision(db, type, id, actor, before, after) {
  await db.execute(
    "INSERT INTO unit1_planning_revisions(entity_type,entity_id,actor_user_id,before_data,after_data) VALUES(?,?,?,?,?)",
    [
      type,
      id,
      actor,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
    ]
  );
}
async function transaction(db, work) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await c.query("SELECT id FROM unit1_planning_lock WHERE id=1 FOR UPDATE");
    const result = await work(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
async function templates(db) {
  const [rows] = await db.query(
    "SELECT id,name,specification,version FROM unit1_material_templates WHERE archived_at IS NULL ORDER BY id DESC"
  );
  return rows.map(({ specification, ...r }) => ({
    ...r,
    ...JSON.parse(specification),
    isTemplate: true,
  }));
}
async function template(db, id, allowArchived = false) {
  const [[r]] = await db.execute(
    "SELECT * FROM unit1_material_templates WHERE id=? FOR UPDATE",
    [id]
  );
  if (!r || (r.archived_at && !allowArchived))
    fail("Choose an active Job Card template.", 409);
  return r;
}
async function saveTemplate(db, id, body, actor) {
  return transaction(db, async (c) => {
    const before=id?await template(c,id):null;
    const previous=before?JSON.parse(before.specification):{};
    const spec=material({...body,structureType:body.structureType||previous.structureType,sectionProfile:body.sectionProfile??previous.sectionProfile});
    const name=text(String(body.name||'').trim()||`${spec.memberName} - ${spec.sectionSize}`,180);
    let resultId = id;
    if (id) {
      if (Number(body.version) !== Number(before.version))
        fail("This template changed. Refresh before editing.", 409);
      const [links] = await c.execute(
        "SELECT l.job_card_id id FROM unit1_production_plan_lines l JOIN unit1_job_cards j ON j.id=l.job_card_id WHERE l.template_id=? AND j.archived_at IS NULL ORDER BY l.job_card_id",
        [id]
      );
      for (const link of links) {
        await c.execute(
          "SELECT id FROM unit1_production_runs WHERE job_card_id=? FOR UPDATE",
          [link.id]
        );
        const old = await job(c, link.id);
        await editJobCard(c, link.id, { ...old, ...spec }, actor, {
          previousSectionProfile: sectionProfileForTemplate(previous),
        });
        if (old.selectedCoils.length && !spec.allowedCoilSizes) {
          const kept = old.selectedCoils.filter(
            (coil) => coil.materialType === spec.materialType
          );
          if (kept.length) await saveSelections(c, link.id, kept, spec, actor);
          else {
            await c.execute(
              "INSERT INTO unit1_job_coil_revisions(job_card_id,actor_user_id,before_data,after_data) VALUES(?,?,?,?)",
              [link.id, actor, JSON.stringify(old.selectedCoils), "[]"]
            );
            await c.execute(
              "DELETE FROM unit1_job_card_coils WHERE job_card_id=?",
              [link.id]
            );
          }
        }
      }
      await c.execute(
        "UPDATE unit1_material_templates SET name=?,specification=?,version=version+1 WHERE id=?",
        [name, JSON.stringify(spec), id]
      );
      await c.execute(
        "UPDATE unit1_production_plan_lines l JOIN unit1_job_cards j ON j.id=l.job_card_id SET l.template_version=? WHERE l.template_id=? AND j.archived_at IS NULL",
        [Number(before.version) + 1, id]
      );
      await revision(c, "template", id, actor, before, { name, ...spec });
    } else {
      const [r] = await c.execute(
        "INSERT INTO unit1_material_templates(name,specification,created_by) VALUES(?,?,?)",
        [name, JSON.stringify(spec), actor]
      );
      resultId = r.insertId;
      await revision(c, "template", resultId, actor, null, { name, ...spec });
    }
    return { id: resultId };
  });
}
async function plans(db) {
  const [headers] = await db.query(
    "SELECT id,party_name partyName,project_name projectName,DATE_FORMAT(plan_date,'%Y-%m-%d') planDate,shift,version FROM unit1_production_plans WHERE archived_at IS NULL ORDER BY id DESC LIMIT 200"
  );
  if (!headers.length) return [];
  const ids = headers.map((h) => h.id),
    [lines] = await db.query(
      `${jobSelect} JOIN unit1_production_plan_lines l ON l.job_card_id=j.id WHERE l.plan_id IN (${ids
        .map(() => "?")
        .join(",")}) AND j.archived_at IS NULL`,
      ids
    );
  const [links] = await db.query(
    `SELECT l.*,m.name machineName,t.name templateName,COALESCE((SELECT SUM(r.produced_pieces) FROM unit1_production_runs r WHERE r.job_card_id=l.job_card_id),0) producedPieces FROM unit1_production_plan_lines l JOIN unit1_job_cards j ON j.id=l.job_card_id LEFT JOIN unit1_machines m ON m.id=COALESCE(j.planned_machine_id,j.machine_id) JOIN unit1_material_templates t ON t.id=l.template_id WHERE l.plan_id IN (${ids
      .map(() => "?")
      .join(",")})`,
    ids
  );
  const coils = await getSelections(
    db,
    lines.map((l) => l.id)
  );
  return headers.map((h) => ({
    ...h,
    lines: lines
      .filter((line) =>
        links.some(
          (l) =>
            Number(l.plan_id) === Number(h.id) &&
            Number(l.job_card_id) === Number(line.id)
        )
      )
      .map((line) => {
        const l = links.find((l) => Number(l.job_card_id) === Number(line.id));
        return {
          ...line,
          templateId: l.template_id,
          templateName: l.templateName,
          machineId: line.plannedMachineId || line.machineId,
          machineName: l.machineName,
          quantity: line.productionQty,
          producedPieces: l.producedPieces,
          selectedCoils: coils.filter(
            (c) => Number(c.jobCardId) === Number(line.id)
          ),
        };
      }),
  }));
}
async function savePlan(db, id, body, actor) {
  const input = planInput(body);
  if (!id && input.lines.some((line) => line.id))
    fail("New planning must use new material lines.");
  return transaction(db, async (c) => {
    let planId = id,
      before = null;
    if (id) {
      const [[header]] = await c.execute(
        "SELECT * FROM unit1_production_plans WHERE id=? FOR UPDATE",
        [id]
      );
      if (!header || header.archived_at) fail("Planning not found.", 404);
      if (Number(body.version) !== Number(header.version))
        fail("This planning changed. Refresh before saving.", 409);
      before = header;
      const [existing] = await c.execute(
        "SELECT job_card_id id,template_id templateId FROM unit1_production_plan_lines WHERE plan_id=?",
        [id]
      );
      if (
        new Set(input.lines.filter((l) => l.id).map((l) => l.id)).size !==
        input.lines.filter((l) => l.id).length
      )
        fail("A planning line is duplicated.");
      if (
        input.lines.some(
          (l) => l.id && !existing.some((e) => Number(e.id) === l.id)
        )
      )
        fail("Invalid planning material.");
      if (
        existing.some(
          (e) => !input.lines.some((l) => Number(l.id) === Number(e.id))
        )
      )
        fail(
          "Keep existing material lines to preserve their production and stock references."
        );
      for (const e of existing) {
        const current = await job(c, e.id);
        if (
          Number(e.templateId) !==
          input.lines.find((l) => Number(l.id) === Number(e.id)).templateId
        )
          fail(
            "Existing planning lines must keep their original material template. Add another line instead."
          );
        (before.lines ||= []).push(current);
      }
      await c.execute(
        "UPDATE unit1_production_plans SET party_name=?,project_name=?,plan_date=?,shift=?,version=version+1 WHERE id=?",
        [input.partyName, input.projectName, input.planDate, input.shift, id]
      );
    } else {
      const key = text(body.requestKey, 100);
      if (!/^[a-zA-Z0-9_-]{10,100}$/.test(key))
        fail("Reopen the planning form.");
      const [[prior]] = await c.execute(
        "SELECT id,original_input FROM unit1_production_plans WHERE request_key=?",
        [key]
      );
      if (prior) {
        if (prior.original_input !== JSON.stringify(input))
          fail("This request has already been used.", 409);
        return { id: prior.id };
      }
      const [r] = await c.execute(
        "INSERT INTO unit1_production_plans(party_name,project_name,plan_date,shift,request_key,original_input,created_by) VALUES(?,?,?,?,?,?,?)",
        [
          input.partyName,
          input.projectName,
          input.planDate,
          input.shift,
          key,
          JSON.stringify(input),
          actor,
        ]
      );
      planId = r.insertId;
    }
    for (const line of input.lines) {
      const t = await template(c, line.templateId, !!line.id),
        spec = JSON.parse(t.specification);
      const [[machine]] = await c.execute(
        "SELECT id,is_active active FROM unit1_machines WHERE id=?",
        [line.machineId]
      );
      if (!machine?.active) fail("Choose an active machine.");
      const v = {
        ...spec,
        jobDate: input.planDate,
        customerName: input.partyName,
        projectNameCapacity: input.projectName,
        productionQty: line.quantity,
        plannedMachineId: line.machineId,
        shift: input.shift,
      };
      let jobId = line.id;
      if (jobId) {
        await c.execute(
          "SELECT id FROM unit1_production_runs WHERE job_card_id=? FOR UPDATE",
          [jobId]
        );
        await editJobCard(c, jobId, v, actor);
      } else {
        const [r] = await c.execute(
          "INSERT INTO unit1_job_cards(job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,planned_machine_id,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            v.jobDate,
            v.customerName,
            v.projectNameCapacity,
            v.productionQty,
            v.structureType,
            v.memberName,
            v.sectionSize,
            v.shift,
            v.cutLengthMm,
            v.plannedMachineId,
            v.materialType,
            v.coilWidthMm,
            v.coilThicknessMm,
            v.punchSize,
            actor,
          ]
        );
        jobId = r.insertId;
        for (const h of spec.holes)
          await c.execute(
            "INSERT INTO unit1_job_card_holes(job_card_id,sequence_no,profile,punch_size,punch_name,target_mm,center_offset_mm) VALUES (?,?,?,?,?,?,?)",
            [jobId, h.sequenceNo, h.profile, h.punchSize, h.punchName||null, h.targetMm,h.centerOffsetMm ?? null]
          );
        await c.execute(
          "INSERT INTO unit1_production_plan_lines(job_card_id,plan_id,template_id,template_version,original_input) VALUES(?,?,?,?,?)",
          [
            jobId,
            planId,
            line.templateId,
            t.version,
            JSON.stringify({ ...line, specification: spec }),
          ]
        );
      }
      await c.execute('UPDATE unit1_job_cards SET allowed_coil_sizes=? WHERE id=?',[JSON.stringify(allowedCoilSizes(v)),jobId]);
      if(line.selectedCoils.length)await saveSelections(c, jobId, line.selectedCoils, v, actor);
    }
    await revision(c, "plan", planId, actor, before, input);
    return { id: planId };
  });
}
async function linkLegacyJob(c, id, actor, archivedAt = null) {
  const [[linked]] = await c.execute(
    "SELECT plan_id FROM unit1_production_plan_lines WHERE job_card_id=?",
    [id]
  );
  if (linked) return linked.plan_id;
  const original = await job(c, id),
    spec = Object.fromEntries(fields.map((k) => [k, original[k]]));
  const [t] = await c.execute(
    "INSERT INTO unit1_material_templates(name,specification,source_job_card_id,created_by) VALUES(?,?,?,?)",
    [
      `${original.memberName} - ${original.sectionSize}`.slice(0, 180),
      JSON.stringify(spec),
      id,
      actor,
    ]
  );
  const [p] = await c.execute(
    "INSERT INTO unit1_production_plans(party_name,project_name,plan_date,shift,original_input,created_by,archived_at) VALUES(?,?,?,?,?,?,?)",
    [
      original.customerName,
      original.projectNameCapacity,
      original.jobDate,
      original.shift,
      JSON.stringify(original),
      actor,
      archivedAt,
    ]
  );
  await c.execute(
    "INSERT INTO unit1_production_plan_lines(job_card_id,plan_id,template_id,template_version,original_input) VALUES(?,?,?,1,?)",
    [id, p.insertId, t.insertId, JSON.stringify(original)]
  );
  await revision(c, "migration", p.insertId, actor, null, {
    sourceJobCardId: id,
    templateId: t.insertId,
    original,
  });
  return p.insertId;
}
async function archive(db, kind, id, actor, version) {
  if (!["templates", "plans"].includes(kind)) fail("Invalid archive type.");
  const table =
    kind === "templates"
      ? "unit1_material_templates"
      : "unit1_production_plans";
  return transaction(db, async (c) => {
    const [[before]] = await c.execute(
      `SELECT * FROM ${table} WHERE id=? FOR UPDATE`,
      [id]
    );
    if (!before) fail("Record not found.", 404);
    if (before.archived_at) return { id, archived: true };
    if (Number(version) !== Number(before.version))
      fail("This record changed. Refresh before deleting.", 409);
    if (kind === "plans") {
      const [runs] = await c.execute(
        "SELECT r.id FROM unit1_production_runs r JOIN unit1_production_plan_lines l ON l.job_card_id=r.job_card_id WHERE l.plan_id=? AND r.status IN ('setup','running','paused') FOR UPDATE",
        [id]
      );
      if (runs.length)
        fail(
          "Remove setup coils, or return/complete running and paused coils, before deleting this planning.",
          409
        );
      const [lines] = await c.execute(
        "SELECT job_card_id FROM unit1_production_plan_lines WHERE plan_id=? ORDER BY job_card_id",
        [id]
      );
      before.materialLines = [];
      for (const line of lines)
        before.materialLines.push(await job(c, line.job_card_id));
      await c.execute(
        "UPDATE unit1_job_cards j JOIN unit1_production_plan_lines l ON l.job_card_id=j.id SET j.archived_at=COALESCE(j.archived_at,UTC_TIMESTAMP(3)),j.machine_id=NULL WHERE l.plan_id=?",
        [id]
      );
    }
    await c.execute(
      `UPDATE ${table} SET archived_at=UTC_TIMESTAMP(3),version=version+1 WHERE id=?`,
      [id]
    );
    const [[after]] = await c.execute(`SELECT * FROM ${table} WHERE id=?`, [
      id,
    ]);
    await revision(
      c,
      kind === "templates" ? "template" : "plan",
      id,
      actor,
      before,
      after
    );
    return { id, archived: true };
  });
}
module.exports = {
  archive,
  linkLegacyJob,
  material,
  planInput,
  fields,
  job,
  templates,
  plans,
  saveTemplate,
  savePlan,
  transaction,
  revision,
};



