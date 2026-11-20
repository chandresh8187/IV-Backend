const { reportDate, reportDateTime } = require("./pdf/unit1ReportDateTime");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { DateTime } = require("luxon");
const { createReportLayout } = require("./pdf/reportLayout");
const { loadCompanyLogo, drawReportFooters } = require("./pdf/reportBranding");
async function maintenancePdf(data, kind = "history") {
  if (kind !== "schedule")
    return require("./pdf/unit1MaintenanceHistoryPdf").maintenanceHistoryPdf(
      data
    );
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const logo = await loadCompanyLogo(pdf);
  const layout = createReportLayout(pdf, fonts, logo, {
    title:
      kind === "schedule"
        ? "Machine maintenance schedule"
        : "Machine maintenance service report",
    subtitle: `Unit 1 | Generated ${reportDateTime(DateTime.now())} IST`,
  });
  layout.addPage();
  if (kind === "schedule") {
    layout.note(
      `Filters: machine ${data.filters?.machine_id || "all"} | status ${
        data.filters?.status || "all"
      }. As of ${reportDate(data.asOf)} IST.`
    );
    layout.metrics([
      ["Overdue", data.summary.overdue],
      ["Due today", data.summary.due_today],
      ["Due soon", data.summary.due_soon],
      ["Without active schedule", data.summary.unscheduled],
    ]);
    layout.table(
      "Maintenance schedules",
      [
        { title: "Machine", key: "machine_name", weight: 1.2 },
        { title: "Task / instructions", key: "taskDetails", weight: 2.5 },
        { title: "Priority", key: "priority", weight: 0.65 },
        { title: "Every (days)", key: "interval_days", weight: 0.65 },
        { title: "Last serviced", key: "last_service_date", weight: 1 },
        { title: "Next due", key: "next_due_date", weight: 1 },
        { title: "Status", key: "status", weight: 1 },
      ],
      data.plans.map((p) => ({
        ...p,
        taskDetails: `${p.title}\n${p.instructions || ""}`,
        last_service_date: reportDate(
          p.last_service_date,
          "No service recorded"
        ),
        next_due_date: reportDate(p.next_due_date),
        status: p.status.replaceAll("_", " "),
      }))
    );
    layout.table(
      "Active machines without a schedule",
      [
        { title: "Code", key: "code", weight: 1 },
        { title: "Machine", key: "name", weight: 3 },
      ],
      data.unscheduled
    );
  }
  drawReportFooters(pdf, fonts, "Unit 1 | Maintenance");
  return Buffer.from(await pdf.save());
}
module.exports = { maintenancePdf };
