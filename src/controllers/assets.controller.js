const prisma = require('../config/db');
const { parsePaging } = require('../utils/studentFilters');
const { valuation } = require('../utils/assetValuation');
const {
  ASSET_CLASSES, CONDITIONS, sentenceCase, parseTag, formatTag, defaultPrefix, tagOptions, nextSeqForPrefix, findAssetType,
} = require('../services/assetRegisterService');

// ─────────────────────────────────────────────────────────────────────────────
// ASSET REGISTER
// One row per individually tagged item. What an asset is worth is worked out from its cost, date and
// depreciation rate each time it is read, so it can never disagree with the figures it comes from.
// ─────────────────────────────────────────────────────────────────────────────

const locationSelect = { select: { id: true, name: true } };
const listInclude = {
  current_location: locationSelect,
  original_location: locationSelect,
  department: { select: { id: true, name: true } },
};

const withValue = (a) => ({ ...a, valuation: valuation(a) });

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === 'P2002') return res.status(409).json({ error: 'An asset with that tag number already exists' });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

const optionalDate = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw fail('A date was not valid');
  return d;
};
const optionalNumber = (v, label) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = parseFloat(v);
  if (isNaN(n) || n < 0) throw fail(`${label} must be a number, 0 or more`);
  return n;
};
const optionalText = (v) => (v === undefined ? undefined : (String(v).trim() || null));

// The fields that can be set when creating or editing an asset
const readFields = (b) => {
  const f = {
    name: b.name !== undefined ? sentenceCase(b.name) : undefined,
    description: optionalText(b.description),
    category: b.category !== undefined ? (sentenceCase(b.category) || null) : undefined,
    serial_number: optionalText(b.serial_number),
    make_model: optionalText(b.make_model),
    source_of_funds: optionalText(b.source_of_funds),
    pv_number: optionalText(b.pv_number),
    responsible_officer: optionalText(b.responsible_officer),
    notes: optionalText(b.notes),
    delivery_date: optionalDate(b.delivery_date),
    purchase_date: optionalDate(b.purchase_date),
    replacement_date: optionalDate(b.replacement_date),
    purchase_cost: optionalNumber(b.purchase_cost, 'Cost'),
    depreciation_rate: optionalNumber(b.depreciation_rate, 'Depreciation rate'),
    useful_life: b.useful_life === undefined ? undefined : (b.useful_life ? parseInt(b.useful_life) : null),
    location_id: b.location_id === undefined ? undefined : (b.location_id || null),
    original_location_id: b.original_location_id === undefined ? undefined : (b.original_location_id || null),
    department_id: b.department_id === undefined ? undefined : (b.department_id || null),
    custodian_id: b.custodian_id === undefined ? undefined : (b.custodian_id || null),
  };
  if (b.condition !== undefined) {
    const c = b.condition ? String(b.condition).toUpperCase() : null;
    if (c && !CONDITIONS.includes(c)) throw fail(`Condition must be one of: ${CONDITIONS.join(', ')}`);
    f.condition = c;
  }
  if (b.asset_class !== undefined) {
    if (!ASSET_CLASSES[b.asset_class]) throw fail(`Asset class must be one of: ${Object.keys(ASSET_CLASSES).join(', ')}`);
    f.asset_class = b.asset_class;
  }
  if (b.status !== undefined) {
    if (!['ACTIVE', 'DISPOSED', 'WRITTEN_OFF'].includes(b.status)) throw fail('Status must be ACTIVE, DISPOSED or WRITTEN_OFF');
    f.status = b.status;
  }
  // drop what was not sent
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
};

