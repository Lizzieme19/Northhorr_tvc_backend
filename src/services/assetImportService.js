const XLSX = require('xlsx');
const prisma = require('../config/db');
const { normDate } = require('../utils/spreadsheet');
const {
  ASSET_CLASSES, sentenceCase, parseTag, isTagLike, formatTag, itemCodeFor, defaultPrefix, canonicalLocations, locKey,
} = require('./assetRegisterService');

// ─────────────────────────────────────────────────────────────────────────────
// Importing the asset registers workbook (National Treasury layout).
// Reads the registers that hold individually tagged items, plus the stock sheet (which goes to Inventory).
// Checks everything first; nothing is written until the import is run.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ROWS = 3000;

// Which sheet is which, by its name
const SHEET_KINDS = [
  { match: /ict\s*computer/i, kind: 'asset', asset_class: 'ICT' },
  { match: /furniture/i, kind: 'asset', asset_class: 'FURNITURE' },
  { match: /plant/i, kind: 'asset', asset_class: 'PLANT_MACHINERY' },
  { match: /office\s*equipment/i, kind: 'asset', asset_class: 'OFFICE_EQUIPMENT' },
  { match: /portable/i, kind: 'asset', asset_class: 'PORTABLE_ATTRACTIVE' },
  { match: /stock|consumable/i, kind: 'stock' },
];

const squash = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// column field -> how its header begins once squashed
const ASSET_COLS = {
  description: ['assetdescription'],
  source_of_funds: ['financedby'],
  serial: ['serialnumber', 'serialno'],
  tag: ['tagnumber', 'tagno'],
  make_model: ['makemodel'],
  delivery_date: ['dateofdelivery', 'dateofpurchase'],
  pv_number: ['pvnumber'],
  original_location: ['originallocation'],
  current_location: ['currentlocation'],
  replacement_date: ['replacementdate'],
  cost: ['purchaseamount', 'amount'],
  rate: ['depreciationrate'],
  disposal_date: ['dateofdisposal'],
  responsible_officer: ['responsibleofficer'],
  condition: ['assetcondition', 'condition'],
  notes: ['notes', 'remarks'],
};
const STOCK_COLS = {
  description: ['descriptionofinventoryitem', 'description'],
  unit: ['unit'],
  quantity: ['quantity'],
  unit_cost: ['unitcost'],
  responsible_officer: ['responsibleofficer'],
  remarks: ['remarks'],
};

const clean = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (!s || /^(n\/?a|-+|nil|none)$/i.test(s)) return null;
  return typeof v === 'number' ? v : s;
};
const text = (v) => { const c = clean(v); return c === null || c instanceof Date ? null : String(c).replace(/\s+/g, ' ').trim(); };
const num = (v) => {
  const c = clean(v);
  if (c === null || c instanceof Date) return null;
  const n = typeof c === 'number' ? c : parseFloat(String(c).replace(/[, ]/g, ''));
  return isNaN(n) ? null : n;
};

// Finds the header row (the one that names the description column) and maps each field to its column index
const mapColumns = (rows, colSpec, headerStarts) => {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const heads = rows[i].map(squash);
    if (heads.some((h) => headerStarts.some((s) => h.startsWith(s)))) {
      const cols = {};
      for (const [field, starts] of Object.entries(colSpec)) {
        const idx = heads.findIndex((h) => h && starts.some((s) => h.startsWith(s)));
        if (idx >= 0) cols[field] = idx;
      }
      return { header: i, cols };
    }
  }
  return null;
};

const CONDITION_MAP = [['good', 'GOOD'], ['fair', 'FAIR'], ['poor', 'POOR'], ['serviceable', 'GOOD'], ['unserviceable', 'UNSERVICEABLE'], ['obsolete', 'UNSERVICEABLE'], ['broken', 'POOR'], ['faulty', 'POOR']];
const normCondition = (v) => {
  const s = (text(v) || '').toLowerCase();
  if (!s) return null;
  if (s.startsWith('unserv')) return 'UNSERVICEABLE';
  return CONDITION_MAP.find(([k]) => s.startsWith(k))?.[1] || null;
};

