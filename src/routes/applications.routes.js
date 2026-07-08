const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { upload } = require('../middleware/upload');
const {
  submitApplication,
  getApplications,
  getApplicationById,
  updateApplicationStatus,
  importKuccps,
  getMyApplication,
} = require('../controllers/applications.controller');

const docUpload = upload.fields([
  { name: 'doc_kcpe', maxCount: 1 },
  { name: 'doc_kcse', maxCount: 1 },
  { name: 'doc_id_copy', maxCount: 1 },
  { name: 'doc_birth_cert', maxCount: 1 },
  { name: 'doc_medical', maxCount: 1 },
]);

// Public — walk-in application submission
router.post('/', docUpload, submitApplication);

// Student — view own application
router.get('/my', authenticate, requireRoles('STUDENT'), getMyApplication);

// Admin / Dept Head
router.get('/', authenticate, requireRoles('ADMIN', 'DEPT_HEAD'), getApplications);
router.get('/:id', authenticate, requireRoles('ADMIN', 'DEPT_HEAD'), getApplicationById);
router.patch('/:id/status', authenticate, requireRoles('ADMIN'), updateApplicationStatus);

// KUCCPS CSV import — Admin only
router.post(
  '/import/kuccps',
  authenticate,
  requireRoles('ADMIN'),
  upload.single('csv_file'),
  importKuccps
);

module.exports = router;
