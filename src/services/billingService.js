const prisma = require('../config/db');
const { sameLevel } = require('../utils/levels');

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE PLACE FEES ARE CALCULATED
//
// Every way of putting a student in a term (assigning, bulk assigning, enrolling, self-enrolling,
// progression, approval) goes through here, so the numbers always agree. A term balance row is:
//
//   total_fees   = what the student is charged for the term (see computeCharge)
//   carryover    = the previous term's balance (debt or credit brought forward)
//   amount_paid  = the payments recorded against the term
//   balance      = total_fees + carryover - amount_paid
//
// "Previous term" always means the term before it by start date. Rows are rebuilt from the payments
// and fee settings on file, so correcting a payment, a term fee or a fee type fixes every figure
// after it as well.
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const statusFor = (balance, paid) => (balance <= 0.009 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING');

// ───────────────────────────────────────────────────────�
// KINDS OF STUDENT. A student has a type (Direct, KUCCPS...), kept by the admin. A type can have its own term fee for
// each term (no row = the term's standard fee), and a fee type can be limited to certain types, with its own amount
// for a type. With no types set up, none of this applies and fees work exactly as before.
// ───────────────────────────────────────────────────────�

// Read once and shared, so working out many students does not re-read the same settings for each
const loadContext = async () => {
  const [allFeeTypes, types, rules, termFees] = await Promise.all([
    prisma.feeType.findMany(),
    prisma.studentType.findMany(),
    prisma.feeTypeStudentType.findMany(),
    prisma.termFee.findMany(),
  ]);
  const rulesByFeeType = new Map();
  for (const r of rules) {
    if (!rulesByFeeType.has(r.fee_type_id)) rulesByFeeType.set(r.fee_type_id, new Map());
    rulesByFeeType.get(r.fee_type_id).set(r.student_type_id, r.amount);
  }
  // only fee types that are switched on are billed automatically; all of them are kept by id so a charge set for a
  // student still shows its name (and still bills) if the fee type is switched off later
  const feeTypes = allFeeTypes.filter((f) => f.is_active && !f.is_disabled);
  return {
    feeTypes,
    feeTypeById: new Map(allFeeTypes.map((f) => [f.id, f])),
    types,
    defaultTypeId: types.find((t) => t.is_default)?.id || null,
    rulesByFeeType,
    termFeeMap: new Map(termFees.map((t) => [`${t.term_id}|${t.student_type_id}`, t.amount])),
  };
};

// The term fee for a kind of student: its own fee for the term if one is set, otherwise the term's standard fee.
// termCostOverrides / typeFeeOverrides let a change be previewed before it is saved (a null type fee = removed).
const termFeeFor = (ctx, term, typeId, { termCostOverrides = {}, typeFeeOverrides = {} } = {}) => {
  const standard = termCostOverrides[term.id] ?? term.term_cost ?? 0;
  if (!typeId || typeId === ctx.defaultTypeId) return standard;
  const over = typeFeeOverrides[term.id];
  if (over && Object.prototype.hasOwnProperty.call(over, typeId)) return over[typeId] ?? standard;
  return ctx.termFeeMap.get(`${term.id}|${typeId}`) ?? standard;
};

// Does a fee type apply to this student at this level?
const feeTypeApplies = (ft, student, level, applicantType) => {
  if (!ft.is_active || ft.is_disabled) return false;
  if (ft.applies_to === 'SPECIFIC_COURSE' && ft.course_id !== student.course_id) return false;
  if (ft.applies_to === 'SPECIFIC_LEVEL' && !sameLevel(ft.level, level)) return false;
  // e.g. the KUCCPS fee is only for KUCCPS-placed students
  if (ft.applicant_type && ft.applicant_type !== applicantType) return false;
  return true;
};

// How a fee type is billed. Set on the fee type: NOT_BILLED, ONCE, EVERY_TERM or PER_STUDENT (no automatic charge: each
// student is charged the amount Finance sets for them).
// Fee types made before that setting existed keep behaving as they did.
const billingOf = (ft) => ft.billing || (ft.term_based ? (ft.added_to_term_fee ? 'EVERY_TERM' : 'NOT_BILLED') : 'ONCE');

// What a student is charged for one term.
//   term fee (Term.term_cost). This is the whole recurring fee.
// + fee types billed EVERY_TERM (on top of the term fee)
// + fee types billed ONCE, in the student's first term only
// - the student's fee adjustment (discount / waiver)
// A fee type that is NOT_BILLED never adds anything; it is only a category for allocating payments.
// + amounts set for this student for this term (`charges`: Map feeTypeId -> { amount, fee_type }). These are the student's own
//   amount for that fee type, so they replace whatever the fee type would have charged automatically, and bill even
//   when the fee type would not normally apply to this student (Finance chose them).
const computeCharge = ({ student, level, termCost, feeTypes, isFirstTerm, typeId = null, rules = null, charges = null }) => {
  const applicantType = student.application?.type || null;
  const applicable = feeTypes
    .filter((ft) => feeTypeApplies(ft, student, level, applicantType))
    // a fee type limited to certain kinds of student applies only to those, at their own amount if they have one
    .filter((ft) => !rules?.has(ft.id) || rules.get(ft.id).has(typeId))
    .map((ft) => (rules?.has(ft.id) && rules.get(ft.id).get(typeId) != null ? { ...ft, amount: rules.get(ft.id).get(typeId) } : ft));

  // Tuition is the term fee. If the term has no fee set, a TUITION fee type's amount stands in for it.
  let base = termCost || 0;
  if (!base) base = applicable.find((ft) => ft.code === 'TUITION')?.amount || 0;

  const breakdown = [{ code: 'TERM_FEE', name: 'Term fee', amount: base, kind: 'term' }];
  let total = base;

  for (const ft of applicable) {
    if (ft.code === 'TUITION') continue;
    if (charges?.has(ft.id)) continue; // set for this student below
    const billing = billingOf(ft);
    if (billing === 'EVERY_TERM') {
      total += ft.amount;
      breakdown.push({ code: ft.code, name: ft.name, amount: ft.amount, kind: 'every term' });
    } else if (billing === 'ONCE' && isFirstTerm) {
      total += ft.amount;
      breakdown.push({ code: ft.code, name: ft.name, amount: ft.amount, kind: 'once' });
    }
  }

  if (charges) {
    for (const [feeTypeId, c] of charges) {
      const amount = round2(c.amount);
      total += amount;
      breakdown.push({ code: c.fee_type?.code || feeTypeId, name: c.fee_type?.name || 'Charge', amount, kind: 'set for this student', fee_type_id: feeTypeId, ...(c.note ? { note: c.note } : {}) });
    }
  }

  const adjustment = student.fee_adjustment || 0;
  if (adjustment) breakdown.push({ code: 'ADJUSTMENT', name: 'Fee adjustment', amount: -adjustment, kind: 'adjustment' });
  return { total: round2(Math.max(0, total - adjustment)), breakdown, adjustment };
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAN: work out what every term row of a student should be, without writing anything
// termCostOverrides: { [termId]: cost } lets a term fee change be previewed before it is saved
// ─────────────────────────────────────────────────────────────────────────────
// options: termCostOverrides {termId: cost}, typeFeeOverrides {termId: {typeId: fee|null}}, ruleOverrides {feeTypeId: Map|null},
//          chargeOverrides {'termId|feeTypeId': amount|null} (the student's own amounts, to preview a change; null = removed),
//          typeChange {typeId, fromStart}: bill the student as that type from the term starting then (all to preview a change)
const planStudent = async (studentId, { termCostOverrides = {}, typeFeeOverrides = {}, ruleOverrides = {}, chargeOverrides = {}, typeChange = null, feeTypes, ctx: given } = {}) => {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { application: { select: { type: true } } },
  });
  if (!student) throw Object.assign(new Error('Student not found'), { status: 404 });

  const [rows, records, ctx, saved] = await Promise.all([
    prisma.studentBalance.findMany({ where: { student_id: studentId }, include: { term: true } }),
    prisma.feeRecord.findMany({ where: { student_id: studentId }, select: { term_id: true, amount: true } }),
    given ? Promise.resolve(given) : loadContext(),
    prisma.studentCharge.findMany({ where: { student_id: studentId } }),
  ]);
  // this student's own amounts: term id -> Map(fee type id -> { amount, note, fee_type })
  const chargesByTerm = new Map();
  const setCharge = (termId, feeTypeId, amount, note) => {
    if (!chargesByTerm.has(termId)) chargesByTerm.set(termId, new Map());
    if (amount === null || amount === undefined) chargesByTerm.get(termId).delete(feeTypeId);
    else chargesByTerm.get(termId).set(feeTypeId, { amount, note: note || null, fee_type: ctx.feeTypeById?.get(feeTypeId) || null });
  };
  for (const c of saved) setCharge(c.term_id, c.fee_type_id, c.amount, c.note);
  for (const [key, amount] of Object.entries(chargeOverrides)) { const [t, f] = key.split('|'); setCharge(t, f, amount, null); }
  const types = feeTypes || ctx.feeTypes;
  let rules = ctx.rulesByFeeType;
  if (Object.keys(ruleOverrides).length) {
    rules = new Map(rules);
    for (const [ftId, m] of Object.entries(ruleOverrides)) { if (m) rules.set(ftId, m); else rules.delete(ftId); }
  }

  rows.sort((a, b) => new Date(a.term.start_date) - new Date(b.term.start_date));

  const paidByTerm = {};
  for (const r of records) if (r.term_id) paidByTerm[r.term_id] = (paidByTerm[r.term_id] || 0) + r.amount;

  const plan = [];
  rows.forEach((row, i) => {
    const prev = plan[i - 1];
    // the kind of student this term is billed as
    const typeId = typeChange && new Date(row.term.start_date) >= new Date(typeChange.fromStart)
      ? typeChange.typeId
      : (row.student_type_id || student.student_type_id || ctx.defaultTypeId);
    const termCost = termFeeFor(ctx, row.term, typeId, { termCostOverrides, typeFeeOverrides });
    const charge = computeCharge({ student, level: row.level || student.level, termCost, feeTypes: types, isFirstTerm: i === 0, typeId, rules, charges: chargesByTerm.get(row.term_id) || null });

    const total_fees = row.fee_override != null ? round2(row.fee_override) : charge.total;
    // Later terms bring forward the term before. The first term keeps an opening balance it was given
    // (set when the student was imported). A brought-forward amount that came from a term that no longer
    // precedes it (removed or moved) is stale and drops to nothing.
    const carryover = prev ? prev.after.balance : (row.carried_from_term_id ? 0 : round2(row.previous_balance_carryover || 0));
    const amount_paid = round2(paidByTerm[row.term_id] || 0);
    const balance = round2(total_fees + carryover - amount_paid);

    plan.push({
      row,
      student_type_id: typeId,
      breakdown: charge.breakdown,
      before: {
        total_fees: row.total_fees, carryover: row.previous_balance_carryover || 0,
        amount_paid: row.amount_paid, balance: row.balance, status: row.status,
      },
      after: {
        total_fees, carryover, amount_paid, balance, status: statusFor(balance, amount_paid),
        carried_from_term_id: prev ? prev.row.term_id : null,
      },
    });
  });

  for (const p of plan) {
    p.changed = ['total_fees', 'carryover', 'amount_paid', 'balance', 'status'].some((k) =>
      typeof p.after[k] === 'number' ? Math.abs(p.after[k] - p.before[k]) > 0.009 : p.after[k] !== p.before[k]
    ) || (p.after.carried_from_term_id || null) !== (p.row.carried_from_term_id || null);
  }

  return { student, plan };
};