// ── Read the workbook ────────────────────────────────────────────────────────

const readWorkbook = (buffer) => {
  let wb;
  try { wb = XLSX.read(buffer, { type: 'buffer', cellDates: true }); }
  catch (e) { throw Object.assign(new Error('That file could not be read. Upload the asset registers workbook (.xlsx).'), { status: 400 }); }

  const assetRows = [];
  const stockRows = [];
  const sheetsRead = [];
  let total = 0;

  for (const name of wb.SheetNames) {
    const kind = SHEET_KINDS.find((k) => k.match.test(name));
    if (!kind) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });

    if (kind.kind === 'asset') {
      const map = mapColumns(rows, ASSET_COLS, ASSET_COLS.description);
      if (!map) continue;
      let count = 0;
      rows.slice(map.header + 1).forEach((r, i) => {
        const get = (f) => (map.cols[f] === undefined ? undefined : r[map.cols[f]]);
        const description = text(get('description'));
        if (!description || /^prepared by/i.test(description)) return;
        total += 1; count += 1;
        assetRows.push({ sheet: name.trim(), row: map.header + 2 + i, asset_class: kind.asset_class, get });
      });
      sheetsRead.push({ sheet: name.trim(), kind: 'asset', asset_class: kind.asset_class, rows: count });
    } else {
      const map = mapColumns(rows, STOCK_COLS, STOCK_COLS.description);
      if (!map) continue;
      let heading = null;
      let count = 0;
      rows.slice(map.header + 1).forEach((r, i) => {
        const get = (f) => (map.cols[f] === undefined ? undefined : r[map.cols[f]]);
        // the first column is just a running number in this sheet; the description is the first text cell
        const description = text(get('description')) || r.map(text).find((v) => v && !/^\d+(\.0+)?$/.test(v));
        if (!description || /^prepared by/i.test(description)) return;
        const unit = text(get('unit'));
        const qty = num(get('quantity'));
        const cost = num(get('unit_cost'));
        // a line with no unit, quantity or cost is a heading for the lines under it
        if (!unit && qty === null && cost === null) { heading = sentenceCase(description); return; }
        count += 1;
        stockRows.push({ sheet: name.trim(), row: map.header + 2 + i, description, category: heading, unit, quantity: qty, unit_cost: cost, responsible_officer: text(get('responsible_officer')), remarks: text(get('remarks')) });
      });
      sheetsRead.push({ sheet: name.trim(), kind: 'stock', rows: count });
    }
  }

  if (assetRows.length + stockRows.length === 0) {
    throw Object.assign(new Error('No asset or stock rows were found. This should be the asset registers workbook with sheets such as "ICT Computer Register" and "Furniture&Fittings".'), { status: 400 });
  }
  if (total > MAX_ROWS) throw Object.assign(new Error(`The workbook has ${total} asset rows. Import at most ${MAX_ROWS} at a time.`), { status: 400 });
  return { assetRows, stockRows, sheetsRead };
};

// ── Updating items that are already in the register ─────────────────────────
// Off unless asked for. A workbook row is matched to an asset by its tag number; rows with no tag, or a tag shared
// with another row, are matched by where they were imported from (and must still hold the same item). Only these
// details can change, and a blank cell in the workbook never blanks anything in the register.

