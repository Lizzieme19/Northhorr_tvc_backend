const XLSX = require('xlsx');
const docs = require('./documentService');

// ─────────────────────────────────────────────────────────────────────────────
// Turns a report (see reportBuilders.js) into a PDF on the college letterhead, or into an Excel file.
// ─────────────────────────────────────────────────────────────────────────────

const thousands = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtMoney = (n) => { const v = Number(n); if (!isFinite(v)) return ''; const neg = v < 0; return `${neg ? '(' : ''}${thousands(Math.abs(v).toFixed(2))}${neg ? ')' : ''}`; };
const fmtInt = (n) => thousands(String(Math.round(Number(n) || 0)));
const fmtDate = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const fmtCell = (col, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (col.type === 'money') return fmtMoney(v);
  if (col.type === 'int') return fmtInt(v);
  if (col.type === 'percent') return `${Number(v).toFixed(1)}%`;
  if (col.type === 'date') return fmtDate(v);
  return String(v);
};
const fmtKpi = (k) => (k.type === 'money' ? `KES ${fmtMoney(k.value)}` : k.type === 'percent' ? `${Number(k.value).toFixed(1)}%` : k.type === 'int' ? fmtInt(k.value) : String(k.value));
const alignOf = (col) => (['money', 'int', 'percent'].includes(col.type) ? 'right' : 'left');
const stamp = () => new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ═════════════════════════ PDF ═════════════════════════
async function renderPdf(report, { generatedBy = '' } = {}) {
  return docs.buildPDF(async (doc) => {
    const st = doc._style;
    const accent = st.accent || '#1F6F4A';
    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const TOP = doc.page.margins.top;
    const BOTTOM = doc.page.height - 50;
    const FS = 7.5;
    let y = 0;

    const continuation = () => {
      doc.font('Helvetica').fontSize(7).fillColor('#6B7280').text(st.college_name || '', L, TOP - 14, { width: W / 2, lineBreak: false });
      doc.text(report.title, L + W / 2, TOP - 14, { width: W / 2, align: 'right', lineBreak: false });
      doc.moveTo(L, TOP - 3).lineTo(L + W, TOP - 3).strokeColor('#D1D5DB').lineWidth(0.5).stroke();
      y = TOP + 6;
    };
    const newPage = () => { doc.addPage(); continuation(); };
    const need = (h) => { if (y + h > BOTTOM) { newPage(); return true; } return false; };

    // ── page 1: the letterhead, title, filters, headline numbers ──
    y = await docs.drawHeader(doc, report.title);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(report.subtitle || '', L, y - 2, { width: W, align: 'center' });
    y = doc.y + 3;
    const filterText = report.filters.length ? report.filters.map(([k, v]) => `${k}: ${v}`).join('   |   ') : 'No filters: everything is included';
    doc.font('Helvetica').fontSize(7.5).fillColor('#4B5563').text(`Filters:  ${filterText}`, L, y, { width: W, align: 'center' });
    y = doc.y + 2;
    doc.fontSize(7).fillColor('#6B7280').text(`Generated ${stamp()}${generatedBy ? ` by ${generatedBy}` : ''}`, L, y, { width: W, align: 'center' });
    y = doc.y + 10;

    if (report.kpis?.length) {
      const n = report.kpis.length; const gap = 6; const bw = (W - gap * (n - 1)) / n;
      report.kpis.forEach((k, i) => {
        const x = L + i * (bw + gap);
        doc.roundedRect(x, y, bw, 34, 4).fillAndStroke('#F7F8F7', '#E5E7EB');
        doc.font('Helvetica').fontSize(6.5).fillColor('#6B7280').text(k.label.toUpperCase(), x + 6, y + 5, { width: bw - 12, lineBreak: false });
        const val = fmtKpi(k);
        doc.font('Helvetica-Bold').fontSize(val.length > 18 ? 8 : 11).fillColor('#111827').text(val, x + 6, y + 17, { width: bw - 12, lineBreak: false });
      });
      y += 34 + 12;
    }

    if (!report.sections.length) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#6B7280').text('No records match these filters.', L, y + 20, { width: W, align: 'center' });
      doc.font('Helvetica').fontSize(8.5).text('Try widening the filters (a different term, a wider date range, or all courses).', L, doc.y + 4, { width: W, align: 'center' });
      y = doc.y + 20;
    }

    // ── each section: a heading, then its table ──
    for (const sec of report.sections) {
      const total = sec.columns.reduce((s, c) => s + (c.w || 10), 0);
      const TW = W * Math.min(1, total / 95); // a table with few columns does not stretch across the page
      let cx = L;
      const cols = sec.columns.map((c) => { const pw = (TW * (c.w || 10)) / total; const o = { ...c, x: cx, pw, align: /status/.test(c.key) ? 'center' : alignOf(c) }; cx += pw; return o; });
      const padX = 3; const padY = 2.6;
      const measure = (cells, bold) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS);
        return Math.max(...cells.map((t, i) => doc.heightOfString(String(t ?? ''), { width: cols[i].pw - padX * 2 })), FS) + padY * 2;
      };
      const writeCells = (cells, ry, bold, color) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS).fillColor(color || '#111827');
        cells.forEach((t, i) => doc.text(String(t ?? ''), cols[i].x + padX, ry + padY, { width: cols[i].pw - padX * 2, align: cols[i].align }));
      };
      const tableHead = () => {
        const labels = cols.map((c) => c.label);
        const h = measure(labels, true);
        doc.rect(L, y, TW, h).fill(accent);
        writeCells(labels, y, true, '#FFFFFF');
        y += h;
      };

      need(16 + 20 + 16);
      doc.rect(L, y, 3, 14).fill(accent);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827').text(sec.heading, L + 8, y + 2, { width: W - 10, lineBreak: false });
      y += 18;
      tableHead();

      sec.rows.forEach((row, ri) => {
        const cells = cols.map((c) => fmtCell(c, row[c.key]));
        const h = measure(cells, false);
        if (need(h)) tableHead();
        if (ri % 2 === 1) doc.rect(L, y, TW, h).fill('#F7F8F7');
        writeCells(cells, y, false);
        doc.moveTo(L, y + h).lineTo(L + TW, y + h).strokeColor('#EEF0EE').lineWidth(0.4).stroke();
        y += h;
      });

      if (sec.omitted) { need(14); doc.font('Helvetica-Oblique').fontSize(7).fillColor('#6B7280').text(`${sec.omitted} more row(s) are in the full report.`, L, y + 3, { width: W }); y += 14; }

      if (sec.subtotal) {
        const vals = sec.subtotal.values || {};
        const firstValIdx = cols.findIndex((c) => vals[c.key] !== undefined);
        const labelW = firstValIdx > 0 ? cols[firstValIdx].x - L : TW;
        const cells = cols.map((c) => fmtCell(c, vals[c.key]));
        const h = measure(cells.map((c, i) => (i === 0 ? '' : c)), true);
        need(h + 2);
        doc.rect(L, y, TW, h).fill('#EAF1EC');
        doc.moveTo(L, y).lineTo(L + TW, y).strokeColor(accent).lineWidth(0.8).stroke();
        doc.font('Helvetica-Bold').fontSize(FS).fillColor('#111827').text(sec.subtotal.label, L + padX, y + padY, { width: labelW - padX * 2, lineBreak: false });
        cols.forEach((c, i) => { if (vals[c.key] !== undefined) doc.text(cells[i], c.x + padX, y + padY, { width: c.pw - padX * 2, align: c.align, lineBreak: false }); });
        y += h;
      }
      y += 14;
    }

    // ── notes and sign-off ──
    if (report.notes?.length) {
      need(14 + report.notes.length * 10);
      doc.font('Helvetica-Oblique').fontSize(7).fillColor('#6B7280');
      report.notes.forEach((n) => { doc.text(`Note: ${n}`, L, y, { width: W }); y = doc.y + 2; });
      y += 6;
    }
    if (report.signoff) {
      need(62);
      y += 14;
      const colW = (W - 40) / 2;
      [['Prepared by', generatedBy], ['Checked and approved by', '']].forEach(([label, name], i) => {
        const x = L + i * (colW + 40);
        doc.moveTo(x, y + 22).lineTo(x + colW, y + 22).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text(label, x, y + 26, { width: colW, lineBreak: false });
        doc.font('Helvetica').fontSize(7.5).fillColor('#6B7280').text(`${name ? name + '   ' : ''}Signature and date`, x, y + 37, { width: colW, lineBreak: false });
      });
    }

    // ── footer and page numbers on every page ──
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const fy = doc.page.height - 30;
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing in the footer area must not start another page
      doc.moveTo(L, fy - 6).lineTo(L + W, fy - 6).strokeColor(accent).lineWidth(0.5).stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#6B7280');
      doc.text(`${report.title}  |  ${stamp()}`, L, fy, { width: W * 0.26, align: 'left', lineBreak: false });
      if (st.show_footer !== false && st.footer_text) doc.text(st.footer_text, L + W * 0.26, fy, { width: W * 0.54, align: 'center', lineBreak: false, ellipsis: true });
      doc.text(`Page ${i + 1} of ${range.count}`, L + W * 0.8, fy, { width: W * 0.2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = keep;
    }
  }, { layout: 'landscape', margin: 36, bufferPages: true });
}