// Writes the changed rows of a plan
const applyPlan = async (plan) => {
  const updates = plan.filter((p) => p.changed).map((p) =>
    prisma.studentBalance.update({
      where: { id: p.row.id },
      data: {
        total_fees: p.after.total_fees,
        previous_balance_carryover: p.after.carryover,
        carried_from_term_id: p.after.carried_from_term_id || null,
        amount_paid: p.after.amount_paid,
        balance: p.after.balance,
        status: p.after.status,
      },
    })
  );
  if (updates.length) await prisma.$transaction(updates);
  return updates.length;
};

// Rebuild one student's term rows from the payments and fee settings on file
const reconcileStudent = async (studentId, opts = {}) => {
  const { plan } = await planStudent(studentId, opts);
  const changed = await applyPlan(plan);
  return { plan, changed };
};

// What a student owes overall, before and after: billed minus paid, so carried-forward debt counts once
const outstandingOf = (plan, side) => round2(plan.reduce((sum, p) => sum + p[side].total_fees - p[side].amount_paid, 0));

// Many students at once. apply=false only reports what would change.
// opts: { apply, termCostOverrides, limitItems, chargeOverridesByStudent: {studentId: {'termId|feeTypeId': amount|null}} }
const reconcileMany = async (studentIds, { apply = false, termCostOverrides = {}, typeFeeOverrides = {}, ruleOverrides = {}, chargeOverridesByStudent = {}, typeChange = null, limitItems = 200 } = {}) => {
  const ctx = await loadContext();
  const summary = {
    students_checked: studentIds.length, students_changed: 0, rows_changed: 0,
    fees_before: 0, fees_after: 0, outstanding_before: 0, outstanding_after: 0, items: [], applied: apply,
  };

  for (const id of studentIds) {
    const { student, plan } = await planStudent(id, { termCostOverrides, typeFeeOverrides, ruleOverrides, chargeOverrides: chargeOverridesByStudent[id] || {}, typeChange, ctx });
    const changedRows = plan.filter((p) => p.changed);
    if (!changedRows.length) continue;

    summary.students_changed += 1;
    summary.rows_changed += changedRows.length;
    summary.fees_before += plan.reduce((s, p) => s + p.before.total_fees, 0);
    summary.fees_after += plan.reduce((s, p) => s + p.after.total_fees, 0);
    summary.outstanding_before += outstandingOf(plan, 'before');
    summary.outstanding_after += outstandingOf(plan, 'after');

    if (summary.items.length < limitItems) {
      summary.items.push({
        student_id: student.id,
        admission_no: student.admission_no,
        rows: changedRows.map((p) => ({
          term: p.row.term.name,
          academic_year: p.row.term.academic_year,
          before: p.before,
          after: { total_fees: p.after.total_fees, carryover: p.after.carryover, amount_paid: p.after.amount_paid, balance: p.after.balance, status: p.after.status },
        })),
      });
    }
    if (apply) await applyPlan(plan);
  }

  for (const k of ['fees_before', 'fees_after', 'outstanding_before', 'outstanding_after']) summary[k] = round2(summary[k]);
  summary.fees_change = round2(summary.fees_after - summary.fees_before);
  summary.outstanding_change = round2(summary.outstanding_after - summary.outstanding_before);
  return summary;
};

