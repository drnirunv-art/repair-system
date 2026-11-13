// Office exports without a server: real .xlsx files (own small writer) and .pptx decks (PptxGenJS, loaded on first use).
// Every table export gets a first sheet "บทสรุปผู้บริหาร" computed from the rows themselves.
window.Office = (() => {
  const enc = new TextEncoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  // zip with stored (uncompressed) entries: enough for Excel and small enough for these tables
  function zip(files) {
    const parts = [], central = []; let off = 0;
    const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
      const head = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      parts.push(new Uint8Array([0x50, 0x4b, 3, 4, ...head]), name, data);
      central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...head, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += 30 + name.length + data.length;
    }
    const csize = central.reduce((s, x) => s + x.length, 0);
    return [...parts, ...central, new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), 0, 0])];
  }
  const x = v => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const col = i => { let s = ""; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const isNum = v => typeof v === "number" ? isFinite(v) : typeof v === "string" && /^-?(0|[1-9]\d{0,13})(\.\d+)?$/.test(v);
  const save = (blobParts, name, type) => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(blobParts, { type })), download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const sheetName = (n, used) => { let s = String(n || "Sheet").replace(/[\\/?*\[\]:]/g, " ").slice(0, 31).trim() || "Sheet", k = 2; while (used.has(s)) s = s.slice(0, 28) + " " + k++; used.add(s); return s; };

  // sheets: [{ name, rows: [[cell]], header: row index of the table header (optional), styles: { rowIndex: 1..4 } }]
  // cell styles: 1 table header, 2 title, 3 bold, 4 wrapped text
  function xlsxParts(sheets) {
    const used = new Set(), names = sheets.map(s => sheetName(s.name, used));
    const ws = s => {
      const widths = [];
      const body = s.rows.map((r, ri) => { const st = (s.styles || {})[ri] || (s.header === ri ? 1 : 0);
        return `<row r="${ri + 1}">${(r || []).map((v, ci) => { if (v == null || v === "") return "";
          const ref = col(ci) + (ri + 1), sa = st ? ` s="${st}"` : "";
          if (st !== 2 && st !== 4) widths[ci] = Math.min(60, Math.max(widths[ci] || 8, String(v).length + 2));
          return isNum(v) && !st ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${sa}><is><t xml:space="preserve">${x(v)}</t></is></c>`; }).join("")}</row>`; }).join("");
      const cols = widths.length ? `<cols>${Array.from(widths, (w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w || 10}" customWidth="1"/>`).join("")}</cols>` : "";
      const freeze = s.header != null ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${s.header + 1}" topLeftCell="A${s.header + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${body}</sheetData></worksheet>`;
    };
    const P = "http://schemas.openxmlformats.org/package/2006", O = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", CT = "application/vnd.openxmlformats-officedocument.spreadsheetml";
    return [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${P}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`).join("")}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${P}/relationships"><Relationship Id="rId1" Type="${O}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${O}"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${P}/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${O}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${O}/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="15"/><name val="Tahoma"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE9F5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF7A8CA0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="0" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: ws(s) }))];
  }
  const xlsx = (name, sheets) => save(zip(xlsxParts(sheets)), name.replace(/\.(csv|xlsx)$/i, "") + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  const nf = v => (+v).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  const now = () => new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "long", timeStyle: "short" });
  // what a manager wants first from any list: how many, how the rows split by each category, and totals of the amounts
  function analyze(head, rows) {
    const n = rows.length, figures = [["จำนวนรายการทั้งหมด", n]], groups = [], findings = [];
    if (!n) return { figures, groups, findings: ["ไม่มีข้อมูลในช่วงหรือเงื่อนไขที่เลือก"] };
    head.forEach((h, c) => {
      const vals = rows.map(r => r[c]).filter(v => v != null && !/^[-–\s]*$/.test(String(v))); if (!vals.length) return;
      const idLike = /เลข|รหัส|โทร|TAG|No\.|วันที่|เวลา|เมื่อ|รับแจ้ง|เกิด|ปิดงาน|หมายเหตุ|รายละเอียด|สรุป|อาการ|สเปค|ชื่อ|ลิงก์|นัด|กำหนด|แผนงาน|เบอร์/i.test(h) && !/จำนวน|นาที|บาท|วัน\)|คะแนน/.test(h);
      const nums = vals.filter(isNum);
      if (!idLike && nums.length >= vals.length * 0.8 && nums.length > 1) {
        const a = nums.map(Number), sum = a.reduce((s, v) => s + v, 0);
        figures.push([`${h}: รวม`, +sum.toFixed(2)], [`${h}: เฉลี่ย`, +(sum / a.length).toFixed(2)], [`${h}: สูงสุด`, Math.max(...a)]);
        return;
      }
      if (idLike || vals.every(v => /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(String(v)))) return;
      const m = new Map(); vals.forEach(v => m.set(String(v), (m.get(String(v)) || 0) + 1));
      if (m.size < 2 || m.size > Math.max(3, Math.min(25, n * 0.6))) return;
      const top = [...m].sort((a, b) => b[1] - a[1]);
      groups.push({ title: h, rows: top.slice(0, 10).map(([k, v]) => [k, v, Math.round(v / n * 100) + "%"]) });
      if (top[0][1] / n >= 0.25 || top.length <= 6) findings.push(`${h}: มากที่สุดคือ "${top[0][0]}" ${nf(top[0][1])} รายการ (${Math.round(top[0][1] / n * 100)}%)${top[1] ? ` รองลงมา "${top[1][0]}" ${nf(top[1][1])} รายการ` : ""}`);
    });
    findings.unshift(`มีข้อมูลทั้งหมด ${nf(n)} รายการ`);
    figures.filter(f => /รวม$/.test(f[0])).slice(0, 4).forEach(f => findings.push(`${f[0].replace(": รวม", "")} รวม ${nf(f[1])}`));
    return { figures, groups, findings };
  }
  // summary sheet rows: title block, findings (given ones first), key figures, split tables
  function summarySheet({ title, org, period, findings = [], figures = [], groups = [], notes = [] }) {
    const rows = [[title], [[org, period].filter(Boolean).join(" · ")], ["ออกรายงานเมื่อ " + now()], [], ["บทสรุปผู้บริหาร"]], styles = { 0: 2, 4: 3 };
    findings.forEach((f, i) => rows.push([`${i + 1}. ${f}`]));
    if (notes.length) { rows.push([]); styles[rows.length] = 3; rows.push(["ข้อสังเกตและข้อเสนอแนะ"]); notes.forEach((f, i) => rows.push([`${i + 1}. ${f}`])); }
    if (figures.length) { rows.push([]); styles[rows.length] = 1; rows.push(["ตัวเลขสำคัญ", "ค่า"]); figures.forEach(f => rows.push(f)); }
    groups.forEach(g => { rows.push([]); styles[rows.length] = 1; rows.push([g.title, ...(g.head || ["จำนวน", "สัดส่วน"])]); g.rows.forEach(r => rows.push(r)); });
    rows.push([], ["บทสรุปนี้ระบบคำนวณจากข้อมูลในไฟล์นี้โดยอัตโนมัติ"]);
    return { name: "บทสรุปผู้บริหาร", rows, styles };
  }
  // one table → .xlsx with the summary sheet first. opts: { title, org, period, findings, notes }
  function table(name, head, rows, opts = {}) {
    const a = analyze(head, rows), title = opts.title || name.replace(/\.(csv|xlsx)$/i, "").replace(/-/g, " ");
    xlsx(name, [summarySheet({ title, org: opts.org, period: opts.period, findings: [...(opts.findings || []), ...a.findings], notes: opts.notes || [], figures: a.figures, groups: a.groups }),
      { name: "ข้อมูล", rows: [head, ...rows], header: 0 }]);
  }

  let lib;
  const loadPptx = () => lib || (lib = new Promise((ok, bad) => { if (window.PptxGenJS) return ok();
    const s = document.createElement("script"); s.src = "assets/vendor/pptxgen.bundle.js"; s.onload = ok; s.onerror = () => { lib = null; bad(new Error("โหลดตัวสร้าง PowerPoint ไม่สำเร็จ ลองใหม่อีกครั้ง")); }; document.head.appendChild(s); }));
  // deck: { title, org, period, findings: [], notes: [], kpis: [[label, value]], sections: [{ title, head, rows, chart: true|false, note }] }
  async function pptx(name, d) {
    await loadPptx();
    const p = new window.PptxGenJS(); p.layout = "LAYOUT_WIDE"; const F = "Tahoma", INK = "1F2A37", ACC = "0B5CAD", MUT = "5B6776";
    const foot = (s, i) => { s.addText(`${d.org || ""} · ${d.title}`, { x: 0.5, y: 7.0, w: 10, h: 0.3, fontFace: F, fontSize: 10, color: MUT }); s.addText(String(i), { x: 12.2, y: 7.0, w: 0.7, h: 0.3, fontFace: F, fontSize: 10, color: MUT, align: "right" }); };
    const head = (s, t) => { s.addText(t, { x: 0.5, y: 0.35, w: 12.3, h: 0.7, fontFace: F, fontSize: 26, bold: true, color: INK }); s.addShape(p.ShapeType.rect, { x: 0.5, y: 1.08, w: 1.2, h: 0.06, fill: { color: ACC }, line: { color: ACC } }); };
    const bullets = (s, list, y, h) => s.addText(list.map(t => ({ text: t, options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } })), { x: 0.6, y, w: 12.1, h, fontFace: F, fontSize: list.length > 7 ? 15 : 18, color: INK, valign: "top" });
    let n = 0, s = p.addSlide(); s.background = { color: "F4F7FB" };
    s.addText(d.title, { x: 0.7, y: 2.3, w: 12, h: 1.2, fontFace: F, fontSize: 38, bold: true, color: INK });
    s.addText([d.org, d.period].filter(Boolean).join(" · "), { x: 0.7, y: 3.5, w: 12, h: 0.6, fontFace: F, fontSize: 22, color: ACC });
    s.addText("ออกรายงานเมื่อ " + now(), { x: 0.7, y: 4.2, w: 12, h: 0.4, fontFace: F, fontSize: 14, color: MUT });
    if ((d.findings || []).length) { s = p.addSlide(); head(s, "บทสรุปผู้บริหาร"); bullets(s, d.findings.slice(0, 9), 1.4, 5.4); foot(s, ++n); }
    if ((d.kpis || []).length) { s = p.addSlide(); head(s, "ตัวเลขสำคัญ");
      d.kpis.slice(0, 12).forEach(([k, v], i) => { const cx = 0.5 + (i % 4) * 3.1, cy = 1.5 + Math.floor(i / 4) * 1.8;
        s.addShape(p.ShapeType.roundRect, { x: cx, y: cy, w: 2.9, h: 1.55, fill: { color: "F4F7FB" }, line: { color: "D5DEE9" }, rectRadius: 0.08 });
        s.addText(String(v), { x: cx + 0.15, y: cy + 0.15, w: 2.6, h: 0.75, fontFace: F, fontSize: 26, bold: true, color: ACC });
        s.addText(String(k), { x: cx + 0.15, y: cy + 0.9, w: 2.6, h: 0.5, fontFace: F, fontSize: 12, color: MUT }); }); foot(s, ++n); }
    (d.sections || []).filter(x => x.rows && x.rows.length).forEach(sec => { s = p.addSlide(); head(s, sec.title);
      const rows = sec.rows.slice(0, 12), withChart = sec.chart !== false && rows.length > 1 && rows.every(r => isNum(r[1]));
      const tw = withChart ? 6.2 : 12.3, cw = sec.head.map((_, i) => i ? (tw * 0.5) / Math.max(1, sec.head.length - 1) : tw * 0.5);
      s.addTable([sec.head.map(h => ({ text: String(h), options: { bold: true, fill: { color: "DCE9F5" }, color: INK } })), ...rows.map(r => r.map((v, i) => ({ text: String(v ?? ""), options: { align: i ? "right" : "left" } })))],
        { x: 0.5, y: 1.4, w: tw, colW: cw, fontFace: F, fontSize: rows.length > 10 ? 11 : 13, color: INK, border: { type: "solid", color: "D5DEE9", pt: 0.75 } });
      if (withChart) s.addChart(p.ChartType.bar, [{ name: sec.head[1], labels: rows.map(r => String(r[0])).reverse(), values: rows.map(r => +r[1]).reverse() }],
        { x: 7.0, y: 1.4, w: 5.8, h: 4.6, barDir: "bar", valAxisMinVal: 0, chartColors: [ACC], catAxisLabelFontFace: F, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, showValue: true, dataLabelFontSize: 10, showLegend: false });
      if (sec.note) s.addText(sec.note, { x: 0.5, y: 6.3, w: 12.3, h: 0.55, fontFace: F, fontSize: 14, color: ACC, italic: true });
      foot(s, ++n); });
    if ((d.notes || []).length) { s = p.addSlide(); head(s, "ข้อสังเกตและข้อเสนอแนะ"); bullets(s, d.notes.slice(0, 9), 1.4, 5.4); foot(s, ++n); }
    await p.writeFile({ fileName: name.replace(/\.pptx$/i, "") + ".pptx" });
  }
  // read an .xlsx in the browser: { sheetName: [[cell text]] }. Only what an import needs: cell values as text (cached results for formulas).
  async function readXlsx(file) {
    const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer), dec = new TextDecoder();
    let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("ไฟล์นี้ไม่ใช่ Excel (.xlsx)");
    const files = {}; let p = dv.getUint32(e + 16, true);
    for (let n = dv.getUint16(e + 10, true); n > 0; n--) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      files[dec.decode(buf.subarray(p + 46, p + 46 + nl))] = { method, csize, off }; p += 46 + nl + xl + cl;
    }
    const text = async name => { const f = files[name]; if (!f) return null;
      const s = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true), raw = buf.subarray(s, s + f.csize);
      if (f.method === 0) return dec.decode(raw);
      if (f.method !== 8 || !window.DecompressionStream) throw new Error("เบราว์เซอร์นี้อ่านไฟล์ Excel ไม่ได้ กรุณาใช้ Chrome รุ่นใหม่");
      return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text(); };
    const xml = t => new DOMParser().parseFromString(t, "application/xml"), tx = n => [...n.getElementsByTagName("t")].filter(t => t.parentNode.nodeName !== "rPh").map(t => t.textContent).join("");
    const sst = await text("xl/sharedStrings.xml"), shared = sst ? [...xml(sst).getElementsByTagName("si")].map(tx) : [];
    const wb = xml(await text("xl/workbook.xml")), rels = xml(await text("xl/_rels/workbook.xml.rels")), target = {};
    [...rels.getElementsByTagName("Relationship")].forEach(r => target[r.getAttribute("Id")] = r.getAttribute("Target").replace(/^\/?(xl\/)?/, "xl/"));
    const out = {};
    for (const sh of wb.getElementsByTagName("sheet")) {
      const t = await text(target[sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")]); if (!t) continue;
      const rows = [];
      for (const r of xml(t).getElementsByTagName("row")) { const row = []; let ci = 0;
        for (const c of r.getElementsByTagName("c")) { const ref = c.getAttribute("r");
          if (ref) { ci = 0; for (const ch of ref.replace(/\d+/g, "")) ci = ci * 26 + ch.charCodeAt(0) - 64; ci--; }
          const ty = c.getAttribute("t"), v = c.getElementsByTagName("v")[0];
          row[ci++] = ty === "s" ? shared[+v?.textContent] ?? "" : ty === "inlineStr" ? tx(c) : v ? v.textContent : ""; }
        rows[(+r.getAttribute("r") || rows.length + 1) - 1] = Array.from(row, x => x ?? ""); }
      out[sh.getAttribute("name")] = Array.from(rows, x => x || []);
    }
    return out;
  }
  return { xlsx, table, analyze, summarySheet, pptx, zip, xlsxParts, readXlsx };
})();
