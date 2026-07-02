const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getFinanceStudents,
  markFeePaid,
  getFeeSummary,
} = require('../controllers/finance.controller');

router.get('/students', authenticate, requireRoles('ADMIN', 'FINANCE'), getFinanceStudents);
router.get('/summary', authenticate, requireRoles('ADMIN', 'FINANCE'), getFeeSummary);
router.patch('/students/:id/fees', authenticate, requireRoles('ADMIN', 'FINANCE'), markFeePaid);

module.exports = router;