const UPDATE_GROUPS = {
  value: { label: 'Cost, date and depreciation rate', fields: ['purchase_cost', 'delivery_date', 'depreciation_rate'] },
  location: { label: 'Location', fields: ['location_id', 'original_location_id'] },
  condition: { label: 'Condition', fields: ['condition'] },
  officer: { label: 'Responsible officer', fields: ['responsible_officer'] },
  details: { label: 'Make, serial number, source of funds, PV number, replacement date', fields: ['make_model', 'serial_number', 'source_of_funds', 'pv_number', 'replacement_date'] },
};
const FIELD_LABELS = {
  purchase_cost: 'Cost', delivery_date: 'Delivery date', depreciation_rate: 'Depreciation rate', location_id: 'Location', original_location_id: 'First placed',
  condition: 'Condition', responsible_officer: 'Responsible officer', make_model: 'Make & model', serial_number: 'Serial number',
  source_of_funds: 'Source of funds', pv_number: 'PV number', replacement_date: 'Replacement date',
};
const dayOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const planUpdates = ({ assetRows, existingAssets, locationName, canonOf, opts }) => {
  const groups = (opts.groups && opts.groups.length ? opts.groups : Object.keys(UPDATE_GROUPS)).filter((g) => UPDATE_GROUPS[g]);
  const wanted = new Set(groups.flatMap((g) => UPDATE_GROUPS[g].fields));
  const fillOnly = opts.fillOnly !== false;

  const byCode = new Map(existingAssets.map((a) => [a.asset_code.toLowerCase(), a]));
  const byRow = new Map(existingAssets.filter((a) => a.imported_from).map((a) => [a.imported_from, a]));
  const tagOf = (r) => { const t = text(r.get('tag')); const s = text(r.get('serial')); return isTagLike(t) ? t : (isTagLike(s) ? s : null); };
  const seen = new Map();
  for (const r of assetRows) { const t = tagOf(r); if (t) seen.set(t.toLowerCase(), (seen.get(t.toLowerCase()) || 0) + 1); }

  const items = [];
  const conflicts = [];
  let matched = 0;
  const done = new Set();

  for (const r of assetRows) {
    const wbTag = tagOf(r);
    const shared = wbTag && seen.get(wbTag.toLowerCase()) > 1;
    const rowKey = `${r.sheet} row ${r.row}`;
    const name = sentenceCase(text(r.get('description')));
    let asset = null;
    let via = null;
    if (wbTag && !shared && byCode.has(wbTag.toLowerCase())) { asset = byCode.get(wbTag.toLowerCase()); via = 'tag'; }
    else if (byRow.has(rowKey)) {
      const cand = byRow.get(rowKey);
      if (wbTag && !shared) {
        if (String(cand.name || '').toLowerCase() !== name.toLowerCase()) continue; // a different item took over this row: the import adds it
        conflicts.push({ sheet: r.sheet, row: r.row, tag: wbTag, name, message: `The tag ${wbTag} is not in the register, but this row was imported as ${cand.asset_code}. Left as it is. If the tag was wrong, correct it in the app.` });
        continue;
      }
      if (String(cand.name || '').toLowerCase() !== name.toLowerCase()) {
        conflicts.push({ sheet: r.sheet, row: r.row, tag: wbTag, name, message: `This row now holds "${name}", but it was imported as "${cand.name}" (${cand.asset_code}). Rows have moved, so it was left as it is.` });
        continue;
      }
      asset = cand; via = 'row';
    } else continue; // a new row: the import adds it
    if (done.has(asset.id)) continue;
    done.add(asset.id);
    matched += 1;

    const tagCol = text(r.get('tag'));
    const serialCol = text(r.get('serial'));
    const cost = num(r.get('cost'));
    const wb = {
      purchase_cost: cost !== null && cost > 0 ? cost : null,
      delivery_date: normDate(clean(r.get('delivery_date'))),
      depreciation_rate: num(r.get('rate')),
      location_id: canonOf(r.get('current_location')),
      original_location_id: canonOf(r.get('original_location')),
      condition: normCondition(r.get('condition')),
      responsible_officer: text(r.get('responsible_officer')),
      make_model: text(r.get('make_model')),
      serial_number: serialCol && !isTagLike(serialCol) ? serialCol : (tagCol && !isTagLike(tagCol) ? tagCol : null),
      source_of_funds: text(r.get('source_of_funds')),
      pv_number: text(r.get('pv_number')),
      replacement_date: normDate(clean(r.get('replacement_date'))),
    };
    const kind = {
      purchase_cost: { cur: asset.purchase_cost, same: (a, b) => Math.abs(a - b) < 0.005 },
      depreciation_rate: { cur: asset.depreciation_rate, same: (a, b) => Math.abs(a - b) < 0.0005 },
      delivery_date: { cur: asset.delivery_date, same: (a, b) => dayOf(a) === dayOf(b), show: dayOf },
      replacement_date: { cur: asset.replacement_date, same: (a, b) => dayOf(a) === dayOf(b), show: dayOf },
      location_id: { cur: asset.location_id ? locationName.get(asset.location_id) : null, same: (a, b) => locKey(a) === locKey(b) },
      original_location_id: { cur: asset.original_location_id ? locationName.get(asset.original_location_id) : null, same: (a, b) => locKey(a) === locKey(b) },
    };
    const changes = [];
    const data = {};
    for (const field of wanted) {
      const to = wb[field];
      if (to === null || to === undefined) continue; // a blank cell never blanks the register
      const k = kind[field] || { cur: asset[field], same: (a, b) => String(a).toLowerCase() === String(b).toLowerCase() };
      const from = k.cur === undefined || k.cur === '' ? null : k.cur;
      const empty = from === null;
      if (!empty && (fillOnly || k.same(from, to))) continue;
      if (empty || !k.same(from, to)) {
        const show = k.show || ((v) => v);
        changes.push({ field, label: FIELD_LABELS[field], from: empty ? null : show(from), to: show(to), filled: empty });
        data[field] = to;
      }
    }
    if (changes.length === 0) continue;
    // a cost with a delivery date also dates the purchase, as on import
    const finalCost = data.purchase_cost ?? asset.purchase_cost;
    const finalDelivery = data.delivery_date ?? asset.delivery_date;
    if (finalCost && finalDelivery && !asset.purchase_date && (data.purchase_cost !== undefined || data.delivery_date !== undefined)) data.purchase_date = finalDelivery;
    items.push({ id: asset.id, tag: asset.asset_code, name: asset.name, sheet: r.sheet, row: r.row, via, changes, data });
  }
  return { groups, fill_only: fillOnly, matched, unchanged: matched - items.length, items, conflicts };
};

