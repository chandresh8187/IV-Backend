const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const access = require('../middleware/roleMiddleware');
const { createChemicalCheck, getChemicalChecks, downloadChemicalChecksPdf } = require('../controllers/chemicalChecksController');

router.use(auth);
router.get('/', access([], 'chemical_checks.view'), getChemicalChecks);
router.post('/', access([], 'chemical_checks.manage'), createChemicalCheck);
router.get('/pdf', access([], 'chemical_checks.report'), downloadChemicalChecksPdf);

module.exports = router;
