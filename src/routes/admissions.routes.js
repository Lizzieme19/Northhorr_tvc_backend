const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { generateLetter, downloadLetter } = require('../controllers/admissions.controller');

// Admin generates letter
router.post('/generate/:student_id', authenticate, requireRoles('ADMIN'), generateLetter);

// Student or Admin can download
router.get('/letter/:student_id', authenticate, downloadLetter);

module.exports = router;
