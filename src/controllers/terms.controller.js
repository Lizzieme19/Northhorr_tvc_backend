const prisma = require('../config/db');

// GET /api/terms
const getAllTerms = async (req, res) => {
  try {
    const { is_active, academic_year } = req.query;
    const where = {};
    
    if (is_active !== undefined) {
      where.is_active = is_active === 'true';
    }
    if (academic_year) {
      where.academic_year = academic_year;
    }

    const terms = await prisma.term.findMany({
      where,
      include: {
        student_balances: {
          select: { id: true },
        },
        _count: {
          select: { students: true, student_balances: true },
        },
      },
      orderBy: [{ academic_year: 'desc' }, { start_date: 'desc' }],
    });

    res.json(terms);
  } catch (err) {
    console.error('Get terms error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/terms/:id
const getTermById = async (req, res) => {
  try {
    const term = await prisma.term.findUnique({
      where: { id: req.params.id },
      include: {
        student_balances: {
          include: {
            student: {
              select: {
                id: true,
                admission_no: true,
                application: {
                  select: {
                    surname: true,
                    other_names: true,
                  },
                },
                course: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
        students: {
          select: {
            id: true,
            admission_no: true,
            application: {
              select: {
                surname: true,
                other_names: true,
              },
            },
            course: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!term) return res.status(404).json({ error: 'Term not found' });

    res.json({ term });
  } catch (err) {
    console.error('Get term error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/terms
const createTerm = async (req, res) => {
  try {
    const { name, start_date, end_date, academic_year, intake, term_cost, is_active } = req.body;

    if (!name || !start_date || !end_date || !academic_year) {
      return res.status(400).json({ error: 'name, start_date, end_date, and academic_year are required' });
    }

    const term = await prisma.term.create({
      data: {
        name,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        academic_year,
        intake: intake || null,
        term_cost: term_cost || 0,
        is_active: is_active !== undefined ? is_active : true,
      },
    });

    res.status(201).json({ term });
  } catch (err) {
    console.error('Create term error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/terms/:id
const updateTerm = async (req, res) => {
  try {
    const { name, start_date, end_date, academic_year, intake, term_cost, is_active } = req.body;

    const term = await prisma.term.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(start_date && { start_date: new Date(start_date) }),
        ...(end_date && { end_date: new Date(end_date) }),
        ...(academic_year && { academic_year }),
        ...(intake !== undefined && { intake: intake || null }),
        ...(term_cost !== undefined && { term_cost: term_cost || 0 }),
        ...(is_active !== undefined && { is_active }),
      },
    });

    res.json({ term });
  } catch (err) {
    console.error('Update term error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/terms/:id
const deleteTerm = async (req, res) => {
  try {
    // Check if term has associated records
    const term = await prisma.term.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: { student_balances: true, fee_records: true, students: true },
        },
      },
    });

    if (!term) return res.status(404).json({ error: 'Term not found' });

    if (term._count.student_balances > 0 || term._count.fee_records > 0 || term._count.students > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete term with associated student balances, fee records, or enrolled students' 
      });
    }

    await prisma.term.delete({
      where: { id: req.params.id },
    });

    res.json({ message: 'Term deleted successfully' });
  } catch (err) {
    console.error('Delete term error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/terms/:termId/enroll/:studentId
const enrollStudentInTerm = async (req, res) => {
  try {
    const { termId, studentId } = req.params;

    // Check if term exists
    const term = await prisma.term.findUnique({
      where: { id: termId },
    });

    if (!term) return res.status(404).json({ error: 'Term not found' });

    // Check if student exists
    const student = await prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Update student's current term
    const updated = await prisma.student.update({
      where: { id: studentId },
      data: {
        current_term_id: termId,
      },
      select: {
        id: true,
        admission_no: true,
        current_term_id: true,
      },
    });

    // Create or update student balance for this term
    const existingBalance = await prisma.studentBalance.findUnique({
      where: { student_id_term_id: { student_id: studentId, term_id: termId } },
    });

    if (!existingBalance) {
      // Calculate total fees for the student's course
      const studentWithCourse = await prisma.student.findUnique({
        where: { id: studentId },
        include: {
          course: {
            include: {
              feeTypes: {
                where: { is_active: true },
              },
            },
          },
        },
      });

      let totalFees = 0;
      studentWithCourse.course.feeTypes.forEach(feeType => {
        if (feeType.applies_to === 'ALL' || feeType.course_id === studentWithCourse.course_id) {
          totalFees += feeType.amount;
        }
      });

      await prisma.studentBalance.create({
        data: {
          student_id: studentId,
          term_id: termId,
          total_fees: totalFees,
          amount_paid: 0,
          balance: totalFees,
          status: 'PENDING',
        },
      });
    }

    res.json({ 
      message: 'Student enrolled in term successfully',
      student: updated,
    });
  } catch (err) {
    console.error('Enroll student error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/terms/:termId/enroll/:studentId
const unenrollStudentFromTerm = async (req, res) => {
  try {
    const { termId, studentId } = req.params;

    // Update student's current term to null
    const updated = await prisma.student.update({
      where: { id: studentId },
      data: {
        current_term_id: null,
      },
      select: {
        id: true,
        admission_no: true,
        current_term_id: true,
      },
    });

    res.json({ 
      message: 'Student unenrolled from term successfully',
      student: updated,
    });
  } catch (err) {
    console.error('Unenroll student error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllTerms,
  getTermById,
  createTerm,
  updateTerm,
  deleteTerm,
  enrollStudentInTerm,
  unenrollStudentFromTerm,
};
