// What an asset is worth today, worked out from its cost, date and depreciation rate.
// Nothing here is stored: it is recalculated each time so the figures never drift apart.
//   annual depreciation = cost x rate%
//   accumulated         = annual x months owned / 12, never more than the cost
//   net book value      = cost - accumulated
// Straight line, counted in whole months from the purchase (or delivery) date.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const wholeMonthsBetween = (from, to) => {
  const f = new Date(from);
  const t = new Date(to);
  let m = (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth());
  if (t.getDate() < f.getDate()) m -= 1;
  return Math.max(0, m);
};

// state: VALUED | NEEDS_COST | NEEDS_RATE | NEEDS_DATE
const valuation = (asset, asAt = new Date()) => {
  const cost = asset.purchase_cost;
  if (cost == null) return { state: 'NEEDS_COST', cost: null, annual_depreciation: null, accumulated_depreciation: null, net_book_value: null };

  const date = asset.purchase_date || asset.delivery_date;
  const rate = asset.depreciation_rate;
  if (!date) return { state: 'NEEDS_DATE', cost, annual_depreciation: null, accumulated_depreciation: null, net_book_value: null };
  if (rate == null) return { state: 'NEEDS_RATE', cost, annual_depreciation: null, accumulated_depreciation: null, net_book_value: null };

  // a disposed asset stops depreciating on the day it was disposed of
  const until = asset.disposal_date && new Date(asset.disposal_date) < asAt ? asset.disposal_date : asAt;
  const months = wholeMonthsBetween(date, until);
  const annual = (cost * rate) / 100;
  const accumulated = Math.min(cost, (annual * months) / 12);
  return {
    state: 'VALUED',
    cost: round2(cost),
    annual_depreciation: round2(annual),
    accumulated_depreciation: round2(accumulated),
    net_book_value: round2(cost - accumulated),
  };
};

module.exports = { valuation, wholeMonthsBetween };
