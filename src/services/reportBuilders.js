const prisma = require('../config/db');
const { buildStudentWhere, resolveFeeFilterIds, STUDENT_STATUSES, INTAKES, BALANCE_STATUSES } = require('../utils/studentFilters');
const { summarizeBalances, round2 } = require('../utils/feeTotals');
const { planStudent } = require('./billingService');
const { statementFor } = require('./admissionLinkService');

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS
// Each report turns the filters into a structured document:
//   { title, subtitle, filters: [[label, value]], kpis: [{label, value, type}], sections: [{ heading, columns, rows,
//     subtotal }], notes }
// The same document feeds the on-screen preview, the PDF (with the college letterhead) and the Excel file, so all
// three always say the same thing. The title, the grouping and the columns follow the filters that were chosen.
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_ROW_BUDGET = 400;

const cap = (v) => (v ? String(v).charAt(0) + String(v).slice(1).toLowerCase() : '');
const fullName = (a) => [a?.surname, a?.other_names].filter(Boolean).join(' ');
const levelNum = (l) => { const m = String(l || '').match(/\d+/); return m ? parseInt(m[0], 10) : 99; };
const byLevel = (a, b) => levelNum(a) - levelNum(b) || String(a).localeCompare(String(b));
const pct = (part, whole) => (whole > 0.009 ? round2((part / whole) * 100) : 0);
const termName = (t) => (t ? `${t.name} (${t.academic_year})` : '');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// ── what the filters say, in words ──
const describeFilters = async (q, relevant) => {
  const use = (k) => !relevant || relevant.includes(k);
  const [dept, course, term, feeType, type] = await Promise.all([
    use('department_id') && q.department_id ? prisma.department.findUnique({ where: { id: q.department_id }, select: { name: true } }) : null,
    use('course_id') && q.course_id ? prisma.course.findUnique({ where: { id: q.course_id }, select: { name: true } }) : null,
    use('term_id') && q.term_id ? prisma.term.findUnique({ where: { id: q.term_id }, select: { name: true, academic_year: true } }) : null,
    use('fee_type_id') && q.fee_type_id ? prisma.feeType.findUnique({ where: { id: q.fee_type_id }, select: { name: true } }) : null,
    use('student_type_id') && q.student_type_id ? prisma.studentType.findUnique({ where: { id: q.student_type_id }, select: { name: true } }) : null,
  ]);
  const lines = [];
  if (dept) lines.push(['Department', dept.name]);
  if (course) lines.push(['Course', course.name]);
  if (use('level') && q.level) lines.push(['Level', q.level]);
  if (use('intake') && q.intake) lines.push(['Intake', cap(q.intake)]);
  if (use('year') && q.year) lines.push(['Year', q.year]);
  if (use('status') && q.status) lines.push(['Student status', cap(q.status)]);
  if (type) lines.push(['Student type', type.name]);
  if (use('gender') && q.gender) lines.push(['Gender', q.gender]);
  if (use('helb') && q.helb) lines.push(['HELB', q.helb === 'true' ? 'Applied' : 'Not applied']);
  if (term) lines.push(['Term', termName(term)]);
  if (use('fee_status') && q.fee_status) lines.push(['Fee status', cap(q.fee_status)]);
  if (use('outstanding_only') && q.outstanding_only === 'true') lines.push(['Balance', 'Outstanding only']);
  if (use('min_balance') && q.min_balance) lines.push(['Owing at least', `KES ${Number(q.min_balance).toLocaleString('en-US')}`]);
  if (feeType) lines.push(['Fee type', feeType.name]);
  if (use('date_from') && q.date_from) lines.push(['From', q.date_from]);
  if (use('date_to') && q.date_to) lines.push(['To', q.date_to]);
  if (use('search') && q.search) lines.push(['Search', q.search]);
  return lines;
};

// "Term 2 · Social Work · Level 5": the part of the filters that says which students and when
const scopeText = (lines) => {
  const want = ['Term', 'Department', 'Course', 'Level', 'Intake', 'Year', 'Student type', 'Student status', 'Fee type'];
  const parts = want.map((k) => lines.find(([l]) => l === k)).filter(Boolean).map(([, v]) => v);
  return parts.join('  ·  ') || 'All students';
};

// ── the students in scope, with their fee position ──
// One row per student. With a term chosen the row is that term; otherwise it is everything the student was billed.
const loadStudentFeeRows = async (q) => {
  const studentWhere = buildStudentWhere(q);
  const feeIds = await resolveFeeFilterIds(q);
  if (feeIds) studentWhere.id = { in: feeIds };

  const balances = await prisma.studentBalance.findMany({
    where: { student: studentWhere, ...(q.term_id ? { term_id: q.term_id } : {}) },
    include: {
      term: { select: { id: true, name: true, academic_year: true, start_date: true } },
      student: {
        select: {
          id: true, admission_no: true, level: true, intake: true, year: true, status: true,
          student_type: { select: { name: true } },
          application: { select: { surname: true, other_names: true, gender: true, phone: true } },
          course: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      },
    },
  });

  const byStudent = new Map();
  for (const b of balances) {
    if (!byStudent.has(b.student_id)) byStudent.set(b.student_id, { student: b.student, rows: [] });
    byStudent.get(b.student_id).rows.push(b);
  }

  const statusOfRow = (s) => ({ PAID: 'Cleared', PARTIAL: 'Partial', PENDING: 'Unpaid', OVERDUE: 'Overdue' }[s] || cap(s));
  const rows = [];
  for (const { student, rows: rs } of byStudent.values()) {
    const sorted = [...rs].sort((x, y) => new Date(x.term.start_date) - new Date(y.term.start_date));
    let billed; let paid; let balance; let bf = null; let status; let termText;
    if (q.term_id) {
      const r = sorted[0];
      billed = r.total_fees; paid = r.amount_paid; balance = r.balance; bf = r.previous_balance_carryover || 0;
      status = statusOfRow(r.status); termText = termName(r.term);
    } else {
      const m = summarizeBalances(sorted);
      billed = m.totalFees; paid = m.totalPaid; balance = m.outstanding;
      const overdue = sorted.some((r) => r.status === 'OVERDUE');
      status = balance <= 0.009 ? 'Cleared' : overdue ? 'Overdue' : paid > 0.009 ? 'Partial' : 'Unpaid';
      termText = `${sorted.length} term${sorted.length === 1 ? '' : 's'}`;
    }
    rows.push({
      id: student.id, admission_no: student.admission_no, name: fullName(student.application),
      gender: student.application?.gender || '', phone: student.application?.phone || '',
      course: student.course?.name || 'No course', department: student.department?.name || 'No department',
      level: student.level, intake: cap(student.intake), year: student.year, student_status: cap(student.status),
      type: student.student_type?.name || '', term: termText, terms: sorted.length,
      billed: round2(billed), paid: round2(paid), balance: round2(balance), bf: bf === null ? null : round2(bf), status,
      termRows: sorted,
    });
  }
  return rows;
};

const sortRows = (rows, sort) => {
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    balance: (a, b) => b.balance - a.balance || a.name.localeCompare(b.name),
    admission: (a, b) => a.admission_no.localeCompare(b.admission_no),
  }[sort] || ((a, b) => a.admission_no.localeCompare(b.admission_no));
  return [...rows].sort(by);
};

const sum = (arr, f) => round2(arr.reduce((s, x) => s + (Number(x[f]) || 0), 0));

// How the students are split into sections: chosen by the person, or sensibly from the filters
const pickGrouping = (q, allowed, fallbackFor) => {
  const g = q.group_by && q.group_by !== 'auto' && allowed.includes(q.group_by) ? q.group_by : null;
  if (g) return g;
  return fallbackFor();
};
const autoGroupForStudents = (q) => (q.course_id ? 'level' : q.department_id ? 'course' : 'department');

