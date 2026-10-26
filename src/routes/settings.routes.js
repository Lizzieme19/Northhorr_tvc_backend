const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { getSetting, updateSetting, getAllSettings } = require('../controllers/settings.controller');

// Public: read a specific safe setting (e.g. student_edit_deadline)
router.get('/:key', getSetting);

// Admin only: list all settings
router.get('/', authenticate, requireRoles('ADMIN'), getAllSettings);

// Admin only: update / create a setting
router.patch('/:key', authenticate, requireRoles('ADMIN'), updateSetting);

module.exports = router;
