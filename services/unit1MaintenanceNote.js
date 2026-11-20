// Starting notes remain in the original session input and its audit revision.
function startNote(input) {
  try {
    return JSON.parse(input || "{}").note || "";
  } catch {
    return "";
  }
}
function normalizeStartNote(value, label = "Note") {
  if (value != null && typeof value !== "string")
    throw Object.assign(new Error(`${label} must be text.`), { status: 400 });
  const note = (value || "").trim();
  if (note.length > 10000)
    throw Object.assign(
      new Error(`${label} must be at most 10000 characters.`),
      {
        status: 400,
      }
    );
  return note;
}
function maintenanceReason(input) {
  try {
    return JSON.parse(input || "{}").maintenance_reason || "";
  } catch {
    return "";
  }
}
function costBasis(input) {
  try {
    return JSON.parse(input || "{}").cost_basis === "approximate"
      ? "approximate"
      : "recorded";
  } catch {
    return "recorded";
  }
}
module.exports = {
  startNote,
  normalizeStartNote,
  maintenanceReason,
  costBasis,
};