// ── Check everything against the register as it is now ───────────────────────

const analyzeWorkbook = async (buffer, opts = {}) => {
  const { assetRows, stockRows, sheetsRead } = readWorkbook(buffer);

  const [existingAssets, prefixMax, existingLocations, existingStock, stockCodes] = await Promise.all([
    prisma.asset.findMany({
      select: opts.updateExisting
        ? { id: true, asset_code: true, name: true, imported_from: true, purchase_cost: true, purchase_date: true, delivery_date: true, depreciation_rate: true, location_id: true, original_location_id: true, condition: true, responsible_officer: true, make_model: true, serial_number: true, source_of_funds: true, pv_number: true, replacement_date: true }
        : { asset_code: true, name: true, imported_from: true },
    }),
    prisma.asset.groupBy({ by: ['tag_prefix'], where: { tag_prefix: { not: null } }, _max: { tag_seq: true } }),
    prisma.assetLocation.findMany({ select: { id: true, name: true } }),
    prisma.inventoryItem.findMany({ select: { name: true, unit_of_measure: true } }),
    prisma.inventoryItem.findMany({ where: { item_code: { startsWith: 'STK-' } }, select: { item_code: true } }),
  ]);
  const haveTag = new Set(existingAssets.map((a) => a.asset_code.toLowerCase()));
  // rows already imported from this workbook, even if their tag was changed on import
  const haveSource = new Map(existingAssets.filter((a) => a.imported_from).map((a) => [a.imported_from, a]));
  const maxSeq = new Map(prefixMax.map((p) => [p.tag_prefix, p._max.tag_seq || 0]));
  const haveLocation = new Map(existingLocations.map((l) => [locKey(l.name), l.name]));

  // Locations: spelling variants fold into one (see assetRegisterService)
  const rawLocations = [];
  for (const r of assetRows) { rawLocations.push(text(r.get('current_location')), text(r.get('original_location'))); }
  const canon = canonicalLocations(rawLocations.filter(Boolean));
  const canonOf = (raw) => {
    const t = text(raw);
    if (!t) return null;
    const c = canon.get(t) || t;
    return haveLocation.get(locKey(c)) || c; // reuse a location that already exists
  };

  // Tags already used in this file, so a repeat can be told apart
  const firstUse = new Map(); // lower tag -> { sheet, row, name }
  const reserve = (prefix) => { const n = (maxSeq.get(prefix) || 0) + 1; maxSeq.set(prefix, n); return n; };
  // numbers already taken in the file must not be handed out again
  for (const r of assetRows) {
    const t = parseTag(text(r.get('tag')) || text(r.get('serial')));
    if (t.prefix && t.seq > (maxSeq.get(t.prefix) || 0)) maxSeq.set(t.prefix, t.seq);
  }

  // how many rows carry each tag, so a tag shared by two rows is not taken to identify either
  const tagCount = new Map();
  for (const r of assetRows) {
    const t = text(r.get('tag')); const v = text(r.get('serial'));
    const x = isTagLike(t) ? t : (isTagLike(v) ? v : null);
    if (x) tagCount.set(x.toLowerCase(), (tagCount.get(x.toLowerCase()) || 0) + 1);
  }

  const out = [];
  for (const r of assetRows) {
    const description = text(r.get('description'));
    // A row imported before is recognised by its tag when it has its own. Rows with no usable tag (none, or one shared
    // with another row) are recognised by where they were imported from, as long as they still hold the same item.
    const rowKey = `${r.sheet} row ${r.row}`;
    const before = haveSource.get(rowKey);
    const ownTag = (() => { const t = text(r.get('tag')); const v = text(r.get('serial')); const x = isTagLike(t) ? t : (isTagLike(v) ? v : null); return x && tagCount.get(x.toLowerCase()) === 1 ? x : null; })();
    const skipped = (why) => {
      const n = sentenceCase(description);
      out.push({ sheet: r.sheet, row: r.row, status: 'exists', tag: null, name: n, category: n, asset_class: r.asset_class, location: null, original_location: null, attention: null, reclassified: null, generated: false, notes: [], warnings: why ? [why] : [], data: { purchase_cost: null }, _location: null, _original_location: null });
    };
    if (before) {
      const same = String(before.name || '').toLowerCase() === sentenceCase(description).toLowerCase();
      if (!ownTag) { skipped(same ? null : `This row now holds "${sentenceCase(description)}", but it was imported as "${before.name}" (${before.asset_code}). Rows have moved, so it was left out to avoid a copy.`); continue; }
      if (!haveTag.has(ownTag.toLowerCase()) && same) { skipped(`The tag ${ownTag} is not in the register, but this row was imported as ${before.asset_code}. Left as it is: correct the tag in the app if it was wrong.`); continue; }
      // otherwise the tag identifies it: already there, or a new item that took over this row number
    }
    const tagCol = text(r.get('tag'));
    const serialCol = text(r.get('serial'));
    // The college typed its tag numbers into the Serial number column; a real serial is left alone
    let tag = isTagLike(tagCol) ? tagCol : (isTagLike(serialCol) ? serialCol : null);
    const realSerial = serialCol && !isTagLike(serialCol) ? serialCol : (tagCol && !isTagLike(tagCol) ? tagCol : null);
    const notes = [];
    const warnings = [];

    // Which register: normally the sheet it is on; a cabinet tagged as office equipment but listed under furniture moves
    let assetClass = r.asset_class;
    const tagClassSeg = tag ? tag.split('/')[1] : null;
    let reclassified = null;
    if (r.asset_class === 'FURNITURE' && tagClassSeg === 'OE') { assetClass = 'OFFICE_EQUIPMENT'; reclassified = 'Tagged as office equipment but listed under furniture'; }

    const name = sentenceCase(description);
    let attention = null;
    let duplicateOf = null;
    let generated = false;

    if (!tag) {
      const prefix = defaultPrefix(assetClass, name);
      tag = formatTag(prefix, reserve(prefix));
      generated = true;
      attention = 'NO_TAG';
      warnings.push(`No tag number in the workbook. ${tag} was generated: it needs a label on the item.`);
    } else if (firstUse.has(tag.toLowerCase())) {
      // same tag on two different items: the first keeps it, the other gets the next free number
      const first = firstUse.get(tag.toLowerCase());
      duplicateOf = first;
      const p = parseTag(tag);
      const prefix = p.prefix || defaultPrefix(assetClass, name);
      const was = tag;
      tag = formatTag(prefix, reserve(prefix));
      attention = 'DUPLICATE_TAG';
      notes.push(`The workbook gave this item the same tag as "${first.name}" (${was}, ${first.sheet} row ${first.row}). It was given ${tag}: it needs a new label.`);
      warnings.push(`${was} is also used by "${first.name}". Given ${tag} instead.`);
    }
    if (!duplicateOf) firstUse.set(tag.toLowerCase(), { sheet: r.sheet, row: r.row, name });

    const { prefix, seq } = parseTag(tag);
    const loc = canonOf(r.get('current_location'));
    const origLoc = canonOf(r.get('original_location'));
    if (!loc) warnings.push('No location');

    const cost = num(r.get('cost'));
    const rate = num(r.get('rate'));
    const delivery = normDate(clean(r.get('delivery_date')));
    const disposal = normDate(clean(r.get('disposal_date')));
    if (text(r.get('delivery_date')) && !delivery && !(clean(r.get('delivery_date')) instanceof Date)) warnings.push(`Delivery date "${text(r.get('delivery_date'))}" was not understood and was left blank`);

    const exists = haveTag.has(tag.toLowerCase());
    out.push({
      sheet: r.sheet, row: r.row,
      status: exists ? 'exists' : 'ready',
      tag, name, category: name, asset_class: assetClass,
      location: loc, original_location: origLoc,
      attention, reclassified, generated, notes, warnings,
      data: {
        asset_code: tag, name, asset_class: assetClass, category: name,
        tag_prefix: prefix, tag_seq: seq,
        serial_number: realSerial,
        make_model: text(r.get('make_model')),
        source_of_funds: text(r.get('source_of_funds')),
        pv_number: text(r.get('pv_number')),
        delivery_date: delivery,
        purchase_date: cost !== null ? delivery : null,
        purchase_cost: cost !== null && cost > 0 ? cost : null,
        depreciation_rate: rate,
        replacement_date: normDate(clean(r.get('replacement_date'))),
        responsible_officer: text(r.get('responsible_officer')),
        condition: normCondition(r.get('condition')),
        notes: [text(r.get('notes')), ...notes].filter(Boolean).join(' ') || null,
        attention,
        imported_from: `${r.sheet} row ${r.row}`,
        status: disposal ? 'DISPOSED' : 'ACTIVE',
        disposal_date: disposal,
      },
      _location: loc,
      _original_location: origLoc,
    });
    if (exists) {
      // already in the register: nothing is imported, so nothing is flagged
      const last = out[out.length - 1];
      last.warnings = []; last.notes = []; last.attention = null; last.reclassified = null; last.generated = false;
    }
  }

  // Stock lines go to Inventory
  // An item already in Inventory with the same name counts as the same item when its unit matches or it has no
  // unit recorded yet (older items were entered without one), so importing never doubles up the stock.
  const haveStock = new Set(existingStock.map((s) => `${key(s.name)}|${key(s.unit_of_measure)}`));
  const unitless = new Set(existingStock.filter((s) => !key(s.unit_of_measure)).map((s) => key(s.name)));
  let stockNo = stockCodes.reduce((m, s) => Math.max(m, parseInt(s.item_code.replace(/\D/g, ''), 10) || 0), 0);
  const stock = stockRows.map((s) => {
    const name = sentenceCase(s.description);
    const unit = s.unit || 'pcs';
    const exists = haveStock.has(`${key(name)}|${key(unit)}`) || unitless.has(key(name));
    const warnings = [];
    if (s.quantity === null) warnings.push('No quantity, 0 used');
    if (s.quantity !== null && !Number.isInteger(s.quantity)) warnings.push(`Quantity ${s.quantity} was rounded`);
    haveStock.add(`${key(name)}|${key(unit)}`);
    return {
      sheet: s.sheet, row: s.row, status: exists ? 'exists' : 'ready', name, category: s.category, unit, quantity: s.quantity === null ? 0 : Math.round(s.quantity), unit_cost: s.unit_cost, warnings,
      data: { item_code: exists ? null : `STK-${String(++stockNo).padStart(4, '0')}`, name, category: s.category, unit_of_measure: unit, current_stock: s.quantity === null ? 0 : Math.round(s.quantity), unit_cost: s.unit_cost, responsible_officer: s.responsible_officer, description: s.remarks },
    };
  });

  const updates = opts.updateExisting
    ? planUpdates({ assetRows, existingAssets, locationName: new Map(existingLocations.map((l) => [l.id, l.name])), canonOf, opts })
    : null;

  return { assets: out, stock, sheetsRead, updates, locationMap: canon, existingLocationNames: new Set(existingLocations.map((l) => locKey(l.name))) };
};

