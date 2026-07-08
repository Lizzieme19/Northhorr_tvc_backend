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

/**
 * @swagger
 * /api/courses:
 *   get:
 *     summary: List courses
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: department_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of courses
 */
router.get('/', authenticate, getCourses);

/**
 * @swagger
 * /api/courses:
 *   post:
 *     summary: Create course (Admin only)
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *               name:
 *                 type: string
 *               department_id:
 *                 type: string
 *               level:
 *                 type: string
 *               duration_years:
 *                 type: integer
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Course created
 */
router.post('/', authenticate, requireRoles('ADMIN'), createCourse);

/**
 * @swagger
 * /api/courses/{id}:
 *   put:
 *     summary: Update course (Admin only)
 *     tags: [Courses]
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
 *         description: Course updated
 */
router.put('/:id', authenticate, requireRoles('ADMIN'), updateCourse);

/**
 * @swagger
 * /api/courses/{id}:
 *   delete:
 *     summary: Delete course (Admin only)
 *     tags: [Courses]
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
 *         description: Course deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteCourse);

module.exports = router;
