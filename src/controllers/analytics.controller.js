const prisma = require('../config/db');
const { buildStudentWhere } = require('../utils/studentFilters');
const { round2 } = require('../utils/feeTotals');
const { reconcileMany, allStudentIdsWithBalances } = require('../services/billingService');

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE ANALYTICS
//
// Every figure comes from two sources only, so they always agree with each other:
//   billed  = the term balances (StudentBalance.total_fees)
//   paid    = the payments recorded (FeeRecord), matched to the term they were paid for
// What a student owes is billed + any opening balance - paid. A term balance's own `balance` column is never
// summed: it already includes debt brought forward, so adding it up counts the same debt repeatedly.
// ─────────────────────────────────────────────────────────────────────────────

const EPS = 0.01;
const BANDS = [
  { key: 'b1', label: 'Up to 5,000', max: 5000 },
  { key: 'b2', label: '5,001 – 20,000', max: 20000 },
  { key: 'b3', label: '20,001 – 50,000', max: 50000 },
  { key: 'b4', label: '50,001 – 100,000', max: 100000 },
  { key: 'b5', label: 'Over 100,000', max: Infinity },
];

const parseDay = (v, endOfDay = false) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  if (endOfDay) d.setUTCHours(23, 59, 59, 999); else d.setUTCHours(0, 0, 0, 0);
  return d;
};

const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
};

