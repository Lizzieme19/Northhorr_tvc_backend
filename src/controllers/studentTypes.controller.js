const prisma = require('../config/db');
const { reconcileMany, studentIdsInTerm, allStudentIdsWithBalances } = require('../services/billingService');
const { assignType, defaultFromTerm } = require('../services/studentTypeService');
const { buildStudentWhere } = require('../utils/studentFilters');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const send = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === 'P2002') return res.status(409).json({ error: 'That name is already used' });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};
const tidy = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const money = (v, label) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || isNaN(n) || n < 0) throw fail(`${label} must be a number, 0 or more`);
  return Math.round(n * 100) / 100;
};
const audit = (req, { action, entityId, oldValues, newValues }) =>
  prisma.auditTrail.create({
    data: {
      user_id: req.user.id, action, entity_type: 'STUDENT_TYPE', entity_id: entityId || null,
      old_values: oldValues ? JSON.stringify(oldValues) : null, new_values: newValues ? JSON.stringify(newValues) : null,
      ip_address: req.ip || null, user_agent: req.headers['user-agent'] || null,
    },
  }).catch((e) => console.error('audit failed', e.message));

// GET /api/student-types - the types with how many students each has
const getTypes = async (req, res) => {
  try {
    const [types, counts, total] = await Promise.all([
      prisma.studentType.findMany({ orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] }),
      prisma.student.groupBy({ by: ['student_type_id'], _count: true }),
      prisma.student.count(),
    ]);
    const by = new Map(counts.map((c) => [c.student_type_id, c._count]));
    const def = types.find((t) => t.is_default);
    res.json({
      types: types.map((t) => ({ ...t, students: (by.get(t.id) || 0) + (t.is_default ? (by.get(null) || 0) : 0) })),
      students_total: total,
      unassigned: types.length ? 0 : total,
      has_default: Boolean(def),
    });
  } catch (err) { send(res, err, 'Could not load the student types'); }
};

// POST /api/student-types { name, description? } - the first one made is the default
const createType = async (req, res) => {
  try {
    const name = tidy(req.body.name);
    if (!name) throw fail('Give the student type a name');
    if (name.length > 60) throw fail('Keep the name under 60 characters');
    if (await prisma.studentType.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) throw fail(`${name} already exists`, 409);
    const first = (await prisma.studentType.count()) === 0;
    const type = await prisma.studentType.create({ data: { name, description: tidy(req.body.description) || null, is_default: first } });
    await audit(req, { action: 'STUDENT_TYPE_CREATED', entityId: type.id, newValues: { name, is_default: first } });
    res.status(201).json(type);
  } catch (err) { send(res, err, 'Could not add the student type'); }
};

// PATCH /api/student-types/:id { name?, description?, is_active? }
const updateType = async (req, res) => {
  try {
    const type = await prisma.studentType.findUnique({ where: { id: req.params.id } });
    if (!type) throw fail('Student type not found', 404);
    const data = {};
    if (req.body.name !== undefined) {
      const name = tidy(req.body.name);
      if (!name) throw fail('Give the student type a name');
      const clash = await prisma.studentType.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, NOT: { id: type.id } } });
      if (clash) throw fail(`${clash.name} already exists`, 409);
      data.name = name;
    }
    if (req.body.description !== undefined) data.description = tidy(req.body.description) || null;
    if (req.body.is_active !== undefined) {
      if (!req.body.is_active && type.is_default) throw fail('The default type cannot be switched off. Make another type the default first.');
      data.is_active = Boolean(req.body.is_active);
    }
    const updated = await prisma.studentType.update({ where: { id: type.id }, data });
    await audit(req, { action: 'STUDENT_TYPE_CHANGED', entityId: type.id, oldValues: { name: type.name, is_active: type.is_active }, newValues: data });
    res.json(updated);
  } catch (err) { send(res, err, 'Could not save the student type'); }
};

