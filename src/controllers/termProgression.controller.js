const prisma = require('../config/db');
const { progressStudent, buildTimeline } = require('../services/studentProgressionService');

// POST /api/term-progression/admit - Admit student to a new term (optionally a new level) with fee carry-over
// body: { student_id, new_term_id, new_level?, new_intake?, new_year?, notes? }
// A new level starts a new stage: new admission number, new intake/year, and a history entry.
const admitStudentToTerm = async (req, res) => {
  try {
    const { student_id, new_term_id, new_level, new_intake, new_year, notes } = req.body;

    if (!student_id || !new_term_id) {
      return res.status(400).json({ error: 'Student ID and new term ID are required' });
    }
    if (new_intake && !['JANUARY', 'MAY', 'SEPTEMBER'].includes(new_intake)) {
      return res.status(400).json({ error: 'Intake must be JANUARY, MAY or SEPTEMBER' });
    }

    const newTerm = await prisma.term.findUnique({ where: { id: new_term_id } });
    if (!newTerm) return res.status(404).json({ error: 'New term not found' });

    const result = await progressStudent({
      studentId: student_id,
      term: newTerm,
      newLevel: new_level || undefined,
      newIntake: new_intake || undefined,
      newYear: new_year,
      notes,
      userId: req.user.id,
      kind: 'PROMOTION',
    });

    res.json({
      message: 'Student admitted to new term successfully',
      student: result.student,
      balance: result.balance,
      progression: result.progression,
      carryover: result.carryover,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Term progression error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Students may only read their own records; staff roles are already limited by the route
const canViewStudent = async (req, studentId) => {
  if (req.user.role !== 'STUDENT') return true;
  const own = await prisma.student.findUnique({ where: { user_id: req.user.id }, select: { id: true } });
  return Boolean(own && own.id === studentId);
};

// GET /api/term-progression/:student_id/history - full academic history: every level, admission
// number, intake, year and date for this student
const getStudentHistory = async (req, res) => {
  try {
    const { student_id } = req.params;
    if (!(await canViewStudent(req, student_id))) return res.status(403).json({ error: 'Access denied' });

    const student = await prisma.student.findUnique({
      where: { id: student_id },
      include: {
        course: { select: { name: true } },
        department: { select: { name: true } },
        application: { select: { surname: true, other_names: true } },
      },
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const progressions = await prisma.studentProgression.findMany({
      where: { student_id },
      include: {
        term: { select: { name: true, academic_year: true } },
        promoter: { select: { email: true } },
      },
    });

    res.json({
      student: {
        id: student.id,
        name: `${student.application?.surname || ''} ${student.application?.other_names || ''}`.trim(),
        admission_no: student.admission_no,
        level: student.level,
        course: student.course?.name || null,
        department: student.department?.name || null,
        status: student.status,
      },
      stages: buildTimeline(student, progressions),
    });
  } catch (err) {
    console.error('Get student history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/term-progression/:student_id - Get student's term progression history
const getStudentProgression = async (req, res) => {
  try {
    const { student_id } = req.params;
    if (!(await canViewStudent(req, student_id))) return res.status(403).json({ error: 'Access denied' });

    const progressions = await prisma.studentProgression.findMany({
      where: { student_id },
      include: {
        term: { select: { name: true, academic_year: true } },
        promoter: { select: { email: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    res.json(progressions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/term-progression/:student_id/balances - Get student's term balances with carry-over info
const getStudentBalances = async (req, res) => {
  try {
    const { student_id } = req.params;
    if (!(await canViewStudent(req, student_id))) return res.status(403).json({ error: 'Access denied' });

    const balances = await prisma.studentBalance.findMany({
      where: { student_id },
      include: {
        term: { select: { name: true, academic_year: true, start_date: true, end_date: true } },
      },
      orderBy: { term: { start_date: 'desc' } },
    });

    res.json(balances);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/term-progression/:id/notes - Update progression notes
const updateProgressionNotes = async (req, res) => {
  try {
    const { notes } = req.body;

    const progression = await prisma.studentProgression.update({
      where: { id: req.params.id },
      data: { notes },
    });

    res.json(progression);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/term-progression/admin/all - Admin: list all progressions with filters
const getAllProgressions = async (req, res) => {
  try {
    const { level, academic_year, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (level) where.to_level = level;
    if (academic_year) where.academic_year = academic_year;

    const [progressions, total] = await Promise.all([
      prisma.studentProgression.findMany({
        where,
        include: {
          student: {
            select: {
              id: true,
              admission_no: true,
              level: true,
              user: { select: { email: true } },
              application: { select: { surname: true, other_names: true } },
              course: { select: { name: true, shortcode: true } },
              department: { select: { name: true } },
            },
          },
          term: { select: { name: true, academic_year: true } },
          promoter: { select: { email: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.studentProgression.count({ where }),
    ]);

    res.json({ progressions, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  admitStudentToTerm,
  getStudentHistory,
  getStudentProgression,
  getStudentBalances,
  updateProgressionNotes,
  getAllProgressions,
};
