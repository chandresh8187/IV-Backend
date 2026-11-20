const test=require('node:test'),assert=require('node:assert/strict');
const {reportDate,reportDateTime}=require('../services/pdf/unit1ReportDateTime');
test('Unit 1 PDF dates consistently use Indian day/month/year and 12-hour IST',()=>{
 assert.equal(reportDate('2026-10-29'),'29/10/2026');
 assert.equal(reportDateTime('2026-10-29'),'29/10/2026','date-only records must not invent midnight');
 assert.equal(reportDateTime('2026-10-29 13:45:09'),'29/10/2026 01:45:09 PM');
 assert.equal(reportDateTime('2026-10-29T08:15:09Z'),'29/10/2026 01:45:09 PM');
 assert.equal(reportDateTime(new Date('2026-10-29T08:15:09Z')),'29/10/2026 01:45:09 PM');
 assert.equal(reportDateTime('2026-10-29T13:45:09+05:30'),'29/10/2026 01:45:09 PM');
 assert.equal(reportDateTime('2026-10-29 00:00:00'),'29/10/2026 12:00:00 AM');
 assert.equal(reportDateTime('2026-10-29 12:00:00'),'29/10/2026 12:00:00 PM');
 assert.equal(reportDateTime('2026-10-29T20:45:00Z'),'30/10/2026 02:15:00 AM');
 assert.equal(reportDateTime(null),'Not recorded');assert.equal(reportDateTime('invalid'),'Not recorded');assert.equal(reportDate('2026-02-30'),'Not recorded');
});
