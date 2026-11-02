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

// NOT_BILLED | ONCE | EVERY_TERM. The older term_based / added_to_term_fee columns are kept in step with it.
const BILLING = ['NOT_BILLED', 'ONCE', 'EVERY_TERM'];
const billingFields = (billing) => (BILLING.includes(billing)
  ? { billing, term_based: billing === 'EVERY_TERM', added_to_term_fee: billing === 'EVERY_TERM' }
  : {});

const createFeeType = async (req, res) => {
  try {
    const { name, code, description, amount, is_required, is_disabled, applies_to, course_id, level, term_based, applicant_type, added_to_term_fee, billing } = req.body;

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
        applicant_type: cleanApplicantType(applicant_type),
      },
      include: {
        course: { select: { id: true, name: true, shortcode: true } },
      },
    });

    res.status(201).json({ message: 'Fee type created successfully', fee_type: feeType });
  } catch (err) {
    console.error('Create fee type error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/fee-types/:id
const updateFeeType = async (req, res) => {
  try {
    const { name, description, amount, is_active, is_required, is_disabled, applies_to, course_id, level, term_based, applicant_type, added_to_term_fee, billing } = req.body;

    const feeType = await prisma.feeType.update({
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
        ...(applicant_type !== undefined && { applicant_type: cleanApplicantType(applicant_type) }),
      },
      include: {
        course: { select: { id: true, name: true, shortcode: true } },
      },
    });

    res.json({ message: 'Fee type updated successfully', fee_type: feeType });
  } catch (err) {
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
