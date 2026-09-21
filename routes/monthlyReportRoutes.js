const router=require('express').Router();
const auth=require('../middleware/authMiddleware');
const access=require('../middleware/roleMiddleware');
const {getMonthlyReport,downloadMonthlyReportPdf}=require('../controllers/monthlyReportController');
router.use(auth);
router.get('/',access([],'monthly_reports.view'),getMonthlyReport);
router.get('/pdf',access([],'monthly_reports.report'),downloadMonthlyReportPdf);
module.exports=router;