// GET /api/assets
// Query: asset_class, category, location_id, condition, status, search, needs_valuation, attention, page, limit
const getAssets = async (req, res) => {
  try {
    const q = req.query;
    const { page, limit, skip } = parsePaging(q, { defaultLimit: 25 });

    const where = {};
    if (q.asset_class) where.asset_class = q.asset_class;
    if (q.category) where.category = q.category;
    if (q.location_id === 'none') where.location_id = null;
    else if (q.location_id) where.location_id = q.location_id;
    if (q.condition === 'none') where.condition = null;
    else if (q.condition) where.condition = q.condition;
    if (q.status) where.status = q.status;
    if (q.department_id) where.department_id = q.department_id;
    if (q.needs_valuation === 'true') where.purchase_cost = null;
    if (q.attention === 'true') where.attention = { not: null };
    if (q.search && String(q.search).trim()) {
      const s = String(q.search).trim();
      where.OR = [
        { asset_code: { contains: s, mode: 'insensitive' } },
        { name: { contains: s, mode: 'insensitive' } },
        { serial_number: { contains: s, mode: 'insensitive' } },
        { make_model: { contains: s, mode: 'insensitive' } },
        { category: { contains: s, mode: 'insensitive' } },
        { responsible_officer: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [assets, total] = await Promise.all([
      prisma.asset.findMany({ where, include: listInclude, orderBy: [{ asset_code: 'asc' }], skip, take: limit }),
      prisma.asset.count({ where }),
    ]);

    res.json({ assets: assets.map(withValue), pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    sendError(res, err, 'Could not load the assets');
  }
};

// GET /api/assets/summary
const getAssetSummary = async (req, res) => {
  try {
    const [byClass, needsValuation, byClassNeeds, byCondition, byStatus, attention, noLocation, valued] = await Promise.all([
      prisma.asset.groupBy({ by: ['asset_class'], where: { status: 'ACTIVE' }, _count: true }),
      prisma.asset.count({ where: { status: 'ACTIVE', purchase_cost: null } }),
      prisma.asset.groupBy({ by: ['asset_class'], where: { status: 'ACTIVE', purchase_cost: null }, _count: true }),
      prisma.asset.groupBy({ by: ['condition'], where: { status: 'ACTIVE' }, _count: true }),
      prisma.asset.groupBy({ by: ['status'], _count: true }),
      prisma.asset.count({ where: { attention: { not: null } } }),
      prisma.asset.count({ where: { status: 'ACTIVE', location_id: null } }),
      prisma.asset.findMany({ where: { status: 'ACTIVE', purchase_cost: { not: null } }, select: { purchase_cost: true, purchase_date: true, delivery_date: true, depreciation_rate: true, disposal_date: true } }),
    ]);

    const needsBy = new Map(byClassNeeds.map((r) => [r.asset_class, r._count]));
    const toTag = (await receivedAssetLines()).reduce((n, l) => n + l.remaining, 0);
    let cost = 0;
    let nbv = 0;
    for (const a of valued) {
      const v = valuation(a);
      cost += a.purchase_cost || 0;
      nbv += v.net_book_value ?? a.purchase_cost ?? 0;
    }

    res.json({
      total_active: byClass.reduce((s, r) => s + r._count, 0),
      by_class: Object.entries(ASSET_CLASSES).map(([key, c]) => ({
        key, label: c.label, count: byClass.find((r) => r.asset_class === key)?._count || 0, needs_valuation: needsBy.get(key) || 0,
      })),
      by_condition: byCondition.map((r) => ({ condition: r.condition, count: r._count })),
      by_status: byStatus.map((r) => ({ status: r.status, count: r._count })),
      needs_valuation: needsValuation,
      needs_attention: attention,
      without_location: noLocation,
      to_tag: toTag,
      valued_assets: valued.length,
      total_cost: Math.round(cost * 100) / 100,
      total_net_book_value: Math.round(nbv * 100) / 100,
    });
  } catch (err) {
    sendError(res, err, 'Could not load the summary');
  }
};

// GET /api/assets/options - dropdown values for the filters and the form
const getAssetOptions = async (req, res) => {
  try {
    const [types, locations, sources] = await Promise.all([
      assetTypeRows(),
      prisma.assetLocation.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { assets: true } } } }),
      prisma.asset.findMany({ where: { source_of_funds: { not: null } }, distinct: ['source_of_funds'], select: { source_of_funds: true } }),
    ]);
    res.json({
      classes: Object.entries(ASSET_CLASSES).map(([key, c]) => ({ key, label: c.label, code: c.code })),
      conditions: CONDITIONS,
      // every asset item: those in the list and any only seen in the register
      categories: types.map((t) => ({ asset_class: t.asset_class, name: t.name, count: t.count, depreciation_rate: t.depreciation_rate })).sort((a, b) => a.name.localeCompare(b.name)),
      locations: locations.map((l) => ({ id: l.id, name: l.name, count: l._count.assets })),
      sources_of_funds: sources.map((s) => s.source_of_funds),
    });
  } catch (err) {
    sendError(res, err, 'Could not load the options');
  }
};

// ── Asset items: the list of what the college buys and tags, like Inventory is for consumables ──

const keyOf = (cls, name) => `${cls}|${String(name || '').trim().toLowerCase()}`;

// The list of asset items. Those added to the list, plus any item type that only exists in the register (from the
// workbook import, say), which can be "set up" to add it to the list.
const assetTypeRows = async () => {
  const [listed, used] = await Promise.all([
    prisma.assetType.findMany({}),
    prisma.asset.groupBy({ by: ['asset_class', 'category', 'tag_prefix'], where: { category: { not: null } }, _count: true, _max: { tag_seq: true } }),
  ]);
  const rows = new Map();
  for (const t of listed) {
    rows.set(keyOf(t.asset_class, t.name), { id: t.id, name: t.name, asset_class: t.asset_class, tag_prefix: t.tag_prefix, depreciation_rate: t.depreciation_rate, description: t.description, count: 0, in_list: true, series: [] });
  }
  for (const u of used) {
    const k = keyOf(u.asset_class, u.category);
    if (!rows.has(k)) rows.set(k, { id: null, name: u.category, asset_class: u.asset_class, tag_prefix: null, depreciation_rate: null, description: null, count: 0, in_list: false, series: [] });
    const r = rows.get(k);
    r.count += u._count;
    if (u.tag_prefix) r.series.push({ prefix: u.tag_prefix, count: u._count, max: u._max.tag_seq || 0 });
  }
  return [...rows.values()].map((r) => {
    // the series new items continue: the one set on the item, otherwise the one most used in the register
    const inUse = [...r.series].sort((a, b) => b.count - a.count)[0];
    const prefix = r.tag_prefix || inUse?.prefix || defaultPrefix(r.asset_class, r.name);
    const seen = r.series.find((x) => x.prefix === prefix);
    const { series, ...rest } = r;
    return { ...rest, class_label: ASSET_CLASSES[r.asset_class]?.label || r.asset_class, tag_series: prefix, tag_series_set: Boolean(r.tag_prefix), next_tag: formatTag(prefix, (seen?.max || 0) + 1) };
  });
};

// GET /api/assets/types?asset_class=&search=
const getAssetTypes = async (req, res) => {
  try {
    const { asset_class, search } = req.query;
    let rows = await assetTypeRows();
    if (asset_class) rows = rows.filter((r) => r.asset_class === asset_class);
    if (search) rows = rows.filter((r) => r.name.toLowerCase().includes(String(search).toLowerCase()));
    rows.sort((a, b) => a.class_label.localeCompare(b.class_label) || a.name.localeCompare(b.name));
    res.json({ types: rows, total: rows.length, not_in_list: rows.filter((r) => !r.in_list).length });
  } catch (err) {
    sendError(res, err, 'Could not load the asset items');
  }
};

const readTypeFields = (b) => {
  const f = {};
  if (b.description !== undefined) f.description = optionalText(b.description);
  if (b.depreciation_rate !== undefined) {
    const r = optionalNumber(b.depreciation_rate, 'Depreciation rate');
    if (r !== null && r > 100) throw fail('Depreciation rate is a percentage a year, 100 at most');
    f.depreciation_rate = r;
  }
  if (b.tag_prefix !== undefined) {
    let t = optionalText(b.tag_prefix);
    if (t) {
      t = t.replace(/\s+/g, '');
      if (!/^[A-Za-z0-9]+(\/[A-Za-z0-9-]+)+\/?$/.test(t)) throw fail('A tag series looks like NHTVC/ICT/CMT/ (letters and numbers separated by /)');
      if (!t.endsWith('/')) t += '/';
    }
    f.tag_prefix = t;
  }
  return f;
};

// POST /api/assets/types
const createAssetType = async (req, res) => {
  try {
    const b = req.body || {};
    if (!ASSET_CLASSES[b.asset_class]) throw fail('Choose the type of asset (ICT, furniture, ...)');
    const name = sentenceCase(b.name);
    if (!name) throw fail('Give the asset item a name');
    if (await findAssetType(b.asset_class, name)) throw fail(`${name} is already in the list`, 409);
    const type = await prisma.assetType.create({ data: { name, asset_class: b.asset_class, ...readTypeFields(b) } });
    res.status(201).json(type);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'That asset item is already in the list' });
    sendError(res, err, 'Could not add the asset item');
  }
};

