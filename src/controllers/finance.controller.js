const prisma = require('../config/db');
const { sendFeeReminder } = require('../services/emailService');

// GET /api/finance/students
const getFinanceStudents = async (req, res) => {
  try {
    const { fee_cleared, page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (fee_cleared === 'true') {
      where.admission_fee_paid = true;
      where.student_id_fee_paid = true;
    } else if (fee_cleared === 'false') {
      where.OR = [{ admission_fee_paid: false }, { student_id_fee_paid: false }];
    }

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: {
          application: { select: { surname: true, other_names: true, email: true, phone: true, type: true } },
          course: { select: { name: true } },
          department: { select: { name: true } },
          fee_records: true,
        },
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

// GET /api/finance/summary
const getFeeSummary = async (req, res) => {
  try {
    const [
      totalStudents,
      admissionPaid,
      studentIdPaid,
      kuccpsPaid,
      helbApplied,
    ] = await Promise.all([
      prisma.student.count(),
      prisma.student.count({ where: { admission_fee_paid: true } }),
      prisma.student.count({ where: { student_id_fee_paid: true } }),
      prisma.student.count({ where: { kuccps_fee_paid: true } }),
      prisma.student.count({ where: { helb_applied: true } }),
    ]);

    // Total fees collected from fee_records
    const feeAgg = await prisma.feeRecord.aggregate({ _sum: { amount: true } });

    res.json({
      totalStudents,
      admissionPaid,
      studentIdPaid,
      kuccpsPaid,
      helbApplied,
      totalCollected: feeAgg._sum.amount || 0,
      pendingAdmissionFee: totalStudents - admissionPaid,
      pendingStudentId: totalStudents - studentIdPaid,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/finance/students/:id/fees
const markFeePaid = async (req, res) => {
  try {
    const { fee_type_id, term_id, amount } = req.body;

    if (!fee_type_id) {
      return res.status(400).json({ error: 'fee_type_id is required' });
    }

    // Get fee type details
    const feeType = await prisma.feeType.findUnique({
      where: { id: fee_type_id },
    });

    if (!feeType) return res.status(404).json({ error: 'Fee type not found' });
    if (!feeType.is_active) return res.status(400).json({ error: 'Fee type is not active' });

    const student = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Record fee payment
    const feeRecord = await prisma.feeRecord.create({
      data: {
        student_id: student.id,
        fee_type_id,
        term_id: term_id || null,
        amount: parseFloat(amount) || feeType.amount,
        received_by: req.user.id,
      },
    });

    // Update student fee flags based on fee type code
    const updateData = {};
    if (feeType.code === 'ADMISSION') updateData.admission_fee_paid = true;
    if (feeType.code === 'KUCCPS') updateData.kuccps_fee_paid = true;
    if (feeType.code === 'STUDENT_ID') updateData.student_id_fee_paid = true;
    if (feeType.code === 'TUITION') updateData.tuition_fee_paid = true;

    const updated = await prisma.student.update({
      where: { id: student.id },
      data: updateData,
      select: {
        id: true, admission_no: true,
        admission_fee_paid: true, kuccps_fee_paid: true, student_id_fee_paid: true, tuition_fee_paid: true,
        application: { select: { email: true } },
        course: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    // Update student balance if term-based fee
    if (feeType.term_based && term_id) {
      const existingBalance = await prisma.studentBalance.findUnique({
        where: { student_id_term_id: { student_id: student.id, term_id } },
      });

      if (existingBalance) {
        await prisma.studentBalance.update({
          where: { id: existingBalance.id },
          data: {
            amount_paid: { increment: parseFloat(amount) || feeType.amount },
            balance: { decrement: parseFloat(amount) || feeType.amount },
            status: existingBalance.balance <= (parseFloat(amount) || feeType.amount) ? 'PAID' : 'PARTIAL',
          },
        });
      }
    }

    // Send fee payment confirmation email
    const studentData = {
      admission_no: student.admission_no,
      course: updated.course?.name || 'N/A',
      department: updated.department?.name || 'N/A',
    };
    
    const feeAmount = parseFloat(amount) || feeType.amount;
    
    // Send email asynchronously
    sendFeeReminder(updated.application?.email, studentData, feeType.name, feeAmount).catch(err => {
      console.error('Failed to send fee email:', err);
    });

    res.json({ message: `${feeType.name} fee marked as paid`, student: updated, fee_record: feeRecord });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/finance/students/:id/balance
const getStudentBalance = async (req, res) => {
  try {
    const { term_id } = req.query;

    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      include: {
        course: { select: { name: true, feeTypes: { where: { is_active: true } } } },
        student_balances: {
          where: term_id ? { term_id } : {},
          include: { term: true },
        },
        fee_records: {
          where: term_id ? { term_id } : {},
          include: { feeType: true, term: true },
          orderBy: { paid_at: 'desc' },
        },
      },
    });

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Calculate total fees for the student's course
    let totalFees = 0;
    student.course.feeTypes.forEach(feeType => {
      if (feeType.applies_to === 'ALL' || feeType.course_id === student.course_id) {
        totalFees += feeType.amount;
      }
    });

    // Calculate total paid
    const totalPaid = student.fee_records.reduce((sum, record) => sum + record.amount, 0);

    // Get balance from StudentBalance if term_id provided
    let balance = totalFees - totalPaid;
    let balanceRecord = null;
    
    if (term_id) {
      balanceRecord = student.student_balances.find(b => b.term_id === term_id);
      if (balanceRecord) {
        balance = balanceRecord.balance;
      }
    }

    res.json({
      student: {
        id: student.id,
        admission_no: student.admission_no,
        course: student.course.name,
      },
      total_fees: totalFees,
      amount_paid: totalPaid,
      balance,
      status: balance <= 0 ? 'PAID' : balance < totalFees ? 'PARTIAL' : 'PENDING',
      fee_records: student.fee_records,
      balance_record: balanceRecord,
    });
  } catch (err) {
    console.error('Get student balance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getFinanceStudents, markFeePaid, getFeeSummary, getStudentBalance };
