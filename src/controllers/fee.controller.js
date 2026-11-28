const prisma = require('../config/db');
const { summarizeBalances, owedPosition } = require('../utils/feeTotals');
const { chargeForStudentTerm, createStudentBalance, reconcileStudent } = require('../services/billingService');
const { parsePaging, buildStudentWhere } = require('../utils/studentFilters');
const { parsePaidAt, daysAgo, dayOf } = require('../utils/paymentDate');
const { allocationView, checkAllocations } = require('../services/voteheadService');

// Fees for a term come from the billing engine (services/billingService.js), shared by every enrol path
const calculateTermFees = chargeForStudentTerm;

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
      const allBalances = await prisma.studentBalance.findMany({ where: { student_id: studentId } });
      const { outstanding } = summarizeBalances(allBalances);

      if (outstanding > 0.01) {
        return res.status(400).json({
          error: `Student has an outstanding balance of KES ${outstanding.toLocaleString()} from previous terms`,
          outstandingBalances: allBalances.filter((b) => b.balance > 0),
        });
      }
    }

    // Create the balance row; the engine works out the fee and what is brought forward
    const studentBalance = await createStudentBalance(studentId, termId, student.level);

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
    const { fee_type_id, notes } = req.body;
    const amount = parseFloat(req.body.amount);

    if (!(amount > 0)) {
      return res.status(400).json({ error: 'Invalid payment amount' });
    }
    // The date it was received (optional, defaults to now; earlier days are allowed)
    let paidAt;
    try { paidAt = parsePaidAt(req.body.paid_at); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

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
        ...(paidAt && { paid_at: paidAt }),
      },
      include: { feeType: true },
    });

    // Rebuild the term and every later one, so a credit or a debt is carried forward
    await reconcileStudent(studentId);
    const updatedBalance = await prisma.studentBalance.findUnique({ where: { id: studentBalance.id } });

    res.json({
      message: 'Payment recorded successfully',
      backdated_days: daysAgo(feeRecord.paid_at),
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

    let paidAt;
    try { paidAt = parsePaidAt(req.body.paid_at); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

    // Validate all fee types exist (before anything is changed)
    const feeTypeIds = allocations.map((a) => a.fee_type_id);
    const feeTypes = await prisma.feeType.findMany({
      where: { id: { in: feeTypeIds } },
    });
    if (feeTypes.length !== feeTypeIds.length) {
      return res.status(400).json({ error: 'One or more fee types not found' });
    }

    // No votehead can be given more than is due under it on this term's bill
    const view = await allocationView(studentId, termId);
    const refusal = checkAllocations(view, allocations, new Map(feeTypes.map((f) => [f.id, f.name])));
    if (refusal) return res.status(400).json({ error: refusal });

    // Get current unallocated payment total for this student & term
    const unallocatedRecords = await prisma.feeRecord.findMany({
      where: {
        student_id: studentId,
        term_id: termId,
        fee_type_id: null,
      },
      orderBy: { paid_at: 'asc' },
    });
    const unallocatedTotal = unallocatedRecords.reduce((sum, r) => sum + r.amount, 0);
    const availableToAllocate = unallocatedTotal;

    if (totalAllocating > availableToAllocate + 0.01) {
      return res.status(400).json({
        error: `Cannot allocate KES ${totalAllocating}. Only KES ${availableToAllocate.toFixed(2)} is available to allocate.`,
        availableToAllocate,
      });
    }

    // Deduct allocated amounts from the unallocated records. The allocated payments keep the date the money
    // was received (the oldest payment used), unless a date is given.
    let remainingToDeduct = totalAllocating;
    let inheritedDate = null;
    for (const record of unallocatedRecords) {
      if (remainingToDeduct <= 0.01) break;
      const deduct = Math.min(record.amount, remainingToDeduct);
      if (!inheritedDate) inheritedDate = record.paid_at;

      if (record.amount - deduct <= 0.01) {
        // Fully consumed, delete the unallocated record
        await prisma.feeRecord.delete({ where: { id: record.id } });
      } else {
        // Partially consumed, reduce its amount
        await prisma.feeRecord.update({
          where: { id: record.id },
          data: { amount: record.amount - deduct },
        });
      }
      remainingToDeduct -= deduct;
    }
    const allocatedAt = paidAt || inheritedDate;

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
          ...(allocatedAt && { paid_at: allocatedAt }),
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
    if (err.status) return res.status(err.status).json({ error: err.message });
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
    const totalUnallocated = unallocated.reduce((sum, r) => sum + r.amount, 0);

    // what is due under each votehead on this bill (see services/voteheadService.js)
    const view = await allocationView(studentId, termId);
    // the same lines in the shape earlier screens read
    const feeTypeBreakdown = [
      ...view.voteheads.map((l) => ({ fee_type: l.fee_type, amount_paid: l.paid, required_amount: l.billed + l.brought_forward, balance: l.balance, status: l.status === 'NOT_ON_BILL' ? 'PAID' : l.status })),
      ...(view.unsplit?.fee_types || []).map((f) => ({ fee_type: { id: f.id, name: f.name, code: f.code }, amount_paid: f.paid, required_amount: view.unsplit.balance + f.paid, balance: view.unsplit.balance, status: f.paid > 0 ? 'PARTIAL' : 'PENDING' })),
    ];

    res.json({
      balance: studentBalance,
      totalPaid,
      totalAllocated,
      totalUnallocated,
      unallocatedRecords: unallocated,
      allocatedRecords: allocated,
      ...view,
      feeTypeBreakdown,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Get allocation breakdown error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Record payments for several students at once (POST /fees/bulk-record-payment)
// body: { paid_at?, fee_type_id?, allow_duplicates?, payments: [{ studentId, termId, amount, notes?, reference?, paid_at?, fee_type_id? }] }
// Each row is recorded on its own: one that cannot be recorded does not stop the others. A row that looks like a
// payment already recorded (same student, term, amount and day) is held back unless allow_duplicates is true.
const bulkRecordFeePayment = async (req, res) => {
  try {
    const { payments, paid_at: commonDate, fee_type_id: commonFeeType, allow_duplicates } = req.body;

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: 'Add at least one payment' });
    }
    if (payments.length > 500) {
      return res.status(400).json({ error: 'Record at most 500 payments at a time' });
    }
    let defaultDate;
    try { defaultDate = parsePaidAt(commonDate); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

    const results = [];
    const errors = [];
    const held = [];

    for (const payment of payments) {
      const { studentId, termId, notes, reference } = payment;
      const amount = parseFloat(payment.amount);
      const fee_type_id = payment.fee_type_id || commonFeeType || null;
      try {
        if (!studentId || !termId || !(amount > 0)) {
          errors.push({ studentId, termId, error: 'Choose the student and term and enter an amount above 0' });
          continue;
        }
        let paidAt = defaultDate;
        if (payment.paid_at) paidAt = parsePaidAt(payment.paid_at);

        const studentBalance = await prisma.studentBalance.findUnique({
          where: { student_term: { student_id: studentId, term_id: termId } },
          include: { student: { select: { admission_no: true } } },
        });
        if (!studentBalance) {
          errors.push({ studentId, termId, error: 'The student is not assigned to that term' });
          continue;
        }
        const label = studentBalance.student?.admission_no;

        // the same payment recorded twice by accident
        if (!allow_duplicates) {
          const day = paidAt || new Date();
          const from = new Date(`${dayOf(day)}T00:00:00+03:00`);
          const to = new Date(from.getTime() + 24 * 3600 * 1000);
          const same = await prisma.feeRecord.findFirst({ where: { student_id: studentId, term_id: termId, amount, paid_at: { gte: from, lt: to } } });
          if (same) {
            held.push({ studentId, termId, admission_no: label, amount, reason: 'A payment of the same amount was already recorded for this student and term on that day' });
            continue;
          }
        }

        const feeRecord = await prisma.feeRecord.create({
          data: {
            student_id: studentId,
            term_id: termId,
            fee_type_id,
            amount,
            received_by: req.user.id,
            notes: [reference && `Ref: ${String(reference).trim()}`, notes].filter(Boolean).join(' · ') || null,
            ...(paidAt && { paid_at: paidAt }),
          },
        });

        // rebuild the term and every later one, so a credit or a debt is carried forward
        await reconcileStudent(studentId);
        const updatedBalance = await prisma.studentBalance.findUnique({ where: { id: studentBalance.id } });

        results.push({
          studentId, termId, admission_no: label, amount,
          paid_at: feeRecord.paid_at,
          feeRecordId: feeRecord.id,
          newBalance: updatedBalance.balance,
          status: updatedBalance.status,
        });
      } catch (err) {
        errors.push({ studentId, termId, error: err.message });
      }
    }

    res.json({
      message: `Recorded ${results.length} of ${payments.length} payments`,
      summary: { total: payments.length, successful: results.length, held: held.length, failed: errors.length, amount: results.reduce((n, r) => n + r.amount, 0) },
      results,
      held,
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

    // Billed minus paid: term balances include carried-forward debt, so summing them double counts
    const { totalFees, totalPaid, outstanding: totalBalance } = summarizeBalances(student.student_balances);

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
        start_date: balance.term.start_date,
        end_date: balance.term.end_date,
        is_active: balance.term.is_active,
      },
      level: balance.level,
      total_fees: balance.total_fees,
      carryover: balance.previous_balance_carryover || 0,
      fee_override: balance.fee_override,
      override_reason: balance.override_reason,
      assigned_on: balance.assigned_on,
      assigned_note: balance.assigned_note,
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
      include: { student_balances: true },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Fees are cleared when nothing is owed overall (older terms' balances are carried forward)
    const { outstanding } = summarizeBalances(student.student_balances);
    const feesCleared = outstanding <= 0.01;

    // Check fee clearance unless forcing
    if (!forcePromote && !feesCleared) {
      return res.status(400).json({
        error: `Student has an outstanding balance of KES ${outstanding.toLocaleString()}`,
        outstandingBalances: student.student_balances.filter((b) => b.balance > 0),
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
        fee_clearance: feesCleared,
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

    // Create the balance row; the engine works out the fee and what is brought forward
    const studentBalance = await createStudentBalance(studentId, termId, student.level);

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
    const { termId, status } = req.query;
    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });

    const where = {};
    if (termId) where.term_id = termId;
    if (status) where.status = status;
    // department_id, course_id, level, intake, year, gender, search narrow by the student
    const studentWhere = buildStudentWhere(req.query);
    if (Object.keys(studentWhere).length) where.student = studentWhere;

    const [balances, total, summary, sums, money] = await Promise.all([
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
        take: limit,
      }),
      prisma.studentBalance.count({ where }),
      prisma.studentBalance.groupBy({
        by: ['status'],
        where,
        _sum: {
          total_fees: true,
          amount_paid: true,
          balance: true,
        },
        _count: true,
      }),
      prisma.studentBalance.aggregate({
        where,
        _sum: { total_fees: true, amount_paid: true, balance: true, previous_balance_carryover: true },
      }),
      prisma.studentBalance.findMany({
        where,
        select: { student_id: true, total_fees: true, amount_paid: true, previous_balance_carryover: true, carried_from_term_id: true },
      }),
    ]);

    const totalFees = sums._sum.total_fees || 0;
    const totalPaid = sums._sum.amount_paid || 0;
    // What is owed, worked out the same way as the finance overview (see utils/feeTotals.js)
    const position = owedPosition(money, Boolean(termId));
    const totalBalance = position.net;
    const totalCarryover = termId ? (sums._sum.previous_balance_carryover || 0) : 0;

    res.json({
      balances,
      pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
      summary: {
        totalFees,
        totalPaid,
        totalBalance,
        totalOwed: position.owed,
        totalCredit: position.credit,
        studentsOwing: position.studentsOwing,
        studentsInCredit: position.studentsInCredit,
        totalCarryover,
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
