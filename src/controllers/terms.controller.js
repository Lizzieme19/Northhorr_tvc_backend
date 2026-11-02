const prisma = require('../config/db');
const { createStudentBalance, reconcileMany, studentIdsInTerm } = require('../services/billingService');
const { audit } = require('./feeCorrections.controller');

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

    res.json({ terms });
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
    const { name, start_date, end_date, academic_year, intake, term_cost, is_active, apply_to_existing } = req.body;

    const existing = await prisma.term.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Term not found' });

    const newCost = term_cost !== undefined ? Number(term_cost) || 0 : undefined;
    const costChanged = newCost !== undefined && newCost !== existing.term_cost;

    const term = await prisma.term.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(start_date && { start_date: new Date(start_date) }),
        ...(end_date && { end_date: new Date(end_date) }),
        ...(academic_year && { academic_year }),
        ...(intake !== undefined && { intake: intake || null }),
        ...(newCost !== undefined && { term_cost: newCost }),
        ...(is_active !== undefined && { is_active }),
      },
    });

    // A changed term fee reaches the students already billed for this term (and the terms after theirs)
    // only when the caller confirms it, after seeing the preview.
    let impact = null;
    if (costChanged && apply_to_existing === true) {
      impact = await reconcileMany(await studentIdsInTerm(term.id), { apply: true });
    }
    if (costChanged) {
      await audit(req, {
        action: 'TERM_FEE_CHANGED', entityType: 'TERM', entityId: term.id,
        oldValues: { term_cost: existing.term_cost },
        newValues: { term_cost: newCost, applied_to_existing: apply_to_existing === true, students_changed: impact?.students_changed ?? 0 },
      });
    }

    res.json({ term, impact });
  } catch (err) {
    console.error('Update term error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/terms/:id/fee-impact?term_cost=33000
// What changing the term fee would do to students already billed for this term. Nothing is saved.
const getTermFeeImpact = async (req, res) => {
  try {
    const term = await prisma.term.findUnique({ where: { id: req.params.id } });
    if (!term) return res.status(404).json({ error: 'Term not found' });

    const newCost = Number(req.query.term_cost);
    if (isNaN(newCost) || newCost < 0) return res.status(400).json({ error: 'term_cost must be 0 or more' });

    const ids = await studentIdsInTerm(term.id);
    const impact = await reconcileMany(ids, { apply: false, termCostOverrides: { [term.id]: newCost } });
    res.json({ term: { id: term.id, name: term.name, current_cost: term.term_cost, new_cost: newCost }, students_in_term: ids.length, impact });
  } catch (err) {
    console.error('Term fee impact error:', err);
    res.status(500).json({ error: 'Failed to work out the effect of the change' });
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

    // Create or refresh the balance row; the billing engine works out the fee and what is brought forward
    await createStudentBalance(studentId, termId, student.level);

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
  getTermFeeImpact,
  deleteTerm,
  enrollStudentInTerm,
  unenrollStudentFromTerm,
};
