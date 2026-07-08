const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { requirePasswordChange } = require('../middleware/requirePasswordChange');
const { upload } = require('../middleware/upload');
const {
  getStudents,
  getStudentById,
  getMyProfile,
  updateStudent,
  uploadPhoto,
  getStudentStats,
  uploadMyProfilePicture,
  generateIdCard,
} = require('../controllers/students.controller');

/**
 * @swagger
 * /api/students:
 *   get:
 *     summary: List all students (Admin/Finance/Dept Head only)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *         description: List of students
 */
router.get('/', authenticate, requireRoles('ADMIN', 'FINANCE', 'DEPT_HEAD'), getStudents);

/**
 * @swagger
 * /api/students/stats:
 *   get:
 *     summary: Get student statistics (Admin only)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student statistics
 */
router.get('/stats', authenticate, requireRoles('ADMIN'), getStudentStats);

/**
 * @swagger
 * /api/students/me:
 *   get:
 *     summary: Get current student profile
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student profile
 */
router.get('/me', authenticate, requireRoles('STUDENT'), requirePasswordChange, getMyProfile);

/**
 * @swagger
 * /api/students/me/profile-picture:
 *   patch:
 *     summary: Upload profile picture
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               profile_picture:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile picture uploaded
 */
router.patch('/me/profile-picture', authenticate, requireRoles('STUDENT'), requirePasswordChange, upload.single('profile_picture'), uploadMyProfilePicture);

/**
 * @swagger
 * /api/students/{id}:
 *   get:
 *     summary: Get student by ID
 *     tags: [Students]
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
 *         description: Student details
 */
router.get('/:id', authenticate, getStudentById);

/**
 * @swagger
 * /api/students/{id}:
 *   patch:
 *     summary: Update student (Admin only)
 *     tags: [Students]
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
 *         description: Student updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN'), updateStudent);

/**
 * @swagger
 * /api/students/{id}/photo:
 *   post:
 *     summary: Upload student photo
 *     tags: [Students]
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Photo uploaded
 */
router.post('/:id/photo', authenticate, upload.single('photo'), uploadPhoto);

/**
 * @swagger
 * /api/students/{id}/id-card:
 *   get:
 *     summary: Generate student ID card
 *     tags: [Students]
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
 *         description: ID card generated
 *       404:
 *         description: Student not found
 */
router.get('/:id/id-card', authenticate, generateIdCard);

module.exports = router;
