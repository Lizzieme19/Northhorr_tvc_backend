const prisma = require('../config/db');
const {
  reconcileStudent,
  reconcileMany,
  studentIdsInTerm,
  allStudentIdsWithBalances,
} = require('../services/billingService');

// ─────────────────────────────────────────────────────────────────────────────
// FIXING MISTAKES
// Wrong payments, wrong term assignments, wrong term fees. Every change is logged in the audit trail
// with the old and new values and the reason, then the student's term rows are rebuilt by the billing
// engine so every figure after the change stays correct.
// ─────────────────────────────────────────────────────────────────────────────

const audit = (req, { action, entityType = 'STUDENT_FEES', entityId, oldValues, newValues, reason }) =>
  prisma.auditTrail.create({
    data: {
      user_id: req.user.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: JSON.stringify({ ...(newValues || {}), ...(reason ? { reason } : {}) }),
      ip_address: req.ip || null,
      user_agent: req.headers['user-agent'] || null,
    },
  });

const needReason = (reason) => typeof reason === 'string' && reason.trim().length >= 3;

// Payment flags on the student (admission_fee_paid, ...) are set when a payment of that type is recorded.
// If a payment is changed or removed and none of that type remain, the flag must go back to unpaid.
const FLAG_BY_CODE = {
  ADMISSION: 'admission_fee_paid',
  KUCCPS: 'kuccps_fee_paid',
  STUDENT_ID: 'student_id_fee_paid',
  TUITION: 'tuition_fee_paid',
};
const clearStaleFlags = async (studentId) => {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return;
  const data = {};
  for (const [code, flag] of Object.entries(FLAG_BY_CODE)) {
    if (!student[flag]) continue;
    const remaining = await prisma.feeRecord.count({ where: { student_id: studentId, feeType: { code } } });
    if (remaining === 0) data[flag] = false;
  }
  if (Object.keys(data).length) await prisma.student.update({ where: { id: studentId }, data });
};

const balancesOf = (studentId) =>
  prisma.studentBalance.findMany({ where: { student_id: studentId }, include: { term: true }, orderBy: { term: { start_date: 'asc' } } });

const snapshot = (r) => ({
  amount: r.amount, paid_at: r.paid_at, notes: r.notes, fee_type_id: r.fee_type_id, term_id: r.term_id, reference_code: r.reference_code,
});

// PATCH /api/fees/records/:id   body: { amount?, paid_at?, notes?, fee_type_id?, term_id?, reason }
const editPayment = async (req, res) => {
  try {
    const { amount, paid_at, notes, fee_type_id, term_id, reason } = req.body;
    if (!needReason(reason)) return res.status(400).json({ error: 'Please give a reason for the change' });

    const record = await prisma.feeRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: 'Payment not found' });

    const data = {};
    if (amount !== undefined) {
      const a = parseFloat(amount);
      if (!(a > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
      data.amount = a;
    }
    if (paid_at) {
      const d = new Date(paid_at);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid payment date' });
      data.paid_at = d;
    }
    if (notes !== undefined) data.notes = notes || null;
    if (fee_type_id !== undefined) {
      if (fee_type_id && !(await prisma.feeType.findUnique({ where: { id: fee_type_id } }))) {
        return res.status(400).json({ error: 'Fee type not found' });
      }
      data.fee_type_id = fee_type_id || null;
    }
    if (term_id !== undefined && term_id !== record.term_id) {
      const row = await prisma.studentBalance.findUnique({ where: { student_term: { student_id: record.student_id, term_id } } });
      if (!row) return res.status(400).json({ error: 'The student is not assigned to that term yet' });
      data.term_id = term_id;
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nothing to change' });

    const updated = await prisma.feeRecord.update({ where: { id: record.id }, data });
    await audit(req, { action: 'PAYMENT_EDITED', entityId: record.student_id, oldValues: snapshot(record), newValues: snapshot(updated), reason: reason.trim() });
    await reconcileStudent(record.student_id);
    await clearStaleFlags(record.student_id);

    res.json({ message: 'Payment updated', record: updated, balances: await balancesOf(record.student_id) });
  } catch (err) {
    console.error('Edit payment error:', err);
    res.status(500).json({ error: err.message || 'Failed to update payment' });
  }
};

// POST /api/fees/records/:id/void   body: { reason }
// Removes a wrongly recorded payment. The full record is kept in the audit trail.
const voidPayment = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!needReason(reason)) return res.status(400).json({ error: 'Please give a reason for voiding this payment' });

    const record = await prisma.feeRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: 'Payment not found' });

    await audit(req, { action: 'PAYMENT_VOIDED', entityId: record.student_id, oldValues: snapshot(record), newValues: { voided: true }, reason: reason.trim() });
    await prisma.feeRecord.delete({ where: { id: record.id } });
    await reconcileStudent(record.student_id);
    await clearStaleFlags(record.student_id);

    res.json({ message: 'Payment voided', balances: await balancesOf(record.student_id) });
  } catch (err) {
    console.error('Void payment error:', err);
    res.status(500).json({ error: err.message || 'Failed to void payment' });
  }
};

