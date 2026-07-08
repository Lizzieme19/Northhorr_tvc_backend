const prisma = require('../config/db');
const { uploadToB2 } = require('../middleware/upload');
const { generateAdmissionNumber, getMonthShortcode } = require('../utils/admissionNumberGenerator');
const PDFDocument = require('pdfkit');

const studentIncludes = {
  user: { select: { id: true, email: true, role: true } },
  course: { select: { id: true, name: true, levels: true } },
  department: { select: { id: true, name: true, slug: true } },
  application: {
    select: {
      id: true, application_no: true, type: true, surname: true, other_names: true,
      gender: true, date_of_birth: true, phone: true, address: true,
      kcpe_marks: true, kcse_grade: true, status: true,
    },
  },
  admission_letter: { select: { id: true, generated_at: true, letter_url: true } },
  fee_records: true,
};

// GET /api/students
const getStudents = async (req, res) => {
  try {
    const { department_id, status, intake, page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (intake) where.intake = intake;

    // Dept head sees only their dept
    if (req.user.role === 'DEPT_HEAD') {
      const dept = await prisma.department.findFirst({ where: { head_user_id: req.user.id } });
      if (dept) where.department_id = dept.id;
    } else if (department_id) {
      where.department_id = department_id;
    }

    if (search) {
      where.OR = [
        { admission_no: { contains: search, mode: 'insensitive' } },
        { application: { surname: { contains: search, mode: 'insensitive' } } },
        { application: { other_names: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: studentIncludes,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.student.count({ where }),
    ]);

    res.json({
      students,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/students/stats
const getStudentStats = async (req, res) => {
  try {
    const [total, active, graduated, withdrawn, pendingApps, approvedApps] = await Promise.all([
      prisma.student.count(),
      prisma.student.count({ where: { status: 'ACTIVE' } }),
      prisma.student.count({ where: { status: 'GRADUATED' } }),
      prisma.student.count({ where: { status: 'WITHDRAWN' } }),
      prisma.application.count({ where: { status: 'PENDING' } }),
      prisma.application.count({ where: { status: 'APPROVED' } }),
    ]);

    const byDepartment = await prisma.student.groupBy({
      by: ['department_id'],
      _count: { _all: true },
    });

    res.json({ total, active, graduated, withdrawn, pendingApps, approvedApps, byDepartment });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/students/me
const getMyProfile = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { user_id: req.user.id },
      include: studentIncludes,
    });
    if (!student) return res.status(404).json({ error: 'Student profile not found' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/students/:id
const getStudentById = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      include: studentIncludes,
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Students can only view their own profile
    if (req.user.role === 'STUDENT' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(student);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/students/:id
const updateStudent = async (req, res) => {
  try {
    const { level, intake, year, status, helb_applied, course_id, department_id, 
          profile_picture_url, id_copy_front_url, id_copy_back_url, 
          parent_id_copy_front_url, parent_id_copy_back_url } = req.body;
    const student = await prisma.student.update({
      where: { id: req.params.id },
      data: {
        ...(level && { level }),
        ...(intake && { intake }),
        ...(year && { year: parseInt(year) }),
        ...(status && { status }),
        ...(helb_applied !== undefined && { helb_applied }),
        ...(course_id && { course_id }),
        ...(department_id && { department_id }),
        ...(profile_picture_url && { profile_picture_url }),
        ...(id_copy_front_url !== undefined && { id_copy_front_url }),
        ...(id_copy_back_url !== undefined && { id_copy_back_url }),
        ...(parent_id_copy_front_url !== undefined && { parent_id_copy_front_url }),
        ...(parent_id_copy_back_url !== undefined && { parent_id_copy_back_url }),
      },
      include: studentIncludes,
    });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/students/:id/photo
const uploadPhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo file is required' });

    // Students can only upload their own photo, admins can upload any
    const student = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (req.user.role === 'STUDENT' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { url } = await uploadToB2(req.file.buffer, req.file.originalname, 'photos');

    const updated = await prisma.student.update({
      where: { id: req.params.id },
      data: { profile_picture_url: url },
      select: { id: true, admission_no: true, profile_picture_url: true },
    });

    res.json({ message: 'Profile picture uploaded successfully', student: updated });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
};

// PATCH /api/students/me/profile-picture - Student self-service profile picture upload
const uploadMyProfilePicture = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Profile picture file is required' });

    const student = await prisma.student.findUnique({ where: { user_id: req.user.id } });
    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    const { url } = await uploadToB2(req.file.buffer, req.file.originalname, 'profile-pictures');

    const updated = await prisma.student.update({
      where: { user_id: req.user.id },
      data: { profile_picture_url: url },
      select: { id: true, admission_no: true, profile_picture_url: true },
    });

    res.json({ message: 'Profile picture uploaded successfully', student: updated });
  } catch (err) {
    console.error('Profile picture upload error:', err);
    res.status(500).json({ error: 'Failed to upload profile picture' });
  }
};

// GET /api/students/:id/id-card - Generate student ID card PDF
const generateIdCard = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { email: true } },
        application: {
          select: {
            surname: true,
            other_names: true,
            gender: true,
            id_number: true,
            date_of_birth: true,
          },
        },
        course: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Access control
    if (req.user.role === 'STUDENT' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Create PDF document
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('NORTH HORR TECHNICAL & VOCATIONAL COLLEGE', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Student Identification Card', { align: 'center' });
    doc.moveDown();

    // Border
    doc.rect(40, 40, 515, 700).stroke();

    // Student photo placeholder (if profile picture exists, it would be loaded here)
    if (student.profile_picture_url) {
      doc.image(student.profile_picture_url, 60, 120, { width: 150, height: 150 });
    } else {
      doc.rect(60, 120, 150, 150).stroke();
      doc.fontSize(10).text('PHOTO', 105, 190, { align: 'center' });
    }

    // Student details
    const fullName = `${student.application.surname} ${student.application.other_names}`;
    doc.fontSize(14).font('Helvetica-Bold').text('Name:', 240, 120);
    doc.fontSize(12).font('Helvetica').text(fullName, 240, 140);

    doc.fontSize(14).font('Helvetica-Bold').text('Admission No:', 240, 170);
    doc.fontSize(12).font('Helvetica').text(student.admission_no, 240, 190);

    doc.fontSize(14).font('Helvetica-Bold').text('Department:', 240, 220);
    doc.fontSize(12).font('Helvetica').text(student.department.name, 240, 240);

    doc.fontSize(14).font('Helvetica-Bold').text('Course:', 240, 270);
    doc.fontSize(12).font('Helvetica').text(student.course.name, 240, 290);

    doc.fontSize(14).font('Helvetica-Bold').text('Gender:', 240, 320);
    doc.fontSize(12).font('Helvetica').text(student.application.gender, 240, 340);

    doc.fontSize(14).font('Helvetica-Bold').text('ID Number:', 240, 370);
    doc.fontSize(12).font('Helvetica').text(student.application.id_number || 'N/A', 240, 390);

    doc.fontSize(14).font('Helvetica-Bold').text('Level:', 240, 420);
    doc.fontSize(12).font('Helvetica').text(student.level, 240, 440);

    doc.fontSize(14).font('Helvetica-Bold').text('Intake:', 240, 470);
    doc.fontSize(12).font('Helvetica').text(`${student.intake} ${student.year}`, 240, 490);

    // Expiry date (2 years from admission)
    const expiryDate = new Date(student.year, 11, 31); // December of year + 2
    expiryDate.setFullYear(expiryDate.getFullYear() + 2);
    doc.fontSize(14).font('Helvetica-Bold').text('Valid Until:', 240, 520);
    doc.fontSize(12).font('Helvetica').text(expiryDate.toLocaleDateString(), 240, 540);

    // Footer
    doc.fontSize(10).font('Helvetica').text('This card is the property of North Horr Technical & Vocational College.', 50, 680, { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('If found, please return to the college administration.', 50, 695, { align: 'center' });

    doc.end();

    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${student.admission_no}_id_card.pdf"`);
      res.send(pdfBuffer);
    });
  } catch (err) {
    console.error('ID card generation error:', err);
    res.status(500).json({ error: 'Failed to generate ID card' });
  }
};

module.exports = { getStudents, getStudentById, getMyProfile, updateStudent, uploadPhoto, getStudentStats, uploadMyProfilePicture, generateIdCard };
