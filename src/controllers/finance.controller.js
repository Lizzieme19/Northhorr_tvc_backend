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
    const { fee_type, amount } = req.body;
    const validTypes = ['ADMISSION', 'KUCCPS', 'STUDENT_ID'];

    if (!fee_type || !validTypes.includes(fee_type)) {
      return res.status(400).json({ error: `fee_type must be one of: ${validTypes.join(', ')}` });
    }

    const student = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Record fee payment
    await prisma.feeRecord.create({
      data: {
        student_id: student.id,
        fee_type,
        amount: parseFloat(amount) || (fee_type === 'ADMISSION' ? 1500 : fee_type === 'STUDENT_ID' ? 500 : 500),
        received_by: req.user.id,
      },
    });

    // Update flag on student
    const updateData = {};
    if (fee_type === 'ADMISSION') updateData.admission_fee_paid = true;
    if (fee_type === 'KUCCPS') updateData.kuccps_fee_paid = true;
    if (fee_type === 'STUDENT_ID') updateData.student_id_fee_paid = true;

    const updated = await prisma.student.update({
      where: { id: student.id },
      data: updateData,
      select: {
        id: true, admission_no: true,
        admission_fee_paid: true, kuccps_fee_paid: true, student_id_fee_paid: true,
      },
      include: {
        application: { select: { email: true } },
        course: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    // Send fee payment confirmation email
    const studentData = {
      admission_no: student.admission_no,
      course: updated.course?.name || 'N/A',
      department: updated.department?.name || 'N/A',
    };
    
    const feeAmount = parseFloat(amount) || (fee_type === 'ADMISSION' ? 1500 : fee_type === 'STUDENT_ID' ? 500 : 500);
    
    // Send email asynchronously
    sendFeeReminder(student.application.email, studentData, fee_type, feeAmount).catch(err => {
      console.error('Failed to send fee email:', err);
    });

    res.json({ message: `${fee_type} fee marked as paid`, student: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getFinanceStudents, markFeePaid, getFeeSummary };