// POST /api/student-types/:id/default - students with no type, and terms with no fee set for a type, use the default
const makeDefault = async (req, res) => {
  try {
    const type = await prisma.studentType.findUnique({ where: { id: req.params.id } });
    if (!type) throw fail('Student type not found', 404);
    if (!type.is_active) throw fail('Switch it on first');
    await prisma.studentType.updateMany({ where: { is_default: true }, data: { is_default: false } });
    await prisma.studentType.update({ where: { id: type.id }, data: { is_default: true } });
    await audit(req, { action: 'STUDENT_TYPE_DEFAULT', entityId: type.id, newValues: { name: type.name } });
    res.json({ message: `${type.name} is now the default` });
  } catch (err) { send(res, err, 'Could not change the default'); }
};

// DELETE /api/student-types/:id - only when nothing uses it
const deleteType = async (req, res) => {
  try {
    const type = await prisma.studentType.findUnique({ where: { id: req.params.id } });
    if (!type) throw fail('Student type not found', 404);
    if (type.is_default) throw fail('The default type cannot be removed');
    const [students, balances, fees, rules] = await Promise.all([
      prisma.student.count({ where: { student_type_id: type.id } }),
      prisma.studentBalance.count({ where: { student_type_id: type.id } }),
      prisma.termFee.count({ where: { student_type_id: type.id } }),
      prisma.feeTypeStudentType.count({ where: { student_type_id: type.id } }),
    ]);
    if (students || balances) throw fail(`${students} student${students === 1 ? '' : 's'} (and their term bills) use ${type.name}. Move them to another type, or switch it off instead.`, 409);
    if (fees || rules) throw fail(`${type.name} has term fees or fee type rules set. Clear them first.`, 409);
    await prisma.termVotehead.deleteMany({ where: { student_type_id: type.id } });
    await prisma.studentType.delete({ where: { id: type.id } });
    await audit(req, { action: 'STUDENT_TYPE_REMOVED', entityId: type.id, oldValues: { name: type.name } });
    res.json({ message: 'Removed' });
  } catch (err) { send(res, err, 'Could not remove the student type'); }
};

// POST /api/student-types/setup { apply } - make Direct (the default) and KUCCPS, and give each student the one that
// matches how they applied. Changes no fee: nothing is priced per type until fees are set.
const setupFromApplications = async (req, res) => {
  try {
    const apply = req.body?.apply === true;
    const existing = await prisma.studentType.findMany();
    const has = (n) => existing.find((t) => t.name.toLowerCase() === n.toLowerCase());
    const [kuccps, direct, none] = await Promise.all([
      prisma.student.count({ where: { student_type_id: null, application: { type: 'KUCCPS' } } }),
      prisma.student.count({ where: { student_type_id: null, NOT: { application: { type: 'KUCCPS' } } } }),
      prisma.student.count({ where: { student_type_id: null } }),
    ]);
    const plan = { create: ['Direct', 'KUCCPS'].filter((n) => !has(n)), will_be_kuccps: kuccps, will_be_direct: direct, students_without_a_type: none, applied: false };
    if (!apply) return res.json(plan);

    let directType = has('Direct');
    let kuccpsType = has('KUCCPS');
    const hasDefault = existing.some((t) => t.is_default);
    if (!directType) directType = await prisma.studentType.create({ data: { name: 'Direct', description: 'Self-sponsored, applied directly to the college', is_default: !hasDefault } });
    if (!kuccpsType) kuccpsType = await prisma.studentType.create({ data: { name: 'KUCCPS', description: 'Placed by KUCCPS' } });
    await prisma.student.updateMany({ where: { student_type_id: null, application: { type: 'KUCCPS' } }, data: { student_type_id: kuccpsType.id } });
    await prisma.student.updateMany({ where: { student_type_id: null }, data: { student_type_id: directType.id } });
    await audit(req, { action: 'STUDENT_TYPES_SETUP', newValues: plan });
    res.json({ ...plan, applied: true, message: 'Student types set up. No fee has changed.' });
  } catch (err) { send(res, err, 'Could not set up the student types'); }
};

