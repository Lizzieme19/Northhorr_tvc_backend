const XLSX = require('xlsx');
const prisma = require('../config/db');

const STUDENT_STATUSES = ['ACTIVE', 'DEFERRED', 'GRADUATED', 'WITHDRAWN', 'ATTACHMENT'];
const INTAKES = ['JANUARY', 'MAY', 'SEPTEMBER'];
const BALANCE_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'];

// Columns of the student details report that expose fee data (left out for Registrars)
const FINANCE_COLUMNS = [
  'admission_fee_paid', 'kuccps_fee_paid', 'student_id_fee_paid', 'tuition_fee_paid', 'full_year_paid',
  'fee_adjustment', 'term_total', 'term_paid', 'term_balance', 'fee_status', 'overall_balance',
];

// ── Query helpers ────────────────────────────────────────────────────────────

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
};

// Student-level filters shared by both reports
const buildStudentWhere = (q) => {
  const where = {};
  if (q.department_id) where.department_id = q.department_id;
  if (q.course_id) where.course_id = q.course_id;
  if (q.level) where.level = q.level;
  if (q.intake && INTAKES.includes(String(q.intake).toUpperCase())) where.intake = String(q.intake).toUpperCase();
  if (q.year && !isNaN(parseInt(q.year))) where.year = parseInt(q.year);
  if (q.status && STUDENT_STATUSES.includes(String(q.status).toUpperCase())) where.status = String(q.status).toUpperCase();
  if (q.helb === 'true') where.helb_applied = true;
  if (q.helb === 'false') where.helb_applied = false;

  const and = [];
  if (q.gender) and.push({ application: { gender: { equals: q.gender, mode: 'insensitive' } } });
  if (q.search) {
    const s = String(q.search).trim();
    and.push({
      OR: [
        { admission_no: { contains: s, mode: 'insensitive' } },
        { application: { surname: { contains: s, mode: 'insensitive' } } },
        { application: { other_names: { contains: s, mode: 'insensitive' } } },
        { application: { phone: { contains: s, mode: 'insensitive' } } },
        { application: { id_number: { contains: s, mode: 'insensitive' } } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
};

const fullName = (app) => [app?.surname, app?.other_names].filter(Boolean).join(' ');
const yesNo = (v) => (v ? 'Yes' : 'No');
const cap = (v) => (v ? String(v).charAt(0) + String(v).slice(1).toLowerCase() : '');

// Human-readable description of the filters used, written into the Summary sheet
const describeFilters = async (q) => {
  const lines = [];
  const [dept, course, term, feeType] = await Promise.all([
    q.department_id ? prisma.department.findUnique({ where: { id: q.department_id }, select: { name: true } }) : null,
    q.course_id ? prisma.course.findUnique({ where: { id: q.course_id }, select: { name: true } }) : null,
    q.term_id ? prisma.term.findUnique({ where: { id: q.term_id }, select: { name: true, academic_year: true } }) : null,
    q.fee_type_id ? prisma.feeType.findUnique({ where: { id: q.fee_type_id }, select: { name: true } }) : null,
  ]);
  if (dept) lines.push(['Department', dept.name]);
  if (course) lines.push(['Course', course.name]);
  if (q.level) lines.push(['Level', q.level]);
  if (q.intake) lines.push(['Intake', cap(q.intake)]);
  if (q.year) lines.push(['Year', q.year]);
  if (q.status) lines.push(['Student status', cap(q.status)]);
  if (q.gender) lines.push(['Gender', q.gender]);
  if (q.helb) lines.push(['HELB applied', q.helb === 'true' ? 'Yes' : 'No']);
  if (term) lines.push(['Term', `${term.name} (${term.academic_year})`]);
  if (q.fee_status) lines.push(['Fee status', q.fee_status]);
  if (q.outstanding_only === 'true') lines.push(['Outstanding balances only', 'Yes']);
  if (feeType) lines.push(['Fee type', feeType.name]);
  if (q.date_from) lines.push(['Payments from', q.date_from]);
  if (q.date_to) lines.push(['Payments to', q.date_to]);
  if (q.search) lines.push(['Search', q.search]);
  if (!lines.length) lines.push(['Filters', 'None (all students)']);
  return lines;
};

// ── Workbook helpers ─────────────────────────────────────────────────────────

const MONEY_FMT = '#,##0.00';
const DATE_FMT = 'dd-mmm-yyyy';
const DATETIME_FMT = 'dd-mmm-yyyy hh:mm';

// columns: [{ label, key, width, type: 'text'|'money'|'int'|'date'|'datetime' }]
const buildTableSheet = (columns, rows) => {
  const aoa = [columns.map((c) => c.label)];
  for (const row of rows) aoa.push(columns.map((c) => row[c.key] ?? ''));

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });

  // Apply number/date formats to the data cells
  for (let r = 1; r < aoa.length; r++) {
    columns.forEach((c, ci) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c: ci })];
      if (!cell || cell.v === '') return;
      if (c.type === 'money') cell.z = MONEY_FMT;
      else if (c.type === 'date') {
        cell.z = DATE_FMT;
        // Date-only values are stored as UTC midnight; re-anchor to local so the day can't shift when written
        if (cell.v instanceof Date) cell.v = new Date(cell.v.getUTCFullYear(), cell.v.getUTCMonth(), cell.v.getUTCDate());
      }
      else if (c.type === 'datetime') cell.z = DATETIME_FMT;
    });
  }

  ws['!cols'] = columns.map((c) => ({ wch: c.width || Math.max(12, c.label.length + 2) }));
  // Excel's own filter dropdowns on the header row, so the user can keep filtering after download
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 0), c: columns.length - 1 } }) };
  return ws;
};