const studentIdsInTerm = async (termId) => {
  const rows = await prisma.studentBalance.findMany({ where: { term_id: termId }, select: { student_id: true } });
  return [...new Set(rows.map((r) => r.student_id))];
};

const allStudentIdsWithBalances = async () => {
  const rows = await prisma.studentBalance.findMany({ select: { student_id: true }, distinct: ['student_id'] });
  return rows.map((r) => r.student_id);
};

// Put a student in a term (or refresh the row if they are already in it) with fees worked out
// by the engine. This is what every assign/enrol path calls.
const createStudentBalance = async (studentId, termId, level) => {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, level: true, student_type_id: true } });
  if (!student) throw new Error('Student not found');
  const term = await prisma.term.findUnique({ where: { id: termId }, select: { id: true } });
  if (!term) throw new Error('Term not found');

  const existing = await prisma.studentBalance.findUnique({
    where: { student_term: { student_id: studentId, term_id: termId } },
  });
  if (!existing) {
    await prisma.studentBalance.create({
      data: {
        student_id: studentId, term_id: termId, level: level || student.level, total_fees: 0, amount_paid: 0, balance: 0, status: 'PENDING',
        // billed as the kind of student they are now; later changes to their type do not rewrite this term
        student_type_id: student.student_type_id || (await prisma.studentType.findFirst({ where: { is_default: true }, select: { id: true } }))?.id || null,
      },
    });
  }

  await reconcileStudent(studentId);
  return prisma.studentBalance.findUnique({ where: { student_term: { student_id: studentId, term_id: termId } } });
};

