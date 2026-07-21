const prisma = require('../config/db');

// Calculate fees for a student based on level and term
const calculateTermFees = async (studentId, termId) => {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { course: true },
  });

  if (!student) {
    throw new Error('Student not found');
  }

  const term = await prisma.term.findUnique({
    where: { id: termId },
  });

  if (!term) {
    throw new Error('Term not found');
  }

  // Get all applicable fee types
  const feeTypes = await prisma.feeType.findMany({
    where: {
      is_active: true,
      is_disabled: false,
      OR: [
        { applies_to: 'ALL' },
        { applies_to: 'SPECIFIC_LEVEL', level: student.level },
        { applies_to: 'SPECIFIC_COURSE', course_id: student.course_id },
      ],
    },
  });

  let totalFees = term.term_cost || 0; // Base term cost (tuition)
  const feeBreakdown = {
    termCost: term.term_cost || 0,
    termBasedFees: [],
    oneTimeFees: [],
  };

  // Process fee types
  for (const feeType of feeTypes) {
    if (feeType.term_based) {
      // Term-based fees (Library, Laboratory, Sports) - add for each term
      if (feeType.code !== 'TUITION') { // Skip TUITION as it's the term_cost
        totalFees += feeType.amount;
        feeBreakdown.termBasedFees.push({
          name: feeType.name,
          code: feeType.code,
          amount: feeType.amount,
        });
      }
    } else {
      // One-time fees (Admission, Student ID, KUCCPS, Medical) - only add if not already paid
      const hasPaid = await prisma.feeRecord.findFirst({
        where: {
          student_id: studentId,
          fee_type_id: feeType.id,
        },
      });
      if (!hasPaid) {
        totalFees += feeType.amount;
        feeBreakdown.oneTimeFees.push({
          name: feeType.name,
          code: feeType.code,
          amount: feeType.amount,
        });
      }
    }
  }

  // Apply fee adjustment if any
  const adjustment = student.fee_adjustment || 0;
  totalFees -= adjustment;

  return {
    totalFees: Math.max(0, totalFees),
    feeBreakdown,
    adjustment,
    level: student.level,
    course: student.course.name,
  };
};

