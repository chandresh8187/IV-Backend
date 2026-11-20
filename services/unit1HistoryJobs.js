function mergeHistoryJobs(productionJobs,inspectionJobs){
 const jobs=productionJobs.map(job=>({...job}));
 for(const inspected of inspectionJobs){const existing=jobs.find(job=>Number(job.jobCardId)===Number(inspected.jobCardId)&&job.machineName===inspected.machineName);if(existing)existing.inspectionCount=Number(existing.inspectionCount||0)+Number(inspected.inspectionCount);else jobs.push({...inspected,entryCount:0,pieces:0,estimatedUsedKg:0});}
 return jobs;
}
module.exports={mergeHistoryJobs};
