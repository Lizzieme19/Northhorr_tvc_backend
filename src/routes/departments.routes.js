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

/**
 * @swagger
 * /api/departments:
 *   get:
 *     summary: List all departments
 *     tags: [Departments]
 *     responses:
 *       200:
 *         description: List of departments
 */
router.get('/',  getDepartments);

/**
 * @swagger
 * /api/departments/courses/all:
 *   get:
 *     summary: Get all courses across all departments
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all courses
 */
router.get('/courses/all',  getAllCourses);

/**
 * @swagger
 * /api/departments/{slug}:
 *   get:
 *     summary: Get department by slug
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Department details
 */
router.get('/:slug',  getDepartmentBySlug);

/**
 * @swagger
 * /api/departments/{slug}/courses:
 *   get:
 *     summary: Get courses for a department
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of courses for the department
 */
router.get('/:slug/courses',  getCoursesByDepartment);

/**
 * @swagger
 * /api/departments:
 *   post:
 *     summary: Create department (Admin only)
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               slug:
 *                 type: string
 *               name:
 *                 type: string
 *               shortcode:
 *                 type: string
 *               tagline:
 *                 type: string
 *               description:
 *                 type: string
 *               icon:
 *                 type: string
 *               image_url:
 *                 type: string
 *     responses:
 *       201:
 *         description: Department created
 */
router.post('/', authenticate, requireRoles('ADMIN'), createDepartment);

/**
 * @swagger
 * /api/departments/{id}:
 *   put:
 *     summary: Update department (Admin only)
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Department updated
 */
router.put('/:id', authenticate, requireRoles('ADMIN'), updateDepartment);

/**
 * @swagger
 * /api/departments/{id}:
 *   delete:
 *     summary: Delete department (Admin only)
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Department deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteDepartment);

module.exports = router;
