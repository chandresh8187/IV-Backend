const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const access = require('../middleware/roleMiddleware');
const { getExpenseReport, getExpenseSettings, saveExpenseSettings, downloadExpenseReportPdf } = require('../controllers/expenseReportController');

router.use(auth);
router.get('/', access([], 'expense_report.view'), getExpenseReport);
router.get('/pdf', access([], 'expense_report.report'), downloadExpenseReportPdf);
router.get('/settings', access([], 'expense_report.settings'), getExpenseSettings);
router.put('/settings', access([], 'expense_report.settings'), saveExpenseSettings);

module.exports = router;