const groupLabelFor = (mode, r) => {
  if (mode === 'course') return `${r.department} — ${r.course}`;
  if (mode === 'level') return r.level;
  if (mode === 'department') return r.department;
  if (mode === 'type') return r.type || 'No student type';
  return 'All students';
};
const groupRows = (rows, mode) => {
  const map = new Map();
  for (const r of rows) {
    const k = groupLabelFor(mode, r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  const keys = [...map.keys()].sort((a, b) => (mode === 'level' ? byLevel(a, b) : a.localeCompare(b)));
  return keys.map((k) => ({ key: k, rows: map.get(k) }));
};

// Rows past the preview budget are left out of the on-screen copy; the PDF and Excel files carry every row
const budgetSections = (sections, full) => {
  if (full) return sections;
  let left = PREVIEW_ROW_BUDGET;
  return sections.map((s) => {
    const total = s.rows.length;
    if (total <= left) { left -= total; return { ...s, total_rows: total, omitted: 0 }; }
    const kept = Math.max(left, 0); left = 0;
    return { ...s, rows: s.rows.slice(0, kept), total_rows: total, omitted: total - kept };
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. FEE BALANCES & ARREARS
// ═════════════════════════════════════════════════════════════════════════════
const FEE_SCOPE_FILTERS = ['department_id', 'course_id', 'level', 'intake', 'year', 'status', 'student_type_id', 'term_id', 'fee_status', 'outstanding_only', 'helb', 'gender', 'search'];

const feeBalances = async (q, { full }) => {
  const filterLines = await describeFilters(q, [...FEE_SCOPE_FILTERS, 'min_balance']);
  let rows = await loadStudentFeeRows(q);
  const min = parseFloat(q.min_balance);
  if (!isNaN(min)) rows = rows.filter((r) => r.balance >= min);
  rows = sortRows(rows, q.sort === 'balance' || q.sort === 'name' ? q.sort : (q.outstanding_only === 'true' ? 'balance' : 'admission'));

  const arrearsMode = q.outstanding_only === 'true' || !isNaN(min);
  const mode = pickGrouping(q, ['department', 'course', 'level', 'type', 'none'], () => autoGroupForStudents(q));
  const withBf = Boolean(q.term_id) && rows.some((r) => r.bf);

  const columns = (m) => [
    { key: 'n', label: '#', type: 'int', w: 3 },
    { key: 'admission_no', label: 'Adm. No', w: 12 },
    { key: 'name', label: 'Student', w: 25 },
    ...(m === 'none' || m === 'department' || m === 'type' ? [{ key: 'course', label: 'Course', w: 20 }] : []),
    ...(m !== 'level' ? [{ key: 'level', label: 'Level', w: 7 }] : []),
    ...(q.term_id ? [] : [{ key: 'term', label: 'Billed for', w: 8 }]),
    ...(withBf ? [{ key: 'bf', label: 'B/F (KES)', type: 'money', w: 11 }] : []),
    { key: 'billed', label: 'Billed (KES)', type: 'money', w: 12 },
    { key: 'paid', label: 'Paid (KES)', type: 'money', w: 12 },
    { key: 'balance', label: q.term_id ? 'Balance (KES)' : 'Outstanding (KES)', type: 'money', w: 13 },
    { key: 'status', label: 'Status', w: 8 },
  ];

  const sections = groupRows(rows, mode).map((g) => ({
    heading: mode === 'none' ? 'Students' : g.key,
    columns: columns(mode),
    rows: g.rows.map((r, i) => ({ ...r, n: i + 1 })),
    subtotal: { label: `Subtotal · ${g.rows.length} student${g.rows.length === 1 ? '' : 's'}`, values: { billed: sum(g.rows, 'billed'), paid: sum(g.rows, 'paid'), balance: sum(g.rows, 'balance'), ...(withBf ? { bf: sum(g.rows, 'bf') } : {}) } },
  }));

  // a short count by fee status closes the report
  const statuses = ['Cleared', 'Partial', 'Unpaid', 'Overdue'].map((s) => {
    const rs = rows.filter((r) => r.status === s);
    return { status: s, students: rs.length, billed: sum(rs, 'billed'), paid: sum(rs, 'paid'), balance: sum(rs, 'balance') };
  }).filter((x) => x.students > 0);
  if (rows.length) {
    sections.push({
      heading: 'Summary by fee status',
      columns: [
        { key: 'status', label: 'Fee status', w: 16 }, { key: 'students', label: 'Students', type: 'int', w: 10 },
        { key: 'billed', label: 'Billed (KES)', type: 'money', w: 14 }, { key: 'paid', label: 'Paid (KES)', type: 'money', w: 14 },
        { key: 'balance', label: q.term_id ? 'Balance (KES)' : 'Outstanding (KES)', type: 'money', w: 16 },
      ],
      rows: statuses,
      subtotal: { label: 'Total', values: { students: rows.length, billed: sum(rows, 'billed'), paid: sum(rows, 'paid'), balance: sum(rows, 'balance') } },
    });
  }

  const billed = sum(rows, 'billed'); const paid = sum(rows, 'paid');
  const owing = rows.filter((r) => r.balance > 0.009);
  // net of anyone who has paid more than was billed, the same figure the collection summary and dashboard use
  const credits = round2(Math.abs(sum(rows.filter((r) => r.balance < -0.009), 'balance')));
  const notes = [];
  if (credits > 0) notes.push('Outstanding is net of students who have paid more than was billed; their credit is shown separately.');
  if (!q.term_id) notes.push('Outstanding is what was billed minus what was paid across every term the student was billed for. Debt carried from an earlier term is counted once.');
  else notes.push('Balances are for the chosen term and include any balance brought forward (B/F) from earlier terms.');

  return {
    title: arrearsMode ? 'Outstanding Fee Balances' : 'Fee Balances Report',
    subtitle: scopeText(filterLines),
    filters: filterLines,
    kpis: [
      { label: 'Students', value: rows.length, type: 'int' },
      { label: 'Total billed', value: billed, type: 'money' },
      { label: 'Total paid', value: paid, type: 'money' },
      { label: q.term_id ? 'Balance due (incl. B/F)' : 'Outstanding', value: sum(rows, 'balance'), type: 'money' },
      { label: 'Collection rate', value: pct(paid, billed), type: 'percent' },
      { label: 'Students owing', value: owing.length, type: 'int' },
      ...(credits > 0 ? [{ label: 'Credits (overpaid)', value: credits, type: 'money' }] : []),
    ],
    sections: budgetSections(sections, full),
    notes,
    signoff: true,
    flat: { columns: [
      { key: 'admission_no', label: 'Adm. No' }, { key: 'name', label: 'Student' }, { key: 'department', label: 'Department' }, { key: 'course', label: 'Course' },
      { key: 'level', label: 'Level' }, { key: 'intake', label: 'Intake' }, { key: 'year', label: 'Year' }, { key: 'type', label: 'Student type' }, { key: 'term', label: 'Term' },
      ...(withBf ? [{ key: 'bf', label: 'B/F (KES)', type: 'money' }] : []),
      { key: 'billed', label: 'Billed (KES)', type: 'money' }, { key: 'paid', label: 'Paid (KES)', type: 'money' }, { key: 'balance', label: q.term_id ? 'Balance (KES)' : 'Outstanding (KES)', type: 'money' }, { key: 'status', label: 'Status' },
    ], rows },
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// 2. COLLECTIONS (PAYMENTS RECEIVED)
// ═════════════════════════════════════════════════════════════════════════════
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const monthKey = (d) => new Date(d).toISOString().slice(0, 7);
const monthLabel = (k) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (k) => new Date(`${k}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const parseDay = (v, end) => { if (!v) return null; const d = new Date(v); if (isNaN(d.getTime())) return null; if (end) d.setHours(23, 59, 59, 999); return d; };

const feeCollections = async (q, { full }) => {
  const scope = ['department_id', 'course_id', 'level', 'intake', 'year', 'status', 'student_type_id', 'term_id', 'fee_type_id', 'date_from', 'date_to', 'search', 'gender', 'helb'];
  const filterLines = await describeFilters(q, scope);
  const from = parseDay(q.date_from); const to = parseDay(q.date_to, true);

  const records = await prisma.feeRecord.findMany({
    where: {
      student: buildStudentWhere(q),
      ...(q.term_id ? { term_id: q.term_id } : {}),
      ...(q.fee_type_id ? { fee_type_id: q.fee_type_id } : {}),
      ...((from || to) ? { paid_at: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}),
    },
    include: {
      feeType: { select: { name: true } },
      term: { select: { name: true, academic_year: true } },
      receiver: { select: { email: true } },
      student: { select: { id: true, admission_no: true, level: true, application: { select: { surname: true, other_names: true } }, course: { select: { name: true } } } },
    },
    orderBy: { paid_at: 'asc' },
  });

  const rows = records.map((r) => ({
    paid_at: r.paid_at, day: dayKey(r.paid_at), month: monthKey(r.paid_at), reference: r.reference_code || '',
    admission_no: r.student.admission_no, student_id: r.student.id, name: fullName(r.student.application), course: r.student.course?.name || '', level: r.student.level,
    term: r.term ? termName(r.term) : '', fee_type: r.feeType?.name || 'Unallocated', amount: round2(r.amount),
    received_by: (r.receiver?.email || '').split('@')[0], notes: r.notes || '',
  }));
  const total = sum(rows, 'amount');

  const groupBy = (keyFn) => {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  };

  const sections = [];
  if (rows.length) {
    const byType = groupBy((r) => r.fee_type);
    sections.push({
      heading: 'Collections by fee type',
      columns: [{ key: 'fee_type', label: 'Fee type', w: 24 }, { key: 'payments', label: 'Payments', type: 'int', w: 10 }, { key: 'amount', label: 'Amount (KES)', type: 'money', w: 16 }, { key: 'share', label: 'Share', type: 'percent', w: 9 }],
      rows: [...byType.entries()].map(([k, rs]) => ({ fee_type: k, payments: rs.length, amount: sum(rs, 'amount'), share: pct(sum(rs, 'amount'), total) })).sort((a, b) => b.amount - a.amount),
      subtotal: { label: 'Total', values: { payments: rows.length, amount: total, share: 100 } },
    });

    // by day when the period is short, otherwise by month
    const spanDays = from && to ? (to - from) / 86400000 : (new Date(rows[rows.length - 1].paid_at) - new Date(rows[0].paid_at)) / 86400000;
    const perDay = spanDays <= 45;
    const periods = groupBy((r) => (perDay ? r.day : r.month));
    let running = 0;
    sections.push({
      heading: perDay ? 'Collections by day' : 'Collections by month',
      columns: [{ key: 'period', label: perDay ? 'Day' : 'Month', w: 22 }, { key: 'payments', label: 'Payments', type: 'int', w: 10 }, { key: 'amount', label: 'Amount (KES)', type: 'money', w: 16 }, { key: 'running', label: 'Running total (KES)', type: 'money', w: 18 }],
      rows: [...periods.keys()].sort().map((k) => { const rs = periods.get(k); const a = sum(rs, 'amount'); running = round2(running + a); return { period: perDay ? dayLabel(k) : monthLabel(k), payments: rs.length, amount: a, running }; }),
      subtotal: { label: 'Total', values: { payments: rows.length, amount: total } },
    });

    sections.push({
      heading: 'Payments received',
      columns: [
        { key: 'paid_at', label: 'Date', type: 'date', w: 10 }, { key: 'reference', label: 'Reference', w: 15 }, { key: 'admission_no', label: 'Adm. No', w: 12 },
        { key: 'name', label: 'Student', w: 21 }, { key: 'term', label: 'Term', w: 15 }, { key: 'fee_type', label: 'Fee type', w: 12 },
        { key: 'amount', label: 'Amount (KES)', type: 'money', w: 12 }, { key: 'received_by', label: 'Received by', w: 11 },
      ],
      rows,
      subtotal: { label: `Total · ${rows.length} payment${rows.length === 1 ? '' : 's'}`, values: { amount: total } },
    });
  }

  const students = new Set(rows.map((r) => r.student_id)).size;
  const periodText = rows.length ? `${new Date(rows[0].paid_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} – ${new Date(rows[rows.length - 1].paid_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'no payments';
  return {
    title: 'Fee Collections Report',
    subtitle: [from || to ? `Payments ${q.date_from ? 'from ' + q.date_from : ''}${q.date_to ? ' to ' + q.date_to : ''}`.trim() : null, scopeText(filterLines)].filter(Boolean).join('  ·  '),
    filters: filterLines,
    kpis: [
      { label: 'Total collected', value: total, type: 'money' },
      { label: 'Payments', value: rows.length, type: 'int' },
      { label: 'Students who paid', value: students, type: 'int' },
      { label: 'Average payment', value: rows.length ? round2(total / rows.length) : 0, type: 'money' },
      { label: 'Largest payment', value: rows.length ? Math.max(...rows.map((r) => r.amount)) : 0, type: 'money' },
      { label: 'Period', value: periodText, type: 'text' },
    ],
    sections: budgetSections(sections, full),
    notes: ['A payment not yet allocated to a fee type is shown as "Unallocated".'],
    signoff: true,
    flat: { columns: [
      { key: 'paid_at', label: 'Date', type: 'date' }, { key: 'reference', label: 'Reference' }, { key: 'admission_no', label: 'Adm. No' }, { key: 'name', label: 'Student' },
      { key: 'course', label: 'Course' }, { key: 'level', label: 'Level' }, { key: 'term', label: 'Term' }, { key: 'fee_type', label: 'Fee type' },
      { key: 'amount', label: 'Amount (KES)', type: 'money' }, { key: 'received_by', label: 'Received by' }, { key: 'notes', label: 'Notes' },
    ], rows },
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// 3. FEE COLLECTION SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
const feeSummary = async (q, { full }) => {
  const filterLines = await describeFilters(q, FEE_SCOPE_FILTERS);
  const rows = await loadStudentFeeRows(q);
  const dim = ['department', 'course', 'level', 'term', 'type'].includes(q.group_by) ? q.group_by : (q.course_id ? 'level' : q.department_id ? 'course' : 'department');
  const dimLabel = { department: 'Department', course: 'Course', level: 'Level', term: 'Term', type: 'Student type' }[dim];

  const groups = new Map();
  const add = (key, o) => {
    if (!groups.has(key)) groups.set(key, { key, students: 0, billed: 0, paid: 0, balance: 0, cleared: 0, partial: 0, unpaid: 0 });
    const g = groups.get(key);
    g.students += o.students; g.billed += o.billed; g.paid += o.paid; g.balance += o.balance;
    g.cleared += o.cleared; g.partial += o.partial; g.unpaid += o.unpaid;
  };
  if (dim === 'term') {
    // by term: each student-term bill counts once; outstanding is billed minus paid for that term
    for (const r of rows) for (const b of r.termRows) {
      const due = b.total_fees - b.amount_paid;
      add(termName(b.term), { students: 1, billed: b.total_fees, paid: b.amount_paid, balance: due, cleared: due <= 0.009 ? 1 : 0, partial: due > 0.009 && b.amount_paid > 0.009 ? 1 : 0, unpaid: due > 0.009 && b.amount_paid <= 0.009 ? 1 : 0 });
    }
  } else {
    for (const r of rows) add(groupLabelFor(dim === 'course' ? 'course' : dim, r), { students: 1, billed: r.billed, paid: r.paid, balance: r.balance, cleared: r.status === 'Cleared' ? 1 : 0, partial: r.status === 'Partial' ? 1 : 0, unpaid: ['Unpaid', 'Overdue'].includes(r.status) ? 1 : 0 });
  }
  const list = [...groups.values()].sort((a, b) => (dim === 'level' ? byLevel(a.key, b.key) : dim === 'term' ? 0 : a.key.localeCompare(b.key)))
    .map((g) => ({ ...g, billed: round2(g.billed), paid: round2(g.paid), balance: round2(g.balance), rate: pct(g.paid, g.billed) }));

  const totalRow = list.reduce((t, g) => ({ students: t.students + g.students, billed: t.billed + g.billed, paid: t.paid + g.paid, balance: t.balance + g.balance, cleared: t.cleared + g.cleared, partial: t.partial + g.partial, unpaid: t.unpaid + g.unpaid }), { students: 0, billed: 0, paid: 0, balance: 0, cleared: 0, partial: 0, unpaid: 0 });
  const sections = list.length ? [{
    heading: `Collection by ${dimLabel.toLowerCase()}`,
    columns: [
      { key: 'key', label: dimLabel, w: 28 }, { key: 'students', label: dim === 'term' ? 'Bills' : 'Students', type: 'int', w: 8 },
      { key: 'billed', label: 'Billed (KES)', type: 'money', w: 13 }, { key: 'paid', label: 'Collected (KES)', type: 'money', w: 14 },
      { key: 'balance', label: 'Outstanding (KES)', type: 'money', w: 15 }, { key: 'rate', label: 'Collected %', type: 'percent', w: 9 },
      { key: 'cleared', label: 'Cleared', type: 'int', w: 7 }, { key: 'partial', label: 'Partial', type: 'int', w: 7 }, { key: 'unpaid', label: 'Unpaid', type: 'int', w: 7 },
    ],
    rows: list,
    subtotal: { label: 'Total', values: { students: totalRow.students, billed: round2(totalRow.billed), paid: round2(totalRow.paid), balance: round2(totalRow.balance), rate: pct(totalRow.paid, totalRow.billed), cleared: totalRow.cleared, partial: totalRow.partial, unpaid: totalRow.unpaid } },
  }] : [];

  return {
    title: 'Fee Collection Summary',
    subtitle: `${scopeText(filterLines)}  ·  by ${dimLabel.toLowerCase()}`,
    filters: filterLines,
    kpis: [
      { label: 'Students', value: rows.length, type: 'int' },
      { label: 'Total billed', value: round2(totalRow.billed), type: 'money' },
      { label: 'Collected', value: round2(totalRow.paid), type: 'money' },
      { label: 'Outstanding', value: round2(totalRow.balance), type: 'money' },
      { label: 'Collection rate', value: pct(totalRow.paid, totalRow.billed), type: 'percent' },
      { label: dim === 'term' ? 'Bills cleared' : 'Fully cleared', value: totalRow.cleared, type: 'int' },
    ],
    sections: budgetSections(sections, full),
    notes: [dim === 'term'
      ? 'By term, outstanding is billed minus paid for that term alone; a student appears once for every term they were billed for.'
      : 'Outstanding is billed minus paid across the terms in scope, with carried-forward debt counted once.'],
    signoff: true,
    flat: { columns: [{ key: 'key', label: dimLabel }, { key: 'students', label: 'Students', type: 'int' }, { key: 'billed', label: 'Billed (KES)', type: 'money' }, { key: 'paid', label: 'Collected (KES)', type: 'money' }, { key: 'balance', label: 'Outstanding (KES)', type: 'money' }, { key: 'rate', label: 'Collected %', type: 'percent' }], rows: list },
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// 4. STUDENT REGISTER
// ═════════════════════════════════════════════════════════════════════════════
const studentRegister = async (q, { full }) => {
  const scope = ['department_id', 'course_id', 'level', 'intake', 'year', 'status', 'student_type_id', 'term_id', 'gender', 'helb', 'search'];
  const filterLines = await describeFilters(q, scope);
  const students = await prisma.student.findMany({
    where: buildStudentWhere(q),
    select: {
      id: true, admission_no: true, level: true, intake: true, year: true, status: true,
      student_type: { select: { name: true } },
      application: { select: { surname: true, other_names: true, gender: true, phone: true } },
      course: { select: { name: true } }, department: { select: { name: true } },
    },
    orderBy: { admission_no: 'asc' },
  });
  const rows = students.map((s) => ({
    admission_no: s.admission_no, name: fullName(s.application), gender: s.application?.gender || '', phone: s.application?.phone || '',
    course: s.course?.name || 'No course', department: s.department?.name || 'No department', level: s.level,
    intake: `${cap(s.intake)} ${s.year}`, student_status: cap(s.status), type: s.student_type?.name || '',
  }));
  const hasTypes = rows.some((r) => r.type);
  const sorted = q.sort === 'name' ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : rows;
  const mode = pickGrouping(q, ['department', 'course', 'level', 'type', 'none'], () => (q.course_id ? 'level' : q.department_id ? 'course' : 'course'));

  const columns = (m) => [
    { key: 'n', label: '#', type: 'int', w: 3 }, { key: 'admission_no', label: 'Adm. No', w: 13 }, { key: 'name', label: 'Student', w: 25 },
    { key: 'gender', label: 'Gender', w: 7 },
    ...(m !== 'level' ? [{ key: 'level', label: 'Level', w: 8 }] : []),
    { key: 'intake', label: 'Intake', w: 12 }, { key: 'phone', label: 'Phone', w: 12 },
    ...(hasTypes ? [{ key: 'type', label: 'Type', w: 9 }] : []),
    { key: 'student_status', label: 'Status', w: 9 },
  ];
  const sections = groupRows(sorted.map((r) => ({ ...r })), mode === 'course' ? 'course' : mode).map((g) => ({
    heading: mode === 'none' ? 'Students' : g.key,
    columns: columns(mode),
    rows: g.rows.map((r, i) => ({ ...r, n: i + 1 })),
    subtotal: { label: `${g.rows.length} student${g.rows.length === 1 ? '' : 's'}`, values: {} },
  }));

  const count = (f, v) => rows.filter((r) => r[f] === v).length;
  return {
    title: 'Student Register',
    subtitle: scopeText(filterLines),
    filters: filterLines,
    kpis: [
      { label: 'Students', value: rows.length, type: 'int' },
      { label: 'Male', value: rows.filter((r) => /^m/i.test(r.gender)).length, type: 'int' },
      { label: 'Female', value: rows.filter((r) => /^f/i.test(r.gender)).length, type: 'int' },
      { label: 'Active', value: count('student_status', 'Active'), type: 'int' },
      { label: 'Completed', value: count('student_status', 'Completed'), type: 'int' },
      { label: 'Graduated', value: count('student_status', 'Graduated'), type: 'int' },
    ],
    sections: budgetSections(sections, full),
    notes: [],
    signoff: false,
    flat: { columns: [{ key: 'admission_no', label: 'Adm. No' }, { key: 'name', label: 'Student' }, { key: 'gender', label: 'Gender' }, { key: 'department', label: 'Department' }, { key: 'course', label: 'Course' }, { key: 'level', label: 'Level' }, { key: 'intake', label: 'Intake' }, { key: 'phone', label: 'Phone' }, { key: 'type', label: 'Student type' }, { key: 'student_status', label: 'Status' }], rows: sorted },
  };
};


// ═════════════════════════════════════════════════════════════════════════════
// 5. ONE STUDENT'S FEE STATEMENT
// ═════════════════════════════════════════════════════════════════════════════
const statusLabel = (st) => ({ PAID: 'Cleared', PARTIAL: 'Partial', PENDING: 'Unpaid', OVERDUE: 'Overdue' }[st] || cap(st));
const dayText = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const safeFile = (v) => String(v || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

const studentStatement = async (q, { audience }) => {
  if (!q.student_id) throw fail('Choose a student');
  const forStudent = audience === 'student';
  const st = await prisma.student.findUnique({
    where: { id: q.student_id },
    include: {
      application: true,
      course: { select: { name: true } }, department: { select: { name: true } }, student_type: { select: { name: true } },
      current_term: { select: { name: true, academic_year: true } }, user: { select: { email: true } },
    },
  });
  if (!st) throw fail('Student not found', 404);

  const [rowsRaw, records, planRes, group] = await Promise.all([
    prisma.studentBalance.findMany({ where: { student_id: st.id }, include: { term: true } }),
    prisma.feeRecord.findMany({
      where: { student_id: st.id },
      include: { feeType: { select: { name: true } }, term: { select: { name: true, academic_year: true } }, receiver: { select: { email: true } } },
      orderBy: { paid_at: 'asc' },
    }),
    planStudent(st.id).catch(() => null),
    statementFor(st.id).catch(() => null),
  ]);
  const rows = [...rowsRaw].sort((a, b) => new Date(a.term.start_date) - new Date(b.term.start_date));
  const money = summarizeBalances(rows);
  const name = fullName(st.application);
  const planByRow = new Map((planRes?.plan || []).map((p) => [p.row.id, p]));
  const allocated = records.filter((r) => r.term_id);
  const loose = records.filter((r) => !r.term_id);

  // 1. fees by term
  const termRows = rows.map((r) => ({ term: termName(r.term), level: r.level || st.level, billed: round2(r.total_fees), bf: round2(r.previous_balance_carryover || 0), paid: round2(r.amount_paid), balance: round2(r.balance), status: statusLabel(r.status) }));

  // 2. what each term's bill is made of; anything the engine's breakdown does not explain is shown as its own line
  const charges = [];
  for (const r of rows) {
    const lines = (planByRow.get(r.id)?.breakdown || []).filter((b) => Math.abs(b.amount) > 0.009);
    const explained = round2(lines.reduce((t, b) => t + b.amount, 0));
    const kindLabel = { term: 'Term fee', 'every term': 'Every term', once: 'Once', adjustment: 'Adjustment' };
    let first = true;
    const push = (item, billing, amount) => { charges.push({ term: first ? termName(r.term) : '', item, billing, amount: round2(amount) }); first = false; };
    if (lines.length) {
      lines.forEach((b) => push(b.name, kindLabel[b.kind] || '', b.amount));
      const diff = round2(r.total_fees - Math.max(0, explained));
      if (Math.abs(diff) > 0.009) push(r.fee_override != null ? 'Fee set manually for this term' : 'Other adjustment', 'Adjustment', diff);
    } else push('Fees billed', '', r.total_fees);
    charges.push({ term: '', item: 'Term total', billing: '', amount: round2(r.total_fees), _bold: true });
  }

  // 3. payments
  let runPaid = 0;
  const payments = records.map((r) => {
    runPaid = round2(runPaid + r.amount);
    return { paid_at: r.paid_at, reference: r.reference_code || '', term: r.term ? termName(r.term) : 'Not allocated to a term', fee_type: r.feeType?.name || 'Unallocated', amount: round2(r.amount), running: runPaid, received_by: (r.receiver?.email || '').split('@')[0], notes: r.notes || '' };
  });
  const totalPayments = sum(payments, 'amount');

  // 4. statement of account: bills and payments in date order, with the balance after each
  const events = [];
  rows.forEach((r, i) => {
    const open = r.previous_balance_carryover || 0;
    if (i === 0 && !r.carried_from_term_id && Math.abs(open) > 0.009) events.push({ date: r.term.start_date, order: 0, desc: 'Balance brought forward', debit: Math.max(open, 0), credit: Math.max(-open, 0) });
    events.push({ date: r.term.start_date, order: 1, desc: `${termName(r.term)}: fees billed`, debit: r.total_fees, credit: 0 });
  });
  allocated.forEach((r) => events.push({ date: r.paid_at, order: 2, desc: `Payment${r.reference_code ? ' ' + r.reference_code : ''} · ${r.feeType?.name || 'Unallocated'}${r.term ? ` (${r.term.name})` : ''}`, debit: 0, credit: r.amount }));
  events.sort((a, b) => new Date(a.date) - new Date(b.date) || a.order - b.order);
  let bal = 0;
  const ledger = events.map((e) => { bal = round2(bal + e.debit - e.credit); return { date: e.date, desc: e.desc, debit: e.debit ? round2(e.debit) : '', credit: e.credit ? round2(e.credit) : '', balance: bal }; });
  const ledgerClosing = bal;

  const sections = [];
  if (rows.length) {
    sections.push({
      heading: 'Fees by term',
      columns: [
        { key: 'term', label: 'Term', w: 24 }, { key: 'level', label: 'Level', w: 8 }, { key: 'billed', label: 'Billed (KES)', type: 'money', w: 13 },
        { key: 'bf', label: 'B/F (KES)', type: 'money', w: 12 }, { key: 'paid', label: 'Paid (KES)', type: 'money', w: 13 }, { key: 'balance', label: 'Balance (KES)', type: 'money', w: 13 }, { key: 'status', label: 'Status', w: 9 },
      ],
      rows: termRows,
      subtotal: { label: 'Total', values: { billed: money.totalFees, paid: money.totalPaid, balance: money.outstanding } },
    });
    sections.push({
      heading: 'What each term was billed for',
      columns: [{ key: 'term', label: 'Term', w: 24 }, { key: 'item', label: 'Fee item', w: 28 }, { key: 'billing', label: 'Billed', w: 11 }, { key: 'amount', label: 'Amount (KES)', type: 'money', w: 14 }],
      rows: charges,
      subtotal: { label: 'Total billed', values: { amount: money.totalFees } },
    });
  }
  if (payments.length) {
    sections.push({
      heading: 'Payments received',
      columns: [
        { key: 'paid_at', label: 'Date', type: 'date', w: 10 }, { key: 'reference', label: 'Reference', w: 16 }, { key: 'term', label: 'Term', w: 20 }, { key: 'fee_type', label: 'Fee type', w: 12 },
        { key: 'amount', label: 'Amount (KES)', type: 'money', w: 13 }, { key: 'running', label: 'Total paid so far (KES)', type: 'money', w: 16 },
        ...(forStudent ? [] : [{ key: 'received_by', label: 'Received by', w: 11 }, { key: 'notes', label: 'Notes', w: 18 }]),
      ],
      rows: payments,
      subtotal: { label: `Total · ${payments.length} payment${payments.length === 1 ? '' : 's'}`, values: { amount: totalPayments } },
    });
  }
  if (ledger.length) {
    sections.push({
      heading: 'Statement of account',
      columns: [{ key: 'date', label: 'Date', type: 'date', w: 10 }, { key: 'desc', label: 'Description', w: 44 }, { key: 'debit', label: 'Billed (KES)', type: 'money', w: 13 }, { key: 'credit', label: 'Paid (KES)', type: 'money', w: 13 }, { key: 'balance', label: 'Balance (KES)', type: 'money', w: 14 }],
      rows: ledger,
      subtotal: { label: 'Closing balance', values: { debit: round2(ledger.reduce((t, e) => t + (Number(e.debit) || 0), 0)), credit: round2(ledger.reduce((t, e) => t + (Number(e.credit) || 0), 0)), balance: ledgerClosing } },
    });
  }
  if (group && group.admissions.length > 1) {
    sections.push({
      heading: 'All admissions of this student',
      columns: [{ key: 'admission_no', label: 'Admission', w: 16 }, { key: 'course', label: 'Course', w: 26 }, { key: 'level', label: 'Level', w: 8 }, { key: 'status', label: 'Status', w: 9 }, { key: 'billed', label: 'Billed (KES)', type: 'money', w: 13 }, { key: 'paid', label: 'Paid (KES)', type: 'money', w: 13 }, { key: 'outstanding', label: 'Outstanding (KES)', type: 'money', w: 15 }],
      rows: group.admissions.map((a) => ({ admission_no: `${a.admission_no}${a.id === st.id ? '  (this statement)' : ''}`, course: a.course || '', level: a.level, status: cap(a.status), billed: a.billed, paid: a.paid, outstanding: a.outstanding })),
      subtotal: { label: 'Combined', values: { billed: group.combined.billed, paid: group.combined.paid, outstanding: group.combined.outstanding } },
    });
  }

  const owing = money.outstanding;
  const last = payments.length ? payments[payments.length - 1] : null;
  const notes = [];
  notes.push('Balance is what was billed minus what was paid, with any balance brought forward counted once.');
  if (loose.length) notes.push(`${loose.length} payment${loose.length === 1 ? ' is' : 's are'} not allocated to a term (KES ${thousandsText(sum(loose, 'amount'))}) and ${loose.length === 1 ? 'is' : 'are'} not counted in the balance until allocated.`);
  if (Math.abs(ledgerClosing - owing) > 0.5) notes.push(`The statement of account closes at KES ${thousandsText(ledgerClosing)} while the term balances total KES ${thousandsText(owing)}; the difference is a payment recorded against one term but counted in another.`);

  return {
    title: 'Student Fee Statement',
    subtitle: `${name.toUpperCase()}  ·  ${st.admission_no}`,
    subtitle_size: 13,
    filters: [],
    filter_text: `Statement of account up to ${dayText(new Date())}`,
    details: [
      ['Student', name], ['Admission no.', st.admission_no], ['Course', st.course?.name], ['Department', st.department?.name],
      ['Level', st.level], ['Intake', `${cap(st.intake)} ${st.year}`], ['Status', cap(st.status)], ['Student type', st.student_type?.name],
      ['Phone', st.application?.phone], ['Email', st.user?.email || st.application?.email], ['Current term', st.current_term ? termName(st.current_term) : ''], ['HELB', st.helb_applied ? 'Applied' : ''],
    ].filter(([, v]) => v),
    kpis: [
      { label: 'Total billed', value: money.totalFees, type: 'money' },
      { label: 'Total paid', value: money.totalPaid, type: 'money' },
      { label: owing < -0.009 ? 'Credit (overpaid)' : 'Balance owing', value: Math.abs(owing), type: 'money' },
      { label: 'Collected', value: pct(money.totalPaid, money.totalFees), type: 'percent' },
      { label: 'Terms billed', value: rows.length, type: 'int' },
      { label: 'Last payment', value: last ? `${dayText(last.paid_at)}: KES ${thousandsText(last.amount)}` : 'None yet', type: 'text' },
    ],
    sections,
    notes,
    signoff: true,
    signoff_labels: ['Issued by (Finance Office)', 'Official stamp'],
    file_base: `fee-statement_${safeFile(st.admission_no)}`,
    flat: { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'desc', label: 'Description' }, { key: 'debit', label: 'Billed (KES)', type: 'money' }, { key: 'credit', label: 'Paid (KES)', type: 'money' }, { key: 'balance', label: 'Balance (KES)', type: 'money' }], rows: ledger },
  };
};
const thousandsText = (n) => Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');


// ═════════════════════════════════════════════════════════════════════════════
// 6. APPLICATIONS
// ═════════════════════════════════════════════════════════════════════════════
const APP_STATUSES = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];
const appStatusLabel = (v) => ({ PENDING: 'Pending', UNDER_REVIEW: 'Under review', APPROVED: 'Approved', REJECTED: 'Rejected' }[v] || cap(v));

const applicationsReport = async (q, { full }) => {
  const where = {};
  if (q.department_id) where.department_id = q.department_id;
  if (q.course_id) where.course_id = q.course_id;
  if (q.level) where.level_applied = q.level;
  if (q.app_status && APP_STATUSES.includes(q.app_status)) where.status = q.app_status;
  if (q.app_type && ['KUCCPS', 'DIRECT'].includes(q.app_type)) where.type = q.app_type;
  if (q.gender) where.gender = { equals: q.gender, mode: 'insensitive' };
  const from = parseDay(q.date_from); const to = parseDay(q.date_to, true);
  if (from || to) where.created_at = { ...(from && { gte: from }), ...(to && { lte: to }) };
  if (q.search && String(q.search).trim()) {
    const t = String(q.search).trim();
    where.OR = ['application_no', 'surname', 'other_names', 'phone', 'email', 'id_number'].map((f) => ({ [f]: { contains: t, mode: 'insensitive' } }));
  }
  const apps = await prisma.application.findMany({
    where,
    include: { course: { select: { name: true } }, department: { select: { name: true } }, student: { select: { admission_no: true } } },
    orderBy: { created_at: 'desc' },
  });

  const rows = apps.map((a) => ({
    application_no: a.application_no, name: fullName(a), gender: a.gender || '', phone: a.phone || '',
    course: a.course?.name || 'No course chosen', department: a.department?.name || 'No department', level: a.level_applied || '',
    type: cap(a.type), status: appStatusLabel(a.status), applied: a.created_at, admission_no: a.student?.admission_no || '',
  }));
  const filterLines = [];
  const [dept, course] = await Promise.all([
    q.department_id ? prisma.department.findUnique({ where: { id: q.department_id }, select: { name: true } }) : null,
    q.course_id ? prisma.course.findUnique({ where: { id: q.course_id }, select: { name: true } }) : null,
  ]);
  if (dept) filterLines.push(['Department', dept.name]);
  if (course) filterLines.push(['Course', course.name]);
  if (q.level) filterLines.push(['Level applied', q.level]);
  if (q.app_status) filterLines.push(['Status', appStatusLabel(q.app_status)]);
  if (q.app_type) filterLines.push(['Entry type', cap(q.app_type)]);
  if (q.gender) filterLines.push(['Gender', q.gender]);
  if (q.date_from) filterLines.push(['Applied from', q.date_from]);
  if (q.date_to) filterLines.push(['Applied to', q.date_to]);
  if (q.search) filterLines.push(['Search', q.search]);

  const mode = ['course', 'status', 'department', 'type', 'none'].includes(q.group_by) ? q.group_by : (q.course_id ? 'status' : 'course');
  const keyOf = (r) => ({ course: `${r.department} — ${r.course}`, status: r.status, department: r.department, type: r.type, none: 'Applications' }[mode]);
  const map = new Map();
  rows.forEach((r) => { const k = keyOf(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
  const hasAdm = rows.some((r) => r.admission_no);
  const columns = [
    { key: 'n', label: '#', type: 'int', w: 3 }, { key: 'application_no', label: 'Application no.', w: 17 }, { key: 'name', label: 'Applicant', w: 24 },
    { key: 'gender', label: 'Gender', w: 7 }, { key: 'level', label: 'Level', w: 8 },
    ...(mode !== 'type' ? [{ key: 'type', label: 'Entry', w: 8 }] : []),
    ...(mode !== 'status' ? [{ key: 'status', label: 'Status', w: 10 }] : []),
    { key: 'applied', label: 'Applied on', type: 'date', w: 10 }, { key: 'phone', label: 'Phone', w: 12 },
    ...(hasAdm ? [{ key: 'admission_no', label: 'Admission no.', w: 14 }] : []),
  ];
  const sections = [...map.keys()].sort((a, b) => a.localeCompare(b)).map((k) => ({
    heading: mode === 'none' ? 'Applications' : k,
    columns, rows: map.get(k).map((r, i) => ({ ...r, n: i + 1 })),
    subtotal: { label: `${map.get(k).length} application${map.get(k).length === 1 ? '' : 's'}`, values: {} },
  }));
  const by = (f, v) => rows.filter((r) => r[f] === v).length;
  return {
    title: 'Applications Report',
    subtitle: filterLines.filter(([l]) => ['Department', 'Course', 'Level applied', 'Status', 'Entry type'].includes(l)).map(([, v]) => v).join('  ·  ') || 'All applications',
    filters: filterLines,
    kpis: [
      { label: 'Applications', value: rows.length, type: 'int' }, { label: 'Pending', value: by('status', 'Pending'), type: 'int' },
      { label: 'Under review', value: by('status', 'Under review'), type: 'int' }, { label: 'Approved', value: by('status', 'Approved'), type: 'int' },
      { label: 'Rejected', value: by('status', 'Rejected'), type: 'int' }, { label: 'KUCCPS / Direct', value: `${by('type', 'Kuccps')} / ${by('type', 'Direct')}`, type: 'text' },
    ],
    sections: budgetSections(sections, full),
    notes: [],
    signoff: false,
    flat: { columns: [{ key: 'application_no', label: 'Application no.' }, { key: 'name', label: 'Applicant' }, { key: 'gender', label: 'Gender' }, { key: 'department', label: 'Department' }, { key: 'course', label: 'Course' }, { key: 'level', label: 'Level applied' }, { key: 'type', label: 'Entry' }, { key: 'status', label: 'Status' }, { key: 'applied', label: 'Applied on', type: 'date' }, { key: 'phone', label: 'Phone' }, { key: 'admission_no', label: 'Admission no.' }], rows },
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// 7. PURCHASE REQUISITIONS
// ═════════════════════════════════════════════════════════════════════════════
const REQ_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ORDERED', 'COMPLETED', 'CANCELLED'];
const reqStatusLabel = (v) => ({ PENDING_APPROVAL: 'Awaiting approval' }[v] || cap(v));

const requisitionsReport = async (q, { full }) => {
  const where = {};
  if (q.department_id) where.department_id = q.department_id;
  if (q.req_status && REQ_STATUSES.includes(q.req_status)) where.status = q.req_status;
  // services only, or goods only (consumables and assets)
  if (q.req_kind === 'SERVICE') where.items = { some: { item_type: 'SERVICE' } };
  else if (q.req_kind === 'GOODS') where.items = { some: { NOT: { item_type: 'SERVICE' } } };
  const from = parseDay(q.date_from); const to = parseDay(q.date_to, true);
  if (from || to) where.created_at = { ...(from && { gte: from }), ...(to && { lte: to }) };
  if (q.search && String(q.search).trim()) {
    const t = String(q.search).trim();
    where.OR = [{ requisition_no: { contains: t, mode: 'insensitive' } }, { unit_name: { contains: t, mode: 'insensitive' } }, { justification: { contains: t, mode: 'insensitive' } }];
  }
  const reqs = await prisma.purchaseRequisition.findMany({
    where,
    include: { department: { select: { name: true } }, requester: { select: { email: true } }, items: true },
    orderBy: { created_at: 'desc' },
  });
  const rows = reqs.map((r) => {
    const itemsTotal = round2(r.items.reduce((t, i) => t + (i.total_price ?? ((i.unit_price || 0) * i.quantity)), 0));
    return {
      requisition_no: r.requisition_no, unit: r.department?.name || r.unit_name || 'Unassigned', requested_by: (r.requester?.email || '').split('@')[0],
      status: reqStatusLabel(r.status), raw_status: r.status, priority: cap(r.priority), items: r.items.length, amount: round2(r.total_amount ?? itemsTotal),
      raised: r.created_at, approved: r.approved_at || '', _items: r.items,
    };
  });
  const filterLines = [];
  const dept = q.department_id ? await prisma.department.findUnique({ where: { id: q.department_id }, select: { name: true } }) : null;
  if (dept) filterLines.push(['Department', dept.name]);
  if (q.req_status) filterLines.push(['Status', reqStatusLabel(q.req_status)]);
  if (q.req_kind) filterLines.push(['Buying', q.req_kind === 'SERVICE' ? 'Services' : 'Goods']);
  if (q.date_from) filterLines.push(['Raised from', q.date_from]);
  if (q.date_to) filterLines.push(['Raised to', q.date_to]);
  if (q.search) filterLines.push(['Search', q.search]);

  const mode = ['department', 'status', 'none'].includes(q.group_by) ? q.group_by : 'department';
  const map = new Map();
  rows.forEach((r) => { const k = mode === 'status' ? r.status : mode === 'department' ? r.unit : 'Requisitions'; if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
  const columns = [
    { key: 'n', label: '#', type: 'int', w: 3 }, { key: 'requisition_no', label: 'Requisition no.', w: 16 },
    ...(mode !== 'department' ? [{ key: 'unit', label: 'Department / unit', w: 20 }] : []),
    { key: 'requested_by', label: 'Requested by', w: 13 }, { key: 'priority', label: 'Priority', w: 8 },
    ...(mode !== 'status' ? [{ key: 'status', label: 'Status', w: 13 }] : []),
    { key: 'items', label: 'Items', type: 'int', w: 6 }, { key: 'amount', label: 'Amount (KES)', type: 'money', w: 13 },
    { key: 'raised', label: 'Raised', type: 'date', w: 10 }, { key: 'approved', label: 'Approved', type: 'date', w: 10 },
  ];
  const sections = [...map.keys()].sort((a, b) => a.localeCompare(b)).map((k) => {
    const rs = map.get(k);
    return { heading: mode === 'none' ? 'Requisitions' : k, columns, rows: rs.map((r, i) => ({ ...r, n: i + 1 })), subtotal: { label: `${rs.length} requisition${rs.length === 1 ? '' : 's'}`, values: { items: rs.reduce((t, r) => t + r.items, 0), amount: sum(rs, 'amount') } } };
  });
  if (q.detail === 'items' && rows.length) {
    const itemRows = [];
    rows.forEach((r) => r._items.forEach((i, ix) => itemRows.push({ requisition_no: ix === 0 ? r.requisition_no : '', item: i.service_category ? `${i.item_name} (${i.service_category})` : i.item_name, kind: i.item_type ? cap(i.item_type) : '', qty: i.quantity, unit: i.unit_of_measure || '', unit_price: round2(i.unit_price || 0), total: round2(i.total_price ?? ((i.unit_price || 0) * i.quantity)) })));
    sections.push({
      heading: 'Items requested',
      columns: [{ key: 'requisition_no', label: 'Requisition', w: 16 }, { key: 'item', label: 'Item', w: 30 }, { key: 'kind', label: 'Type', w: 10 }, { key: 'qty', label: 'Qty', type: 'int', w: 6 }, { key: 'unit', label: 'Unit', w: 8 }, { key: 'unit_price', label: 'Unit price (KES)', type: 'money', w: 14 }, { key: 'total', label: 'Total (KES)', type: 'money', w: 14 }],
      rows: itemRows, subtotal: { label: 'Total', values: { total: sum(itemRows, 'total') } },
    });
  }
  const serviceValue = round2(rows.reduce((t, r) => t + r._items.filter((i) => i.item_type === 'SERVICE').reduce((n, i) => n + (i.total_price ?? ((i.unit_price || 0) * i.quantity)), 0), 0));
  const val = (st) => sum(rows.filter((r) => r.raw_status === st), 'amount');
  const cnt = (st) => rows.filter((r) => r.raw_status === st).length;
  return {
    title: 'Purchase Requisitions Report',
    subtitle: filterLines.filter(([l]) => ['Department', 'Status'].includes(l)).map(([, v]) => v).join('  ·  ') || 'All requisitions',
    filters: filterLines,
    kpis: [
      { label: 'Requisitions', value: rows.length, type: 'int' }, { label: 'Total value', value: sum(rows, 'amount'), type: 'money' },
      { label: 'Awaiting approval', value: cnt('PENDING_APPROVAL'), type: 'int' }, { label: 'Approved value', value: round2(val('APPROVED') + val('ORDERED') + val('COMPLETED')), type: 'money' },
      { label: 'Rejected', value: cnt('REJECTED'), type: 'int' }, { label: 'Ordered / completed', value: cnt('ORDERED') + cnt('COMPLETED'), type: 'int' },
      ...(serviceValue > 0 ? [{ label: 'Of which services', value: serviceValue, type: 'money' }] : []),
    ],
    sections: budgetSections(sections, full),
    notes: ['A requisition with no amount entered is valued from the prices of its items.'],
    signoff: false,
    flat: { columns: [{ key: 'requisition_no', label: 'Requisition no.' }, { key: 'unit', label: 'Department / unit' }, { key: 'requested_by', label: 'Requested by' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' }, { key: 'items', label: 'Items', type: 'int' }, { key: 'amount', label: 'Amount (KES)', type: 'money' }, { key: 'raised', label: 'Raised', type: 'date' }, { key: 'approved', label: 'Approved', type: 'date' }], rows },
  };
};

// ── the list of reports offered, and which filters each one understands ──
const STUDENT_FILTERS = ['department_id', 'course_id', 'level', 'intake', 'year', 'status', 'student_type_id', 'gender', 'helb', 'search'];
const CATALOG = [
  {
    id: 'fee-balances', group: 'Finance', title: 'Fee balances & arrears', roles: ['ADMIN', 'FINANCE'],
    blurb: 'Who owes what. Grouped by department, course or level, with subtotals, and a summary by fee status.',
    filters: [...STUDENT_FILTERS, 'term_id', 'fee_status', 'outstanding_only', 'min_balance'],
    options: { group_by: [['auto', 'Automatic (follows the filters)'], ['department', 'Department'], ['course', 'Course'], ['level', 'Level'], ['type', 'Student type'], ['none', 'One list']], sort: [['admission', 'Admission number'], ['name', 'Name'], ['balance', 'Largest balance first']] },
    build: feeBalances,
  },
  {
    id: 'fee-collections', group: 'Finance', title: 'Fee collections', roles: ['ADMIN', 'FINANCE'],
    blurb: 'Money received in a period: by fee type, by day or month, and every payment listed.',
    filters: [...STUDENT_FILTERS, 'term_id', 'fee_type_id', 'date_from', 'date_to'],
    options: {},
    build: feeCollections,
  },
  {
    id: 'fee-summary', group: 'Finance', title: 'Fee collection summary', roles: ['ADMIN', 'FINANCE'],
    blurb: 'Billed, collected and outstanding side by side, with the collection rate for each department, course, level or term.',
    filters: [...STUDENT_FILTERS, 'term_id', 'fee_status', 'outstanding_only'],
    options: { group_by: [['auto', 'Automatic (follows the filters)'], ['department', 'Department'], ['course', 'Course'], ['level', 'Level'], ['term', 'Term'], ['type', 'Student type']] },
    build: feeSummary,
  },
  {
    id: 'student-statement', group: 'Finance', title: 'Student fee statement', roles: ['ADMIN', 'FINANCE'],
    blurb: 'One student: their details, fees by term, what each term was billed for, every payment, and a running statement of account.',
    filters: ['student_id'],
    options: {},
    build: studentStatement,
  },
  {
    id: 'student-register', group: 'Students', title: 'Student register', roles: ['ADMIN', 'FINANCE', 'REGISTRAR', 'DEPT_HEAD'],
    blurb: 'A clean class list by course and level, with counts by gender and status.',
    filters: [...STUDENT_FILTERS, 'term_id'],
    options: { group_by: [['auto', 'Automatic (follows the filters)'], ['department', 'Department'], ['course', 'Course'], ['level', 'Level'], ['type', 'Student type'], ['none', 'One list']], sort: [['admission', 'Admission number'], ['name', 'Name']] },
    build: studentRegister,
  },
  {
    id: 'applications', group: 'Students', title: 'Applications', roles: ['ADMIN', 'REGISTRAR', 'DEPT_HEAD'],
    blurb: 'Who applied, for what, and where each application stands, grouped by course, status or entry type.',
    filters: ['department_id', 'course_id', 'level', 'app_status', 'app_type', 'gender', 'date_from', 'date_to', 'search'],
    date_label: 'Applied', level_label: 'Level applied',
    options: { group_by: [['auto', 'Automatic (follows the filters)'], ['course', 'Course'], ['status', 'Status'], ['department', 'Department'], ['type', 'Entry type (KUCCPS / Direct)'], ['none', 'One list']] },
    build: applicationsReport,
  },
  {
    id: 'requisitions', group: 'Procurement', title: 'Purchase requisitions', roles: ['ADMIN', 'PROCUREMENT', 'DEPT_HEAD'],
    blurb: 'What was asked for, by whom, how much it is worth, and where each requisition is in the approval and ordering process.',
    filters: ['department_id', 'req_status', 'req_kind', 'date_from', 'date_to', 'search'],
    date_label: 'Raised',
    options: { group_by: [['department', 'Department or unit'], ['status', 'Status'], ['none', 'One list']], detail: [['summary', 'Requisitions only'], ['items', 'With every item requested']] },
    build: requisitionsReport,
  },
];

const catalogFor = (role) => CATALOG.filter((r) => r.roles.includes(role)).map(({ build, roles, ...rest }) => rest);

// A department head sees their own department only: it is forced on every report, whatever the request says
const scopeFor = async (role, userId) => {
  if (role !== 'DEPT_HEAD') return null;
  const dept = userId ? await prisma.department.findFirst({ where: { head_user_id: userId }, select: { id: true, name: true } }) : null;
  if (!dept) throw fail('You are not set as the head of a department, so there are no reports for you yet. Ask the administrator.', 403);
  return { department_id: dept.id, department_name: dept.name };
};

const buildReport = async (id, query, { role, userId, full = false, audience } = {}) => {
  const def = CATALOG.find((r) => r.id === id);
  if (!def) throw fail('Unknown report', 404);
  if (!def.roles.includes(role)) throw fail('You do not have access to this report', 403);
  // only the filters this report understands are applied
  const q = {};
  for (const k of [...def.filters, 'group_by', 'sort', 'detail']) if (query[k] !== undefined && query[k] !== '') q[k] = query[k];
  const scope = await scopeFor(role, userId);
  if (scope) {
    q.department_id = scope.department_id;
    if (q.course_id) {
      const c = await prisma.course.findUnique({ where: { id: q.course_id }, select: { department_id: true } });
      if (!c || c.department_id !== scope.department_id) delete q.course_id; // another department's course is not theirs to ask for
    }
  }
  const doc = await def.build(q, { full, audience });
  // internal working data is not part of the report that is sent out
  const clean = (rows) => rows.map(({ termRows, ...r }) => r);
  const out = { id: def.id, group: def.group, ...doc, sections: doc.sections.map((s) => ({ ...s, rows: clean(s.rows) })) };
  if (full && doc.flat) out.flat = { ...doc.flat, rows: clean(doc.flat.rows) }; else delete out.flat;
  return out;
};

module.exports = { buildReport, catalogFor, scopeFor, APP_STATUSES, REQ_STATUSES, CATALOG, STUDENT_STATUSES, INTAKES, BALANCE_STATUSES };