// PATCH /api/fees/students/:studentId/terms/:termId/fee   body: { total_fees: number | null, reason }
// Fixes one student's fee for one term. null puts it back to the calculated fee.
const setTermFeeOverride = async (req, res) => {
  try {
    const { studentId, termId } = req.params;
    const { total_fees, reason } = req.body;
    if (!needReason(reason)) return res.status(400).json({ error: 'Please give a reason for the change' });

    const row = await prisma.studentBalance.findUnique({ where: { student_term: { student_id: studentId, term_id: termId } } });
    if (!row) return res.status(404).json({ error: 'The student is not assigned to that term' });

    let override = null;
    if (total_fees !== null && total_fees !== undefined && total_fees !== '') {
      override = parseFloat(total_fees);
      if (isNaN(override) || override < 0) return res.status(400).json({ error: 'Fee must be 0 or more' });
    }

    await prisma.studentBalance.update({
      where: { id: row.id },
      data: { fee_override: override, override_reason: override === null ? null : reason.trim() },
    });
    await audit(req, {
      action: override === null ? 'TERM_FEE_OVERRIDE_CLEARED' : 'TERM_FEE_OVERRIDE_SET',
      entityId: studentId,
      oldValues: { term_id: termId, fee_override: row.fee_override, total_fees: row.total_fees },
      newValues: { term_id: termId, fee_override: override },
      reason: reason.trim(),
    });
    await reconcileStudent(studentId);

    res.json({ message: override === null ? 'Fee set back to the calculated amount' : 'Fee updated', balances: await balancesOf(studentId) });
  } catch (err) {
    console.error('Term fee override error:', err);
    res.status(500).json({ error: err.message || 'Failed to update fee' });
  }
};