// PATCH /api/assets/types/:id - renaming also renames it on the assets that use it
const updateAssetType = async (req, res) => {
  try {
    const type = await prisma.assetType.findUnique({ where: { id: req.params.id } });
    if (!type) throw fail('Asset item not found', 404);
    const b = req.body || {};
    const oldName = type.name;
    const data = readTypeFields(b);
    let renamed = null;
    if (b.name !== undefined) {
      const name = sentenceCase(b.name);
      if (!name) throw fail('Give the asset item a name');
      if (name !== type.name) {
        const clash = await findAssetType(type.asset_class, name);
        if (clash && clash.id !== type.id) throw fail(`${name} is already in the list`, 409);
        data.name = name;
        renamed = name;
      }
    }
    const updated = await prisma.assetType.update({ where: { id: type.id }, data });
    if (renamed) await prisma.asset.updateMany({ where: { asset_class: type.asset_class, category: oldName }, data: { category: renamed } });
    res.json(updated);
  } catch (err) {
    sendError(res, err, 'Could not save the asset item');
  }
};

// DELETE /api/assets/types/:id - only when no asset uses it
const deleteAssetType = async (req, res) => {
  try {
    const type = await prisma.assetType.findUnique({ where: { id: req.params.id } });
    if (!type) throw fail('Asset item not found', 404);
    const inUse = await prisma.asset.count({ where: { asset_class: type.asset_class, category: type.name } });
    if (inUse > 0) throw fail(`${inUse} asset${inUse === 1 ? ' uses' : 's use'} ${type.name}, so it cannot be removed from the list`, 409);
    await prisma.assetType.delete({ where: { id: type.id } });
    res.json({ message: 'Removed from the list' });
  } catch (err) {
    sendError(res, err, 'Could not remove the asset item');
  }
};