// every month between two dates, so months with no payments show as zero
const monthsBetween = (from, to) => {
  const out = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (d <= end && out.length < 60) {
    out.push(monthKey(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
};

// A group of students (department, course, level...) summed up
const newGroup = (name) => ({ name, students: 0, billed: 0, paid: 0, owing: 0 });
const addToGroup = (g, s) => {
  g.students += 1;
  g.billed += s.billed;
  g.paid += s.paid;
  g.owing += Math.max(0, s.owing); // credit in one student never cancels another's debt
};
const finishGroup = (g) => ({
  name: g.name,
  students: g.students,
  billed: round2(g.billed),
  paid: round2(g.paid),
  owing: round2(g.owing),
  rate: g.billed > 0 ? round2((g.paid / g.billed) * 100) : null,
});

// GET /api/finance/analytics
// Query: term_id, department_id, course_id, level, intake, year, date_from, date_to
const getAnalytics = async (req, res) => {
  try {
    const q = req.query;
    const termId = q.term_id || null;
    // student filters; the term is handled on the term rows below
    const studentWhere = buildStudentWhere({ ...q, term_id: undefined, has_term: undefined, search: undefined });
    const hasStudentFilter = Object.keys(studentWhere).length > 0;

    const from = parseDay(q.date_from);
    const to = parseDay(q.date_to, true);
    const paidAtRange = from || to ? { ...(from && { gte: from }), ...(to && { lte: to }) } : null;

    const studentSelect = {
      id: true, admission_no: true, level: true, intake: true,
      application: { select: { surname: true, other_names: true } },
      course: { select: { name: true } },
      department: { select: { name: true } },
    };

    const [rows, payments, studentsInScope] = await Promise.all([
      prisma.studentBalance.findMany({
        where: { ...(termId && { term_id: termId }), ...(hasStudentFilter && { student: studentWhere }) },
        select: {
          student_id: true, term_id: true, total_fees: true, amount_paid: true,
          previous_balance_carryover: true, carried_from_term_id: true,
          term: { select: { name: true, academic_year: true, start_date: true } },
          student: { select: studentSelect },
        },
      }),
      prisma.feeRecord.findMany({
        where: { ...(termId && { term_id: termId }), ...(hasStudentFilter && { student: studentWhere }) },
        select: { student_id: true, term_id: true, amount: true, paid_at: true, fee_type_id: true, feeType: { select: { name: true } } },
      }),
      termId ? Promise.resolve(null) : prisma.student.count({ where: studentWhere }),
    ]);

    // Payments, by the term they were paid for. Payments not tied to a term cannot be matched to a bill.
    const paidByKey = new Map();
    let unlinked = { count: 0, amount: 0 };
    for (const p of payments) {
      if (!p.term_id) { unlinked.count += 1; unlinked.amount += p.amount; continue; }
      const k = `${p.student_id}|${p.term_id}`;
      paidByKey.set(k, (paidByKey.get(k) || 0) + p.amount);
    }

    // Per term row
    const termRows = rows.map((r) => {
      const paid = paidByKey.get(`${r.student_id}|${r.term_id}`) || 0;
      return { ...r, paid };
    });

    // Per student
    const byStudent = new Map();
    for (const r of termRows) {
      const s = byStudent.get(r.student_id) || { student: r.student, billed: 0, paid: 0, opening: 0, carry: 0 };
      s.billed += r.total_fees;
      s.paid += r.paid;
      // a balance the student started with sits on a row that did not bring it forward from another term
      if (!r.carried_from_term_id) s.opening += r.previous_balance_carryover || 0;
      s.carry += r.previous_balance_carryover || 0;
      byStudent.set(r.student_id, s);
    }
    const students = [...byStudent.entries()].map(([id, s]) => {
      // One term: what is owed includes what was brought into it. Across terms: billed + opening - paid.
      const owing = termId ? s.billed + s.carry - s.paid : s.billed + s.opening - s.paid;
      return { id, ...s, owing };
    });

    // ── headline numbers ──
    const billed = students.reduce((a, s) => a + s.billed, 0);
    const opening = termId ? 0 : students.reduce((a, s) => a + s.opening, 0);
    const carried = termId ? students.reduce((a, s) => a + s.carry, 0) : 0;
    const appliedPaid = students.reduce((a, s) => a + s.paid, 0);
    const outstanding = students.reduce((a, s) => a + Math.max(0, s.owing), 0);
    const credit = students.reduce((a, s) => a + Math.max(0, -s.owing), 0);

    const periodPayments = paidAtRange
      ? payments.filter((p) => (!paidAtRange.gte || p.paid_at >= paidAtRange.gte) && (!paidAtRange.lte || p.paid_at <= paidAtRange.lte))
      : payments;
    const collected = periodPayments.reduce((a, p) => a + p.amount, 0);

    const counts = { fully_paid: 0, part_paid: 0, not_paid: 0, in_credit: 0 };
    for (const s of students) {
      if (s.owing < -EPS) counts.in_credit += 1;
      else if (s.owing <= EPS) { if (s.billed > 0 || s.paid > 0) counts.fully_paid += 1; }
      else if (s.paid > EPS) counts.part_paid += 1;
      else counts.not_paid += 1;
    }

    // ── collections by month ──
    const now = new Date();
    const windowFrom = from || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const windowTo = to || now;
    const monthSums = new Map(monthsBetween(windowFrom, windowTo).map((k) => [k, { amount: 0, count: 0 }]));
    for (const p of payments) {
      if (p.paid_at < windowFrom || p.paid_at > windowTo) continue;
      const m = monthSums.get(monthKey(p.paid_at));
      if (m) { m.amount += p.amount; m.count += 1; }
    }
    const trend = [...monthSums.entries()].map(([month, v]) => ({ month, label: monthLabel(month), amount: round2(v.amount), count: v.count }));

    // ── by term (across terms only) ──
    let byTerm = null;
    if (!termId) {
      const map = new Map();
      for (const r of termRows) {
        const t = map.get(r.term_id) || { term_id: r.term_id, name: r.term.name, academic_year: r.term.academic_year, start: r.term.start_date, students: 0, billed: 0, collected: 0, unpaid: 0 };
        t.students += 1;
        t.billed += r.total_fees;
        t.collected += r.paid;
        t.unpaid += Math.max(0, r.total_fees - r.paid); // for that term alone, earlier terms not counted
        map.set(r.term_id, t);
      }
      byTerm = [...map.values()]
        .sort((a, b) => new Date(a.start) - new Date(b.start))
        .map((t) => ({
          term_id: t.term_id, name: t.name, academic_year: t.academic_year, students: t.students,
          billed: round2(t.billed), collected: round2(t.collected), unpaid: round2(t.unpaid),
          rate: t.billed > 0 ? round2((t.collected / t.billed) * 100) : null,
        }));
    }

    // ── by department / course / level ──
    const groupBy = (keyFn) => {
      const map = new Map();
      for (const s of students) {
        const name = keyFn(s.student) || 'Not set';
        if (!map.has(name)) map.set(name, newGroup(name));
        addToGroup(map.get(name), s);
      }
      return [...map.values()].map(finishGroup).sort((a, b) => b.owing - a.owing);
    };

    // ── how big the debts are ──
    const bands = BANDS.map((b) => ({ key: b.key, label: b.label, students: 0, amount: 0 }));
    for (const s of students) {
      if (s.owing <= EPS) continue;
      const i = BANDS.findIndex((b) => s.owing <= b.max);
      bands[i].students += 1;
      bands[i].amount += s.owing;
    }
    bands.forEach((b) => { b.amount = round2(b.amount); });

    // ── who owes the most ──
    const lastPaid = new Map();
    for (const p of payments) {
      const cur = lastPaid.get(p.student_id);
      if (!cur || p.paid_at > cur) lastPaid.set(p.student_id, p.paid_at);
    }
    const topDebtors = students
      .filter((s) => s.owing > EPS)
      .sort((a, b) => b.owing - a.owing)
      .slice(0, 10)
      .map((s) => ({
        student_id: s.id,
        admission_no: s.student.admission_no,
        name: `${s.student.application?.surname || ''} ${s.student.application?.other_names || ''}`.trim(),
        course: s.student.course?.name || null,
        level: s.student.level,
        billed: round2(s.billed),
        paid: round2(s.paid),
        owing: round2(s.owing),
        last_payment: lastPaid.get(s.id) || null,
      }));

    // ── where the money went (fee types), for the period ──
    const feeTypeMap = new Map();
    for (const p of periodPayments) {
      const name = p.feeType?.name || 'Not yet allocated';
      feeTypeMap.set(name, (feeTypeMap.get(name) || 0) + p.amount);
    }
    const byFeeType = [...feeTypeMap.entries()]
      .map(([name, amount]) => ({ name, amount: round2(amount), unallocated: name === 'Not yet allocated' }))
      .sort((a, b) => b.amount - a.amount);

    // ── latest payments ──
    const recent = await prisma.feeRecord.findMany({
      where: { ...(termId && { term_id: termId }), ...(hasStudentFilter && { student: studentWhere }), ...(paidAtRange && { paid_at: paidAtRange }) },
      orderBy: { paid_at: 'desc' },
      take: 10,
      select: {
        id: true, amount: true, paid_at: true, reference_code: true,
        feeType: { select: { name: true } },
        term: { select: { name: true, academic_year: true } },
        receiver: { select: { email: true } },
        student: { select: { admission_no: true, application: { select: { surname: true, other_names: true } } } },
      },
    });

    // ── things that would make the numbers wrong, said out loud ──
    const mismatched = termRows.filter((r) => Math.abs((r.amount_paid || 0) - r.paid) > EPS).length;
    const studentsWithoutTerm = studentsInScope == null ? null : Math.max(0, studentsInScope - byStudent.size);

    res.json({
      generated_at: new Date().toISOString(),
      scope: { term_id: termId, date_from: from, date_to: to, period_filtered: Boolean(paidAtRange) },
      summary: {
        students_billed: students.length,
        students_not_billed: studentsWithoutTerm,
        billed: round2(billed),
        opening_balance: round2(opening),
        carried_forward: round2(carried),
        collected: round2(collected),
        applied_to_bills: round2(appliedPaid),
        outstanding: round2(outstanding),
        credit: round2(credit),
        // share of what was billed (plus any opening balance) that has been paid
        collection_rate: billed + opening > 0 ? round2((appliedPaid / (billed + opening)) * 100) : null,
        average_owing: counts.part_paid + counts.not_paid > 0 ? round2(outstanding / (counts.part_paid + counts.not_paid)) : 0,
        counts,
      },
      trend,
      by_term: byTerm,
      by_department: groupBy((s) => s.department?.name),
      by_course: groupBy((s) => s.course?.name),
      by_level: groupBy((s) => s.level),
      debt_bands: bands,
      top_debtors: topDebtors,
      by_fee_type: byFeeType,
      recent_payments: recent.map((p) => ({
        id: p.id, amount: p.amount, paid_at: p.paid_at, reference: p.reference_code,
        fee_type: p.feeType?.name || null,
        term: p.term ? `${p.term.name} (${p.term.academic_year})` : null,
        received_by: p.receiver?.email || null,
        admission_no: p.student?.admission_no,
        student: `${p.student?.application?.surname || ''} ${p.student?.application?.other_names || ''}`.trim(),
      })),
      data_quality: {
        unlinked_payments: { count: unlinked.count, amount: round2(unlinked.amount) },
        paid_mismatch_rows: mismatched,
        unallocated_amount: round2(byFeeType.find((f) => f.unallocated)?.amount || 0),
      },
    });
  } catch (err) {
    console.error('Finance analytics error:', err);
    res.status(500).json({ error: 'Could not work out the analytics' });
  }
};

// GET /api/finance/analytics/health
// Are the stored term balances in step with the payments and fee settings? Slower, so it is a separate call.
const getAnalyticsHealth = async (req, res) => {
  try {
    const ids = await allStudentIdsWithBalances();
    const r = await reconcileMany(ids, { apply: false, limitItems: 0 });
    res.json({
      students_checked: r.students_checked,
      students_out_of_date: r.students_changed,
      balances_out_of_date: r.rows_changed,
      owing_would_change_by: r.outstanding_change,
    });
  } catch (err) {
    console.error('Analytics health error:', err);
    res.status(500).json({ error: 'Could not check the balances' });
  }
};

module.exports = { getAnalytics, getAnalyticsHealth };