// GET /api/fees/students/:studentId/history
const getFeeHistory = async (req, res) => {
  try {
    const entries = await prisma.auditTrail.findMany({
      where: { entity_type: 'STUDENT_FEES', entity_id: req.params.studentId },
      include: { user: { select: { email: true } } },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
    res.json({
      history: entries.map((e) => ({
        id: e.id, action: e.action, at: e.created_at, by: e.user?.email || null,
        old_values: parse(e.old_values), new_values: parse(e.new_values),
      })),
    });
  } catch (err) {
    console.error('Fee history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Moves one student's term row (and its payments) to another term. Throws an error with a status on a refusal.
const reassignTermCore = async (req, studentId, termId, toTermId, reason) => {
  if (!toTermId) throw fail('to_term_id is required');
  if (toTermId === termId) throw fail('Choose a different term');

  const [student, toTerm, rows] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId }, select: { id: true, current_term_id: true } }),
    prisma.term.findUnique({ where: { id: toTermId } }),
    prisma.studentBalance.findMany({ where: { student_id: studentId }, include: { term: true }, orderBy: { term: { start_date: 'asc' } } }),
  ]);
  if (!student) throw fail('Student not found', 404);
  if (!toTerm) throw fail('The new term was not found', 404);

  const row = rows.find((r) => r.term_id === termId);
  if (!row) throw fail('The student is not assigned to that term', 404);
  if (rows.find((r) => r.term_id === toTermId)) {
    throw fail(`The student is already assigned to ${toTerm.name}. Remove that assignment first, or choose another term.`);
  }

  // A row that brought debt forward gets it from whatever now comes before it; only a first row keeps an opening balance
  const wasFirst = rows[0].id === row.id;

  await prisma.$transaction([
    prisma.studentBalance.update({
      where: { id: row.id },
      data: { term_id: toTermId, carried_from_term_id: null, previous_balance_carryover: wasFirst ? row.previous_balance_carryover : 0 },
    }),
    prisma.feeRecord.updateMany({ where: { student_id: studentId, term_id: termId }, data: { term_id: toTermId } }),
    ...(student.current_term_id === termId ? [prisma.student.update({ where: { id: studentId }, data: { current_term_id: toTermId } })] : []),
  ]);

  await audit(req, {
    action: 'TERM_REASSIGNED',
    entityId: studentId,
    oldValues: { term_id: termId, term: row.term.name },
    newValues: { term_id: toTermId, term: toTerm.name },
    reason: (reason || '').trim() || undefined,
  });
  await reconcileStudent(studentId);
  return { from: row.term.name, to: toTerm.name };
};

// Removes a wrong term assignment. Refused when anything was paid against it.
const removeTermCore = async (req, studentId, termId, reason) => {
  const row = await prisma.studentBalance.findUnique({
    where: { student_term: { student_id: studentId, term_id: termId } },
    include: { term: true },
  });
  if (!row) throw fail('The student is not assigned to that term', 404);

  const payments = await prisma.feeRecord.count({ where: { student_id: studentId, term_id: termId } });
  if (payments > 0) {
    throw fail(`${payments} payment(s) were recorded against ${row.term.name}. Move the student to the right term instead, or void those payments first.`);
  }

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { current_term_id: true } });
  await prisma.studentBalance.delete({ where: { id: row.id } });

  if (student?.current_term_id === termId) {
    const latest = await prisma.studentBalance.findMany({ where: { student_id: studentId }, include: { term: true }, orderBy: { term: { start_date: 'desc' } }, take: 1 });
    await prisma.student.update({ where: { id: studentId }, data: { current_term_id: latest[0]?.term_id || null } });
  }

  await audit(req, { action: 'TERM_REMOVED', entityId: studentId, oldValues: { term_id: termId, term: row.term.name, total_fees: row.total_fees }, newValues: { removed: true }, reason: String(reason || '').trim() || undefined });
  await reconcileStudent(studentId);
  return { term: row.term.name };
};

const sendFailure = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: err.message || fallback });
};

// POST /api/students/:id/terms/:termId/reassign   body: { to_term_id, reason? }
// A student was put in the wrong term: move the term row and its payments to the right one.
const reassignTerm = async (req, res) => {
  try {
    const { id: studentId, termId } = req.params;
    const r = await reassignTermCore(req, studentId, termId, req.body.to_term_id, req.body.reason);
    // Registrars handle term assignment but not finance, so they get no amounts back
    if (req.user.role === 'REGISTRAR') return res.json({ message: `Moved from ${r.from} to ${r.to}` });
    res.json({ message: `Moved from ${r.from} to ${r.to}. Payments moved with it and the fees were recalculated.`, balances: await balancesOf(studentId) });
  } catch (err) {
    sendFailure(res, err, 'Failed to reassign term');
  }
};

// DELETE /api/students/:id/terms/:termId
// Remove a wrong term assignment. Only possible when nothing was paid against it.
const removeTerm = async (req, res) => {
  try {
    const { id: studentId, termId } = req.params;
    const r = await removeTermCore(req, studentId, termId, (req.body && req.body.reason) || req.query.reason);
    res.json({ message: `Removed ${r.term}` });
  } catch (err) {
    sendFailure(res, err, 'Failed to remove term');
  }
};

const MAX_BULK = 500;

