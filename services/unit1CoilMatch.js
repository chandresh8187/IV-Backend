const {matchesAllowedCoilSize}=require('./unit1AllowedCoilSizes');
const legacyCoilMatchesJob = (coil, job, { allowSizeVariation = false } = {}) => Boolean(
  coil && job &&
  coil.materialType === job.materialType &&
  (allowSizeVariation || (Number(coil.widthMm) === Number(job.coilWidthMm) &&
  Number(coil.thicknessMm) === Number(job.coilThicknessMm)))
);
const coilMatchesJob=(coil,job,options={})=>Boolean(coil&&job&&(job.allowedCoilSizes!=null||job.allowed_coil_sizes!=null ? matchesAllowedCoilSize(coil,job) : legacyCoilMatchesJob(coil,job,options)));

module.exports = { coilMatchesJob };
