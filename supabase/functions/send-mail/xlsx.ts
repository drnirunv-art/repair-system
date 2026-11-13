// Small .xlsx writer (stored zip, inline strings) and the two PM attachments. Plain JavaScript on purpose: no dependencies.
const enc = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const head = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    parts.push(new Uint8Array([0x50, 0x4b, 3, 4, ...head]), name, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...head, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, x) => s + x.length, 0);
  const all = [...parts, ...central, new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), 0, 0])];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
const x = (v) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i) => { let s = ""; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const isNum = (v) => typeof v === "number" && isFinite(v);
// sheets: [{ name, rows, bold: [row indexes], widths: [n] }]
export function xlsx(sheets) {
  const ws = (s) => {
    const bold = new Set(s.bold || []);
    const body = s.rows.map((r, ri) => `<row r="${ri + 1}">${(r || []).map((v, ci) => v == null || v === "" ? "" : isNum(v) && !bold.has(ri)
      ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"${bold.has(ri) ? ' s="1"' : ""}><is><t xml:space="preserve">${x(v)}</t></is></c>`).join("")}</row>`).join("");
    const cols = s.widths ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
  };
  const P = "http://schemas.openxmlformats.org/package/2006", O = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", CT = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${P}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${P}/relationships"><Relationship Id="rId1" Type="${O}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${O}"><sheets>${sheets.map((s, i) => `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${P}/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${O}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${O}/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE9F5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: ws(s) }))]);
}

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const TH_M = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const gridOf = (e) => e.pm_grid && Object.keys(e.pm_grid).length ? e.pm_grid : Object.fromEntries((e.pm_months || []).map((m) => [(m - 1) * 4 + (e.pm_week || 1), e.pm_freq || "M"]));
const grpOf = (e) => e.pm_group || e.system || e.eq_type || "อื่น ๆ";

// yearly master plan in the same layout as the import template (sheet PM_Plan)
export function masterPlan(code, year, equip) {
  const wk = [...Array(48)].map((_, i) => (i % 4) + 1), mh = MONTHS.flatMap((m) => [m, "", "", ""]);
  const list = equip.filter((e) => e.tag).sort((a, b) => (a.system || "").localeCompare(b.system || "") || grpOf(a).localeCompare(grpOf(b)) || a.tag.localeCompare(b.tag));
  const rows = [["MASTER PLAN PREVENTIVE MAINTENANCE"], [`PROJECT :  ${code}    ปี ${year + 543}`], ["NO.", "MACHINE NAME", "MACHINE TAG", "LOCATION", "BUILDING", "FLOOR", "PERIODES", ...mh, "SYSTEM", "MAINTAIN BY (TW/MA)", "CONTRACTOR / VENDOR"], ["", "", "", "", "", "", "", ...wk.map(String)]];
  const bold = [0, 1, 2, 3]; let g = null, n = 0;
  for (const e of list) { if (grpOf(e) !== g) { g = grpOf(e); bold.push(rows.length); rows.push([g]); }
    const grid = gridOf(e);
    rows.push([++n, e.name, e.tag, e.place || "", e.building || "", e.floor || "", [...new Set(Object.values(grid))].join("/"), ...wk.map((_, i) => grid[i + 1] || ""), e.system || "", e.pm_by || "TW", e.pm_vendor || ""]); }
  return xlsx([{ name: "PM_Plan", rows, bold, widths: [6, 38, 22, 28, 10, 8, 10, ...Array(48).fill(4), 16, 12, 22] }]);
}

// monthly PM results: summary by system and every planned machine of the month with its status
const ST = { todo: "ยังไม่ทำ", submitted: "ส่งแล้ว รอหัวหน้าเซ็น", head_signed: "หัวหน้าเซ็นแล้ว รอวิศวกร", approved: "เสร็จและอนุมัติ", returned: "ส่งกลับแก้ไข" };
export function monthResult(hname, code, year, month, follow, equip, tasks) {
  const title = `ผลงาน PM ประจำเดือน ${TH_M[month - 1]} ${year + 543}`, tot = follow.find((r) => r.grp === "รวม") || {};
  const pc = (v) => v == null ? "-" : v + "%", byEq = new Map(tasks.map((t) => [t.equipment_id, t]));
  const s1 = [[title], [`${hname} (${code})`], [], ["บทสรุปผู้บริหาร"],
    [`แผนเดือนนี้ ${tot.planned ?? 0} เครื่อง ทำเสร็จและอนุมัติแล้ว ${tot.done ?? 0} เครื่อง (${pc(tot.pct)}) รอเซ็น ${tot.waiting_sign ?? 0} ยังไม่ทำ ${tot.not_done ?? 0} พบผิดปกติ ${tot.abnormal ?? 0} ใบ`],
    [`สะสมตั้งแต่ต้นปี ทำแล้ว ${tot.ytd_done ?? 0} จากแผน ${tot.ytd_planned ?? 0} ครั้ง (${pc(tot.ytd_pct)})`], [],
    ["ระบบ", "แผนเดือนนี้ (เครื่อง)", "เสร็จและอนุมัติ", "รอเซ็น", "ยังไม่ทำ", "พบผิดปกติ (ใบ)", "% เสร็จ", "แผนสะสมทั้งปี (ครั้ง)", "ทำแล้วสะสม", "% สะสม"],
    ...follow.map((r) => [r.grp, r.planned, r.done, r.waiting_sign, r.not_done, r.abnormal, pc(r.pct), r.ytd_planned, r.ytd_done, pc(r.ytd_pct)])];
  const planned = equip.filter((e) => (e.pm_months || []).includes(month)).sort((a, b) => grpOf(a).localeCompare(grpOf(b)) || (a.tag || "").localeCompare(b.tag || ""));
  const s2 = [["ระบบ", "TAG", "เครื่อง", "อาคาร", "ชั้น", "ที่ตั้ง", "ผู้ทำ", "สัปดาห์ตามแผน", "สถานะ", "คะแนน", "ข้อผิดปกติ", "วันที่ส่งผล", "วันที่อนุมัติ"],
    ...planned.map((e) => { const t = byEq.get(e.id) || {}; const d = (v) => v ? new Date(v).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "";
      return [e.system || grpOf(e), e.tag || "", e.name, e.building || "", e.floor || "", e.place || "", e.pm_by || "TW", t.week ?? e.pm_week ?? "", ST[t.status] || "ยังไม่ทำ", t.score ?? "", t.abnormal || "", d(t.submitted_at), d(t.eng_at)]; })];
  return xlsx([{ name: "สรุปผลงาน PM", rows: s1, bold: [0, 3, 7], widths: [34, 18, 16, 10, 10, 16, 10, 20, 14, 10] }, { name: "รายเครื่อง", rows: s2, bold: [0], widths: [18, 22, 36, 10, 8, 26, 8, 14, 24, 8, 12, 14, 14] }]);
}