function key(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// ── What the preview shows ───────────────────────────────────────────────────

const summarizeAnalysis = (a) => {
  const byClass = {};
  for (const r of a.assets) {
    const c = (byClass[r.asset_class] = byClass[r.asset_class] || { label: ASSET_CLASSES[r.asset_class]?.label || r.asset_class, total: 0, ready: 0, exists: 0 });
    c.total += 1; c[r.status] += 1;
  }
  const ready = a.assets.filter((r) => r.status === 'ready');
  const locations = new Map();
  for (const r of ready) for (const l of [r._location]) if (l) locations.set(l, (locations.get(l) || 0) + 1);
  const variants = new Map();
  for (const [raw, c] of a.locationMap) { if (raw !== c) { const v = variants.get(c) || []; v.push(raw); variants.set(c, v); } }

  return {
    assets: {
      total: a.assets.length,
      ready: ready.length,
      already_in_register: a.assets.filter((r) => r.status === 'exists').length,
      by_class: byClass,
      with_cost: ready.filter((r) => r.data.purchase_cost !== null).length,
      needs_valuation: ready.filter((r) => r.data.purchase_cost === null).length,
      without_location: ready.filter((r) => !r._location).length,
      duplicate_tags_fixed: ready.filter((r) => r.attention === 'DUPLICATE_TAG').length,
      tags_generated: ready.filter((r) => r.generated).length,
      moved_to_other_register: ready.filter((r) => r.reclassified).length,
    },
    updates: a.updates ? {
      enabled: true,
      fill_only: a.updates.fill_only,
      groups: a.updates.groups.map((g) => ({ key: g, label: UPDATE_GROUPS[g].label })),
      matched: a.updates.matched,
      unchanged: a.updates.unchanged,
      to_change: a.updates.items.length,
      fields: a.updates.items.reduce((n, u) => n + u.changes.length, 0),
      by_field: Object.entries(a.updates.items.reduce((m, u) => { u.changes.forEach((c) => { m[c.label] = (m[c.label] || 0) + 1; }); return m; }, {})).sort((x, y) => y[1] - x[1]).map(([label, count]) => ({ label, count })),
      conflicts: a.updates.conflicts.length,
    } : null,
    stock: { total: a.stock.length, ready: a.stock.filter((s) => s.status === 'ready').length, already_in_inventory: a.stock.filter((s) => s.status === 'exists').length },
    sheets: a.sheetsRead,
    locations: [...locations.entries()].sort((x, y) => y[1] - x[1]).map(([name, count]) => ({
      name, count, will_create: !a.existingLocationNames.has(locKey(name)), merged_from: variants.get(name) || [],
    })),
  };
};

// The rows worth looking at first, and a sample of the rest
const previewRows = (a, limit = 300) => {
  const flagged = a.assets.filter((r) => r.warnings.length || r.reclassified || r.attention);
  const plain = a.assets.filter((r) => !(r.warnings.length || r.reclassified || r.attention));
  const strip = ({ data, _location, _original_location, ...rest }) => rest;
  return {
    flagged: flagged.slice(0, limit).map(strip),
    flagged_total: flagged.length,
    sample: plain.slice(0, 15).map(strip),
    update_items: a.updates ? a.updates.items.slice(0, 300).map(({ data, ...rest }) => rest) : [],
    update_conflicts: a.updates ? a.updates.conflicts.slice(0, 100) : [],
  };
};

// ── Run the import ───────────────────────────────────────────────────────────

const importWorkbook = async (a, { includeStock = true, userId } = {}) => {
  const result = { assets_created: 0, assets_updated: 0, fields_changed: 0, locations_created: 0, stock_created: 0, errors: [] };

  // locations first, so every asset can point at one
  const wanted = new Set();
  for (const r of a.assets) if (r.status === 'ready') { if (r._location) wanted.add(r._location); if (r._original_location) wanted.add(r._original_location); }
  for (const u of a.updates?.items || []) for (const c of u.changes) if ((c.field === 'location_id' || c.field === 'original_location_id') && c.to) wanted.add(c.to);
  const have = await prisma.assetLocation.findMany();
  const byKey = new Map(have.map((l) => [locKey(l.name), l]));
  for (const name of wanted) {
    if (!byKey.has(locKey(name))) {
      const created = await prisma.assetLocation.create({ data: { name } });
      byKey.set(locKey(name), created);
      result.locations_created += 1;
    }
  }

  const rows = a.assets.filter((r) => r.status === 'ready').map((r) => ({
    ...r.data,
    location_id: r._location ? byKey.get(locKey(r._location)).id : null,
    original_location_id: r._original_location ? byKey.get(locKey(r._original_location)).id : null,
  }));
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    try {
      const r = await prisma.asset.createMany({ data: chunk, skipDuplicates: true });
      result.assets_created += r.count;
    } catch (err) {
      console.error('Asset import chunk failed:', err);
      result.errors.push({ rows: `${chunk[0].imported_from} … ${chunk[chunk.length - 1].imported_from}`, error: 'Could not save this group of rows' });
    }
  }

  // update items already in the register (only when asked for)
  for (const u of a.updates?.items || []) {
    try {
      const data = { ...u.data };
      if (data.location_id) data.location_id = byKey.get(locKey(data.location_id)).id;
      if (data.original_location_id) data.original_location_id = byKey.get(locKey(data.original_location_id)).id;
      await prisma.asset.update({ where: { id: u.id }, data });
      result.assets_updated += 1;
      result.fields_changed += u.changes.length;
    } catch (err) {
      result.errors.push({ rows: `${u.sheet} row ${u.row}`, error: `Could not update ${u.tag}` });
    }
  }

  if (includeStock) {
    for (const s of a.stock.filter((x) => x.status === 'ready')) {
      try {
        await prisma.$transaction(async (tx) => {
          const item = await tx.inventoryItem.create({ data: s.data });
          if (s.data.current_stock > 0) {
            await tx.stockMovement.create({ data: { inventory_item_id: item.id, movement_type: 'IN', quantity: s.data.current_stock, reference: 'Opening balance', notes: 'Imported from the asset registers workbook', performed_by: userId || null } });
          }
        });
        result.stock_created += 1;
      } catch (err) {
        result.errors.push({ rows: `${s.sheet} row ${s.row}`, error: err.message.split('\n').pop() });
      }
    }
  }
  return result;
};

module.exports = { UPDATE_GROUPS, analyzeWorkbook, summarizeAnalysis, previewRows, importWorkbook, readWorkbook, MAX_ROWS };