const buildSummarySheet = (title, generatedBy, filterLines, blocks) => {
  const aoa = [
    [title],
    ['Generated', new Date()],
    ['Generated by', generatedBy],
    [],
    ['Filters applied'],
    ...filterLines,
  ];
  const moneyCells = [];
  for (const block of blocks) {
    aoa.push([]);
    aoa.push([block.title]);
    if (block.header) aoa.push(block.header);
    for (const row of block.rows) {
      const rowIdx = aoa.length;
      row.forEach((v, ci) => { if (block.money?.includes(ci)) moneyCells.push({ r: rowIdx, c: ci }); });
      aoa.push(row);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const generatedCell = ws[XLSX.utils.encode_cell({ r: 1, c: 1 })];
  if (generatedCell) generatedCell.z = DATETIME_FMT;
  moneyCells.forEach(({ r, c }) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell && typeof cell.v === 'number') cell.z = MONEY_FMT;
  });
  ws['!cols'] = [{ wch: 34 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  return ws;
};

const sendWorkbook = (res, wb, baseName) => {
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${baseName}_${stamp}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(buffer);
};

// Group rows by a key and sum numeric fields — used for the summary breakdowns
const groupSum = (rows, keyFn, fields) => {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r) || 'Unassigned';
    if (!map.has(k)) map.set(k, { key: k, count: 0, ...Object.fromEntries(fields.map((f) => [f, 0])) });
    const g = map.get(k);
    g.count += 1;
    fields.forEach((f) => { g[f] += r[f] || 0; });
  }
  return [...map.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
};

// ── GET /api/finance/reports/filters ─────────────────────────────────────────
// Distinct values for the report filter dropdowns
const getReportFilters = async (req, res) => {
  try {
    const [levels, years, departments, courses, terms, feeTypes] = await Promise.all([
      prisma.student.findMany({ distinct: ['level'], select: { level: true }, orderBy: { level: 'asc' } }),
      prisma.student.findMany({ distinct: ['year'], select: { year: true }, orderBy: { year: 'desc' } }),
      prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.course.findMany({ select: { id: true, name: true, department_id: true }, orderBy: { name: 'asc' } }),
      prisma.term.findMany({ select: { id: true, name: true, academic_year: true, intake: true, start_date: true, end_date: true, term_cost: true, is_active: true }, orderBy: { start_date: 'desc' } }),
      prisma.feeType.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    res.json({
      levels: levels.map((l) => l.level).filter(Boolean),
      years: years.map((y) => y.year),
      intakes: INTAKES,
      student_statuses: STUDENT_STATUSES,
      fee_statuses: req.user?.role === 'REGISTRAR' ? [] : BALANCE_STATUSES,
      departments, courses, terms, fee_types: req.user?.role === 'REGISTRAR' ? [] : feeTypes,
    });
  } catch (err) {
    console.error('Report filters error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ── GET /api/finance/reports/fees/export ─────────────────────────────────────
// Workbook: Summary | Fee Balances | Payments | Paid by Fee Type
const exportFeesReport = async (req, res) => {
  try {
    const q = req.query;
    const studentWhere = buildStudentWhere(q);
    const dateFrom = parseDate(q.date_from);
    const dateTo = parseDate(q.date_to, true);

    // Balance rows: one per student × term
    const balanceWhere = { student: studentWhere };
    if (q.term_id) balanceWhere.term_id = q.term_id;
    if (q.fee_status && BALANCE_STATUSES.includes(String(q.fee_status).toUpperCase())) {
      balanceWhere.status = String(q.fee_status).toUpperCase();
    }
    if (q.outstanding_only === 'true') balanceWhere.balance = { gt: 0 };

    const balances = await prisma.studentBalance.findMany({
      where: balanceWhere,
      include: {
        term: { select: { id: true, name: true, academic_year: true, intake: true } },
        student: {
          select: {
            id: true, admission_no: true, level: true, intake: true, year: true, status: true, helb_applied: true, fee_adjustment: true,
            application: { select: { surname: true, other_names: true, gender: true, phone: true } },
            user: { select: { email: true } },
            course: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
      orderBy: [{ student: { admission_no: 'asc' } }, { term: { start_date: 'asc' } }],
    });

    // Payments follow the same student scope; narrowed by term, fee type and date range.
    // When fee_status/outstanding_only narrow the balances, only the matching students' payments are listed.
    const narrowedByBalance = Boolean(q.fee_status || q.outstanding_only === 'true');
    const paymentWhere = { student: studentWhere };
    if (q.term_id) paymentWhere.term_id = q.term_id;
    if (q.fee_type_id) paymentWhere.fee_type_id = q.fee_type_id;
    if (dateFrom || dateTo) paymentWhere.paid_at = { ...(dateFrom && { gte: dateFrom }), ...(dateTo && { lte: dateTo }) };
    if (narrowedByBalance) {
      paymentWhere.student_id = { in: [...new Set(balances.map((b) => b.student_id))] };
    }

    const records = await prisma.feeRecord.findMany({
      where: paymentWhere,
      include: {
        feeType: { select: { name: true } },
        term: { select: { name: true, academic_year: true } },
        receiver: { select: { email: true } },
        student: {
          select: {
            admission_no: true, level: true,
            application: { select: { surname: true, other_names: true } },
            course: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { paid_at: 'desc' },
    });

    // Sheet 2: Fee Balances
    const balanceRows = balances.map((b) => ({
      admission_no: b.student.admission_no,
      name: fullName(b.student.application),
      gender: b.student.application?.gender || '',
      phone: b.student.application?.phone || '',
      email: b.student.user?.email || '',
      department: b.student.department?.name || '',
      course: b.student.course?.name || '',
      level: b.level || b.student.level,
      intake: cap(b.student.intake),
      year: b.student.year,
      student_status: cap(b.student.status),
      helb: yesNo(b.student.helb_applied),
      term: b.term?.name || '',
      academic_year: b.term?.academic_year || '',
      carryover: b.previous_balance_carryover || 0,
      total_fees: b.total_fees,
      amount_paid: b.amount_paid,
      balance: b.balance,
      // billed minus paid for this row, without debt carried from earlier terms (used for totals)
      due: b.total_fees - b.amount_paid,
      status: b.status,
      updated: b.updated_at,
    }));
    const balanceCols = [
      { label: 'Admission No', key: 'admission_no', width: 18 },
      { label: 'Student Name', key: 'name', width: 30 },
      { label: 'Gender', key: 'gender', width: 9 },
      { label: 'Phone', key: 'phone', width: 15 },
      { label: 'Email', key: 'email', width: 28 },
      { label: 'Department', key: 'department', width: 28 },
      { label: 'Course', key: 'course', width: 32 },
      { label: 'Level', key: 'level', width: 12 },
      { label: 'Intake', key: 'intake', width: 11 },
      { label: 'Year', key: 'year', width: 7 },
      { label: 'Student Status', key: 'student_status', width: 14 },
      { label: 'HELB', key: 'helb', width: 7 },
      { label: 'Term', key: 'term', width: 20 },
      { label: 'Academic Year', key: 'academic_year', width: 14 },
      { label: 'Balance B/F (KES)', key: 'carryover', width: 17, type: 'money' },
      { label: 'Total Fees (KES)', key: 'total_fees', width: 16, type: 'money' },
      { label: 'Amount Paid (KES)', key: 'amount_paid', width: 17, type: 'money' },
      { label: 'Balance (KES)', key: 'balance', width: 15, type: 'money' },
      { label: 'Fee Status', key: 'status', width: 12 },
      { label: 'Last Updated', key: 'updated', width: 18, type: 'datetime' },
    ];

    // Sheet 3: Payments
    const paymentRows = records.map((r) => ({
      paid_at: r.paid_at,
      reference: r.reference_code || '',
      admission_no: r.student.admission_no,
      name: fullName(r.student.application),
      department: r.student.department?.name || '',
      course: r.student.course?.name || '',
      level: r.student.level,
      term: r.term ? `${r.term.name} (${r.term.academic_year})` : '',
      fee_type: r.feeType?.name || 'Unallocated',
      amount: r.amount,
      received_by: r.receiver?.email || '',
      notes: r.notes || '',
    }));
    const paymentCols = [
      { label: 'Date Paid', key: 'paid_at', width: 18, type: 'datetime' },
      { label: 'Reference', key: 'reference', width: 26 },
      { label: 'Admission No', key: 'admission_no', width: 18 },
      { label: 'Student Name', key: 'name', width: 30 },
      { label: 'Department', key: 'department', width: 28 },
      { label: 'Course', key: 'course', width: 32 },
      { label: 'Level', key: 'level', width: 12 },
      { label: 'Term', key: 'term', width: 28 },
      { label: 'Fee Type', key: 'fee_type', width: 20 },
      { label: 'Amount (KES)', key: 'amount', width: 15, type: 'money' },
      { label: 'Received By', key: 'received_by', width: 28 },
      { label: 'Notes', key: 'notes', width: 36 },
    ];

    // Sheet 4: Paid by Fee Type — one row per student × term, one column per fee type
    const feeTypeNames = [...new Set(records.map((r) => r.feeType?.name || 'Unallocated'))].sort((a, b) => {
      if (a === 'Unallocated') return 1;
      if (b === 'Unallocated') return -1;
      return a.localeCompare(b);
    });
    const matrix = new Map();
    for (const r of records) {
      const k = `${r.student_id}|${r.term_id || ''}`;
      if (!matrix.has(k)) {
        matrix.set(k, {
          admission_no: r.student.admission_no,
          name: fullName(r.student.application),
          course: r.student.course?.name || '',
          level: r.student.level,
          term: r.term ? `${r.term.name} (${r.term.academic_year})` : 'No term',
          total: 0,
        });
      }
      const row = matrix.get(k);
      const col = r.feeType?.name || 'Unallocated';
      row[col] = (row[col] || 0) + r.amount;
      row.total += r.amount;
    }
    const matrixRows = [...matrix.values()].sort((a, b) => a.admission_no.localeCompare(b.admission_no));
    const matrixCols = [
      { label: 'Admission No', key: 'admission_no', width: 18 },
      { label: 'Student Name', key: 'name', width: 30 },
      { label: 'Course', key: 'course', width: 32 },
      { label: 'Level', key: 'level', width: 12 },
      { label: 'Term', key: 'term', width: 28 },
      ...feeTypeNames.map((n) => ({ label: `${n} (KES)`, key: n, width: Math.max(16, n.length + 8), type: 'money' })),
      { label: 'Total Paid (KES)', key: 'total', width: 17, type: 'money' },
    ];

    // Sheet 1: Summary
    const sum = (arr, f) => arr.reduce((s, x) => s + (x[f] || 0), 0);
    const totalFees = sum(balanceRows, 'total_fees');
    const totalPaid = sum(balanceRows, 'amount_paid');
    // Row balances include debt carried forward, so across terms they overlap. For one term the balance
    // is what is due for it; across terms use billed minus paid so nothing is counted twice.
    const balKey = q.term_id ? 'balance' : 'due';
    const totalBalance = sum(balanceRows, balKey);
    const byStatus = groupSum(balanceRows, (r) => r.status, ['total_fees', 'amount_paid', balKey]);
    const byDept = groupSum(balanceRows, (r) => r.department, ['total_fees', 'amount_paid', balKey]);
    const byFeeType = groupSum(paymentRows, (r) => r.fee_type, ['amount']);
    const header = ['', 'Records', 'Total Fees (KES)', 'Paid (KES)', 'Balance (KES)'];

    const summarySheet = buildSummarySheet(
      'Northhorr TVC — Student Fees Report',
      req.user?.email || '',
      await describeFilters(q),
      [
        {
          title: 'Totals',
          rows: [
            ['Students with fee records', new Set(balances.map((b) => b.student_id)).size],
            ['Student-term records', balanceRows.length],
            ['Total fees billed (KES)', totalFees],
            ['Total paid (KES)', totalPaid],
            ['Outstanding balance (KES)', totalBalance],
            ['Collection rate', totalFees > 0 ? `${((totalPaid / totalFees) * 100).toFixed(1)}%` : 'n/a'],
            ['Payments listed', paymentRows.length],
            ['Payments value (KES)', sum(paymentRows, 'amount')],
          ],
          money: [1],
        },
        {
          title: 'By fee status',
          header,
          rows: byStatus.map((g) => [g.key, g.count, g.total_fees, g.amount_paid, g[balKey]]),
          money: [2, 3, 4],
        },
        {
          title: 'By department',
          header,
          rows: byDept.map((g) => [g.key, g.count, g.total_fees, g.amount_paid, g[balKey]]),
          money: [2, 3, 4],
        },
        {
          title: 'Payments by fee type',
          header: ['', 'Payments', 'Amount (KES)'],
          rows: byFeeType.map((g) => [g.key, g.count, g.amount]),
          money: [2],
        },
      ]
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    XLSX.utils.book_append_sheet(wb, buildTableSheet(balanceCols, balanceRows), 'Fee Balances');
    XLSX.utils.book_append_sheet(wb, buildTableSheet(paymentCols, paymentRows), 'Payments');
    XLSX.utils.book_append_sheet(wb, buildTableSheet(matrixCols, matrixRows), 'Paid by Fee Type');

    sendWorkbook(res, wb, 'Student_Fees_Report');
  } catch (err) {
    console.error('Export fees report error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate fees report' });
  }
};

// ── GET /api/finance/reports/students/export ─────────────────────────────────
// Workbook: Summary | Students (full details, with current fee position)
const exportStudentsReport = async (req, res) => {
  try {
    // Registrars get the same report without any fee data, and fee-based filters are ignored
    const hideFinance = req.user?.role === 'REGISTRAR';
    const q = hideFinance ? { ...req.query, fee_status: undefined, outstanding_only: undefined } : req.query;
    const where = buildStudentWhere(q);

    // Narrow by the student's balance in a term / fee status when asked
    const balanceFilter = {};
    if (q.term_id) balanceFilter.term_id = q.term_id;
    if (q.fee_status && BALANCE_STATUSES.includes(String(q.fee_status).toUpperCase())) {
      balanceFilter.status = String(q.fee_status).toUpperCase();
    }
    if (q.outstanding_only === 'true') balanceFilter.balance = { gt: 0 };
    if (Object.keys(balanceFilter).length) where.student_balances = { some: balanceFilter };

    const students = await prisma.student.findMany({
      where,
      include: {
        user: { select: { email: true, is_active: true } },
        application: true,
        course: { select: { name: true, shortcode: true } },
        department: { select: { name: true } },
        current_term: { select: { name: true, academic_year: true } },
        student_balances: {
          where: q.term_id ? { term_id: q.term_id } : {},
          include: { term: { select: { id: true, name: true, academic_year: true, start_date: true } } },
        },
      },
      orderBy: { admission_no: 'asc' },
    });

    const rows = students.map((s) => {
      const a = s.application || {};
      // Fee position: the filtered term, otherwise the student's current term, otherwise the latest balance
      const sortedBalances = [...s.student_balances].sort((x, y) => new Date(y.term.start_date) - new Date(x.term.start_date));
      const bal =
        (q.term_id ? sortedBalances[0] : null) ||
        sortedBalances.find((b) => b.term_id === s.current_term_id) ||
        sortedBalances[0];
      // billed minus paid; summing term balances would count carried-forward debt repeatedly
      const lifetime = s.student_balances.reduce(
        (acc, b) => ({ fees: acc.fees + b.total_fees, paid: acc.paid + b.amount_paid, balance: acc.balance + b.total_fees - b.amount_paid }),
        { fees: 0, paid: 0, balance: 0 }
      );

      return {
        admission_no: s.admission_no,
        surname: a.surname || '',
        other_names: a.other_names || '',
        gender: a.gender || '',
        dob: a.date_of_birth || '',
        nationality: a.nationality || '',
        religion: a.religion || '',
        id_number: a.id_number || '',
        birth_cert_no: a.birth_cert_no || '',
        email: s.user?.email || a.email || '',
        phone: a.phone || '',
        address: a.address || '',
        department: s.department?.name || '',
        course: s.course?.name || '',
        level: s.level,
        intake: cap(s.intake),
        year: s.year,
        status: cap(s.status),
        application_no: a.application_no || '',
        application_type: cap(a.type),
        kcpe_index: a.kcpe_index || '',
        kcpe_marks: a.kcpe_marks ?? '',
        kcse_index: a.kcse_index || '',
        kcse_grade: a.kcse_grade || '',
        previous_school: a.previous_school || '',
        guardian_name: a.parent_names || '',
        guardian_relationship: a.parent_relationship || '',
        guardian_phone: a.parent_phone || '',
        guardian_email: a.parent_email || '',
        father_name: a.father_name || '',
        father_phone: a.father_phone || '',
        father_occupation: a.father_occupation || '',
        mother_name: a.mother_name || '',
        mother_phone: a.mother_phone || '',
        mother_occupation: a.mother_occupation || '',
        emergency_person: a.emergency_person || '',
        emergency_phone: a.emergency_phone || '',
        medical_conditions: a.medical_conditions || '',
        allergies: a.allergies || '',
        disability: a.disability || '',
        helb: yesNo(s.helb_applied),
        admission_fee_paid: yesNo(s.admission_fee_paid),
        kuccps_fee_paid: yesNo(s.kuccps_fee_paid),
        student_id_fee_paid: yesNo(s.student_id_fee_paid),
        tuition_fee_paid: yesNo(s.tuition_fee_paid),
        full_year_paid: yesNo(s.full_year_paid),
        fee_adjustment: s.fee_adjustment || 0,
        fee_term: bal?.term ? `${bal.term.name} (${bal.term.academic_year})` : (s.current_term ? `${s.current_term.name} (${s.current_term.academic_year})` : ''),
        term_total: bal ? bal.total_fees : '',
        term_paid: bal ? bal.amount_paid : '',
        term_balance: bal ? bal.balance : '',
        fee_status: bal ? bal.status : 'NO TERM',
        overall_balance: s.student_balances.length ? lifetime.balance : '',
        id_card_expiry: s.id_card_expiry_date || '',
        account_active: yesNo(s.user?.is_active),
        registered: s.created_at,
        _numeric_balance: bal ? bal.balance : 0,
        _numeric_paid: bal ? bal.amount_paid : 0,
        _numeric_total: bal ? bal.total_fees : 0,
      };
    });

    const cols = [
      { label: 'Admission No', key: 'admission_no', width: 18 },
      { label: 'Surname', key: 'surname', width: 18 },
      { label: 'Other Names', key: 'other_names', width: 22 },
      { label: 'Gender', key: 'gender', width: 9 },
      { label: 'Date of Birth', key: 'dob', width: 14, type: 'date' },
      { label: 'Nationality', key: 'nationality', width: 13 },
      { label: 'Religion', key: 'religion', width: 13 },
      { label: 'ID Number', key: 'id_number', width: 14 },
      { label: 'Birth Cert No', key: 'birth_cert_no', width: 14 },
      { label: 'Email', key: 'email', width: 28 },
      { label: 'Phone', key: 'phone', width: 15 },
      { label: 'Address', key: 'address', width: 24 },
      { label: 'Department', key: 'department', width: 28 },
      { label: 'Course', key: 'course', width: 32 },
      { label: 'Level', key: 'level', width: 12 },
      { label: 'Intake', key: 'intake', width: 11 },
      { label: 'Year', key: 'year', width: 7 },
      { label: 'Student Status', key: 'status', width: 14 },
      { label: 'Application No', key: 'application_no', width: 18 },
      { label: 'Application Type', key: 'application_type', width: 16 },
      { label: 'KCPE Index', key: 'kcpe_index', width: 14 },
      { label: 'KCPE Marks', key: 'kcpe_marks', width: 11 },
      { label: 'KCSE Index', key: 'kcse_index', width: 14 },
      { label: 'KCSE Grade', key: 'kcse_grade', width: 11 },
      { label: 'Previous School', key: 'previous_school', width: 26 },
      { label: 'Guardian Name', key: 'guardian_name', width: 24 },
      { label: 'Guardian Relationship', key: 'guardian_relationship', width: 20 },
      { label: 'Guardian Phone', key: 'guardian_phone', width: 15 },
      { label: 'Guardian Email', key: 'guardian_email', width: 26 },
      { label: 'Father Name', key: 'father_name', width: 24 },
      { label: 'Father Phone', key: 'father_phone', width: 15 },
      { label: 'Father Occupation', key: 'father_occupation', width: 20 },
      { label: 'Mother Name', key: 'mother_name', width: 24 },
      { label: 'Mother Phone', key: 'mother_phone', width: 15 },
      { label: 'Mother Occupation', key: 'mother_occupation', width: 20 },
      { label: 'Emergency Contact', key: 'emergency_person', width: 24 },
      { label: 'Emergency Phone', key: 'emergency_phone', width: 15 },
      { label: 'Medical Conditions', key: 'medical_conditions', width: 28 },
      { label: 'Allergies', key: 'allergies', width: 22 },
      { label: 'Disability', key: 'disability', width: 20 },
      { label: 'HELB Applied', key: 'helb', width: 12 },
      { label: 'Admission Fee Paid', key: 'admission_fee_paid', width: 17 },
      { label: 'KUCCPS Fee Paid', key: 'kuccps_fee_paid', width: 16 },
      { label: 'Student ID Fee Paid', key: 'student_id_fee_paid', width: 18 },
      { label: 'Tuition Fee Paid', key: 'tuition_fee_paid', width: 16 },
      { label: 'Full Year Paid', key: 'full_year_paid', width: 14 },
      { label: 'Fee Adjustment (KES)', key: 'fee_adjustment', width: 19, type: 'money' },
      { label: hideFinance ? 'Current Term' : 'Fee Term', key: 'fee_term', width: 28 },
      { label: 'Term Total Fees (KES)', key: 'term_total', width: 20, type: 'money' },
      { label: 'Term Paid (KES)', key: 'term_paid', width: 16, type: 'money' },
      { label: 'Term Balance (KES)', key: 'term_balance', width: 18, type: 'money' },
      { label: 'Fee Status', key: 'fee_status', width: 12 },
      { label: 'Overall Balance, All Terms (KES)', key: 'overall_balance', width: 30, type: 'money' },
      { label: 'ID Card Expiry', key: 'id_card_expiry', width: 14, type: 'date' },
      { label: 'Account Active', key: 'account_active', width: 14 },
      { label: 'Date Registered', key: 'registered', width: 18, type: 'datetime' },
    ].filter((c) => !hideFinance || !FINANCE_COLUMNS.includes(c.key));

    const countBy = (keyFn) => {
      const m = new Map();
      rows.forEach((r) => { const k = keyFn(r) || 'Unassigned'; m.set(k, (m.get(k) || 0) + 1); });
      return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    };
    const totalFees = rows.reduce((s, r) => s + r._numeric_total, 0);
    const totalPaid = rows.reduce((s, r) => s + r._numeric_paid, 0);
    const totalBal = rows.reduce((s, r) => s + r._numeric_balance, 0);

    const summarySheet = buildSummarySheet(
      'Northhorr TVC — Students Full Details Report',
      req.user?.email || '',
      await describeFilters(q),
      [
        {
          title: 'Totals',
          rows: hideFinance
            ? [['Students', rows.length]]
            : [
              ['Students', rows.length],
              ['Term fees billed (KES)', totalFees],
              ['Term fees paid (KES)', totalPaid],
              ['Term balance outstanding (KES)', totalBal],
            ],
          money: [1],
        },
        { title: 'By department', header: ['', 'Students'], rows: countBy((r) => r.department) },
        { title: 'By course', header: ['', 'Students'], rows: countBy((r) => r.course) },
        { title: 'By level', header: ['', 'Students'], rows: countBy((r) => r.level) },
        { title: 'By student status', header: ['', 'Students'], rows: countBy((r) => r.status) },
        { title: 'By gender', header: ['', 'Students'], rows: countBy((r) => r.gender) },
        ...(hideFinance ? [] : [{ title: 'By fee status', header: ['', 'Students'], rows: countBy((r) => r.fee_status) }]),
      ]
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    XLSX.utils.book_append_sheet(wb, buildTableSheet(cols, rows), 'Students');

    sendWorkbook(res, wb, 'Students_Full_Details_Report');
  } catch (err) {
    console.error('Export students report error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate students report' });
  }
};

module.exports = { getReportFilters, exportFeesReport, exportStudentsReport };
