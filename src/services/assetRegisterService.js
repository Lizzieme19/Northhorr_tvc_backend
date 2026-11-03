const prisma = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Asset register helpers: asset classes, tag numbers, locations
// ─────────────────────────────────────────────────────────────────────────────

const TAG_ROOT = process.env.ASSET_TAG_ROOT || 'NHTVC';

// The registers the college keeps. `code` is the class segment in a tag: NHTVC/<code>/<item>/<number>
const ASSET_CLASSES = {
  ICT: { label: 'ICT & computers', code: 'ICT' },
  FURNITURE: { label: 'Furniture & fittings', code: 'FN' },
  PLANT_MACHINERY: { label: 'Plant & machinery', code: 'MR' },
  OFFICE_EQUIPMENT: { label: 'Office equipment', code: 'OE' },
  PORTABLE_ATTRACTIVE: { label: 'Portable & attractive items', code: 'PA' },
};

const CONDITIONS = ['GOOD', 'FAIR', 'POOR', 'UNSERVICEABLE'];

// ── Text clean-up ────────────────────────────────────────────────────────────

const ACRONYMS = new Set(['CCTV', 'ICT', 'LED', 'LCD', 'UPS', 'PC', 'TV', 'DVD', 'USB', 'HDMI', 'LAN', 'VGA', 'WIFI', 'AC', 'DC', 'CPU', 'RAM', 'PVC', 'HP']);

// "COMPUTER MONITOR" and "computer monitor" both become "Computer monitor"; mixed-case names are left alone
const sentenceCase = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  const words = t.toLowerCase().split(' ').map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w));
  const out = words.join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
};

// ── Tag numbers ──────────────────────────────────────────────────────────────

// NHTVC/ICT/CMT/J/001 -> { prefix: 'NHTVC/ICT/CMT/J/', seq: 1 }
const parseTag = (tag) => {
  const m = String(tag || '').match(/^(.*\/)(\d+)$/);
  return m ? { prefix: m[1], seq: parseInt(m[2], 10) } : { prefix: null, seq: null };
};

const isTagLike = (v) => /^[A-Za-z0-9]+(\/[A-Za-z0-9-]+){2,}$/.test(String(v || '').trim());

const formatTag = (prefix, seq) => `${prefix}${String(seq).padStart(3, '0')}`;

// Item code for a new item type: "Filing cabinet" -> FC, "Projector" -> PRO
const itemCodeFor = (name) => {
  const words = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean);
  if (words.length === 0) return 'IT';
  if (words.length === 1) return words[0].slice(0, 3);
  return words.slice(0, 4).map((w) => w[0]).join('');
};

const defaultPrefix = (assetClass, category) =>
  `${TAG_ROOT}/${ASSET_CLASSES[assetClass]?.code || 'XX'}/${itemCodeFor(category)}/`;

// The next unused number for a prefix, counting what is already in the register
const nextSeqForPrefix = async (prefix) => {
  const r = await prisma.asset.aggregate({ where: { tag_prefix: prefix }, _max: { tag_seq: true } });
  return (r._max.tag_seq || 0) + 1;
};

// The tag prefixes already used for an item type, so new items continue the same numbering
const tagOptions = async (assetClass, category) => {
  const rows = category
    ? await prisma.asset.groupBy({ by: ['tag_prefix'], where: { asset_class: assetClass, category, tag_prefix: { not: null } }, _count: true, _max: { tag_seq: true } })
    : [];
  const options = rows
    .sort((a, b) => b._count - a._count)
    .map((r) => ({ prefix: r.tag_prefix, count: r._count, next_tag: formatTag(r.tag_prefix, (r._max.tag_seq || 0) + 1) }));
  if (options.length === 0 && category) {
    const prefix = defaultPrefix(assetClass, category);
    options.push({ prefix, count: 0, next_tag: formatTag(prefix, await nextSeqForPrefix(prefix)) });
  }
  return options;
};

// ── Locations ────────────────────────────────────────────────────────────────

// spellings seen in the college's own registers that are simply wrong
const KNOWN_TYPOS = { boadroom: 'Boardroom' };

const locKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const levenshtein = (a, b) => {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = i - 1;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
};

// Spelling and case variants of the same place become one: "ICT LAB" / "ICT Lab" / "Ict lab",
// and a one-letter slip such as "Boadroom" joins "Boardroom". The most used spelling wins.
// rawNames: every location value found. Returns Map(raw -> canonical name).
const canonicalLocations = (rawNames) => {
  const counts = new Map();
  for (const raw of rawNames) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (t) counts.set(t, (counts.get(t) || 0) + 1);
  }
  // group exact keys first
  const groups = new Map(); // key -> { total, variants: Map(raw -> n) }
  for (const [raw, n] of counts) {
    const k = locKey(raw);
    const g = groups.get(k) || { key: k, total: 0, variants: new Map() };
    g.total += n;
    g.variants.set(raw, (g.variants.get(raw) || 0) + n);
    groups.set(k, g);
  }
  // then fold a small typo into the group it is one letter away from
  const ordered = [...groups.values()].sort((a, b) => b.total - a.total);
  const parents = [];
  for (const g of ordered) {
    const parent = g.key.length >= 5 ? parents.find((p) => Math.abs(p.key.length - g.key.length) <= 1 && levenshtein(p.key, g.key) <= 1) : null;
    if (parent) { for (const [v, n] of g.variants) parent.variants.set(v, (parent.variants.get(v) || 0) + n); parent.total += g.total; }
    else parents.push(g);
  }
  const map = new Map();
  for (const p of parents) {
    // most used spelling; on a tie prefer the one that is not ALL CAPS
    let best = [...p.variants.entries()].sort((a, b) => b[1] - a[1] || (a[0] === a[0].toUpperCase() ? 1 : -1))[0][0];
    best = KNOWN_TYPOS[locKey(best)] || best;
    for (const v of p.variants.keys()) map.set(v, best);
  }
  return map;
};

module.exports = {
  TAG_ROOT, ASSET_CLASSES, CONDITIONS,
  sentenceCase, parseTag, isTagLike, formatTag, itemCodeFor, defaultPrefix, nextSeqForPrefix, tagOptions,
  locKey, levenshtein, canonicalLocations,
};
