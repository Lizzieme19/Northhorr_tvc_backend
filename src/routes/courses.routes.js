const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getCourses,
  createCourse,
  updateCourse,
  deleteCourse,
} = require('../controllers/courses.controller');

// Authenticated users can list courses
router.get('/', authenticate, getCourses);

// Admin CRUD
router.post('/', authenticate, requireRoles('ADMIN'), createCourse);
router.put('/:id', authenticate, requireRoles('ADMIN'), updateCourse);
router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteCourse);

module.exports = router;
