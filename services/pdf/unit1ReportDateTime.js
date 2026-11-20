const {DateTime}=require('luxon');
const ZONE='Asia/Kolkata';
function parseReportDate(value) {
 if(value==null||value==='')return null;
 let parsed;
 if(value instanceof Date)parsed=DateTime.fromJSDate(value);
 else if(DateTime.isDateTime(value))parsed=value;
 else if(typeof value==='string'){
  const input=value.trim();if(!input)return null;
  // SQL timestamps without an offset are Unit 1 local database times, not UTC.
  parsed=DateTime.fromISO(input,{zone:ZONE});
  if(!parsed.isValid)parsed=DateTime.fromSQL(input,{zone:ZONE});
 }else return null;
 return parsed.isValid?parsed.setZone(ZONE).setLocale('en-IN').reconfigure({numberingSystem:'latn'}):null;
}
function reportDate(value,fallback='Not recorded') {
 const date=parseReportDate(value);return date?date.toFormat('dd/MM/yyyy'):fallback;
}
function reportDateTime(value,fallback='Not recorded') {
 // A date-only record has no recorded time; do not invent a midnight time.
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.trim()))return reportDate(value,fallback);
 const date=parseReportDate(value);return date?date.toFormat('dd/MM/yyyy hh:mm:ss a').toUpperCase():fallback;
}
module.exports={reportDate,reportDateTime,parseReportDate,ZONE};
