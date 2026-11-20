const test=require('node:test'),assert=require('node:assert/strict');
const {machineHoleReport}=require('../services/unit1HoleReports');
test('daily progress groups completed checks per machine and has no upper cap', async () => {
  const { dailyMachineInspectionProgress } = require('../services/unit1HoleReports');
  const db = { execute: async (sql, args) => {
    assert.match(sql, /GROUP BY r.machine_id/);
    assert.match(sql, /<> 'rejection'/);
    assert.deepEqual(args, ['2026-11-15']);
    return [[{ machineId: 2, completed: '4' }]];
  } };
  assert.deepEqual(await dailyMachineInspectionProgress(db, '2026-11-15'), {
    day: '2026-11-15', target: 3, machines: [{ machineId: 2, completed: 4 }],
  });
});
function fixture(){const calls=[];const db={execute:async(sql,args)=>{calls.push({sql,args});return sql.includes('FROM unit1_machines')?[[{id:2,name:'Line 2'}]]:[[{total:0}]];},query:async(sql,args)=>{calls.push({sql,args});return [[]];}};return{calls,db};}
const activeShift={name:'night',shiftDate:'2026-10-24',startsAt:'2026-10-24T20:00:00+05:30',endsAt:'2026-10-25T08:00:00+05:30'};
test('live inspections include the complete overnight shift and sort newest first',async()=>{const f=fixture();await machineHoleReport(f.db,{activeShift,page:1});assert.deepEqual(f.calls[0].args,['2026-10-24 20:00:00','2026-10-25 08:00:00']);assert(f.calls[1].sql.includes('ORDER BY hc.checked_at DESC,hc.id DESC'));});
test('machine and pagination are applied before fetching inspection rows',async()=>{const f=fixture();const report=await machineHoleReport(f.db,{activeShift,machineId:2,page:2});assert.deepEqual(f.calls.at(-1).args,[2,'2026-10-24 20:00:00','2026-10-25 08:00:00',20,20]);assert.equal(report.page,2);});

test('entry tabs filter both counts and pages in SQL, retaining old rejection quantities',async()=>{
 for(const entryKind of ['inspection','rejection']){const f=fixture();await machineHoleReport(f.db,{activeShift,entryKind,page:2});
 const queries=f.calls.filter(c=>c.sql.includes('unit1_hole_checks'));
 assert.equal(queries.length,2);for(const q of queries)assert(q.sql.includes(entryKind==='rejection'?"$.rejectedPieces":"$.entryKind"));}
});