// The depreciation rate set on an asset item, used when an asset has none of its own
const itemRate = async (assetClass, category) => (category ? (await findAssetType(assetClass, category))?.depreciation_rate ?? null : null);

// GET /api/assets/tag-options?asset_class=&category=
// Tag numbering already in use for an item type, so a new item continues the sequence
const getTagOptions = async (req, res) => {
  try {
    const { asset_class, category } = req.query;
    if (!ASSET_CLASSES[asset_class]) return res.status(400).json({ error: 'asset_class is required' });
    res.json({ options: await tagOptions(asset_class, category ? sentenceCase(category) : null) });
  } catch (err) {
    sendError(res, err, 'Could not work out the tag numbers');
  }
};

// GET /api/assets/:id
const getAssetById = async (req, res) => {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: req.params.id },
      include: {
        ...listInclude,
        custodian: { select: { id: true, employee_number: true, first_name: true, last_name: true } },
        maintenance_records: { orderBy: { performed_date: 'desc' } },
      },
    });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(withValue(asset));
  } catch (err) {
    sendError(res, err, 'Could not load the asset');
  }
};

// POST /api/assets
// body: asset_class, name, category?, quantity? (several of the same item), asset_code? (otherwise generated), tag_prefix?, ...
// Tags continue the numbering of the item type: NHTVC/ICT/CMT/J/120, then 121...
const createAsset = async (req, res) => {
  try {
    const b = req.body;
    if (!b.name || !String(b.name).trim()) throw fail('Description is required');
    if (!ASSET_CLASSES[b.asset_class]) throw fail('Choose the type of asset (ICT, furniture, ...)');
    const quantity = Math.max(1, Math.min(200, parseInt(b.quantity) || 1));
    if (b.asset_code && quantity > 1) throw fail('Several items need generated tag numbers: leave the tag empty');

    const f = readFields(b);
    f.name = f.name || sentenceCase(b.name);
    f.category = f.category || f.name;
    if (f.depreciation_rate == null) f.depreciation_rate = await itemRate(b.asset_class, f.category);

    const created = [];
    if (b.asset_code) {
      const code = String(b.asset_code).trim();
      if (await prisma.asset.findUnique({ where: { asset_code: code } })) throw fail(`The tag ${code} is already used by another asset`, 409);
      const t = parseTag(code);
      created.push(await prisma.asset.create({ data: { ...f, asset_code: code, tag_prefix: t.prefix, tag_seq: t.seq, status: 'ACTIVE' }, include: listInclude }));
    } else {
      const options = await tagOptions(b.asset_class, f.category);
      const prefix = b.tag_prefix || options[0]?.prefix || defaultPrefix(b.asset_class, f.category);
      let seq = await nextSeqForPrefix(prefix);
      for (let i = 0; i < quantity; i++, seq++) {
        created.push(await prisma.asset.create({ data: { ...f, asset_code: formatTag(prefix, seq), tag_prefix: prefix, tag_seq: seq, status: 'ACTIVE' }, include: listInclude }));
      }
    }
    res.status(201).json({ assets: created.map(withValue), message: created.length === 1 ? `Registered ${created[0].asset_code}` : `Registered ${created.length} items, ${created[0].asset_code} to ${created[created.length - 1].asset_code}` });
  } catch (err) {
    sendError(res, err, 'Could not register the asset');
  }
};


