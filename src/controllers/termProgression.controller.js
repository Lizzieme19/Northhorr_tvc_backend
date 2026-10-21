const prisma = require('../config/db');
const { generateAdmissionNumber } = require('../utils/admissionNumberGenerator');

// POST /api/term-progression/admit - Admit student to new term with fee carry-over
const admitStudentToTerm = async (req, res) => {
  try {
    const { student_id, new_term_id, new_level, notes } = req.body;

    if (!student_id || !new_term_id) {
      return res.status(400).json({ error: 'Student ID and new term ID are required' });
    }

    // Get student details
    const student = await prisma.student.findUnique({
      where: { id: student_id },
      include: {
        current_term: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get new term details
    const newTerm = await prisma.term.findUnique({
      where: { id: new_term_id },
    });

    if (!newTerm) {
      return res.status(404).json({ error: 'New term not found' });
    }

    // Check if student already has a balance for this term
    const existingBalance = await prisma.studentBalance.findUnique({
      where: {
        student_term: {
          student_id,
          term_id: new_term_id,
        },
      },
    });

    if (existingBalance) {
      return res.status(400).json({ error: 'Student already enrolled in this term' });
    }

    // Calculate previous term's carry-over
    let carryoverAmount = 0;
    let carryoverNotes = '';
    let carriedFromTermId = null;

    if (student.current_term_id) {
      const previousBalance = await prisma.studentBalance.findUnique({
        where: {
          student_term: {
            student_id,
            term_id: student.current_term_id,
          },
        },
      });

      if (previousBalance) {
        carryoverAmount = previousBalance.balance; // Positive = debt, Negative = credit
        carriedFromTermId = student.current_term_id;

        if (carryoverAmount > 0) {
          carryoverNotes = `Balance of KES ${carryoverAmount} carried forward from previous term`;
        } else if (carryoverAmount < 0) {
          carryoverNotes = `Credit of KES ${Math.abs(carryoverAmount)} carried forward from previous term`;
        }
      }
    }

    // Calculate new term's total fees
    const levelForFees = new_level || student.level;
    let totalFees = newTerm.term_cost || 0;

    // Apply fee adjustments if any
    if (student.fee_adjustment && student.fee_adjustment > 0) {
      totalFees -= student.fee_adjustment;
      carryoverNotes += carryoverNotes ? '. ' : '';
      carryoverNotes += `Fee adjustment of KES ${student.fee_adjustment} applied`;
    }

    // Calculate new balance with carry-over
    const newBalance = totalFees + carryoverAmount;
    const status = newBalance <= 0 ? 'PAID' : newBalance < totalFees ? 'PARTIAL' : 'PENDING';

    // Create new student balance record
    const newStudentBalance = await prisma.studentBalance.create({
      data: {
        student_id,
        term_id: new_term_id,
        level: levelForFees,
        total_fees: totalFees,
        amount_paid: 0,
        balance: newBalance,
        status,
        previous_balance_carryover: carryoverAmount,
        carried_from_term_id,
        carryover_notes: carryoverNotes || null,
      },
    });

    // Update student's current term
    const updatedStudent = await prisma.student.update({
      where: { id: student_id },
      data: {
        current_term_id: new_term_id,
        level: new_level || student.level,
      },
    });

    // Create progression record if level changed
    let progression = null;
    if (new_level && new_level !== student.level) {
      // ─── Generate new admission number for the new level ───
      let newAdmissionNo = student.admission_no; // fallback: keep existing
      try {
        newAdmissionNo = await generateAdmissionNumber(
          student.course_id,
          new_level,
          student.intake,  // e.g. 'JANUARY', 'MAY', 'SEPTEMBER'
          student.year
        );
      } catch (genErr) {
        console.warn('Could not generate new admission number, keeping existing:', genErr.message);
      }

      const oldAdmissionNo = student.admission_no;

      // Update student: new level + new admission number
      await prisma.student.update({
        where: { id: student_id },
        data: {
          level: new_level,
          admission_no: newAdmissionNo,
        },
      });

      // Record progression with both admission numbers
      progression = await prisma.studentProgression.create({
        data: {
          student_id,
          from_level: student.level,
          to_level: new_level,
          term_id: new_term_id,
          academic_year: newTerm.academic_year,
          promoted_by: req.user.id,
          notes: notes || `Promoted from ${student.level} to ${new_level}`,
          fee_clearance: carryoverAmount <= 0,
          old_admission_no: oldAdmissionNo,
          new_admission_no: newAdmissionNo,
        },
      });

      // Return updated student data in response
      updatedStudent.admission_no = newAdmissionNo;
      updatedStudent.level = new_level;
    }

    res.json({
      message: 'Student admitted to new term successfully',
      student: updatedStudent,
      balance: newStudentBalance,
      progression,
      carryover: {
        amount: carryoverAmount,
        from_term_id: carriedFromTermId,
        notes: carryoverNotes,
      },
    });
  } catch (err) {
    console.error('Term progression error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/term-progression/:student_id - Get student's term progression history
const getStudentProgression = async (req, res) => {
  try {
    const { student_id } = req.params;

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
              user: { select: { first_name: true, last_name: true, email: true } },
              course: { select: { name: true, shortcode: true } },
              department: { select: { name: true } },
            },
          },
          term: { select: { name: true, academic_year: true } },
          promoter: { select: { email: true, first_name: true, last_name: true } },
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
  getStudentProgression,
  getStudentBalances,
  updateProgressionNotes,
  getAllProgressions,
};