// The charge a student would get for a term, for showing in forms (no writes)
const chargeForStudentTerm = async (studentId, termId) => {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { application: { select: { type: true } }, course: { select: { name: true } } },
  });
  if (!student) throw new Error('Student not found');
  const term = await prisma.term.findUnique({ where: { id: termId } });
  if (!term) throw new Error('Term not found');

  const [ctx, earlier, saved] = await Promise.all([
    loadContext(),
    prisma.studentBalance.count({ where: { student_id: studentId, term: { start_date: { lt: term.start_date } } } }),
    prisma.studentCharge.findMany({ where: { student_id: studentId, term_id: termId } }),
  ]);
  const typeId = student.student_type_id || ctx.defaultTypeId;
  const charges = saved.length ? new Map(saved.map((c) => [c.fee_type_id, { amount: c.amount, note: c.note, fee_type: ctx.feeTypeById.get(c.fee_type_id) || null }])) : null;
  const charge = computeCharge({ student, level: student.level, termCost: termFeeFor(ctx, term, typeId), feeTypes: ctx.feeTypes, isFirstTerm: earlier === 0, typeId, rules: ctx.rulesByFeeType, charges });
  return { totalFees: charge.total, feeBreakdown: charge.breakdown, adjustment: charge.adjustment, level: student.level, course: student.course?.name };
};

module.exports = {
  round2,
  statusFor,
  computeCharge,
  loadContext,
  termFeeFor,
  planStudent,
  applyPlan,
  reconcileStudent,
  reconcileMany,
  studentIdsInTerm,
  allStudentIdsWithBalances,
  createStudentBalance,
  chargeForStudentTerm,
};
