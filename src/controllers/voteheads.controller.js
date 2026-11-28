const prisma = require('../config/db');
const { loadContext, termFeeFor, round2 } = require('../services/billingService');
const { NEAR } = require('../services/voteheadService');

// The votehead split of a term fee: how much of it is Tuition, Activity, and so on, for each term and (where it
// differs) each kind of student. Used by Allocate Funds. Saving a split never changes anyone's bill.

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const send = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};
const money = (n) => `KES ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const byStart = (a, b) => new Date(b.start_date) - new Date(a.start_date);

// GET /api/terms/:id/voteheads - the splits saved for the term, with what is needed to edit them
const getVoteheads = async (req, res) => {
  try {
    const [ctx, terms, rows] = await Promise.all([loadContext(), prisma.term.findMany(), prisma.termVotehead.findMany()]);
    const term = terms.find((t) => t.id === req.params.id);
    if (!term) throw fail('Term not found', 404);

    // '' is the standard split; then one choice per kind of student
    const kinds = [{ id: '', name: 'All students (standard)' }, ...ctx.types.filter((t) => t.is_active && !t.is_default).map((t) => ({ id: t.id, name: t.name }))];
    const feeOf = (t, typeId) => termFeeFor(ctx, t, typeId || null);
    const rowsFor = (termId, typeId) => rows.filter((r) => r.term_id === termId && r.student_type_id === typeId).map((r) => ({ fee_type_id: r.fee_type_id, amount: r.amount }));

    const copyFrom = [];
    for (const t of [...terms].sort(byStart)) {
      for (const k of kinds) {
        const saved = rowsFor(t.id, k.id);
        if (saved.length && !(t.id === term.id)) copyFrom.push({ term_id: t.id, term: t.name, academic_year: t.academic_year, student_type_id: k.id, kind: k.name, total: round2(saved.reduce((s, r) => s + r.amount, 0)), rows: saved });
      }
    }

    res.json({
      term: { id: term.id, name: term.name, academic_year: term.academic_year },
      kinds: kinds.map((k) => ({ ...k, term_fee: feeOf(term, k.id), rows: rowsFor(term.id, k.id) })),
      fee_types: ctx.feeTypes.filter((f) => f.billing !== 'PER_STUDENT').map((f) => ({ id: f.id, name: f.name, code: f.code, amount: f.amount })).sort((a, b) => a.name.localeCompare(b.name)),
      copy_from: copyFrom,
      other_terms: terms.filter((t) => t.id !== term.id).sort(byStart).map((t) => ({
        id: t.id, name: t.name, academic_year: t.academic_year, start_date: t.start_date,
        fees: Object.fromEntries(kinds.map((k) => [k.id, feeOf(t, k.id)])),
        has: kinds.filter((k) => rowsFor(t.id, k.id).length).map((k) => k.id),
      })),
    });
  } catch (err) { send(res, err, 'Could not load the votehead split'); }
};

// PUT /api/terms/:id/voteheads  { student_type_id: '' | id, rows: [{ fee_type_id, amount }], also_term_ids?: [] }
// An empty list takes the split away. The split must add up to the term fee. Other terms given in also_term_ids get
// the same split when their term fee matches it; the rest are reported and left alone.
const saveVoteheads = async (req, res) => {
  try {
    const typeId = String(req.body.student_type_id || '');
    const ctx = await loadContext();
    if (typeId && !ctx.types.some((t) => t.id === typeId)) throw fail('Student type not found', 404);
    if (!Array.isArray(req.body.rows)) throw fail('rows is required');

    const allowed = new Map(ctx.feeTypes.filter((f) => f.billing !== 'PER_STUDENT').map((f) => [f.id, f]));
    const seen = new Set();
    const rows = [];
    for (const r of req.body.rows) {
      if (r.amount === '' || r.amount === null || r.amount === undefined) continue;
      const amount = Number(r.amount);
      if (!allowed.has(r.fee_type_id)) throw fail('One of the fee types cannot be part of a term fee');
      if (isNaN(amount) || amount < 0) throw fail(`The amount for ${allowed.get(r.fee_type_id).name} must be a number, 0 or more`);
      if (seen.has(r.fee_type_id)) throw fail(`${allowed.get(r.fee_type_id).name} is listed twice`);
      seen.add(r.fee_type_id);
      if (amount > 0) rows.push({ fee_type_id: r.fee_type_id, amount: round2(amount) });
    }
    const total = round2(rows.reduce((s, r) => s + r.amount, 0));

    const also = Array.isArray(req.body.also_term_ids) ? req.body.also_term_ids : [];
    const terms = await prisma.term.findMany({ where: { id: { in: [req.params.id, ...also] } } });
    const first = terms.find((t) => t.id === req.params.id);
    if (!first) throw fail('Term not found', 404);
    const fits = (t) => !rows.length || Math.abs(total - termFeeFor(ctx, t, typeId || null)) <= NEAR;
    if (!fits(first)) throw fail(`The voteheads add up to ${money(total)} but the term fee is ${money(termFeeFor(ctx, first, typeId || null))}. They must be the same.`);

    const targets = [first, ...terms.filter((t) => t.id !== first.id)];
    const skipped = targets.filter((t) => !fits(t)).map((t) => ({ term_id: t.id, term: t.name, academic_year: t.academic_year, reason: `Its term fee is ${money(termFeeFor(ctx, t, typeId || null))}, not ${money(total)}` }));
    const saved = targets.filter(fits);

    await prisma.$transaction(saved.flatMap((t) => [
      prisma.termVotehead.deleteMany({ where: { term_id: t.id, student_type_id: typeId } }),
      ...rows.map((r) => prisma.termVotehead.create({ data: { term_id: t.id, student_type_id: typeId, fee_type_id: r.fee_type_id, amount: r.amount } })),
    ]));

    await prisma.auditTrail.create({
      data: {
        user_id: req.user.id, action: rows.length ? 'VOTEHEAD_SPLIT_SAVED' : 'VOTEHEAD_SPLIT_REMOVED', entity_type: 'TERM', entity_id: first.id,
        new_values: JSON.stringify({ student_type: ctx.types.find((t) => t.id === typeId)?.name || 'Standard', total, voteheads: rows.map((r) => ({ name: allowed.get(r.fee_type_id).name, amount: r.amount })), terms: saved.map((t) => t.name) }),
        ip_address: req.ip || null, user_agent: req.headers['user-agent'] || null,
      },
    }).catch((e) => console.error('audit failed', e.message));

    res.json({ saved: saved.map((t) => ({ term_id: t.id, term: t.name })), skipped, total });
  } catch (err) { send(res, err, 'Could not save the votehead split'); }
};

module.exports = { getVoteheads, saveVoteheads };
