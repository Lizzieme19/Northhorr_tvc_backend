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

// Record fee payment - fee_type_id is optional (Finance Officer can allocate later)
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

    // Create fee record (fee_type_id is optional – Finance Officer can allocate later)
    const feeRecord = await prisma.feeRecord.create({
      data: {
        student_id: studentId,
        term_id: termId,
        fee_type_id: fee_type_id || null,
        amount,
        received_by: req.user.id,
        notes: notes || null,
      },
      include: { feeType: true },
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
      allocated: !!fee_type_id,
    });
  } catch (err) {
    console.error('Record payment error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Allocate an unallocated payment to specific fee types (Finance Officer manual allocation)
// POST /fees/students/:studentId/terms/:termId/allocate
const allocatePayment = async (req, res) => {
  try {
    const { studentId, termId } = req.params;
    const { allocations, notes } = req.body;
    // allocations: [{ fee_type_id: string, amount: number }]

    if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
      return res.status(400).json({ error: 'allocations array is required' });
    }

    const totalAllocating = allocations.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
    if (totalAllocating <= 0) {
      return res.status(400).json({ error: 'Total allocation amount must be greater than 0' });
    }

    // Get current unallocated payment total for this student & term
    const unallocatedRecords = await prisma.feeRecord.findMany({
      where: {
        student_id: studentId,
        term_id: termId,
        fee_type_id: null,
      },
    });
    const unallocatedTotal = unallocatedRecords.reduce((sum, r) => sum + r.amount, 0);

    // Get already allocated total for this term
    const allocatedRecords = await prisma.feeRecord.findMany({
      where: {
        student_id: studentId,
        term_id: termId,
        fee_type_id: { not: null },
      },
    });
    const alreadyAllocated = allocatedRecords.reduce((sum, r) => sum + r.amount, 0);
    const availableToAllocate = unallocatedTotal - alreadyAllocated;

    if (totalAllocating > availableToAllocate + 0.01) {
      return res.status(400).json({
        error: `Cannot allocate KES ${totalAllocating}. Only KES ${availableToAllocate.toFixed(2)} is available to allocate.`,
        unallocatedTotal,
        alreadyAllocated,
        availableToAllocate,
      });
    }

    // Validate all fee types exist
    const feeTypeIds = allocations.map((a) => a.fee_type_id);
    const feeTypes = await prisma.feeType.findMany({
      where: { id: { in: feeTypeIds } },
    });
    if (feeTypes.length !== feeTypeIds.length) {
      return res.status(400).json({ error: 'One or more fee types not found' });
    }

    // Create allocation records
    const createdRecords = [];
    for (const allocation of allocations) {
      if (!allocation.amount || parseFloat(allocation.amount) <= 0) continue;
      const record = await prisma.feeRecord.create({
        data: {
          student_id: studentId,
          term_id: termId,
          fee_type_id: allocation.fee_type_id,
          amount: parseFloat(allocation.amount),
          received_by: req.user.id,
          notes: notes || `Manual allocation by finance officer`,
        },
        include: { feeType: true },
      });
      createdRecords.push(record);
    }

    res.json({
      message: 'Payment allocated successfully',
      allocations: createdRecords,
      totalAllocated: totalAllocating,
    });
  } catch (err) {
    console.error('Allocate payment error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Get allocation breakdown for a student term
// GET /fees/students/:studentId/terms/:termId/allocations
const getAllocationBreakdown = async (req, res) => {
  try {
    const { studentId, termId } = req.params;

    const studentBalance = await prisma.studentBalance.findUnique({
      where: { student_term: { student_id: studentId, term_id: termId } },
      include: { term: true },
    });
    if (!studentBalance) {
      return res.status(404).json({ error: 'Student balance not found for this term' });
    }

    // All fee records for this student+term
    const feeRecords = await prisma.feeRecord.findMany({
      where: { student_id: studentId, term_id: termId },
      include: { feeType: true },
      orderBy: { paid_at: 'asc' },
    });

    const unallocated = feeRecords.filter((r) => !r.fee_type_id);
    const allocated = feeRecords.filter((r) => !!r.fee_type_id);
    const totalPaid = feeRecords.reduce((sum, r) => sum + r.amount, 0);
    const totalAllocated = allocated.reduce((sum, r) => sum + r.amount, 0);
    const totalUnallocated = totalPaid - totalAllocated;

    // Get all applicable fee types for this student
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { course_id: true, level: true },
    });
    const applicableFeeTypes = await prisma.feeType.findMany({
      where: {
        is_active: true,
        is_disabled: false,
        OR: [
          { applies_to: 'ALL' },
          { applies_to: 'SPECIFIC_LEVEL', level: student?.level },
          { applies_to: 'SPECIFIC_COURSE', course_id: student?.course_id },
        ],
      },
    });

    // Build allocation summary per fee type
    const feeTypeBreakdown = applicableFeeTypes.map((ft) => {
      const ftRecords = allocated.filter((r) => r.fee_type_id === ft.id);
      const amountPaid = ftRecords.reduce((sum, r) => sum + r.amount, 0);
      return {
        fee_type: { id: ft.id, name: ft.name, code: ft.code, amount: ft.amount, term_based: ft.term_based },
        amount_paid: amountPaid,
        required_amount: ft.amount,
        balance: Math.max(0, ft.amount - amountPaid),
        status: amountPaid >= ft.amount ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'PENDING',
        records: ftRecords,
      };
    });

    res.json({
      balance: studentBalance,
      totalPaid,
      totalAllocated,
      totalUnallocated,
      unallocatedRecords: unallocated,
      allocatedRecords: allocated,
      feeTypeBreakdown,
      applicableFeeTypes,
    });
  } catch (err) {
    console.error('Get allocation breakdown error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Bulk record fee payments for multiple students
const bulkRecordFeePayment = async (req, res) => {
  try {
    const { payments } = req.body; // Array of { studentId, termId, amount, fee_type_id, notes }

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: 'payments array is required' });
    }

    const results = [];
    const errors = [];

    for (const payment of payments) {
      try {
        const { studentId, termId, amount, fee_type_id, notes } = payment;

        if (!studentId || !termId || !amount || amount <= 0) {
          errors.push({ payment, error: 'Invalid payment data' });
          continue;
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
          errors.push({ studentId, termId, error: 'Student balance record not found' });
          continue;
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

        results.push({
          studentId,
          termId,
          amount,
          feeRecordId: feeRecord.id,
          newBalance: updatedBalance.balance,
          status: updatedBalance.status,
        });
      } catch (err) {
        errors.push({ payment, error: err.message });
      }
    }

    res.json({
      message: 'Bulk fee payments recorded',
      summary: {
        total: payments.length,
        successful: results.length,
        failed: errors.length,
      },
      results,
      errors,
    });
  } catch (err) {
    console.error('Bulk record payment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get student fee summary
const getStudentFeeSummary = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Students can only view their own fee summary
    if (req.user.role === 'STUDENT') {
      const student = await prisma.student.findUnique({
        where: { user_id: req.user.id },
        select: { id: true }
      });
      if (!student || student.id !== studentId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

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
    const totalFees = student.student_balances.reduce((sum, b) => sum + b.total_fees, 0);

    // Group fee records by term_id
    const feeRecordsByTerm = {};
    student.fee_records.forEach(record => {
      if (!feeRecordsByTerm[record.term_id]) {
        feeRecordsByTerm[record.term_id] = [];
      }
      feeRecordsByTerm[record.term_id].push(record);
    });

    // Build per-term breakdown
    const termBreakdown = student.student_balances.map(balance => ({
      term: {
        id: balance.term.id,
        name: balance.term.name,
        academic_year: balance.term.academic_year,
        intake: balance.term.intake,
        term_cost: balance.term.term_cost,
      },
      level: balance.level,
      total_fees: balance.total_fees,
      amount_paid: balance.amount_paid,
      balance: balance.balance,
      status: balance.status,
      payment_count: feeRecordsByTerm[balance.term_id]?.length || 0,
      payments: feeRecordsByTerm[balance.term_id] || [],
    }));

    res.json({
      student: {
        id: student.id,
        admission_no: student.admission_no,
        level: student.level,
      },
      summary: {
        totalFees,
        totalPaid,
        totalBalance,
        totalTerms: student.student_balances.length,
      },
      termBreakdown,
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

    if (!toLevel) {
      return res.status(400).json({ error: 'toLevel is required' });
    }
    if (!termId) {
      return res.status(400).json({ error: 'termId is required' });
    }

    // Dept head can only promote students in their department
    if (req.user.role === 'DEPT_HEAD') {
      const dept = await prisma.department.findFirst({ where: { head_user_id: req.user.id } });
      if (!dept) {
        return res.status(403).json({ error: 'You are not a department head' });
      }
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { department_id: true }
      });
      if (!student || student.department_id !== dept.id) {
        return res.status(403).json({ error: 'You can only promote students in your department' });
      }
    }

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
        to_level: toLevel,
        term_id: termId,
        academic_year: term.academic_year,
        promoted_by: req.user.id,
        notes,
        fee_clearance: student.student_balances.length === 0,
      },
    });

    // Update student level
    await prisma.student.update({
      where: { id: studentId },
      data: { level: toLevel },
    });

    res.json({
      message: 'Student promoted successfully',
      progression,
    });
  } catch (err) {
    console.error('Promote student error:', err);
    res.status(500).json({ error: err.message || 'Failed to promote student' });
  }
};

// Get student progression history
const getStudentProgression = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Students can only view their own progression history
    if (req.user.role === 'STUDENT') {
      const student = await prisma.student.findUnique({
        where: { user_id: req.user.id },
        select: { id: true }
      });
      if (!student || student.id !== studentId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

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
    const studentId = req.user.student?.id;

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
    const studentId = req.user.student?.id;

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

// Get billing dashboard data for Finance role
const getBillingDashboard = async (req, res) => {
  try {
    const { termId, status, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (termId) where.term_id = termId;
    if (status) where.status = status;

    const [balances, total, summary] = await Promise.all([
      prisma.studentBalance.findMany({
        where,
        include: {
          student: {
            include: {
              application: true,
              course: true,
              department: true,
            },
          },
          term: true,
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.studentBalance.count({ where }),
      prisma.studentBalance.groupBy({
        by: ['status'],
        _sum: {
          total_fees: true,
          amount_paid: true,
          balance: true,
        },
        _count: true,
      }),
    ]);

    const totalFees = summary.reduce((sum, s) => sum + (s._sum.total_fees || 0), 0);
    const totalPaid = summary.reduce((sum, s) => sum + (s._sum.amount_paid || 0), 0);
    const totalBalance = summary.reduce((sum, s) => sum + (s._sum.balance || 0), 0);

    res.json({
      balances,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
      summary: {
        totalFees,
        totalPaid,
        totalBalance,
        byStatus: summary,
      },
    });
  } catch (err) {
    console.error('Get billing dashboard error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Get billing report by term
const getBillingReport = async (req, res) => {
  try {
    const { termId } = req.params;

    const balances = await prisma.studentBalance.findMany({
      where: { term_id: termId },
      include: {
        student: {
          include: {
            application: true,
            course: true,
            department: true,
          },
        },
        term: true,
      },
      orderBy: { student: { admission_no: 'asc' } },
    });

    const summary = await prisma.studentBalance.groupBy({
      by: ['status'],
      where: { term_id: termId },
      _sum: {
        total_fees: true,
        amount_paid: true,
        balance: true,
      },
      _count: true,
    });

    const totalFees = summary.reduce((sum, s) => sum + (s._sum.total_fees || 0), 0);
    const totalPaid = summary.reduce((sum, s) => sum + (s._sum.amount_paid || 0), 0);
    const totalBalance = summary.reduce((sum, s) => sum + (s._sum.balance || 0), 0);
    const totalStudents = balances.length;

    res.json({
      term: balances[0]?.term,
      summary: {
        totalStudents,
        totalFees,
        totalPaid,
        totalBalance,
        collectionRate: totalFees > 0 ? (totalPaid / totalFees) * 100 : 0,
        byStatus: summary,
      },
      balances,
    });
  } catch (err) {
    console.error('Get billing report error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

module.exports = {
  calculateTermFees,
  enrollStudentInTerm,
  recordFeePayment,
  allocatePayment,
  getAllocationBreakdown,
  bulkRecordFeePayment,
  getStudentFeeSummary,
  promoteStudent,
  getStudentProgression,
  studentSelfEnroll,
  getStudentEnrollments,
  getBillingDashboard,
  getBillingReport,
};