// ── Goods received that are waiting to be tagged ─────────────────────────────
// A verified GRN line for an asset does not create asset records by itself: it waits here until a person
// confirms how many arrived in good order and adds serial numbers and locations. Tag numbers are permanent.

const receivedAssetLines = async () => {
  const lines = await prisma.gRNItem.findMany({
    where: { item_type: 'ASSET', quantity_accepted: { gt: 0 }, grn: { status: 'VERIFIED' } },
    include: { grn: { include: { lpo: { include: { supplier: { select: { name: true } } } } } } },
    orderBy: { created_at: 'asc' },
  });
  return lines
    .map((l) => ({ ...l, remaining: l.quantity_accepted - (l.tagged_count || 0) }))
    .filter((l) => l.remaining > 0);
};

// GET /api/assets/to-tag
const getToTag = async (req, res) => {
  try {
    const lines = await receivedAssetLines();
    const out = [];
    for (const l of lines) {
      const category = sentenceCase(l.asset_category || l.item_name);
      const options = await tagOptions(l.asset_class, category);
      out.push({
        id: l.id,
        item_name: l.item_name,
        asset_class: l.asset_class,
        asset_category: category,
        accepted: l.quantity_accepted,
        tagged: l.tagged_count || 0,
        remaining: l.remaining,
        unit_price: l.unit_price,
        received_date: l.grn.received_date,
        grn_no: l.grn.grn_no,
        lpo_no: l.grn.lpo?.lpo_no || null,
        supplier: l.grn.lpo?.supplier?.name || null,
        tag_options: options,
      });
    }
    res.json({ lines: out, total_remaining: out.reduce((n, l) => n + l.remaining, 0) });
  } catch (err) {
    sendError(res, err, 'Could not load the items waiting to be tagged');
  }
};

// POST /api/assets/to-tag/:itemId  { count | units: [{ serial_number, make_model, location_id, condition, responsible_officer }], shared: {...} }
const registerReceived = async (req, res) => {
  try {
    const line = await prisma.gRNItem.findUnique({
      where: { id: req.params.itemId },
      include: { grn: { include: { lpo: { include: { supplier: { select: { name: true } } } } } } },
    });
    if (!line || line.item_type !== 'ASSET') throw fail('That line is not an asset waiting to be tagged', 404);
    if (line.grn.status !== 'VERIFIED') throw fail('The GRN has to be verified before its assets are tagged');
    const remaining = line.quantity_accepted - (line.tagged_count || 0);
    if (remaining <= 0) throw fail('Everything received on this line has already been tagged');

    const b = req.body || {};
    const units = Array.isArray(b.units) ? b.units : null;
    const count = units ? units.length : parseInt(b.count, 10);
    if (!count || count < 1) throw fail('Say how many items to tag');
    if (count > remaining) throw fail(`Only ${remaining} ${remaining === 1 ? 'item is' : 'items are'} left to tag on this line`);

    const category = sentenceCase(line.asset_category || line.item_name);
    const shared = b.shared || {};
    const base = {
      name: line.item_name,
      category,
      asset_class: line.asset_class,
      purchase_cost: line.unit_price ?? undefined,
      purchase_date: line.grn.received_date,
      delivery_date: line.grn.received_date,
      ...shared,
    };
    // validate every unit before anything is written
    const fieldSets = Array.from({ length: count }, (_, i) => {
      const f = readFields({ ...base, ...(units ? units[i] : {}) });
      f.name = f.name || sentenceCase(line.item_name);
      f.category = f.category || category;
      return f;
    });
    const rate = await itemRate(line.asset_class, category);
    fieldSets.forEach((f) => { if (f.depreciation_rate == null) f.depreciation_rate = rate; });

    const options = await tagOptions(line.asset_class, category);
    const prefix = shared.tag_prefix || options[0]?.prefix || defaultPrefix(line.asset_class, category);
    let seq = await nextSeqForPrefix(prefix);

    // claim the quantity first, so two people tagging the same line at once cannot tag more than arrived
    const claim = await prisma.gRNItem.updateMany({ where: { id: line.id, tagged_count: line.tagged_count || 0 }, data: { tagged_count: { increment: count } } });
    if (claim.count === 0) throw fail('This line was just tagged by someone else. Reload and check what is left.', 409);

    const trace = { asset_class: line.asset_class, grn_item_id: line.id, grn_no: line.grn.grn_no, lpo_no: line.grn.lpo?.lpo_no || null, supplier_name: line.grn.lpo?.supplier?.name || null, status: 'ACTIVE' };
    const created = [];
    try {
      for (const f of fieldSets) {
        created.push(await prisma.asset.create({ data: { ...f, ...trace, asset_code: formatTag(prefix, seq), tag_prefix: prefix, tag_seq: seq }, include: listInclude }));
        seq++;
      }
    } catch (err) {
      await prisma.gRNItem.update({ where: { id: line.id }, data: { tagged_count: { decrement: count - created.length } } });
      if (created.length === 0) throw err;
      return res.status(500).json({ error: `Only ${created.length} of ${count} were tagged (${created[0].asset_code} to ${created[created.length - 1].asset_code}). Check what is left and try again.` });
    }
    res.status(201).json({
      assets: created.map(withValue),
      remaining: remaining - count,
      message: created.length === 1 ? `Tagged ${created[0].asset_code}` : `Tagged ${created.length} items, ${created[0].asset_code} to ${created[created.length - 1].asset_code}`,
    });
  } catch (err) {
    sendError(res, err, 'Could not tag the items');
  }
};

