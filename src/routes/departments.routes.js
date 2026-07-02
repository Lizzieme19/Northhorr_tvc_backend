const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getDepartments,
  getDepartmentBySlug,
  getCoursesByDepartment,
  getAllCourses,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} = require('../controllers/departments.controller');

// Public
router.get('/', getDepartments);
router.get('/courses/all', getAllCourses);
router.get('/:slug', getDepartmentBySlug);
router.get('/:slug/courses', getCoursesByDepartment);

// Admin CRUD
router.post('/', authenticate, requireRoles('ADMIN'), createDepartment);
router.put('/:id', authenticate, requireRoles('ADMIN'), updateDepartment);
router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteDepartment);

module.exports = router;
