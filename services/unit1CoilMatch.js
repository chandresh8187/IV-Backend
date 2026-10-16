const coilMatchesJob = (coil, job) => Boolean(
  coil && job &&
  coil.materialType === job.materialType &&
  Number(coil.widthMm) === Number(job.coilWidthMm) &&
  Number(coil.thicknessMm) === Number(job.coilThicknessMm)
);

module.exports = { coilMatchesJob };