// ═════════════════════════ EXCEL ═════════════════════════
const MONEY_Z = '#,##0.00';
function renderXlsx(report, { generatedBy = '', style = {} } = {}) {
  const aoa = [];
  const cellFmt = []; // { r, c, z }
  const merges = [];
  const push = (row) => { aoa.push(row); return aoa.length - 1; };
  const widest = Math.max(6, ...report.sections.map((s) => s.columns.length));
  const mergeRow = (r) => merges.push({ s: { r, c: 0 }, e: { r, c: widest - 1 } });

  mergeRow(push([style.college_name || 'North Horr Technical and Vocational College']));
  if (style.contact_line) mergeRow(push([style.contact_line]));
  mergeRow(push([report.title.toUpperCase()]));
  mergeRow(push([report.subtitle || '']));
  push([]);
  push(['Generated', stamp()]);
  if (generatedBy) push(['Generated by', generatedBy]);
  push(['Filters', report.filters.length ? report.filters.map(([k, v]) => `${k}: ${v}`).join('; ') : 'None (everything included)']);
  push([]);
  for (const k of report.kpis || []) {
    const r = push([k.label, k.type === 'money' || k.type === 'int' || k.type === 'percent' ? Number(k.value) : String(k.value)]);
    if (k.type === 'money') cellFmt.push({ r, c: 1, z: MONEY_Z });
    if (k.type === 'percent') cellFmt.push({ r, c: 1, z: '0.0"%"' });
  }
  for (const sec of report.sections) {
    push([]);
    push([sec.heading]);
    push(sec.columns.map((c) => c.label));
    for (const row of sec.rows) {
      const r = push(sec.columns.map((c) => { const v = row[c.key]; if (c.type === 'date' && v) return new Date(v); return v ?? ''; }));
      sec.columns.forEach((c, ci) => { if (c.type === 'money') cellFmt.push({ r, c: ci, z: MONEY_Z }); if (c.type === 'date') cellFmt.push({ r, c: ci, z: 'dd-mmm-yyyy' }); if (c.type === 'percent') cellFmt.push({ r, c: ci, z: '0.0"%"' }); });
    }
    if (sec.subtotal) {
      const vals = sec.subtotal.values || {};
      const r = push(sec.columns.map((c, i) => (i === 0 ? sec.subtotal.label : vals[c.key] ?? '')));
      sec.columns.forEach((c, ci) => { if (c.type === 'money' && vals[c.key] !== undefined) cellFmt.push({ r, c: ci, z: MONEY_Z }); });
    }
  }
  if (report.notes?.length) { push([]); report.notes.forEach((n) => push([`Note: ${n}`])); }

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  for (const { r, c, z } of cellFmt) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.v !== '') cell.z = z; }
  ws['!merges'] = merges;
  ws['!cols'] = Array.from({ length: widest }, (_, i) => ({ wch: Math.max(14, ...report.sections.map((s) => Math.round((s.columns[i]?.w || 10) * 1.5))) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');

  // the same rows as one flat table, ready for Excel's own filters and pivots
  if (report.flat?.rows?.length) {
    const cols = report.flat.columns;
    const data = [cols.map((c) => c.label), ...report.flat.rows.map((row) => cols.map((c) => { const v = row[c.key]; if (c.type === 'date' && v) return new Date(v); return v ?? ''; }))];
    const flat = XLSX.utils.aoa_to_sheet(data, { cellDates: true });
    for (let r = 1; r < data.length; r++) cols.forEach((c, ci) => { const cell = flat[XLSX.utils.encode_cell({ r, c: ci })]; if (!cell || cell.v === '') return; if (c.type === 'money') cell.z = MONEY_Z; if (c.type === 'date') cell.z = 'dd-mmm-yyyy'; if (c.type === 'percent') cell.z = '0.0"%"'; });
    flat['!cols'] = cols.map((c) => ({ wch: c.type === 'money' ? 16 : Math.max(12, c.label.length + 4) }));
    flat['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length - 1, c: cols.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, flat, 'Data');
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
}

module.exports = { renderPdf, renderXlsx };
