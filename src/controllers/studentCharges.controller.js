const prisma = require('../config/db');
const { reconcileMany, round2 } = require('../services/billingService');
const { buildStudentWhere, parsePaging } = require('../utils/studentFilters');

// AMOUNTS SET FOR INDIVIDUAL STUDENTS
//
// Some fees are not the same for everyone (an exam fee, a re-sit, a replacement ID, a trip). Finance picks the fee type
// and the term, then gives each student their own amount. The amount is saved as a StudentCharge and the billing engine
// adds it to that student's bill for that term, whatever the fee type's own amount is. Nothing is saved until Finance
// has seen what it would change to the fee totals.

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const send = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};
const MAX_ENTRIES = 2000;
const tidy = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const nameOf = (st) => [st.application?.surname, st.application?.other_names].filter(Boolean).join(' ') || st.admission_no;

const audit = (req, { action, entityId, oldValues, newValues }) =>
  prisma.auditTrail.create({
    data: {
      user_id: req.user.id, action, entity_type: 'STUDENT_CHARGE', entity_id: entityId || null,
      old_values: oldValues ? JSON.stringify(oldValues) : null, new_values: newValues ? JSON.stringify(newValues) : null,
      ip_address: req.ip || null, user_agent: req.headers['user-agent'] || null,
    },
  }).catch((e) => console.error('audit failed', e.message));

// The fee type and term a sheet is about. Tuition is the term fee itself, which is set on the term, so it is not allowed here.
const loadPair = async (feeTypeId, termId) => {
  if (!feeTypeId) throw fail('Choose a fee type');
  if (!termId) throw fail('Choose a term');
  const [feeType, term] = await Promise.all([
    prisma.feeType.findUnique({ where: { id: feeTypeId } }),
    prisma.term.findUnique({ where: { id: termId } }),
  ]);
  if (!feeType) throw fail('Fee type not found', 404);
  if (!term) throw fail('Term not found', 404);
  if (feeType.code === 'TUITION') throw fail('Tuition is the term fee. Change it on the Terms tab, or give a student a fee adjustment.');
  return { feeType, term };
};

// GET /api/student-charges/sheet?fee_type_id&term_id&search&course_id&level&department_id&student_type_id&only_set&page&limit
// The students in the term, each with the amount set for them (or none).
const sheet = async (req, res) => {
  try {
    const { feeType, term } = await loadPair(req.query.fee_type_id, req.query.term_id);
    const where = buildStudentWhere({ ...req.query, term_id: term.id });
    if (req.query.only_set === 'true') where.charges = { some: { term_id: term.id, fee_type_id: feeType.id } };
    else if (req.query.only_set === 'false') where.charges = { none: { term_id: term.id, fee_type_id: feeType.id } };
    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50, maxLimit: 200 });

    const [students, total, setRows] = await Promise.all([
      prisma.student.findMany({
        where, skip, take: limit, orderBy: { admission_no: 'asc' },
        select: {
          id: true, admission_no: true, level: true, status: true,
          application: { select: { surname: true, other_names: true } },
          course: { select: { name: true, shortcode: true } },
          student_type: { select: { name: true } },
          charges: { where: { term_id: term.id, fee_type_id: feeType.id }, select: { amount: true, note: true } },
        },
      }),
      prisma.student.count({ where }),
      prisma.studentCharge.findMany({ where: { term_id: term.id, fee_type_id: feeType.id }, select: { amount: true } }),
    ]);

    res.json({
      fee_type: { id: feeType.id, name: feeType.name, code: feeType.code, amount: feeType.amount, billing: feeType.billing },
      term: { id: term.id, name: term.name, academic_year: term.academic_year },
      students: students.map((s) => ({
        student_id: s.id, admission_no: s.admission_no, name: nameOf(s), level: s.level, status: s.status,
        course: s.course?.shortcode || s.course?.name || '', student_type: s.student_type?.name || null,
        amount: s.charges[0]?.amount ?? null, note: s.charges[0]?.note || '',
      })),
      total, page, pages: Math.max(1, Math.ceil(total / limit)),
      // across the whole term, not only this page
      set_count: setRows.length,
      set_total: round2(setRows.reduce((t, r) => t + r.amount, 0)),
    });
  } catch (err) { send(res, err, 'Could not load the students'); }
};

