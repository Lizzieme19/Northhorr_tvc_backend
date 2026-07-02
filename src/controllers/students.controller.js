const prisma = require('../config/db');
const { uploadToB2 } = require('../middleware/upload');

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
    const { level, intake, year, status, helb_applied, course_id, department_id } = req.body;
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
      data: { photo_url: url },
      select: { id: true, admission_no: true, photo_url: true },
    });

    res.json({ message: 'Photo uploaded successfully', student: updated });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
};

module.exports = { getStudents, getStudentById, getMyProfile, updateStudent, uploadPhoto, getStudentStats };