// Runs one action for each student and reports who was done and who was skipped, with the reason
const bulkTermAction = async (req, res, studentIds, action) => {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return res.status(400).json({ error: 'studentIds is required' });
  if (studentIds.length > MAX_BULK) return res.status(400).json({ error: `Select at most ${MAX_BULK} students at a time` });

  const students = await prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, admission_no: true } });
  const name = new Map(students.map((s) => [s.id, s.admission_no]));

  const done = [];
  const skipped = [];
  for (const id of studentIds) {
    try {
      await action(id);
      done.push({ studentId: id, admission_no: name.get(id) });
    } catch (err) {
      skipped.push({ studentId: id, admission_no: name.get(id) || id, error: err.status ? err.message : 'Something went wrong' });
      if (!err.status) console.error('Bulk term action error:', err);
    }
  }
  res.json({ summary: { total: studentIds.length, successful: done.length, failed: skipped.length }, done, errors: skipped });
};

// POST /api/students/bulk-remove-term   body: { studentIds, termId, reason? }
const bulkRemoveTerm = async (req, res) => {
  try {
    const { studentIds, termId, reason } = req.body || {};
    if (!termId) return res.status(400).json({ error: 'termId is required' });
    await bulkTermAction(req, res, studentIds, (id) => removeTermCore(req, id, termId, reason));
  } catch (err) {
    sendFailure(res, err, 'Failed to remove the term');
  }
};

// POST /api/students/bulk-reassign-term   body: { studentIds, fromTermId, toTermId, reason? }
const bulkReassignTerm = async (req, res) => {
  try {
    const { studentIds, fromTermId, toTermId, reason } = req.body || {};
    if (!fromTermId || !toTermId) return res.status(400).json({ error: 'fromTermId and toTermId are required' });
    await bulkTermAction(req, res, studentIds, (id) => reassignTermCore(req, id, fromTermId, toTermId, reason));
  } catch (err) {
    sendFailure(res, err, 'Failed to move the term');
  }
};

// POST /api/fees/reconcile   body: { student_id?, term_id?, apply? }
// Checks (and with apply=true, fixes) balances against the payments and fee settings on file.
// Without a student, applying is limited to Admins.
const reconcile = async (req, res) => {
  try {
    const { student_id, term_id, apply = false } = req.body || {};
    if (apply && !student_id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only an Admin can apply a fee recalculation to many students' });
    }

    const ids = student_id ? [student_id] : term_id ? await studentIdsInTerm(term_id) : await allStudentIdsWithBalances();
    const result = await reconcileMany(ids, { apply: Boolean(apply) });

    if (apply && result.rows_changed > 0) {
      await audit(req, {
        action: 'FEES_RECONCILED', entityType: 'BILLING', entityId: student_id || term_id || null,
        newValues: { students_changed: result.students_changed, rows_changed: result.rows_changed, outstanding_change: result.outstanding_change, scope: student_id ? 'student' : term_id ? 'term' : 'all' },
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Reconcile error:', err);
    res.status(500).json({ error: err.message || 'Failed to check fees' });
  }
};

// GET /api/students/:id/terms
// The terms a student is assigned to, without any amounts, so Registrars can fix a wrong assignment.
const getStudentTerms = async (req, res) => {
  try {
    const rows = await prisma.studentBalance.findMany({
      where: { student_id: req.params.id },
      include: { term: true },
      orderBy: { term: { start_date: 'asc' } },
    });
    const counts = await prisma.feeRecord.groupBy({ by: ['term_id'], where: { student_id: req.params.id }, _count: true });
    const paid = new Set(counts.filter((c) => c._count > 0).map((c) => c.term_id));
    res.json({
      terms: rows.map((r) => ({ term: r.term, level: r.level, has_payments: paid.has(r.term_id) })),
    });
  } catch (err) {
    console.error('Get student terms error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { bulkRemoveTerm, bulkReassignTerm, getStudentTerms, editPayment, voidPayment, setTermFeeOverride, getFeeHistory, reassignTerm, removeTerm, reconcile, audit };