// PATCH /api/assets/:id
const updateAsset = async (req, res) => {
  try {
    const b = req.body;
    const data = readFields(b);
    if (data.name === '') throw fail('Description cannot be empty');

    // The tag can be corrected (for example a duplicated one), but never to one that is taken
    if (b.asset_code !== undefined) {
      const code = String(b.asset_code).trim();
      if (!code) throw fail('The tag number cannot be empty');
      const clash = await prisma.asset.findUnique({ where: { asset_code: code } });
      if (clash && clash.id !== req.params.id) throw fail(`The tag ${code} is already used by another asset`, 409);
      const t = parseTag(code);
      Object.assign(data, { asset_code: code, tag_prefix: t.prefix, tag_seq: t.seq });
    }
    // Marking a flagged record as sorted out
    if (b.resolve_attention === true) data.attention = null;
    // If a cost is entered with no purchase date, the delivery date is used for depreciation
    const asset = await prisma.asset.update({ where: { id: req.params.id }, data, include: listInclude });
    res.json(withValue(asset));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Asset not found' });
    sendError(res, err, 'Could not update the asset');
  }
};

// POST /api/assets/:id/depreciate - what the asset is worth now (worked out, not stored)
const calculateDepreciation = async (req, res) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json({ ...asset, valuation: valuation(asset) });
  } catch (err) {
    sendError(res, err, 'Could not work out the value');
  }
};

// POST /api/assets/:id/maintenance
const recordMaintenance = async (req, res) => {
  try {
    const { maintenance_type, description, cost, performed_by, performed_date, next_due_date } = req.body;
    if (!maintenance_type || !description || !performed_date) {
      return res.status(400).json({ error: 'Maintenance type, description, and performed date are required' });
    }
    const maintenance = await prisma.maintenanceRecord.create({
      data: {
        asset_id: req.params.id,
        maintenance_type,
        description,
        cost: cost ? parseFloat(cost) : null,
        performed_by,
        performed_date: new Date(performed_date),
        next_due_date: next_due_date ? new Date(next_due_date) : null,
      },
      include: { asset: { select: { asset_code: true, name: true } } },
    });
    res.status(201).json(maintenance);
  } catch (err) {
    sendError(res, err, 'Could not record the maintenance');
  }
};