// POST /api/student-charges/save
// { fee_type_id, term_id, entries: [{ student_id | admission_no, amount | null, note? }], apply }
// amount null / '' takes away the amount set for that student (they are then billed the usual way for this fee type).
// apply=false only reports what would change.
const save = async (req, res) => {
  try {
    const { feeType, term } = await loadPair(req.body.fee_type_id, req.body.term_id);
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (!entries.length) throw fail('There is nothing to save');
    if (entries.length > MAX_ENTRIES) throw fail(`Save at most ${MAX_ENTRIES} students at a time`);
    const apply = req.body.apply === true;

    // find each student, by id or admission number
    const ids = entries.map((e) => e.student_id).filter(Boolean);
    const admNos = entries.filter((e) => !e.student_id && e.admission_no).map((e) => tidy(e.admission_no));
    const found = await prisma.student.findMany({
      where: { OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(admNos.length ? [{ admission_no: { in: admNos } }] : [])] },
      select: { id: true, admission_no: true },
    });
    // an admission number typed in another case (cga/018/2024) is still found
    const have = new Set(found.map((s) => s.admission_no.toLowerCase()));
    for (const a of [...new Set(admNos.filter((a) => !have.has(a.toLowerCase())))].slice(0, 300)) {
      const s = await prisma.student.findFirst({ where: { admission_no: { equals: a, mode: 'insensitive' } }, select: { id: true, admission_no: true } });
      if (s) found.push(s);
    }
    const byId = new Map(found.map((s) => [s.id, s]));
    const byAdm = new Map(found.map((s) => [s.admission_no.toLowerCase(), s]));

    const [enrolled, existing] = await Promise.all([
      prisma.studentBalance.findMany({ where: { term_id: term.id, student_id: { in: found.map((s) => s.id) } }, select: { student_id: true } }),
      prisma.studentCharge.findMany({ where: { term_id: term.id, fee_type_id: feeType.id, student_id: { in: found.map((s) => s.id) } } }),
    ]);
    const inTerm = new Set(enrolled.map((r) => r.student_id));
    const had = new Map(existing.map((c) => [c.student_id, c]));

    const problems = [];
    const todo = new Map(); // student id -> { amount|null, note, admission_no }
    entries.forEach((e, i) => {
      const label = tidy(e.admission_no) || e.student_id || `Row ${i + 1}`;
      const st = e.student_id ? byId.get(e.student_id) : byAdm.get(tidy(e.admission_no).toLowerCase());
      if (!st) return problems.push({ row: i + 1, admission_no: label, reason: 'No student with this admission number' });
      if (!inTerm.has(st.id)) return problems.push({ row: i + 1, admission_no: st.admission_no, reason: `Not enrolled in ${term.name}. Put them in the term first.` });
      const blank = e.amount === null || e.amount === undefined || tidy(e.amount) === '';
      const amount = blank ? null : Number(String(e.amount).replace(/,/g, ''));
      if (!blank && (isNaN(amount) || amount < 0)) return problems.push({ row: i + 1, admission_no: st.admission_no, reason: 'The amount must be a number, 0 or more' });
      if (todo.has(st.id)) problems.push({ row: i + 1, admission_no: st.admission_no, reason: 'Listed more than once. The last amount is used.' });
      todo.set(st.id, { amount: blank ? null : round2(amount), note: tidy(e.note).slice(0, 200) || null, admission_no: st.admission_no });
    });

    // what actually changes
    const counts = { added: 0, changed: 0, removed: 0, unchanged: 0, nothing_to_remove: 0 };
    const writes = []; // { student_id, amount|null, note }
    for (const [studentId, t] of todo) {
      const h = had.get(studentId);
      if (t.amount === null) {
        if (!h) { counts.nothing_to_remove += 1; continue; }
        counts.removed += 1; writes.push({ student_id: studentId, amount: null });
      } else if (!h) {
        counts.added += 1; writes.push({ student_id: studentId, amount: t.amount, note: t.note });
      } else if (Math.abs(h.amount - t.amount) > 0.009 || (h.note || null) !== t.note) {
        counts.changed += 1; writes.push({ student_id: studentId, amount: t.amount, note: t.note });
      } else counts.unchanged += 1;
    }

    // what that does to the fees. A preview works the new amounts out without saving them.
    const key = `${term.id}|${feeType.id}`;
    const overrides = Object.fromEntries(writes.map((w) => [w.student_id, { [key]: w.amount }]));
    const ids2 = writes.map((w) => w.student_id);
    const impact = ids2.length ? await reconcileMany(ids2, { apply: false, chargeOverridesByStudent: overrides, limitItems: 50 }) : null;

    if (apply && writes.length) {
      await prisma.$transaction(writes.map((w) => (w.amount === null
        ? prisma.studentCharge.deleteMany({ where: { student_id: w.student_id, term_id: term.id, fee_type_id: feeType.id } })
        : prisma.studentCharge.upsert({
          where: { student_term_fee: { student_id: w.student_id, term_id: term.id, fee_type_id: feeType.id } },
          create: { student_id: w.student_id, term_id: term.id, fee_type_id: feeType.id, amount: w.amount, note: w.note, created_by: req.user.id },
          update: { amount: w.amount, note: w.note },
        }))));
      // the amounts are saved now, so the engine reads them itself
      await reconcileMany(ids2, { apply: true, limitItems: 0 });
      await audit(req, {
        action: 'STUDENT_CHARGES_SET', entityId: feeType.id,
        oldValues: { term: term.name, fee_type: feeType.name },
        newValues: { ...counts, students: writes.slice(0, 200).map((w) => ({ admission_no: todo.get(w.student_id).admission_no, amount: w.amount })) },
      });
    }

    res.json({
      applied: apply && writes.length > 0,
      fee_type: { id: feeType.id, name: feeType.name }, term: { id: term.id, name: term.name },
      counts, problems,
      impact: impact && {
        students_changed: impact.students_changed, fees_before: impact.fees_before, fees_after: impact.fees_after, fees_change: impact.fees_change,
        outstanding_before: impact.outstanding_before, outstanding_after: impact.outstanding_after, outstanding_change: impact.outstanding_change,
      },
      // who changes and by how much, for the preview
      items: writes.slice(0, 200).map((w) => ({
        student_id: w.student_id, admission_no: todo.get(w.student_id).admission_no,
        before: had.get(w.student_id)?.amount ?? null, after: w.amount,
      })),
    });
  } catch (err) { send(res, err, 'Could not save the amounts'); }
};

// GET /api/student-charges/student/:id - every amount set for one student
const forStudent = async (req, res) => {
  try {
    const rows = await prisma.studentCharge.findMany({
      where: { student_id: req.params.id },
      include: { term: { select: { id: true, name: true, academic_year: true, start_date: true } }, fee_type: { select: { id: true, name: true, code: true } } },
    });
    rows.sort((a, b) => new Date(b.term.start_date) - new Date(a.term.start_date));
    res.json(rows.map((r) => ({ id: r.id, term: r.term, fee_type: r.fee_type, amount: r.amount, note: r.note || '' })));
  } catch (err) { send(res, err, 'Could not load the amounts'); }
};

module.exports = { sheet, save, forStudent };
