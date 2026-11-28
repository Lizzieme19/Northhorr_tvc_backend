// The requisition lines an RFQ asks suppliers for: the ones chosen for it, or all of them when none were chosen
// (every RFQ made before lines could be chosen)
const rfqItems = (rfq) => {
  const all = rfq?.requisition?.items || [];
  if (!rfq?.item_ids?.length) return all;
  const wanted = new Set(rfq.item_ids);
  return all.filter((i) => wanted.has(i.id));
};

module.exports = { rfqItems };