// GET /api/student-types/fees - the grid: a term fee per type per term, and the fee types with their rules
const getFees = async (req, res) => {
  try {
    const [types, terms, termFees, feeTypes, rules] = await Promise.all([
      prisma.studentType.findMany({ orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] }),
      prisma.term.findMany({ orderBy: { start_date: 'desc' } }),
      prisma.termFee.findMany(),
      prisma.feeType.findMany({ where: { is_active: true }, orderBy: { name: 'asc' } }),
      prisma.feeTypeStudentType.findMany(),
    ]);
    const fees = new Map(termFees.map((f) => [`${f.term_id}|${f.student_type_id}`, f.amount]));
    const rulesBy = new Map();
    for (const r of rules) { if (!rulesBy.has(r.fee_type_id)) rulesBy.set(r.fee_type_id, {}); rulesBy.get(r.fee_type_id)[r.student_type_id] = r.amount; }
    res.json({
      types,
      terms: terms.map((t) => ({
        id: t.id, name: t.name, academic_year: t.academic_year, intake: t.intake, start_date: t.start_date, end_date: t.end_date, standard_fee: t.term_cost, is_active: t.is_active,
        fees: Object.fromEntries(types.filter((ty) => fees.has(`${t.id}|${ty.id}`)).map((ty) => [ty.id, fees.get(`${t.id}|${ty.id}`)])),
      })),
      fee_types: feeTypes.map((f) => ({
        id: f.id, name: f.name, code: f.code, amount: f.amount,
        billing: f.billing || (f.term_based ? (f.added_to_term_fee ? 'EVERY_TERM' : 'NOT_BILLED') : 'ONCE'),
        rules: rulesBy.get(f.id) || null,
      })),
    });
  } catch (err) { send(res, err, 'Could not load the fees'); }
};

const summarize = (impact) => ({
  students_changed: impact.students_changed, rows_changed: impact.rows_changed,
  fees_before: impact.fees_before, fees_after: impact.fees_after, fees_change: impact.fees_change,
  outstanding_before: impact.outstanding_before, outstanding_after: impact.outstanding_after, outstanding_change: impact.outstanding_change,
  items: impact.items,
});

// PUT /api/student-types/term-fees { term_id, student_type_id, amount | null, apply }
// A type's term fee for a term (null = back to the term's standard fee). apply=false only reports who would change.
const setTermFee = async (req, res) => {
  try {
    const { term_id, student_type_id } = req.body;
    const apply = req.body.apply === true;
    const [term, type] = await Promise.all([prisma.term.findUnique({ where: { id: term_id } }), prisma.studentType.findUnique({ where: { id: student_type_id } })]);
    if (!term) throw fail('Term not found', 404);
    if (!type) throw fail('Student type not found', 404);
    if (type.is_default) throw fail(`${type.name} is the default type: its fee is the term's own fee. Change the term's fee under Terms.`);
    const amount = req.body.amount === null || req.body.amount === '' ? null : money(req.body.amount, 'The fee');
    const current = (await prisma.termFee.findUnique({ where: { term_id_student_type_id: { term_id, student_type_id } } }))?.amount ?? null;

    const ids = await studentIdsInTerm(term.id);
    const impact = await reconcileMany(ids, { apply: false, typeFeeOverrides: { [term.id]: { [type.id]: amount } } });
    if (!apply) return res.json({ term: { id: term.id, name: term.name }, type: { id: type.id, name: type.name }, current_fee: current, new_fee: amount, students_in_term: ids.length, impact: summarize(impact), applied: false });

    if (amount === null) await prisma.termFee.deleteMany({ where: { term_id, student_type_id } });
    else await prisma.termFee.upsert({ where: { term_id_student_type_id: { term_id, student_type_id } }, update: { amount }, create: { term_id, student_type_id, amount } });
    const done = await reconcileMany(ids, { apply: true });
    await audit(req, { action: 'TERM_TYPE_FEE_CHANGED', entityId: type.id, oldValues: { term: term.name, student_type: type.name, fee: current }, newValues: { fee: amount, students_changed: done.students_changed } });
    res.json({ term: { id: term.id, name: term.name }, type: { id: type.id, name: type.name }, current_fee: current, new_fee: amount, students_in_term: ids.length, impact: summarize(done), applied: true, message: 'Saved, and the affected students\' fees were recalculated.' });
  } catch (err) { send(res, err, 'Could not set the fee'); }
};

