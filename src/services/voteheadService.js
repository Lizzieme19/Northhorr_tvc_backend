const prisma = require('../config/db');
const { planStudent, loadContext, round2 } = require('./billingService');

// ─────────────────────────────────────────────────────────────────────────────
// WHAT A PAYMENT ON A TERM CAN BE ALLOCATED TO (Allocate Funds)
//
// For the chosen term:
//   1. the term fee, split by the votehead split saved for that term and kind of student (TermVotehead)
//   2. anything else billed on that term bill under its own fee type: amounts set for the student, and fee types
//      charged once or every term
//   3. such separate charges from earlier terms that are still unpaid and were carried onto this bill
//
// Only (2) and (3) are "separate charges": they stay allocatable under their own votehead on later bills until paid.
// Nothing here changes what a student is billed.
// ─────────────────────────────────────────────────────────────────────────────

const TINY = 0.009;
// A split within this much of the term fee counts as adding up (a share of an annual fee rarely divides evenly)
const NEAR = 1;

const add = (map, key, n) => map.set(key, round2((map.get(key) || 0) + n));
const sum = (values) => round2([...values].reduce((t, v) => t + v, 0));

// The split for a term for a kind of student: its own if saved, otherwise the standard one
const pickSplit = (rows, termId, typeId) => {
  const here = rows.filter((r) => r.term_id === termId);
  const own = typeId ? here.filter((r) => r.student_type_id === typeId) : [];
  if (own.length) return { source: 'type', rows: own };
  const standard = here.filter((r) => !r.student_type_id);
  return standard.length ? { source: 'standard', rows: standard } : null;
};