// Enroll student in a term with fee calculation
const enrollStudentInTerm = async (req, res) => {
  try {
    const { studentId, termId } = req.params;
    const { allowPartialPayment = false } = req.body;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        student_balances: {
          where: { term_id: termId },
        },
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Check if already enrolled in this term
    if (student.student_balances.length > 0) {
      return res.status(400).json({ error: 'Student already enrolled in this term' });
    }

    // Calculate fees
    const feeCalculation = await calculateTermFees(studentId, termId);

    // Check previous term balance if enforcing full payment
    if (!allowPartialPayment) {
      const previousBalances = await prisma.studentBalance.findMany({
        where: {
          student_id: studentId,
          balance: { gt: 0 },
        },
      });

      if (previousBalances.length > 0) {
        return res.status(400).json({
          error: 'Student has outstanding balances from previous terms',
          outstandingBalances: previousBalances,
        });
      }
    }

    // Create student balance record
    const studentBalance = await prisma.studentBalance.create({
      data: {
        student_id: studentId,
        term_id: termId,
        level: student.level,
        total_fees: feeCalculation.totalFees,
        amount_paid: 0,
        balance: feeCalculation.totalFees,
        status: feeCalculation.totalFees === 0 ? 'PAID' : 'PENDING',
      },
    });

    // Update student's current term
    await prisma.student.update({
      where: { id: studentId },
      data: { current_term_id: termId },
    });

    res.json({
      message: 'Student enrolled in term successfully',
      studentBalance,
      feeCalculation,
    });
  } catch (err) {
    console.error('Enroll student error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Record fee payment
const recordFeePayment = async (req, res) => {
  try {
    const { studentId, termId } = req.params;
    const { amount, fee_type_id, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid payment amount' });
    }

    const studentBalance = await prisma.studentBalance.findUnique({
      where: {
        student_term: {
          student_id: studentId,
          term_id: termId,
        },
      },
    });

    if (!studentBalance) {
      return res.status(404).json({ error: 'Student balance record not found' });
    }

    // Create fee record
    const feeRecord = await prisma.feeRecord.create({
      data: {
        student_id: studentId,
        term_id: termId,
        fee_type_id: fee_type_id || null,
        amount,
        received_by: req.user.id,
        notes,
      },
    });

    // Update student balance
    const newAmountPaid = studentBalance.amount_paid + amount;
    const newBalance = studentBalance.balance - amount;
    const newStatus = newBalance <= 0 ? 'PAID' : (newAmountPaid > 0 ? 'PARTIAL' : 'PENDING');

    const updatedBalance = await prisma.studentBalance.update({
      where: { id: studentBalance.id },
      data: {
        amount_paid: newAmountPaid,
        balance: Math.max(0, newBalance),
        status: newStatus,
      },
    });

    res.json({
      message: 'Payment recorded successfully',
      feeRecord,
      updatedBalance,
    });
  } catch (err) {
    console.error('Record payment error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Get student fee summary
const getStudentFeeSummary = async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        student_balances: {
          include: { term: true },
          orderBy: { created_at: 'desc' },
        },
        fee_records: {
          include: { feeType: true, term: true, receiver: true },
          orderBy: { paid_at: 'desc' },
        },
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const totalBalance = student.student_balances.reduce((sum, b) => sum + b.balance, 0);
    const totalPaid = student.student_balances.reduce((sum, b) => sum + b.amount_paid, 0);

    res.json({
      student: {
        id: student.id,
        admission_no: student.admission_no,
        level: student.level,
      },
      summary: {
        totalBalance,
        totalPaid,
        totalTerms: student.student_balances.length,
      },
      balances: student.student_balances,
      paymentHistory: student.fee_records,
    });
  } catch (err) {
    console.error('Get fee summary error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Promote student to next level with fee clearance check
const promoteStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { toLevel, termId, notes, forcePromote = false } = req.body;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        student_balances: {
          where: { balance: { gt: 0 } },
        },
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Check fee clearance unless forcing
    if (!forcePromote && student.student_balances.length > 0) {
      return res.status(400).json({
        error: 'Student has outstanding balances',
        outstandingBalances: student.student_balances,
      });
    }

    const term = await prisma.term.findUnique({
      where: { id: termId },
    });

    if (!term) {
      return res.status(404).json({ error: 'Term not found' });
    }

    // Create progression record
    const progression = await prisma.studentProgression.create({
      data: {
        student_id: studentId,
        from_level: student.level,
        to_level,
        term_id: termId,
        academic_year: term.academic_year,
        promoted_by: req.user.id,
        notes,
        fee_clearance: student.student_balances.length === 0,
      },
    });

    // Update student level
    const updatedStudent = await prisma.student.update({
      where: { id: studentId },
      data: { level: toLevel },
    });

    res.json({
      message: 'Student promoted successfully',
      progression,
      student: updatedStudent,
    });
  } catch (err) {
    console.error('Promote student error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Get student progression history
const getStudentProgression = async (req, res) => {
  try {
    const { studentId } = req.params;

    const progressions = await prisma.studentProgression.findMany({
      where: { student_id: studentId },
      include: {
        term: true,
        promoter: {
          select: { id: true, email: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json({ progressions });
  } catch (err) {
    console.error('Get progression error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Student self-enrollment in a term
const studentSelfEnroll = async (req, res) => {
  try {
    const { termId } = req.params;
    const studentId = req.user.student_id;

    if (!studentId) {
      return res.status(400).json({ error: 'Student profile not found for this user' });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        student_balances: {
          where: { term_id: termId },
        },
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Check if already enrolled in this term
    if (student.student_balances.length > 0) {
      return res.status(400).json({ error: 'Already enrolled in this term' });
    }

    // Check if term is active
    const term = await prisma.term.findUnique({
      where: { id: termId },
    });

    if (!term) {
      return res.status(404).json({ error: 'Term not found' });
    }

    if (!term.is_active) {
      return res.status(400).json({ error: 'Term is not currently active for enrollment' });
    }

    // Calculate fees
    const feeCalculation = await calculateTermFees(studentId, termId);

    // Create student balance record
    const studentBalance = await prisma.studentBalance.create({
      data: {
        student_id: studentId,
        term_id: termId,
        level: student.level,
        total_fees: feeCalculation.totalFees,
        amount_paid: 0,
        balance: feeCalculation.totalFees,
        status: feeCalculation.totalFees === 0 ? 'PAID' : 'PENDING',
      },
    });

    // Update student's current term
    await prisma.student.update({
      where: { id: studentId },
      data: { current_term_id: termId },
    });

    res.json({
      message: 'Enrolled in term successfully',
      studentBalance,
      feeCalculation,
    });
  } catch (err) {
    console.error('Student self-enroll error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Get student's own enrollments
const getStudentEnrollments = async (req, res) => {
  try {
    const studentId = req.user.student_id;

    if (!studentId) {
      return res.status(400).json({ error: 'Student profile not found for this user' });
    }

    const enrollments = await prisma.studentBalance.findMany({
      where: { student_id: studentId },
      include: { term: true },
      orderBy: { created_at: 'desc' },
    });

    res.json(enrollments);
  } catch (err) {
    console.error('Get student enrollments error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

module.exports = {
  calculateTermFees,
  enrollStudentInTerm,
  recordFeePayment,
  getStudentFeeSummary,
  promoteStudent,
  getStudentProgression,
  studentSelfEnroll,
  getStudentEnrollments,
};