// PUT /api/student-types/fee-type-rules { fee_type_id, rules: null | [{ student_type_id, amount | null }], apply }
// Limits a fee type to certain kinds of student (null = every kind, as before), with an amount for a kind if it differs.
const setFeeTypeRules = async (req, res) => {
  try {
    const { fee_type_id } = req.body;
    const apply = req.body.apply === true;
    const feeType = await prisma.feeType.findUnique({ where: { id: fee_type_id } });
    if (!feeType) throw fail('Fee type not found', 404);
    let list = null;
    if (Array.isArray(req.body.rules)) {
      const types = new Set((await prisma.studentType.findMany({ select: { id: true } })).map((t) => t.id));
      list = req.body.rules.map((r) => {
        if (!types.has(r.student_type_id)) throw fail('A student type in the list was not found');
        return { student_type_id: r.student_type_id, amount: r.amount === null || r.amount === undefined || r.amount === '' ? null : money(r.amount, 'The amount') };
      });
      if (list.length === 0) throw fail('Choose at least one student type, or choose "all students"');
    }
    const before = await prisma.feeTypeStudentType.findMany({ where: { fee_type_id } });
    const ids = await allStudentIdsWithBalances();
    const override = list ? new Map(list.map((r) => [r.student_type_id, r.amount])) : null;
    const impact = await reconcileMany(ids, { apply: false, ruleOverrides: { [fee_type_id]: override } });
    const shape = (rows) => (rows && rows.length ? rows.map((r) => ({ student_type_id: r.student_type_id, amount: r.amount })) : null);
    if (!apply) return res.json({ fee_type: { id: feeType.id, name: feeType.name }, before: shape(before), after: list, students_checked: ids.length, impact: summarize(impact), applied: false });

    await prisma.feeTypeStudentType.deleteMany({ where: { fee_type_id } });
    if (list) for (const r of list) await prisma.feeTypeStudentType.create({ data: { fee_type_id, student_type_id: r.student_type_id, amount: r.amount } });
    const done = await reconcileMany(ids, { apply: true });
    await audit(req, { action: 'FEE_TYPE_RULES_CHANGED', entityId: fee_type_id, oldValues: { fee_type: feeType.name, rules: shape(before) }, newValues: { rules: list, students_changed: done.students_changed } });
    res.json({ fee_type: { id: feeType.id, name: feeType.name }, before: shape(before), after: list, students_checked: ids.length, impact: summarize(done), applied: true, message: 'Saved, and the affected students\' fees were recalculated.' });
  } catch (err) { send(res, err, 'Could not save the rule'); }
};

// POST /api/student-types/assign { student_ids | filters, student_type_id, from_term_id?, apply }
const assign = async (req, res) => {
  try {
    const apply = req.body.apply === true;
    let ids = Array.isArray(req.body.student_ids) ? req.body.student_ids.filter(Boolean) : null;
    if (!ids) {
      if (!req.body.filters || typeof req.body.filters !== 'object') throw fail('Choose the students (a list, or the filters)');
      ids = (await prisma.student.findMany({ where: buildStudentWhere(req.body.filters), select: { id: true } })).map((s) => s.id);
    }
    if (ids.length === 0) throw fail('No students match');
    if (ids.length > 2000) throw fail('Move at most 2,000 students at a time');
    const fromTerm = req.body.from_term_id ? await prisma.term.findUnique({ where: { id: req.body.from_term_id } }) : null;
    if (req.body.from_term_id && !fromTerm) throw fail('Term not found', 404);
    const result = await assignType(ids, req.body.student_type_id, { fromTerm, apply });
    if (apply) await audit(req, { action: 'STUDENTS_TYPE_ASSIGNED', entityId: req.body.student_type_id, newValues: { type: result.type.name, students: result.students, from_term: result.from_term?.name || null, fees_change: result.impact.fees_change } });
    // the registrar moves students between types but does not see money
    const impact = req.user.role === 'REGISTRAR'
      ? { students_changed: result.impact.students_changed, rows_changed: result.impact.rows_changed, items: [] }
      : summarize(result.impact);
    res.json({ ...result, impact });
  } catch (err) { send(res, err, 'Could not move the students'); }
};

module.exports = { getTypes, createType, updateType, makeDefault, deleteType, setupFromApplications, getFees, setTermFee, setFeeTypeRules, assign };
