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

  // A simple SVG drawing (line, rect, polygon arrow head, text) as a list of native shapes, so a fishbone in PPT / Word / Excel
  // is lines and text boxes people can edit, not a picture. Units stay the SVG's; each writer scales them.
  const visLen = t => String(t).replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
  function svgShapes(svg) {
    const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement, vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    const W = vb[2] || +root.getAttribute("width"), H = vb[3] || +root.getAttribute("height"), out = [];
    const c = v => v && v !== "none" && /^#[0-9a-f]{6}$/i.test(v) ? v.slice(1).toUpperCase() : null;
    for (const el of root.children) { const a = k => el.getAttribute(k), n = k => +a(k) || 0;
      if (el.localName === "line") out.push({ t: "line", x1: n("x1"), y1: n("y1"), x2: n("x2"), y2: n("y2"), stroke: c(a("stroke")) || "000000", sw: n("stroke-width") || 1 });
      else if (el.localName === "rect") { if (!n("x") && !n("y") && n("width") >= W && n("height") >= H) continue;
        out.push({ t: "rect", x: n("x"), y: n("y"), w: n("width"), h: n("height"), rx: n("rx"), fill: c(a("fill")), stroke: c(a("stroke")), sw: n("stroke-width") }); }
      else if (el.localName === "polygon") { const p = a("points").trim().split(/[\s,]+/).map(Number), xs = p.filter((_, i) => !(i % 2)), ys = p.filter((_, i) => i % 2);
        out.push({ t: "tri", x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), fill: c(a("fill")) || "000000" }); }
      else if (el.localName === "text") { const fs = n("font-size") || 16, anc = a("text-anchor") || "start", text = el.textContent, w = Math.max(fs * 2, visLen(text) * fs * 0.62 + fs), h = fs * 1.6;
        out.push({ t: "text", x: anc === "middle" ? n("x") - w / 2 : anc === "end" ? n("x") - w : n("x"), y: n("y") - fs * 1.15, w, h, fs, al: anc === "middle" ? "center" : anc === "end" ? "right" : "left", bold: a("font-weight") === "bold", color: c(a("fill")) || "000000", text }); } }
    return { W, H, items: out };
  }
  // DrawingML shape (used by Word wps:wsp and Excel xdr:sp): e = EMU per SVG unit
  const dmlGeom = (it, e) => { const L = it.t === "line", lw = Math.round((it.sw || 0) * e);
    const box = L ? { x: Math.min(it.x1, it.x2), y: Math.min(it.y1, it.y2), w: Math.abs(it.x2 - it.x1), h: Math.abs(it.y2 - it.y1) } : it;
    const flipV = L && (it.x2 - it.x1) * (it.y2 - it.y1) < 0, rot = it.t === "tri";
    // a right-pointing arrow head: an upright triangle turned 90°, its box swapped around the same centre
    const bx = rot ? { x: box.x + box.w / 2 - box.h / 2, y: box.y + box.h / 2 - box.w / 2, w: box.h, h: box.w } : box;
    const X = Math.round(bx.x * e), Y = Math.round(bx.y * e), CX = Math.max(1, Math.round(bx.w * e)), CY = Math.max(L ? 0 : 1, Math.round(bx.h * e));
    const geom = L ? "line" : it.t === "tri" ? "triangle" : it.t === "rect" && it.rx ? "roundRect" : "rect";
    const adj = geom === "roundRect" ? `<a:gd name="adj" fmla="val ${Math.round(Math.min(50000, it.rx / Math.min(it.w, it.h) * 100000))}"/>` : "";
    const fill = L || it.t === "text" || !it.fill ? "<a:noFill/>" : `<a:solidFill><a:srgbClr val="${it.fill}"/></a:solidFill>`;
    const ln = L ? `<a:ln w="${lw}"><a:solidFill><a:srgbClr val="${it.stroke}"/></a:solidFill></a:ln>` : it.stroke && it.sw ? `<a:ln w="${lw}"><a:solidFill><a:srgbClr val="${it.stroke}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
    const spPr = `<a:xfrm${rot ? ' rot="5400000"' : ""}${flipV ? ' flipV="1"' : ""}><a:off x="${X}" y="${Y}"/><a:ext cx="${CX}" cy="${CY}"/></a:xfrm><a:prstGeom prst="${geom}"><a:avLst>${adj}</a:avLst></a:prstGeom>${fill}${ln}`;
    return { X, Y, CX, CY, spPr }; };
  const dmlRun = (it, pt) => `<a:r><a:rPr lang="th-TH" sz="${Math.round(pt * 100)}"${it.bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${it.color}"/></a:solidFill><a:latin typeface="Tahoma"/><a:cs typeface="Tahoma"/></a:rPr><a:t>${x(it.text)}</a:t></a:r>`;
  const dmlAl = it => it.al === "center" ? "ctr" : it.al === "right" ? "r" : "l";

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
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${freeze}${cols}<sheetData>${body}</sheetData>${s.svg ? '<drawing r:id="rId1"/>' : ""}</worksheet>`;
    };
    // a sheet with svg gets the drawing as editable shapes below its rows (10 inches wide)
    const drawing = s => { const G = svgShapes(s.svg), e = 9144000 / G.W, top = ((s.rows || []).length + 1) * 254000; let id = 1;
      const sp = G.items.map(it => { const g = dmlGeom(it, e), T = it.t === "text";
        return `<xdr:absoluteAnchor><xdr:pos x="${g.X + 190500}" y="${g.Y + top}"/><xdr:ext cx="${g.CX}" cy="${g.CY}"/><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${++id}" name="${T ? "ข้อความ" : "รูปร่าง"} ${id}"/><xdr:cNvSpPr${T ? ' txBox="1"' : ""}/></xdr:nvSpPr><xdr:spPr>${g.spPr.replace(/<a:off x="\d+" y="\d+"\/>/, '<a:off x="' + (g.X + 190500) + '" y="' + (g.Y + top) + '"/>')}</xdr:spPr>` +
          (T ? `<xdr:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${dmlAl(it)}"/>${dmlRun(it, it.fs * e / 12700)}</a:p></xdr:txBody>` : "") + `</xdr:sp><xdr:clientData/></xdr:absoluteAnchor>`; }).join("");
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${sp}</xdr:wsDr>`; };
    const P = "http://schemas.openxmlformats.org/package/2006", O = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", CT = "application/vnd.openxmlformats-officedocument.spreadsheetml";
    return [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${P}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>${sheets.map((sh, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>` + (sh.svg ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : "")).join("")}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${P}/relationships"><Relationship Id="rId1" Type="${O}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${O}"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${P}/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${O}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${O}/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="15"/><name val="Tahoma"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE9F5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF7A8CA0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="0" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: ws(s) })),
      ...sheets.flatMap((s, i) => s.svg ? [{ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${P}/relationships"><Relationship Id="rId1" Type="${O}/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>` },
        { name: `xl/drawings/drawing${i + 1}.xml`, data: drawing(s) }] : [])];
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
    if (deckBuf) { deckBuf.push({ name, head, rows, opts }); return; }   // a PPT / Word / PDF button is asking: collect, build the deck afterwards
    const a = analyze(head, rows), title = opts.title || name.replace(/\.(csv|xlsx)$/i, "").replace(/-/g, " ");
    xlsx(name, [summarySheet({ title, org: opts.org, period: opts.period, findings: [...(opts.findings || []), ...a.findings], notes: opts.notes || [], figures: a.figures, groups: a.groups }),
      { name: "ข้อมูล", rows: [head, ...rows], header: 0 }]);
  }

  let lib;
  const loadPptx = () => lib || (lib = new Promise((ok, bad) => { if (window.PptxGenJS) return ok();
    const s = document.createElement("script"); s.src = "assets/vendor/pptxgen.bundle.js"; s.onload = ok; s.onerror = () => { lib = null; bad(new Error("โหลดตัวสร้าง PowerPoint ไม่สำเร็จ ลองใหม่อีกครั้ง")); }; document.head.appendChild(s); }));
  // deck: { title, org, period, findings: [], lead: [sections shown right after the summary], analysis: [], notes: [], kpis: [[label, value]], sections: [{ title, head, rows, chart: true|false, note }] }
  // the same deck as Word (.docx) and PDF, so every executive summary comes as Excel + PPT + Word + PDF
  let mode = null;
  const deckParts = d => { const out = [];
    const sec = x => out.push({ h: x.title, head: x.head, rows: x.rows && x.rows.length ? x.rows : null, note: x.note, img: x.img, imgR: x.imgR, svg: x.svg }), shown = x => (x.rows && x.rows.length) || x.img || x.svg;
    if ((d.findings || []).length) out.push({ h: "บทสรุปผู้บริหาร", list: d.findings });
    (d.lead || []).filter(shown).forEach(sec);
    if ((d.kpis || []).length) out.push({ h: "ตัวเลขสำคัญ", head: ["ตัวชี้วัด", "ค่า"], rows: d.kpis });
    if ((d.analysis || []).length) out.push({ h: "บทวิเคราะห์", list: d.analysis });
    (d.sections || []).filter(shown).forEach(sec);
    if ((d.notes || []).length) out.push({ h: "ข้อสังเกตและข้อเสนอแนะ", list: d.notes });
    return out; };
  function docx(name, d) {
    const R = (t, o = {}) => `<w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/>${o.b ? "<w:b/><w:bCs/>" : ""}${o.i ? "<w:i/><w:iCs/>" : ""}${o.c ? `<w:color w:val="${o.c}"/>` : ""}<w:sz w:val="${o.sz || 22}"/><w:szCs w:val="${o.sz || 22}"/></w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
    const P = (t, o = {}) => `<w:p><w:pPr><w:spacing w:after="${o.after ?? 120}"/>${o.ind ? `<w:ind w:left="360" w:hanging="360"/>` : ""}${o.al ? `<w:jc w:val="${o.al}"/>` : ""}</w:pPr>${R(t, o)}</w:p>`;
    const cell = (v, h, al, w) => `<w:tc><w:tcPr>${w ? `<w:tcW w:w="${w}" w:type="dxa"/>` : ""}${h ? '<w:shd w:val="clear" w:color="auto" w:fill="DCE9F5"/>' : ""}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/>${al ? `<w:jc w:val="${al}"/>` : ""}</w:pPr>${R(v, { b: h, sz: 18 })}</w:p></w:tc>`;
    const T = (head, rows) => `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(k => `<w:${k} w:val="single" w:sz="4" w:color="BFCBD8"/>`).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>
      <w:tblGrid>${head.map((_, i) => `<w:gridCol w:w="${Math.round(head.length < 2 ? 9638 : i ? 9638 * (head.length > 3 ? 0.6 : 0.5) / (head.length - 1) : 9638 * (head.length > 3 ? 0.4 : 0.5))}"/>`).join("")}</w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/></w:trPr>${head.map(h => cell(h, true)).join("")}</w:tr>${rows.map(r => `<w:tr>${head.map((_, i) => cell(r[i] ?? "", false, i && isNum(r[i]) ? "right" : null)).join("")}</w:tr>`).join("")}</w:tbl>${P("", { after: 60 })}`;
    const imgs = [], b64 = u => Uint8Array.from(atob(u.split(",")[1]), ch => ch.charCodeAt(0));
    const IMG = (u, r) => { const n = imgs.push(b64(u)), cx = 6120000, cy = Math.round(cx * (r || 600 / 1400));
      return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="ภาพ ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="img${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`; };
    let did = 100;
    const SHAPES = svg => { const G = svgShapes(svg), e = 6120000 / G.W, hTw = Math.round(G.H * e / 635);
      const runs = G.items.map((it, k) => { const g = dmlGeom(it, e), T = it.t === "text", id = ++did;
        const tb = T ? `<wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="${it.al === "center" ? "center" : it.al === "right" ? "right" : "left"}"/></w:pPr>${R(it.text, { b: it.bold, c: it.color, sz: Math.max(12, Math.round(it.fs * e / 6350)) })}</w:p></w:txbxContent></wps:txbx>` : "";
        return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${k + 2}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${g.X}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${g.Y}</wp:posOffset></wp:positionV><wp:extent cx="${g.CX}" cy="${g.CY}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="${T ? "ข้อความ" : "รูปร่าง"} ${id}"/><wp:cNvGraphicFramePr/>` +
          `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr${T ? ' txBox="1"' : ""}/><wps:spPr>${g.spPr.replace(/<a:off x="\d+" y="\d+"\/>/, '<a:off x="0" y="0"/>')}</wps:spPr>${tb}<wps:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`; }).join("");
      return `<w:p><w:pPr><w:spacing w:after="120" w:line="${hTw}" w:lineRule="exact"/></w:pPr>${runs}</w:p>`; };
    let body = P(d.title, { b: 1, sz: 36, after: 60 }) + P([d.org, d.period].filter(Boolean).join(" · "), { sz: 24, c: "0B5CAD", after: 40 }) + P("ออกรายงานเมื่อ " + now(), { sz: 18, c: "5B6776", after: 240 });
    deckParts(d).forEach(s => { body += P(s.h, { b: 1, sz: 28, c: "1F2A37", after: 100 });
      if (s.list) s.list.forEach((t, i) => body += P(`${i + 1}. ${t}`, { ind: 1 }));
      if (s.svg) body += SHAPES(s.svg); else if (s.img) body += IMG(s.img, s.imgR);
      if (s.rows) body += T(s.head, s.rows);
      if (s.note) body += P(s.note, { i: 1, c: "0B5CAD" }); });
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    save(zip([{ name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: "word/document.xml", data: doc },
      ...(imgs.length ? [{ name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imgs.map((_, i) => `<Relationship Id="rImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${i + 1}.png"/>`).join("")}</Relationships>` },
        ...imgs.map((data, i) => ({ name: `word/media/img${i + 1}.png`, data }))] : [])]), name.replace(/\.(pptx|docx)$/i, "") + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }
  let pdfLib;
  const loadPdf = () => pdfLib || (pdfLib = new Promise((ok, bad) => { if (window.html2pdf) return ok();
    const s = document.createElement("script"); s.src = "assets/vendor/html2pdf.bundle.min.js"; s.onload = ok; s.onerror = () => { pdfLib = null; bad(new Error("โหลดตัวสร้าง PDF ไม่สำเร็จ ลองใหม่อีกครั้ง")); }; document.head.appendChild(s); }));
  async function pdf(name, d) {
    await loadPdf();
    const h = v => x(v), el = document.createElement("div");
    el.style.cssText = "width:690px;padding:4px;font-family:Tahoma,'IBM Plex Sans Thai',sans-serif;color:#1F2A37;font-size:13px;line-height:1.55;background:#fff";
    el.innerHTML = `<h1 style="font-size:24px;margin:0 0 4px">${h(d.title)}</h1><div style="color:#0B5CAD;font-size:15px">${h([d.org, d.period].filter(Boolean).join(" · "))}</div><div style="color:#5B6776;font-size:11px;margin-bottom:14px">ออกรายงานเมื่อ ${h(now())}</div>` +
      deckParts(d).map(s => `<h2 style="font-size:17px;margin:16px 0 6px;border-bottom:2px solid #0B5CAD;padding-bottom:3px;page-break-after:avoid">${h(s.h)}</h2>` +
        (s.img ? `<img src="${s.img}" style="width:100%;display:block;page-break-inside:avoid" alt="">` : "") +
        (s.list ? `<ol style="margin:0;padding-left:22px">${s.list.map(t => `<li style="margin-bottom:4px;page-break-inside:avoid">${h(t)}</li>`).join("")}</ol>` : "") +
        (s.rows ? `<table style="border-collapse:collapse;width:100%;font-size:11px"><thead><tr>${s.head.map(c => `<th style="background:#DCE9F5;border:1px solid #BFCBD8;padding:4px 6px;text-align:left">${h(c)}</th>`).join("")}</tr></thead><tbody>${s.rows.map(r => `<tr style="page-break-inside:avoid">${s.head.map((_, i) => `<td style="border:1px solid #BFCBD8;padding:3px 6px;${i && isNum(r[i]) ? "text-align:right" : ""}">${h(r[i] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "") +
        (s.note ? `<p style="color:#0B5CAD;font-style:italic;margin:6px 0 0">${h(s.note)}</p>` : "")).join("");
    const sx = window.scrollX, sy = window.scrollY; window.scrollTo(0, 0);
    try { await window.html2pdf().set({ margin: [10, 10, 12, 10], filename: name.replace(/\.(pptx|pdf)$/i, "") + ".pdf", image: { type: "jpeg", quality: 0.95 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }, pagebreak: { mode: ["avoid-all", "css"] } }).from(el).save(); } finally { window.scrollTo(sx, sy); }
  }
  // every executive-summary PPT button gets a Word and a PDF button beside it; they build the very same deck
  const MORE = ["#pP", "#sP", "#moPpt", "#exPpt", "#fPpt", "#mpPpt", "#kP", "#yP", "#wP"];
  const addMore = () => MORE.forEach(sel => { const b = document.querySelector("button" + sel); if (!b || b.dataset.more) return; b.dataset.more = 1;
    [["docx", "Word (บทสรุป + วิเคราะห์)"], ["pdf", "PDF"]].reverse().forEach(([m, label]) => { const c = document.createElement("button"); c.type = "button"; c.className = b.className.replace(/\bprimary\b/, ""); c.textContent = label;
      if (b.style.alignSelf) c.style.alignSelf = b.style.alignSelf;
      c.onclick = () => { mode = m; b.click(); setTimeout(() => { mode = null; }, 0); }; b.after(c); }); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addMore); else addMore();
  // pages whose results so far had only an Excel button: PPT / Word / PDF beside it build an executive summary + analysis
  // from the very same rows the Excel file gets (the button's own handler runs; Office.table calls are collected, not saved)
  let deckBuf = null;
  const TABLE_DECK = { "op.html": ["#sCsv", "#mCsv"], "ac.html": ["#uCsv", "#cCsv"], "gate.html": ["#x"], "survey.html": ["#vCsv"], "pmboard.html": ["#x", "#rx"], "staff.html": ["#dExport", "#qExport", "#wExport"], "training.html": ["#oX", "#mX", "#sX", "#pX"], "energy.html": ["#yX", "#aX"] };
  function tableDeck(list) {
    const first = list[0], o = first.opts || {}, title = o.title || first.name.replace(/-/g, " "), many = list.length > 1;
    const d = { title, org: o.org, period: o.period, findings: [], kpis: [], analysis: [], sections: [], notes: [] };
    list.forEach(({ name, head, rows, opts = {} }) => { const a = analyze(head, rows), tag = many ? `${opts.title || name}: ` : "";
      [...(opts.findings || []), ...a.findings].forEach(f => d.findings.push(tag + f));
      a.figures.slice(0, many ? 4 : 8).forEach(([k, v]) => d.kpis.push([(many ? (opts.title || name) + " · " : "") + k, nf(v)]));
      a.groups.forEach(g => { const [t1, t2] = g.rows, n = rows.length;
        d.analysis.push(`${tag}${g.title}: แบ่งได้ ${nf(g.rows.length)} กลุ่ม กลุ่มใหญ่สุด "${t1[0]}" ${nf(t1[1])} รายการ (${t1[2]})${t2 ? ` รองลงมา "${t2[0]}" ${nf(t2[1])} (${t2[2]})` : ""}${t1[1] / n > 0.5 ? " เกินครึ่งหนึ่ง ควรดูเป็นลำดับแรก" : ""}`);
        d.sections.push({ title: tag + g.title, head: [g.title, "จำนวน", "สัดส่วน"], rows: g.rows }); });
      a.figures.filter(f => /สูงสุด$/.test(f[0])).slice(0, 3).forEach(f => d.analysis.push(`${tag}${f[0].replace(": สูงสุด", "")}: ค่าสูงสุด ${nf(f[1])} (เฉลี่ย ${nf((a.figures.find(x => x[0] === f[0].replace("สูงสุด", "เฉลี่ย")) || [])[1] ?? "-")})`));
      (opts.notes || []).forEach(t => d.notes.push(tag + t)); });
    if (!d.analysis.length) d.analysis.push("ข้อมูลชุดนี้ยังไม่มีกลุ่มหรือตัวเลขให้เปรียบเทียบ ดูรายละเอียดในไฟล์ Excel");
    d.sections = d.sections.slice(0, 8); return d;
  }
  const addDeck = () => (TABLE_DECK[(location.pathname.split("/").pop() || "")] || []).forEach(sel => { const b = document.querySelector("button" + sel); if (!b || b.dataset.deck) return; b.dataset.deck = 1;
    [["pptx", "PPT (บทสรุป + วิเคราะห์)"], ["docx", "Word (บทสรุป + วิเคราะห์)"], ["pdf", "PDF (บทสรุป)"]].reverse().forEach(([m, label]) => { const c = document.createElement("button"); c.type = "button"; c.className = b.className.replace(/\bprimary\b/, ""); c.textContent = label;
      if (b.style.alignSelf) c.style.alignSelf = b.style.alignSelf;
      c.onclick = async () => { deckBuf = []; try { b.click(); } finally { var got = deckBuf; deckBuf = null; }
        if (!got.length) return; const d = tableDeck(got), nm = got[0].name + "_บทสรุปผู้บริหาร";
        try { mode = m === "pptx" ? null : m; await pptx(nm, d); } catch (e) { alert(e.message || e); } }; b.after(c); }); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addDeck); else addDeck();
  async function pptx(name, d) {
    const m = mode; mode = null;
    if (m === "docx") return docx(name, d);
    if (m === "pdf") return pdf(name, d);
    await loadPptx();
    const p = new window.PptxGenJS(); p.layout = "LAYOUT_WIDE"; const F = "Tahoma", INK = "1F2A37", ACC = "0B5CAD", MUT = "5B6776";
    const foot = (s, i) => { s.addText(`${d.org || ""} · ${d.title}`, { x: 0.5, y: 7.0, w: 10, h: 0.3, fontFace: F, fontSize: 10, color: MUT }); s.addText(String(i), { x: 12.2, y: 7.0, w: 0.7, h: 0.3, fontFace: F, fontSize: 10, color: MUT, align: "right" }); };
    const head = (s, t) => { s.addText(t, { x: 0.5, y: 0.35, w: 12.3, h: 0.7, fontFace: F, fontSize: 26, bold: true, color: INK }); s.addShape(p.ShapeType.rect, { x: 0.5, y: 1.08, w: 1.2, h: 0.06, fill: { color: ACC }, line: { color: ACC } }); };
    const bullets = (s, list, y, h) => s.addText(list.map(t => ({ text: t, options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } })), { x: 0.6, y, w: 12.1, h, fontFace: F, fontSize: list.length > 7 ? 15 : 18, color: INK, valign: "top" });
    let n = 0, s = p.addSlide(); s.background = { color: "F4F7FB" };
    s.addText(d.title, { x: 0.7, y: 2.3, w: 12, h: 1.2, fontFace: F, fontSize: 38, bold: true, color: INK });
    s.addText([d.org, d.period].filter(Boolean).join(" · "), { x: 0.7, y: 3.5, w: 12, h: 0.6, fontFace: F, fontSize: 22, color: ACC });
    s.addText("ออกรายงานเมื่อ " + now(), { x: 0.7, y: 4.2, w: 12, h: 0.4, fontFace: F, fontSize: 14, color: MUT });
    // drawing as native PowerPoint shapes: every line and text box can be moved and edited
    const shapes = (s, svg, X, Y, Wd, Hm) => { const G = svgShapes(svg), k = Math.min(Wd / G.W, Hm / G.H), pt = u => u * k * 72; X += (Wd - G.W * k) / 2;
      G.items.forEach(it => {
        if (it.t === "line") { const x0 = Math.min(it.x1, it.x2), y0 = Math.min(it.y1, it.y2);
          s.addShape(p.ShapeType.line, { x: X + x0 * k, y: Y + y0 * k, w: Math.max(0.001, Math.abs(it.x2 - it.x1) * k), h: Math.abs(it.y2 - it.y1) * k, flipV: (it.x2 - it.x1) * (it.y2 - it.y1) < 0, line: { color: it.stroke, width: Math.max(0.5, pt(it.sw)) } }); }
        else if (it.t === "rect") s.addShape(it.rx ? p.ShapeType.roundRect : p.ShapeType.rect, { x: X + it.x * k, y: Y + it.y * k, w: it.w * k, h: it.h * k, ...(it.rx ? { rectRadius: Math.min(0.5, it.rx / Math.min(it.w, it.h)) } : {}),
          fill: it.fill ? { color: it.fill } : { type: "none" }, line: it.stroke && it.sw ? { color: it.stroke, width: pt(it.sw) } : { type: "none" } });
        else if (it.t === "tri") s.addShape(p.ShapeType.triangle, { x: X + (it.x + it.w / 2 - it.h / 2) * k, y: Y + (it.y + it.h / 2 - it.w / 2) * k, w: it.h * k, h: it.w * k, rotate: 90, fill: { color: it.fill }, line: { type: "none" } });
        else if (it.t === "text") s.addText(it.text, { x: X + it.x * k, y: Y + it.y * k, w: it.w * k, h: it.h * k, fontFace: F, fontSize: Math.round(pt(it.fs) * 10) / 10, bold: it.bold, color: it.color, align: it.al, valign: "middle", margin: 0, wrap: false }); }); };
    const secSlide = sec => { s = p.addSlide(); head(s, sec.title);
      if (!(sec.rows && sec.rows.length) && sec.svg) { shapes(s, sec.svg, 0.5, 1.3, 12.3, 5.25); if (sec.note) s.addText(sec.note, { x: 0.5, y: 6.62, w: 12.3, h: 0.35, fontFace: F, fontSize: 12, color: ACC, italic: true }); foot(s, ++n); return; }
      if (!(sec.rows && sec.rows.length)) { { const r = sec.imgR || 600 / 1400, w = Math.min(12.3, 5.27 / r); s.addImage({ data: sec.img, x: 0.5, y: 1.35, w, h: w * r }); } if (sec.note) s.addText(sec.note, { x: 0.5, y: 6.62, w: 12.3, h: 0.35, fontFace: F, fontSize: 12, color: ACC, italic: true }); foot(s, ++n); return; }
      const rows = sec.rows.slice(0, 12), withChart = sec.chart !== false && rows.length > 1 && rows.every(r => isNum(r[1]));
      const tw = withChart ? 6.2 : 12.3, cw = sec.colW || sec.head.map((_, i) => i ? (tw * 0.5) / Math.max(1, sec.head.length - 1) : tw * 0.5);
      s.addTable([sec.head.map(h => ({ text: String(h), options: { bold: true, fill: { color: "DCE9F5" }, color: INK } })), ...rows.map(r => r.map((v, i) => ({ text: String(v ?? ""), options: { align: i && !sec.left ? "right" : "left" } })))],
        { x: 0.5, y: 1.4, w: tw, colW: cw, fontFace: F, fontSize: sec.fs || (rows.length > 10 ? 11 : 13), color: INK, border: { type: "solid", color: "D5DEE9", pt: 0.75 } });
      if (withChart) s.addChart(p.ChartType.bar, [{ name: sec.head[1], labels: rows.map(r => String(r[0])).reverse(), values: rows.map(r => +r[1]).reverse() }],
        { x: 7.0, y: 1.4, w: 5.8, h: 4.6, barDir: "bar", valAxisMinVal: 0, chartColors: [ACC], catAxisLabelFontFace: F, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, showValue: true, dataLabelFontSize: 10, showLegend: false });
      if (sec.note) s.addText(sec.note, { x: 0.5, y: 6.3, w: 12.3, h: 0.55, fontFace: F, fontSize: 14, color: ACC, italic: true });
      foot(s, ++n); };
    const shown = x => (x.rows && x.rows.length) || x.img || x.svg;
    if ((d.findings || []).length) { s = p.addSlide(); head(s, "บทสรุปผู้บริหาร"); bullets(s, d.findings.slice(0, 9), 1.4, 5.4); foot(s, ++n); }
    (d.lead || []).filter(shown).forEach(secSlide);   // lead: drawings that belong to the executive summary (SWOT 4 boxes), right after it
    if ((d.kpis || []).length) { s = p.addSlide(); head(s, "ตัวเลขสำคัญ");
      d.kpis.slice(0, 12).forEach(([k, v], i) => { const cx = 0.5 + (i % 4) * 3.1, cy = 1.5 + Math.floor(i / 4) * 1.8;
        s.addShape(p.ShapeType.roundRect, { x: cx, y: cy, w: 2.9, h: 1.55, fill: { color: "F4F7FB" }, line: { color: "D5DEE9" }, rectRadius: 0.08 });
        s.addText(String(v), { x: cx + 0.15, y: cy + 0.15, w: 2.6, h: 0.75, fontFace: F, fontSize: 26, bold: true, color: ACC });
        s.addText(String(k), { x: cx + 0.15, y: cy + 0.9, w: 2.6, h: 0.5, fontFace: F, fontSize: 12, color: MUT }); }); foot(s, ++n); }
    if ((d.analysis || []).length) { s = p.addSlide(); head(s, "บทวิเคราะห์"); bullets(s, d.analysis.slice(0, 9), 1.4, 5.4); foot(s, ++n); }
    (d.sections || []).filter(shown).forEach(secSlide);
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
  // Excel sheets for the drawings of a deck (fishbone, SWOT): one sheet each, editable shapes under a title row
  const drawSheets = d => [...(d.lead || []), ...(d.sections || [])].filter(x => x.svg).map(x => ({ name: x.title.replace(/^RCA ก้างปลา 4M\s*[·:]?\s*/, "ก้างปลา "), rows: [[x.title], ...(x.note ? [[x.note]] : [])], styles: { 0: 2 }, svg: x.svg }));
  return { xlsx, table, analyze, summarySheet, pptx, docx, pdf, zip, xlsxParts, readXlsx, svgShapes, drawSheets };
})();
