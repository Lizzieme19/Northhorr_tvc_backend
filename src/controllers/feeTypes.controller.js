const prisma = require('../config/db');

// GET /api/fee-types
const getAllFeeTypes = async (req, res) => {
  try {
    const { is_active } = req.query;
    const where = {};
    if (is_active !== undefined) {
      where.is_active = is_active === 'true';
    }

    const feeTypes = await prisma.feeType.findMany({
      where,
      include: {
        course: { select: { id: true, name: true, shortcode: true } },
        student_type_rules: { include: { student_type: { select: { id: true, name: true } } } },
        _count: { select: { fee_records: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ fee_types: feeTypes });
  } catch (err) {
    console.error('Get fee types error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/fee-types/:id
const getFeeTypeById = async (req, res) => {
  try {
    const feeType = await prisma.feeType.findUnique({
      where: { id: req.params.id },
      include: {
        course: { select: { id: true, name: true, shortcode: true } },
        student_type_rules: { include: { student_type: { select: { id: true, name: true } } } },
        fee_records: {
          include: {
            student: { select: { admission_no: true } },
          },
          take: 10,
          orderBy: { paid_at: 'desc' },
        },
      },
    });

    if (!feeType) return res.status(404).json({ error: 'Fee type not found' });

    res.json({ fee_type: feeType });
  } catch (err) {
    console.error('Get fee type error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/fee-types
// KUCCPS / DIRECT limits a fee to that kind of student; empty means everyone
const cleanApplicantType = (v) => (v === 'KUCCPS' || v === 'DIRECT' ? v : null);

// NOT_BILLED | ONCE | EVERY_TERM | PER_STUDENT (an amount Finance sets for each student). The older term_based / added_to_term_fee columns are kept in step with it.
const BILLING = ['NOT_BILLED', 'ONCE', 'EVERY_TERM', 'PER_STUDENT'];
const billingFields = (billing) => (BILLING.includes(billing)
  ? { billing, term_based: billing === 'EVERY_TERM', added_to_term_fee: billing === 'EVERY_TERM' }
  : {});

// The kinds of student a fee type is charged to: null/[] = every student, else [{ student_type_id, amount|null }].
// amount is for that kind of student when it differs from the fee type's own amount. Returns undefined when the
// request did not mention it (leave the rules as they are).
const readTypeRules = async (raw) => {
  if (raw === undefined) return undefined;
  if (raw === null || (Array.isArray(raw) && raw.length === 0)) return [];
  if (!Array.isArray(raw)) throw Object.assign(new Error('student_type_rules must be a list'), { status: 400 });
  const types = new Set((await prisma.studentType.findMany({ select: { id: true } })).map((t) => t.id));
  const seen = new Set();
  return raw.map((r) => {
    if (!types.has(r.student_type_id)) throw Object.assign(new Error('A student type in the list was not found'), { status: 400 });
    if (seen.has(r.student_type_id)) throw Object.assign(new Error('A student type is listed twice'), { status: 400 });
    seen.add(r.student_type_id);
    const blank = r.amount === null || r.amount === undefined || r.amount === '';
    const amount = blank ? null : Number(r.amount);
    if (!blank && (isNaN(amount) || amount < 0)) throw Object.assign(new Error('An amount for a student type must be a number, 0 or more'), { status: 400 });
    return { student_type_id: r.student_type_id, amount };
  });
};

const saveTypeRules = async (feeTypeId, rules) => {
  if (rules === undefined) return;
  await prisma.feeTypeStudentType.deleteMany({ where: { fee_type_id: feeTypeId } });
  for (const r of rules) await prisma.feeTypeStudentType.create({ data: { fee_type_id: feeTypeId, student_type_id: r.student_type_id, amount: r.amount } });
};

const withRules = (feeTypeId) => prisma.feeType.findUnique({
  where: { id: feeTypeId },
  include: { course: { select: { id: true, name: true, shortcode: true } }, student_type_rules: { include: { student_type: { select: { id: true, name: true } } } } },
});

const createFeeType = async (req, res) => {
  try {
    const { name, code, description, amount, is_required, is_disabled, applies_to, course_id, level, term_based, applicant_type, added_to_term_fee, billing } = req.body;
    const rules = await readTypeRules(req.body.student_type_rules);

    // Check if code already exists
    const existing = await prisma.feeType.findUnique({ where: { code } });
    if (existing) return res.status(400).json({ error: 'Fee type code already exists' });

    const feeType = await prisma.feeType.create({
      data: {
        name,
        code,
        description,
        amount: parseFloat(amount) || 0,
        is_required: is_required || false,
        applies_to: applies_to || 'ALL',
        course_id: course_id || null,
        level: level || null,
        term_based: term_based || false,
        is_disabled: is_disabled || false,
        added_to_term_fee: added_to_term_fee || false,
        // new fee types are not billed until it is chosen
        billing: 'NOT_BILLED',
        ...billingFields(billing),
        // choosing student types replaces the older KUCCPS/Direct setting
        applicant_type: rules !== undefined ? null : cleanApplicantType(applicant_type),
      },
    });
    await saveTypeRules(feeType.id, rules);

    res.status(201).json({ message: 'Fee type created successfully', fee_type: await withRules(feeType.id) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Create fee type error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/fee-types/:id
const updateFeeType = async (req, res) => {
  try {
    const { name, description, amount, is_active, is_required, is_disabled, applies_to, course_id, level, term_based, applicant_type, added_to_term_fee, billing } = req.body;
    const rules = await readTypeRules(req.body.student_type_rules);

    await prisma.feeType.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(amount !== undefined && { amount: parseFloat(amount) }),
        ...(is_active !== undefined && { is_active }),
        ...(is_required !== undefined && { is_required }),
        ...(applies_to !== undefined && { applies_to }),
        ...(course_id !== undefined && { course_id: course_id || null }),
        ...(level !== undefined && { level }),
        ...(term_based !== undefined && { term_based }),
        ...(is_disabled !== undefined && { is_disabled }),
        ...(added_to_term_fee !== undefined && { added_to_term_fee }),
        ...billingFields(billing),
        // choosing student types replaces the older KUCCPS/Direct setting
        ...(rules !== undefined ? { applicant_type: null } : applicant_type !== undefined && { applicant_type: cleanApplicantType(applicant_type) }),
      },
    });
    await saveTypeRules(req.params.id, rules);

    res.json({ message: 'Fee type updated successfully', fee_type: await withRules(req.params.id) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Fee type not found' });
    console.error('Update fee type error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/fee-types/:id
const deleteFeeType = async (req, res) => {
  try {
    // Check if fee type has associated fee records
    const feeType = await prisma.feeType.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { fee_records: true } } },
    });

    if (!feeType) return res.status(404).json({ error: 'Fee type not found' });

    if (feeType._count.fee_records > 0) {
      return res.status(400).json({ error: 'Cannot delete fee type with associated fee records' });
    }

    await prisma.feeType.delete({ where: { id: req.params.id } });

    res.json({ message: 'Fee type deleted successfully' });
  } catch (err) {
    console.error('Delete fee type error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllFeeTypes,
  getFeeTypeById,
  createFeeType,
  updateFeeType,
  deleteFeeType,
};
