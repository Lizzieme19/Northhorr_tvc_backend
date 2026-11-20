const prisma = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// The interests and sports lists. Anyone signed in can read the active ones (students pick from them); the admin
// keeps them: add, rename (students' choices follow the new name), switch off, remove when no student has it.
// ─────────────────────────────────────────────────────────────────────────────

const KINDS = ['INTEREST', 'SPORT'];
const TYPICAL = {
  SPORT: ['Football', 'Volleyball', 'Netball', 'Basketball', 'Handball', 'Athletics', 'Rugby', 'Chess', 'Table tennis', 'Darts'],
  INTEREST: ['Music', 'Drama and theatre', 'Debate', 'Photography', 'Reading', 'Farming', 'Entrepreneurship', 'Computing and coding', 'Art and design', 'Community service'],
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const send = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === 'P2002') return res.status(409).json({ error: 'That is already in the list' });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};
const tidy = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const field = (kind) => (kind === 'SPORT' ? 'sports' : 'interests');

// How many students chose each option
const usage = async () => {
  const students = await prisma.student.findMany({ select: { interests: true, sports: true } });
  const out = { INTEREST: new Map(), SPORT: new Map() };
  for (const s of students) {
    (s.interests || []).forEach((n) => out.INTEREST.set(n, (out.INTEREST.get(n) || 0) + 1));
    (s.sports || []).forEach((n) => out.SPORT.set(n, (out.SPORT.get(n) || 0) + 1));
  }
  return out;
};

// GET /api/profile-options        -> { interests: [names], sports: [names] } (active only)
// GET /api/profile-options?all=1  -> admin: every option with its id, state and how many students chose it
const getOptions = async (req, res) => {
  try {
    if (req.query.all && req.user.role === 'ADMIN') {
      const [rows, used] = await Promise.all([prisma.profileOption.findMany({ orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] }), usage()]);
      const withCount = rows.map((r) => ({ ...r, students: used[r.kind]?.get(r.name) || 0 }));
      return res.json({ interests: withCount.filter((r) => r.kind === 'INTEREST'), sports: withCount.filter((r) => r.kind === 'SPORT') });
    }
    const rows = await prisma.profileOption.findMany({ where: { is_active: true }, orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] });
    res.json({ interests: rows.filter((r) => r.kind === 'INTEREST').map((r) => r.name), sports: rows.filter((r) => r.kind === 'SPORT').map((r) => r.name) });
  } catch (err) {
    send(res, err, 'Could not load the lists');
  }
};

// POST /api/profile-options { kind, name }
const createOption = async (req, res) => {
  try {
    const kind = String(req.body.kind || '').toUpperCase();
    if (!KINDS.includes(kind)) throw fail('Say whether it is an interest or a sport');
    const name = tidy(req.body.name);
    if (!name) throw fail('Give it a name');
    if (name.length > 60) throw fail('Keep the name under 60 characters');
    const clash = await prisma.profileOption.findFirst({ where: { kind, name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw fail(`${clash.name} is already in the list`, 409);
    res.status(201).json(await prisma.profileOption.create({ data: { kind, name } }));
  } catch (err) {
    send(res, err, 'Could not add it');
  }
};

// POST /api/profile-options/defaults - add the usual ones that are missing
const addTypical = async (req, res) => {
  try {
    let added = 0;
    for (const kind of KINDS) {
      const have = (await prisma.profileOption.findMany({ where: { kind } })).map((o) => o.name.toLowerCase());
      for (const name of TYPICAL[kind]) {
        if (have.includes(name.toLowerCase())) continue;
        await prisma.profileOption.create({ data: { kind, name } });
        added += 1;
      }
    }
    res.json({ added, message: added ? `Added ${added} usual options` : 'The usual options are already there' });
  } catch (err) {
    send(res, err, 'Could not add the usual options');
  }
};

// PATCH /api/profile-options/:id { name?, is_active?, sort_order? }
const updateOption = async (req, res) => {
  try {
    const opt = await prisma.profileOption.findUnique({ where: { id: req.params.id } });
    if (!opt) throw fail('Not found', 404);
    const data = {};
    if (req.body.is_active !== undefined) data.is_active = Boolean(req.body.is_active);
    if (req.body.sort_order !== undefined) data.sort_order = parseInt(req.body.sort_order, 10) || 0;
    let renamed = null;
    if (req.body.name !== undefined) {
      const name = tidy(req.body.name);
      if (!name) throw fail('Give it a name');
      if (name.length > 60) throw fail('Keep the name under 60 characters');
      if (name !== opt.name) {
        const clash = await prisma.profileOption.findFirst({ where: { kind: opt.kind, name: { equals: name, mode: 'insensitive' }, NOT: { id: opt.id } } });
        if (clash) throw fail(`${clash.name} is already in the list`, 409);
        data.name = name;
        renamed = name;
      }
    }
    const updated = await prisma.profileOption.update({ where: { id: opt.id }, data });
    // the students who chose it keep it under the new name
    if (renamed) {
      const f = field(opt.kind);
      const students = await prisma.student.findMany({ where: { [f]: { has: opt.name } }, select: { id: true, [f]: true } });
      for (const s of students) {
        await prisma.student.update({ where: { id: s.id }, data: { [f]: s[f].map((n) => (n === opt.name ? renamed : n)) } });
      }
    }
    res.json(updated);
  } catch (err) {
    send(res, err, 'Could not save it');
  }
};

// DELETE /api/profile-options/:id - only when no student has chosen it (otherwise switch it off)
const deleteOption = async (req, res) => {
  try {
    const opt = await prisma.profileOption.findUnique({ where: { id: req.params.id } });
    if (!opt) throw fail('Not found', 404);
    const n = (await usage())[opt.kind]?.get(opt.name) || 0;
    if (n > 0) throw fail(`${n} student${n === 1 ? ' has' : 's have'} chosen ${opt.name}. Switch it off instead, so they keep it but nobody else can pick it.`, 409);
    await prisma.profileOption.delete({ where: { id: opt.id } });
    res.json({ message: 'Removed' });
  } catch (err) {
    send(res, err, 'Could not remove it');
  }
};

// Checks a student's choices against the active lists. Choices a student already has that were switched off are
// kept (they are not forced to drop them), new ones must be active. Returns the cleaned arrays.
const checkChoices = async ({ interests, sports }, current = {}) => {
  const active = await prisma.profileOption.findMany({ where: { is_active: true } });
  const ok = { INTEREST: new Set(active.filter((o) => o.kind === 'INTEREST').map((o) => o.name)), SPORT: new Set(active.filter((o) => o.kind === 'SPORT').map((o) => o.name)) };
  const clean = (list, kind, had = []) => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list)) throw fail('Choose from the list');
    const out = [];
    for (const raw of list) {
      const n = String(raw);
      if (!ok[kind].has(n) && !had.includes(n)) throw fail(`${n} is not in the list`);
      if (!out.includes(n)) out.push(n);
    }
    if (out.length > 30) throw fail('Choose at most 30');
    return out;
  };
  return { interests: clean(interests, 'INTEREST', current.interests || []), sports: clean(sports, 'SPORT', current.sports || []) };
};

module.exports = { getOptions, createOption, addTypical, updateOption, deleteOption, checkChoices };
