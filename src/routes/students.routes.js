const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { upload } = require('../middleware/upload');
const {
  getStudents,
  getStudentById,
  getMyProfile,
  updateStudent,
  uploadPhoto,
  getStudentStats,
} = require('../controllers/students.controller');

// Admin / Finance / Dept Head
router.get('/', authenticate, requireRoles('ADMIN', 'FINANCE', 'DEPT_HEAD'), getStudents);
router.get('/stats', authenticate, requireRoles('ADMIN'), getStudentStats);

// Student — own profile
router.get('/me', authenticate, requireRoles('STUDENT'), getMyProfile);

// Shared (student own, or admin)
router.get('/:id', authenticate, getStudentById);
router.patch('/:id', authenticate, requireRoles('ADMIN'), updateStudent);
router.post('/:id/photo', authenticate, upload.single('photo'), uploadPhoto);

module.exports = router;