const allocationView = async (studentId, termId) => {
  const ctx = await loadContext();
  const { plan } = await planStudent(studentId, { ctx });
  const at = plan.findIndex((p) => p.row.term_id === termId);
  if (at === -1) throw Object.assign(new Error('Student balance not found for this term'), { status: 404 });

  const [records, splitRows] = await Promise.all([
    prisma.feeRecord.findMany({ where: { student_id: studentId, fee_type_id: { not: null } }, select: { term_id: true, fee_type_id: true, amount: true } }),
    prisma.termVotehead.findMany({ where: { term_id: { in: plan.map((p) => p.row.term_id) } } }),
  ]);

  // each term of the student: what is billed under which votehead, and what has been allocated to it
  const terms = plan.map((p) => {
    const split = pickSplit(splitRows, p.row.term_id, p.student_type_id);
    const base = round2(p.breakdown.find((b) => b.kind === 'term')?.amount || 0);
    const shares = new Map();
    if (split && base > TINY) for (const r of split.rows) add(shares, r.fee_type_id, r.amount);
    const separate = new Map();
    for (const b of p.breakdown) if (b.fee_type_id && b.kind !== 'term' && b.amount > TINY) add(separate, b.fee_type_id, b.amount);
    const allocated = new Map();
    for (const r of records) if (r.term_id === p.row.term_id) add(allocated, r.fee_type_id, r.amount);
    return { p, split, base, shares, separate, allocated };
  });

  // Charges older than the last term that was fully settled are paid: nothing of them was carried further
  const settledBefore = (i) => { for (let k = i - 1; k >= 0; k -= 1) if (plan[k].after.balance <= TINY) return k; return -1; };

  const feeTypeIds = new Set();
  terms.forEach((t) => [t.shares, t.separate, t.allocated].forEach((m) => m.forEach((_, id) => feeTypeIds.add(id))));

  const lines = [];
  for (const ftId of feeTypeIds) {
    const open = terms.map(() => 0); // what is still unpaid of each term's separate charge
    let toEarlier = 0; // part of this term's allocations that paid charges brought forward
    // an allocation pays its own term first; anything over goes to the oldest unpaid charge carried into that term
    terms.forEach((t, i) => {
      let money = t.allocated.get(ftId) || 0;
      money -= Math.min(money, t.shares.get(ftId) || 0);
      const own = t.separate.get(ftId) || 0;
      const paidOwn = Math.min(money, own);
      money -= paidOwn;
      open[i] = round2(own - paidOwn);
      for (let j = settledBefore(i) + 1; j < i && money > TINY; j += 1) {
        const x = Math.min(money, open[j]);
        open[j] = round2(open[j] - x);
        money = round2(money - x);
        if (i === at) toEarlier = round2(toEarlier + x);
      }
    });

    const here = terms[at];
    const paidHere = here.allocated.get(ftId) || 0;
    const share = here.shares.get(ftId) || 0;
    const own = here.separate.get(ftId) || 0;
    const ownDue = round2(share - Math.min(share, paidHere) + open[at]);
    const sources = [];
    for (let j = settledBefore(at) + 1; j < at; j += 1) {
      if (open[j] > TINY) sources.push({ term_id: plan[j].row.term_id, term: plan[j].row.term.name, academic_year: plan[j].row.term.academic_year, order: j, amount: open[j] });
    }
    lines.push({ fee_type_id: ftId, share, own, paidHere, ownDue, toEarlier, sources });
  }

  // No more can be brought forward than the debt that actually came into this term (oldest assumed paid first)
  const debtIn = Math.max(0, plan[at].after.carryover || 0);
  let over = round2(sum(lines.map((l) => l.toEarlier + sum(l.sources.map((s) => s.amount)))) - debtIn);
  if (over > TINY) {
    const all = lines.flatMap((l) => l.sources).sort((a, b) => a.order - b.order);
    for (const s of all) {
      if (over <= TINY) break;
      const cut = Math.min(over, s.amount);
      s.amount = round2(s.amount - cut);
      over = round2(over - cut);
    }
  }

  const here = terms[at];
  const info = (id) => { const f = ctx.feeTypeById.get(id); return { id, name: f?.name || 'Fee type', code: f?.code || '' }; };
  const unsplit = !here.split && here.base > TINY;

  const shown = lines.map((l) => {
    const sources = l.sources.filter((s) => s.amount > TINY).map(({ order, ...s }) => s);
    const carriedDue = sum(sources.map((s) => s.amount));
    const billed = round2(l.share + l.own);
    const brought = round2(carriedDue + l.toEarlier);
    const balance = round2(Math.max(0, l.ownDue + carriedDue));
    const due = round2(billed + brought);
    return {
      fee_type: info(l.fee_type_id),
      term_fee_share: l.share, separate: l.own, billed, brought_forward: brought, brought_from: sources,
      paid: l.paidHere, paid_later: round2(Math.max(0, due - l.paidHere - balance)), balance,
      status: due <= TINY ? 'NOT_ON_BILL' : balance <= TINY ? 'PAID' : l.paidHere > TINY ? 'PARTIAL' : 'PENDING',
    };
  }).filter((l) => l.billed > TINY || l.brought_forward > TINY || l.paid > TINY);

  // With no split saved, the term fee is one amount that can be shared among the ordinary voteheads
  let rest = null;
  let voteheads = shown;
  if (unsplit) {
    const withOwnLine = new Set(shown.filter((l) => l.billed > TINY || l.brought_forward > TINY).map((l) => l.fee_type.id));
    const pool = ctx.feeTypes.filter((f) => f.billing !== 'PER_STUDENT' && !withOwnLine.has(f.id));
    const poolIds = new Set([...pool.map((f) => f.id), ...[...here.allocated.keys()].filter((id) => !withOwnLine.has(id))]);
    const used = sum([...poolIds].map((id) => here.allocated.get(id) || 0));
    rest = {
      amount: here.base, allocated: used, balance: round2(Math.max(0, here.base - used)),
      fee_types: [...poolIds].map((id) => ({ ...info(id), paid: here.allocated.get(id) || 0 })).sort((a, b) => a.name.localeCompare(b.name)),
    };
    voteheads = shown.filter((l) => !poolIds.has(l.fee_type.id));
  }

  // voteheads of this bill first, then what was brought forward, then allocations that match nothing on the bill
  const rank = (l) => (l.term_fee_share > TINY ? 0 : l.separate > TINY ? 1 : l.brought_forward > TINY ? 2 : 3);
  voteheads.sort((a, b) => rank(a) - rank(b) || a.fee_type.name.localeCompare(b.fee_type.name));

  const type = ctx.types.find((t) => t.id === here.p.student_type_id) || null;
  const splitTotal = here.split ? sum(here.split.rows.map((r) => r.amount)) : null;
  const warnings = [];
  const money = (n) => `KES ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (unsplit) warnings.push(`No votehead split is saved for this term${type ? ` for ${type.name}` : ''}, so the term fee of ${money(here.base)} is not divided. Set up the split to see the amount required under each votehead.`);
  if (here.split && here.base > TINY && Math.abs(splitTotal - here.base) > NEAR) warnings.push(`The saved split adds up to ${money(splitTotal)} but the term fee on this bill is ${money(here.base)}. Correct the split for this term.`);
  if (here.p.row.fee_override != null) warnings.push(`This term's fee was set by hand to ${money(here.p.row.fee_override)}, so it may not match the amounts below.`);
  const discount = here.p.breakdown.find((b) => b.kind === 'adjustment');
  if (discount) warnings.push(`A fee adjustment of ${money(-discount.amount)} reduces this bill. It is not taken from any one votehead.`);

  return {
    term_fee: here.base,
    student_type: type ? { id: type.id, name: type.name } : null,
    split: here.split ? { source: here.split.source, total: splitTotal } : null,
    voteheads,
    unsplit: rest,
    warnings,
  };
};

// Refuses an allocation that goes over what is due. allocations: [{ fee_type_id, amount }]
const checkAllocations = (view, allocations, names = new Map()) => {
  const lines = new Map(view.voteheads.map((l) => [l.fee_type.id, l]));
  const pool = new Map((view.unsplit?.fee_types || []).map((f) => [f.id, f]));
  let fromPool = 0;
  const money = (n) => `KES ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  for (const a of allocations) {
    const amount = Number(a.amount) || 0;
    if (amount <= 0) continue;
    const line = lines.get(a.fee_type_id);
    if (line) {
      if (amount > line.balance + 0.01) return line.balance > TINY ? `Only ${money(line.balance)} is due under ${line.fee_type.name} for this term` : `Nothing is due under ${line.fee_type.name} for this term`;
    } else if (pool.has(a.fee_type_id)) fromPool += amount;
    else return `${names.get(a.fee_type_id) || 'That fee type'} is not on this term's bill`;
  }
  if (fromPool > (view.unsplit?.balance || 0) + 0.01) return `Only ${money(view.unsplit?.balance || 0)} of the term fee is left to allocate`;
  return null;
};

module.exports = { allocationView, checkAllocations, pickSplit, NEAR };
