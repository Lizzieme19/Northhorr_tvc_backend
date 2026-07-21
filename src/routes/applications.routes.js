const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { requirePasswordChange } = require('../middleware/requirePasswordChange');
const { upload } = require('../middleware/upload');
const {
  submitApplication,
  getApplications,
  getApplicationById,
  updateApplicationStatus,
  importKuccps,
  getMyApplication,
  updateApplicationDocuments,
} = require('../controllers/applications.controller');

const docUpload = upload.fields([
  { name: 'doc_kcpe', maxCount: 1 },
  { name: 'doc_kcse', maxCount: 1 },
  { name: 'doc_id_copy', maxCount: 1 },
  { name: 'doc_birth_cert', maxCount: 1 },
  { name: 'doc_medical', maxCount: 1 },
  { name: 'id_copy_front', maxCount: 1 },
  { name: 'id_copy_back', maxCount: 1 },
  { name: 'parent_id_copy_front', maxCount: 1 },
  { name: 'parent_id_copy_back', maxCount: 1 },
]);

/**
 * @swagger
 * /api/applications:
 *   post:
 *     summary: Submit new application
 *     tags: [Applications]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               surname:
 *                 type: string
 *               other_names:
 *                 type: string
 *               gender:
 *                 type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               course_id:
 *                 type: string
 *               department_id:
 *                 type: string
 *               level_applied:
 *                 type: string
 *               doc_kcpe:
 *                 type: string
 *                 format: binary
 *               doc_kcse:
 *                 type: string
 *                 format: binary
 *               doc_id_copy:
 *                 type: string
 *                 format: binary
 *               doc_birth_cert:
 *                 type: string
 *                 format: binary
 *               doc_medical:
 *                 type: string
 *                 format: binary
 *               id_copy_front:
 *                 type: string
 *                 format: binary
 *               id_copy_back:
 *                 type: string
 *                 format: binary
 *               parent_id_copy_front:
 *                 type: string
 *                 format: binary
 *               parent_id_copy_back:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Application submitted
 */
router.post('/', docUpload, submitApplication);

/**
 * @swagger
 * /api/applications/my:
 *   get:
 *     summary: Get current student's application
 *     tags: [Applications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Application retrieved
 */
router.get('/my', authenticate, requireRoles('STUDENT'), requirePasswordChange, getMyApplication);

/**
 * @swagger
 * /api/applications:
 *   get:
 *     summary: List all applications (Admin/Dept Head only)
 *     tags: [Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, UNDER_REVIEW, APPROVED, REJECTED]
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
 *         description: List of applications
 */
router.get('/', authenticate, requireRoles('ADMIN', 'DEPT_HEAD'), getApplications);

/**
 * @swagger
 * /api/applications/{id}:
 *   get:
 *     summary: Get application by ID (Admin/Dept Head only)
 *     tags: [Applications]
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
 *         description: Application details
 */
router.get('/:id', authenticate, requireRoles('ADMIN', 'DEPT_HEAD'), getApplicationById);

/**
 * @swagger
 * /api/applications/{id}/status:
 *   patch:
 *     summary: Update application status (Admin only)
 *     tags: [Applications]
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
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [UNDER_REVIEW, APPROVED, REJECTED]
 *               review_notes:
 *                 type: string
 *               intake:
 *                 type: string
 *                 enum: [JANUARY, MAY, SEPTEMBER]
 *               year:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Application status updated
 */
router.patch('/:id/status', authenticate, requireRoles('ADMIN'), updateApplicationStatus);

/**
 * @swagger
 * /api/applications/{id}/documents:
 *   patch:
 *     summary: Update application data and documents (Admin only)
 *     tags: [Applications]
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
 *               surname:
 *                 type: string
 *               other_names:
 *                 type: string
 *               gender:
 *                 type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               kcpe_index:
 *                 type: string
 *               kcpe_marks:
 *                 type: integer
 *               kcse_index:
 *                 type: string
 *               kcse_grade:
 *                 type: string
 *               previous_school:
 *                 type: string
 *               parent_names:
 *                 type: string
 *               parent_relationship:
 *                 type: string
 *               parent_phone:
 *                 type: string
 *               parent_email:
 *                 type: string
 *               father_present:
 *                 type: boolean
 *               father_name:
 *                 type: string
 *               father_phone:
 *                 type: string
 *               father_email:
 *                 type: string
 *               father_occupation:
 *                 type: string
 *               mother_present:
 *                 type: boolean
 *               mother_name:
 *                 type: string
 *               mother_phone:
 *                 type: string
 *               mother_email:
 *                 type: string
 *               mother_occupation:
 *                 type: string
 *               medical_conditions:
 *                 type: string
 *               allergies:
 *                 type: string
 *               disability:
 *                 type: string
 *               emergency_person:
 *                 type: string
 *               emergency_phone:
 *                 type: string
 *               course_id:
 *                 type: string
 *               department_id:
 *                 type: string
 *               level_applied:
 *                 type: string
 *               doc_kcpe:
 *                 type: string
 *                 format: binary
 *               doc_kcse:
 *                 type: string
 *                 format: binary
 *               doc_id_copy:
 *                 type: string
 *                 format: binary
 *               doc_birth_cert:
 *                 type: string
 *                 format: binary
 *               doc_medical:
 *                 type: string
 *                 format: binary
 *               id_copy_front:
 *                 type: string
 *                 format: binary
 *               id_copy_back:
 *                 type: string
 *                 format: binary
 *               parent_id_copy_front:
 *                 type: string
 *                 format: binary
 *               parent_id_copy_back:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Application updated successfully
 */
router.patch('/:id/documents', authenticate, requireRoles('ADMIN'), docUpload, updateApplicationDocuments);

/**
 * @swagger
 * /api/applications/import/kuccps:
 *   post:
 *     summary: Import KUCCPS applications from CSV (Admin only)
 *     tags: [Applications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               csv_file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: KUCCPS applications imported
 */
router.post(
  '/import/kuccps',
  authenticate,
  requireRoles('ADMIN'),
  upload.single('csv_file'),
  importKuccps
);

module.exports = router;
