const prisma = require('../config/db');
const { ASSET_CLASSES, sentenceCase } = require('./assetRegisterService');

// ─────────────────────────────────────────────────────────────────────────────
// What a procurement line is buying.
// A consumable goes into Inventory (counted in a unit of measure); an asset is registered one by one, with a
// tag number, in the asset register. The answer is chosen once on the requisition and carried through the RFQ,
// LPO and GRN so that receiving the goods can put them in the right place.
// ─────────────────────────────────────────────────────────────────────────────

const ITEM_TYPES = ['CONSUMABLE', 'ASSET'];

// Offered in the dropdown; the college can use any other unit by typing it
const DEFAULT_UNITS = ['pcs', 'ream', 'box', 'packet', 'carton', 'dozen', 'pair', 'set', 'roll', 'bottle', 'tin', 'sachet', 'bag', 'kg', 'litre', 'metre', 'bundle'];

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// "REAM", "ream " and "Ream" are one unit: keep the spelling already in use, otherwise lower case
const normalizeUnit = (value, known = []) => {
  const u = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!u) return null;
  const hit = [...known, ...DEFAULT_UNITS].find((k) => k.toLowerCase() === u.toLowerCase());
  return hit || u.toLowerCase();
};

// Validates and tidies the classification fields of one line (requisition, LPO or GRN).
// Everything is optional: a line with no item_type is simply "not classified yet".
const readLineKind = (item, known = []) => {
  const type = item.item_type ? String(item.item_type).toUpperCase() : null;
  if (type && !ITEM_TYPES.includes(type)) throw fail('An item is either a consumable or an asset');
  if (!type) return { item_type: null, unit_of_measure: normalizeUnit(item.unit_of_measure, known), inventory_item_id: null, asset_class: null, asset_category: null };
  if (type === 'ASSET') {
    if (!ASSET_CLASSES[item.asset_class]) throw fail('Choose the type of asset (ICT, furniture, ...) for an asset line');
    return {
      item_type: 'ASSET',
      unit_of_measure: null, // assets are counted as individual items
      inventory_item_id: null,
      asset_class: item.asset_class,
      asset_category: item.asset_category ? sentenceCase(item.asset_category) : null,
    };
  }
  return {
    item_type: 'CONSUMABLE',
    unit_of_measure: normalizeUnit(item.unit_of_measure, known),
    inventory_item_id: item.inventory_item_id || null,
    asset_class: null,
    asset_category: null,
  };
};

// The units already used in Inventory, merged with the common ones
const knownUnits = async () => {
  const rows = await prisma.inventoryItem.findMany({ where: { unit_of_measure: { not: null } }, distinct: ['unit_of_measure'], select: { unit_of_measure: true } });
  const out = [];
  [...rows.map((r) => r.unit_of_measure), ...DEFAULT_UNITS].forEach((u) => {
    if (u && !out.some((x) => x.toLowerCase() === u.toLowerCase())) out.push(u);
  });
  return out;
};

// The fields copied from one procurement line to the next (requisition -> LPO -> GRN)
const carryKind = (line) => ({
  item_type: line.item_type || null,
  unit_of_measure: line.unit_of_measure || null,
  inventory_item_id: line.inventory_item_id || null,
  asset_class: line.asset_class || null,
  asset_category: line.asset_category || null,
});

const nextStockCode = async () => {
  const rows = await prisma.inventoryItem.findMany({ where: { item_code: { startsWith: 'STK-' } }, select: { item_code: true } });
  let max = 0;
  rows.forEach((r) => { const n = parseInt(String(r.item_code).slice(4), 10); if (!isNaN(n) && n > max) max = n; });
  return `STK-${String(max + 1).padStart(4, '0')}`;
};

module.exports = { ITEM_TYPES, DEFAULT_UNITS, normalizeUnit, readLineKind, knownUnits, carryKind, nextStockCode, fail };