// PATCH /api/assets/:id/dispose
const disposeAsset = async (req, res) => {
  try {
    const { disposal_reason, disposal_date, status = 'DISPOSED' } = req.body;
    if (!['DISPOSED', 'WRITTEN_OFF'].includes(status)) return res.status(400).json({ error: 'Status must be DISPOSED or WRITTEN_OFF' });
    if (!disposal_reason || String(disposal_reason).trim().length < 3) return res.status(400).json({ error: 'Please give the reason' });
    const asset = await prisma.asset.update({
      where: { id: req.params.id },
      data: { status, disposal_reason: String(disposal_reason).trim(), disposal_date: disposal_date ? new Date(disposal_date) : new Date() },
      include: listInclude,
    });
    res.json(withValue(asset));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Asset not found' });
    sendError(res, err, 'Could not dispose of the asset');
  }
};

// DELETE /api/assets/:id
const deleteAsset = async (req, res) => {
  try {
    await prisma.maintenanceRecord.deleteMany({ where: { asset_id: req.params.id } });
    await prisma.asset.delete({ where: { id: req.params.id } });
    res.json({ message: 'Asset deleted successfully' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Asset not found' });
    sendError(res, err, 'Could not delete the asset');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LOCATIONS
// ─────────────────────────────────────────────────────────────────────────────

const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim();

// GET /api/assets/locations
const getLocations = async (req, res) => {
  try {
    const locations = await prisma.assetLocation.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { assets: true } } } });
    res.json({ locations: locations.map((l) => ({ id: l.id, name: l.name, count: l._count.assets })) });
  } catch (err) {
    sendError(res, err, 'Could not load the locations');
  }
};

// POST /api/assets/locations
const createLocation = async (req, res) => {
  try {
    const name = cleanName(req.body.name);
    if (!name) throw fail('Give the location a name');
    const clash = await prisma.assetLocation.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw fail(`${clash.name} already exists`, 409);
    res.status(201).json(await prisma.assetLocation.create({ data: { name } }));
  } catch (err) {
    sendError(res, err, 'Could not add the location');
  }
};

// PATCH /api/assets/locations/:id  { name }
const renameLocation = async (req, res) => {
  try {
    const name = cleanName(req.body.name);
    if (!name) throw fail('Give the location a name');
    const clash = await prisma.assetLocation.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, NOT: { id: req.params.id } } });
    if (clash) throw fail(`${clash.name} already exists. Merge the two instead.`, 409);
    res.json(await prisma.assetLocation.update({ where: { id: req.params.id }, data: { name } }));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Location not found' });
    sendError(res, err, 'Could not rename the location');
  }
};

// POST /api/assets/locations/:id/merge  { into_id }
// Two spellings of the same place: everything in this one moves to the other, and this one is removed
const mergeLocation = async (req, res) => {
  try {
    const { into_id } = req.body;
    if (!into_id || into_id === req.params.id) throw fail('Choose a different location to merge into');
    const [from, into] = await Promise.all([prisma.assetLocation.findUnique({ where: { id: req.params.id } }), prisma.assetLocation.findUnique({ where: { id: into_id } })]);
    if (!from || !into) throw fail('Location not found', 404);
    const [a, b] = await prisma.$transaction([
      prisma.asset.updateMany({ where: { location_id: from.id }, data: { location_id: into.id } }),
      prisma.asset.updateMany({ where: { original_location_id: from.id }, data: { original_location_id: into.id } }),
    ]);
    await prisma.assetLocation.delete({ where: { id: from.id } });
    res.json({ message: `Merged ${from.name} into ${into.name}`, moved: a.count + b.count });
  } catch (err) {
    sendError(res, err, 'Could not merge the locations');
  }
};

// DELETE /api/assets/locations/:id - only when nothing is kept there
const deleteLocation = async (req, res) => {
  try {
    const used = await prisma.asset.count({ where: { OR: [{ location_id: req.params.id }, { original_location_id: req.params.id }] } });
    if (used > 0) throw fail(`${used} asset${used === 1 ? ' is' : 's are'} recorded here. Merge this location into another instead.`);
    await prisma.assetLocation.delete({ where: { id: req.params.id } });
    res.json({ message: 'Location removed' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Location not found' });
    sendError(res, err, 'Could not remove the location');
  }
};

module.exports = {
  getAssetTypes, createAssetType, updateAssetType, deleteAssetType, getToTag, registerReceived, getAssets, getAssetSummary, getAssetOptions, getTagOptions, getAssetById, createAsset, updateAsset,
  calculateDepreciation, recordMaintenance, disposeAsset, deleteAsset,
  getLocations, createLocation, renameLocation, mergeLocation, deleteLocation,
};
