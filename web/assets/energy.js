// รายงานพลังงานและความยั่งยืน (GHI, สัญญาข้อ 3.1.10, KPI 8.1): energy_monthly = one row per hospital per month typed from bills.
// Indicators: kWh / m² / day (8.1.1), water m³ per user (8.1.2, user = inpatient days + outpatient visits), kWh per inpatient day (8.1.3),
// chiller kW/TR, CO2e. "Efficiency" vs the same month last year = last year's intensity ÷ this year's × 100 (100 = same, above 100 = better).
// Daily OP meter logs of the month are summed beside the form as a cross-check (own hospital only, op_logs RLS).
(() => {
  const { sb, $, esc, errText } = RS;
  const MGR = ["owner", "admin", "chief_engineer", "supervisor"];
  const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const KEYS = ["elec_kwh", "elec_cost", "peak_kw", "chiller_kwh", "chiller_tonh", "water_m3", "water_cost", "diesel_l", "lpg_kg", "area_m2", "patient_days", "opd_visits", "waste_general_kg", "waste_infect_kg", "waste_recycle_kg"];
  const EF0 = { e: 0.4999, d: 2.7078, l: 3.1133, w: 0.5410 };
  let me = null, exec = false, hosps = [], canWrite = false, cur = "month", busy = false, rows = [], prev = [], allRows = [];
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const guard = fn => async ev => { if (ev && ev.preventDefault) ev.preventDefault(); if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const hosp = () => hosps.find(h => h.id === $("#h").value) || {};
  const Y = () => +$("#y").value;                       // CE year (DB); shown as พ.ศ.
  const mKey = (y, m) => `${y}-${String(m).padStart(2, "0")}-01`;
  const days = (y, m) => new Date(y, m, 0).getDate();
  const n = v => v === null || v === undefined || v === "" ? null : +v;
  const nf = (v, d = 0) => v == null || !isFinite(v) ? "-" : (+v).toLocaleString("th-TH", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const div = (a, b) => a != null && b ? a / b : null;
  const ef = () => ({ e: +$("#efE").value || EF0.e, d: +$("#efD").value || EF0.d, l: +$("#efL").value || EF0.l, w: +$("#efW").value || EF0.w });

  // indicators of one month row
  function ind(r, y, m) {
    if (!r) return {};
    const E = ef(), users = (n(r.patient_days) || 0) + (n(r.opd_visits) || 0);
    const co2 = [[r.elec_kwh, E.e], [r.diesel_l, E.d], [r.lpg_kg, E.l], [r.water_m3, E.w]].reduce((s, [v, f]) => v == null ? s : s + v * f, 0) / 1000;
    const wt = ["waste_general_kg", "waste_infect_kg", "waste_recycle_kg"].reduce((s, k) => s + (n(r[k]) || 0), 0);
    return { eui: div(n(r.elec_kwh), (n(r.area_m2) || 0) * days(y, m)), wpu: div(n(r.water_m3), users), epd: div(n(r.elec_kwh), n(r.patient_days)),
      kwtr: div(n(r.chiller_kwh), n(r.chiller_tonh)), co2: r.elec_kwh == null && r.water_m3 == null && r.diesel_l == null && r.lpg_kg == null ? null : co2,
      rec: wt ? (n(r.waste_recycle_kg) || 0) * 100 / wt : null, inf: div(n(r.waste_infect_kg), n(r.patient_days)) };
  }
  const eff = (now, before) => now && before ? before / now * 100 : null;   // lower intensity than last year = above 100
  const effCls = v => v == null ? "" : v >= 90 ? "ok" : v >= 80 ? "mid" : "bad";

  // ---------- boot ----------
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (me) return;
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    if (!data || !data.hospital_id) { $("#gate").hidden = false; return; }
    me = data; $("#who").textContent = `${me.full_name || ""} · ${me.hospitals.name}`;
    exec = !!(await sb.rpc("am_exec")).data;
    const mh = await sb.rpc("my_hospitals");
    hosps = (mh.data && mh.data.length ? mh.data : [me.hospitals]).map(h => ({ id: h.id, code: h.code, name: h.name }));
    $("#h").innerHTML = hosps.map(h => `<option value="${h.id}">${esc(h.code)} · ${esc(h.name)}</option>`).join("");
    $("#h").value = hosps.some(h => h.id === me.hospital_id) ? me.hospital_id : hosps[0].id; $("#h").disabled = hosps.length < 2;
    const ty = +today().slice(0, 4); $("#y").innerHTML = [ty, ty - 1, ty - 2].map(y => `<option value="${y}">${y + 543}</option>`).join("");
    $("#efE").value = EF0.e; $("#efD").value = EF0.d; $("#efL").value = EF0.l; $("#efW").value = EF0.w;
    fillMonths(); const lm = new Date(); lm.setDate(1); lm.setMonth(lm.getMonth() - 1);   // bills arrive after the month ends
    if (lm.getFullYear() === ty) $("#m").value = lm.getMonth() + 1;
    $("#tAll").hidden = !exec; $("#body").hidden = false; $("#tabs").hidden = false;
    fillWeeks(); await load(); show(new URLSearchParams(location.search).get("tab") || "week");
  }
  function fillMonths() { const ty = +today().slice(0, 4), tm = +today().slice(5, 7), last = Y() < ty ? 12 : tm;
    const keep = +$("#m").value; $("#m").innerHTML = [...Array(last)].map((_, i) => `<option value="${i + 1}">${TH_M[i]} ${Y() + 543}</option>`).join(""); $("#m").value = keep && keep <= last ? keep : last; }
  async function load() {
    const h = $("#h").value;
    canWrite = exec || (MGR.includes(me.role) && hosps.some(x => x.id === h));
    $("#ro").textContent = canWrite ? "" : "ดูได้อย่างเดียว (บันทึกได้เฉพาะหัวหน้าของโรงนี้)";
    $("#fE").querySelectorAll("input,button").forEach(i => i.disabled = !canWrite);
    ["#wSave", "#wSend", "#wCopy"].forEach(k => $(k).hidden = !canWrite); document.querySelectorAll("[data-add]").forEach(b => b.hidden = !canWrite);
    document.querySelectorAll("[data-w]").forEach(i => i.readOnly = !canWrite); ["#wCost", "#wTgt", "#wArea"].forEach(k => $(k).value = "");
    const r = await sb.from("energy_monthly").select("*").eq("hospital_id", h).gte("month", mKey(Y() - 1, 1)).lte("month", mKey(Y(), 12)); if (r.error) throw r.error;
    const all = r.data || []; rows = all.filter(x => x.month.startsWith(String(Y()))); prev = all.filter(x => x.month.startsWith(String(Y() - 1)));
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    cur = t === "all" && exec ? "all" : ["year", "month"].includes(t) ? t : "week";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    ["week", "month", "year", "all"].forEach(k => $("#tab-" + k).hidden = k !== cur);
    ({ week: rWeek, month: rMonth, year: rYear, all: rAll })[cur]().catch(e => toast(errText(e), true));
  }
  $("#h").onchange = guard(async () => { await load(); show(cur); });
  $("#y").onchange = guard(async () => { fillMonths(); await load(); show(cur); });
  $("#m").onchange = () => rMonth().catch(e => toast(errText(e), true));
  ["#efE", "#efD", "#efL", "#efW"].forEach(s => $(s).oninput = () => { if (cur === "year") rYear(); });

  // ---------- บันทึกรายเดือน ----------
  const thisRow = m => rows.find(x => x.month === mKey(Y(), m));
  const lastRow = m => prev.find(x => x.month === mKey(Y() - 1, m));
  let opVals = null;
  async function rMonth() {
    const m = +$("#m").value, r = thisRow(m) || {};
    $("#fE").querySelectorAll("[data-k]").forEach(i => i.value = r[i.dataset.k] ?? "");
    $("#msg").textContent = r.updated_at ? `บันทึกล่าสุด ${new Date(r.updated_at).toLocaleString("th-TH")}` : "ยังไม่ได้บันทึกเดือนนี้";
    renderMk(); await opBox(m);
  }
  function formRow() { const o = {}; $("#fE").querySelectorAll("[data-k]").forEach(i => { o[i.dataset.k] = i.dataset.k === "note" ? (i.value.trim() || null) : (i.value === "" ? null : +i.value); }); return o; }
  function renderMk() {
    const m = +$("#m").value, I = ind(formRow(), Y(), m), L = ind(lastRow(m), Y() - 1, m);
    const t = [["ไฟฟ้าต่อพื้นที่ต่อวัน", I.eui, 3, "kWh/ตร.ม./วัน", L.eui], ["น้ำต่อผู้ใช้", I.wpu, 3, "m³/คน", L.wpu], ["ไฟฟ้าต่อวันนอนผู้ป่วย", I.epd, 1, "kWh/วันนอน", L.epd],
      ["Chiller", I.kwtr, 2, "kW/TR", L.kwtr], ["ก๊าซเรือนกระจก", I.co2, 1, "tCO₂e", L.co2], ["ขยะรีไซเคิล", I.rec, 1, "% ของขยะทั้งหมด", null]];
    $("#mk").innerHTML = t.map(([l, v, d, u, b]) => { const e = l === "ขยะรีไซเคิล" || l === "ก๊าซเรือนกระจก" ? null : eff(v, b);
      return `<div class="kpi"><b>${nf(v, d)}</b><span>${esc(l)} (${esc(u)})${e != null ? `<br>เทียบปีก่อน ${nf(e, 1)}%` : ""}</span></div>`; }).join("");
  }
  $("#fE").addEventListener("input", renderMk);
  async function opBox(m) {
    opVals = null; const H = hosp();
    if (H.id !== me.hospital_id) { $("#op").innerHTML = `<b>บันทึก OP</b> <span class="sub">ดูยอดมิเตอร์ OP ได้เฉพาะโรงที่สังกัด (${esc(me.hospitals.code)})</span>`; return; }
    const a = mKey(Y(), m), b = `${Y()}-${String(m).padStart(2, "0")}-${days(Y(), m)}`;
    const [f, p, l] = await Promise.all([sb.from("op_forms").select("id,code"), sb.from("op_points").select("id,form_id,name,active").eq("hospital_id", H.id),
      sb.from("op_logs").select("point_id,log_date,values,usage").eq("hospital_id", H.id).gte("log_date", a).lte("log_date", b)]);
    const forms = f.data || [], pts = p.data || [], logs = l.data || [], code = id => (forms.find(x => x.id === id) || {}).code;
    const sum = (fc, k) => { let s = 0, d = 0; logs.forEach(x => { const pt = pts.find(q => q.id === x.point_id); if (!pt || code(pt.form_id) !== fc) return; const v = (x.usage || {})[k]; if (v != null) { s += +v; d++; } }); return d ? { s, d } : null; };
    const chil = (() => { let k = 0, d = 0; logs.forEach(x => { const pt = pts.find(q => q.id === x.point_id); if (!pt || code(pt.form_id) !== "OP-12") return; const kw = n((x.values || {}).kw), hr = n((x.usage || {}).hr); if (kw != null && hr != null) { k += kw * hr; d++; } }); return d ? { s: k, d } : null; })();
    const mdb = sum("OP-01", "kwh"), sub = sum("OP-22E", "kwh"), wat = sum("OP-22W", "m3");
    opVals = { elec_kwh: mdb && mdb.s, water_m3: wat && wat.s, chiller_kwh: chil && chil.s };
    const line = (l, v, u) => `<tr><td>${l}</td><td>${v ? `<b>${nf(v.s, 1)}</b> ${u}` : "-"}</td><td class="sub">${v ? `จาก ${v.d} วัน-จุด` : "ยังไม่มีบันทึก"}</td></tr>`;
    $("#op").innerHTML = `<b>ยอดจากบันทึก OP ของเดือนนี้ (ใช้เทียบกับบิล)</b><table>${line("ไฟฟ้าตู้ MDB (OP-01)", mdb, "kWh")}${line("มิเตอร์ไฟย่อยรวม (OP-22E)", sub, "kWh")}${line("มิเตอร์น้ำย่อยรวม (OP-22W)", wat, "m³")}${line("Chiller ประมาณ kW × ชั่วโมงเดิน (OP-12)", chil, "kWh")}</table>
      ${canWrite && (mdb || wat || chil) ? `<button class="btn small" type="button" id="useOp">ใช้ค่าจาก OP กรอกช่องที่ยังว่าง</button>` : ""}<div class="sub">ถ้าบันทึก OP ไม่ครบทุกวัน ยอดจะต่ำกว่าบิล ให้ยึดตัวเลขตามบิลเป็นหลัก</div>`;
    const u = $("#useOp"); if (u) u.onclick = () => { Object.entries(opVals).forEach(([k, v]) => { const i = $(`#fE [data-k="${k}"]`); if (v != null && i.value === "") i.value = Math.round(v * 10) / 10; }); renderMk(); };
  }
  $("#copyBase").onclick = () => { const m = +$("#m").value, p = m > 1 ? thisRow(m - 1) : lastRow(12); if (!p || p.area_m2 == null) { toast("เดือนก่อนยังไม่มีพื้นที่", true); return; } $('#fE [data-k="area_m2"]').value = p.area_m2; renderMk(); };
  $("#fE").onsubmit = guard(async () => {
    const row = { ...formRow(), hospital_id: $("#h").value, month: mKey(Y(), +$("#m").value), updated_by: me.id, updated_at: new Date().toISOString() };
    if (KEYS.every(k => row[k] == null)) throw new Error("ยังไม่ได้กรอกตัวเลข");
    const { error } = await sb.from("energy_monthly").upsert(row, { onConflict: "hospital_id,month" }); if (error) throw error;
    await load(); await rMonth(); toast(`บันทึก ${TH_M[+$("#m").value - 1]} ${Y() + 543} แล้ว`);
  });

  // ---------- สรุปรายปี ----------
  const tot = (list, k) => { const v = list.map(x => n(x[k])).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  function yearData() {
    return [...Array(12)].map((_, i) => { const m = i + 1, r = thisRow(m), p = lastRow(m), I = ind(r, Y(), m), P = ind(p, Y() - 1, m);
      return { m, r, p, I, P, e1: eff(I.eui, P.eui), e2: eff(I.wpu, P.wpu), e3: eff(I.epd, P.epd) }; });
  }
  async function rYear() {
    const D = yearData(), has = D.filter(x => x.r), E = ef();
    const kwh = tot(rows, "elec_kwh"), kwhP = tot(prev.filter(p => has.some(x => x.m === +p.month.slice(5, 7))), "elec_kwh"), m3 = tot(rows, "water_m3"), cost = (tot(rows, "elec_cost") || 0) + (tot(rows, "water_cost") || 0);
    const co2 = has.reduce((s, x) => s + (x.I.co2 || 0), 0), avg = k => { const v = has.map(x => x[k]).filter(v => v != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    $("#yNote").innerHTML = `<b>${esc(hosp().code || "")} ปี ${Y() + 543}</b>: กรอกแล้ว ${has.length} เดือน · ตัวเลข "เทียบปีก่อน" = ค่าต่อหน่วยของปีก่อน ÷ ปีนี้ × 100 (เกิน 100 = ใช้น้อยลง ดีขึ้น) ใช้ประกอบการกรอก KPI ข้อ 8.1.1–8.1.3 ในหน้า <a href="kpi.html">KPI ตามสัญญา</a> ให้หัวหน้าตรวจทานนิยามตามสัญญาของโรงอีกครั้ง`;
    $("#yk").innerHTML = [["ไฟฟ้ารวม (kWh)", nf(kwh), kwh != null && kwhP ? `${kwh > kwhP ? "▲" : "▼"} ${nf(Math.abs(kwh - kwhP) * 100 / kwhP, 1)}% จากเดือนเดียวกันปีก่อน` : ""], ["น้ำรวม (m³)", nf(m3), ""], ["ค่าไฟ + ค่าน้ำ (บาท)", nf(cost), ""],
      ["ก๊าซเรือนกระจก (tCO₂e)", nf(has.length ? co2 : null, 1), ""], ["เฉลี่ย 8.1.1 เทียบปีก่อน", avg("e1") == null ? "-" : nf(avg("e1"), 1) + "%", ""], ["เฉลี่ย 8.1.3 เทียบปีก่อน", avg("e3") == null ? "-" : nf(avg("e3"), 1) + "%", ""]]
      .map(([l, v, s]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}${s ? "<br>" + esc(s) : ""}</span></div>`).join("");
    chart(D);
    $("#yTable").innerHTML = `<tr><th>เดือน</th><th>ไฟฟ้า kWh</th><th>ค่าไฟ บาท</th><th>Peak kW</th><th>น้ำ m³</th><th>ดีเซล ลิตร</th><th>LPG กก.</th><th>kWh/ตร.ม./วัน</th><th>m³/คน</th><th>kWh/วันนอน</th><th>kW/TR</th><th>tCO₂e</th><th>ขยะติดเชื้อ กก./วันนอน</th><th>รีไซเคิล %</th></tr>` +
      D.map(x => `<tr><td>${TH_M[x.m - 1]}</td>${["elec_kwh", "elec_cost", "peak_kw", "water_m3", "diesel_l", "lpg_kg"].map(k => `<td>${nf(x.r && n(x.r[k]))}</td>`).join("")}<td>${nf(x.I.eui, 3)}</td><td>${nf(x.I.wpu, 3)}</td><td>${nf(x.I.epd, 1)}</td><td>${nf(x.I.kwtr, 2)}</td><td>${nf(x.I.co2, 1)}</td><td>${nf(x.I.inf, 2)}</td><td>${nf(x.I.rec, 1)}</td></tr>`).join("") +
      `<tr class="sum"><td>รวม</td>${["elec_kwh", "elec_cost", null, "water_m3", "diesel_l", "lpg_kg"].map(k => `<td>${k ? nf(tot(rows, k)) : ""}</td>`).join("")}<td colspan="4"></td><td>${nf(has.length ? co2 : null, 1)}</td><td colspan="2"></td></tr>`;
    const c = v => `<td class="${effCls(v)}">${v == null ? "-" : nf(v, 1) + "%"}</td>`;
    $("#yCmp").innerHTML = `<tr><th>เดือน</th><th>kWh/ตร.ม./วัน ปีนี้</th><th>ปีก่อน</th><th>8.1.1</th><th>m³/คน ปีนี้</th><th>ปีก่อน</th><th>8.1.2</th><th>kWh/วันนอน ปีนี้</th><th>ปีก่อน</th><th>8.1.3</th></tr>` +
      D.map(x => `<tr><td>${TH_M[x.m - 1]}</td><td>${nf(x.I.eui, 3)}</td><td>${nf(x.P.eui, 3)}</td>${c(x.e1)}<td>${nf(x.I.wpu, 3)}</td><td>${nf(x.P.wpu, 3)}</td>${c(x.e2)}<td>${nf(x.I.epd, 1)}</td><td>${nf(x.P.epd, 1)}</td>${c(x.e3)}</tr>`).join("");
  }
  function chart(D) {
    const W = 760, H = 240, L = 56, B = 30, max = Math.max(1, ...D.flatMap(x => [n(x.r && x.r.elec_kwh) || 0, n(x.p && x.p.elec_kwh) || 0])), bw = (W - L - 10) / 12;
    const yv = v => H - B - (v / max) * (H - B - 20);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ไฟฟ้ารายเดือน ปีนี้เทียบปีก่อน"><text x="${L}" y="14" font-size="12" fill="#17212b">ไฟฟ้า kWh รายเดือน</text>
      <rect x="${W - 210}" y="5" width="10" height="10" fill="#0b5cad"/><text x="${W - 195}" y="14" font-size="12" fill="#17212b">ปี ${Y() + 543}</text><rect x="${W - 120}" y="5" width="10" height="10" fill="#b8c4d2"/><text x="${W - 105}" y="14" font-size="12" fill="#17212b">ปี ${Y() + 542}</text>`;
    [0, .5, 1].forEach(f => { const y = yv(max * f); s += `<line x1="${L}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="#e5e9f0"/><text x="${L - 6}" y="${y + 4}" font-size="11" text-anchor="end" fill="#4b5563">${nf(max * f)}</text>`; });
    D.forEach((x, i) => { const x0 = L + i * bw + 4, w = (bw - 10) / 2, a = n(x.p && x.p.elec_kwh), b = n(x.r && x.r.elec_kwh);
      if (a != null) s += `<rect x="${x0}" y="${yv(a)}" width="${w}" height="${H - B - yv(a)}" fill="#b8c4d2"><title>${TH_M[i]} ${Y() + 542}: ${nf(a)} kWh</title></rect>`;
      if (b != null) s += `<rect x="${x0 + w + 2}" y="${yv(b)}" width="${w}" height="${H - B - yv(b)}" fill="#0b5cad"><title>${TH_M[i]} ${Y() + 543}: ${nf(b)} kWh</title></rect>`;
      s += `<text x="${x0 + w}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#17212b">${TH_M[i]}</text>`; });
    $("#yChart").innerHTML = s + "</svg>";
  }
  $("#yX").onclick = () => { const D = yearData(), has = D.filter(x => x.r), E = ef(), kwh = tot(rows, "elec_kwh"), m3 = tot(rows, "water_m3"), co2 = has.reduce((s, x) => s + (x.I.co2 || 0), 0);
    const good = has.filter(x => x.e1 != null), worst = good.slice().sort((a, b) => a.e1 - b.e1)[0], per = `${hosp().code || ""} · ปี ${Y() + 543}`;
    const findings = [`กรอกข้อมูลแล้ว ${has.length} จาก 12 เดือน ไฟฟ้ารวม ${nf(kwh)} kWh น้ำรวม ${nf(m3)} m³ ก๊าซเรือนกระจก ${nf(co2, 1)} tCO₂e`];
    if (good.length) findings.push(`ไฟฟ้าต่อพื้นที่ต่อวัน เทียบเดือนเดียวกันปีก่อน เฉลี่ย ${nf(good.reduce((s, x) => s + x.e1, 0) / good.length, 1)}% (เกิน 100 = ใช้น้อยลง)`);
    if (worst && worst.e1 < 90) findings.push(`เดือนที่ใช้ไฟต่อพื้นที่เพิ่มมากที่สุด: ${TH_M[worst.m - 1]} (${nf(worst.e1, 1)}%) ควรหาสาเหตุ เช่น อากาศร้อน ภาระ Chiller พื้นที่เปิดใหม่`);
    Office.table(`พลังงาน_${hosp().code || ""}_${Y() + 543}`, ["เดือน", "ไฟฟ้า kWh", "ค่าไฟ บาท", "Peak kW", "น้ำ m³", "ค่าน้ำ บาท", "ดีเซล ลิตร", "LPG กก.", "พื้นที่ ตร.ม.", "วันนอน", "ผู้ป่วยนอก", "kWh/ตร.ม./วัน", "m³/คน", "kWh/วันนอน", "kW/TR", "tCO₂e", "รีไซเคิล %", "8.1.1 เทียบปีก่อน %", "8.1.2 เทียบปีก่อน %", "8.1.3 เทียบปีก่อน %", "หมายเหตุ"],
      D.map(x => { const r = x.r || {}, r1 = v => v == null ? "" : Math.round(v * 1000) / 1000; return [TH_M[x.m - 1], ...["elec_kwh", "elec_cost", "peak_kw", "water_m3", "water_cost", "diesel_l", "lpg_kg", "area_m2", "patient_days", "opd_visits"].map(k => r[k] ?? ""),
        r1(x.I.eui), r1(x.I.wpu), r1(x.I.epd), r1(x.I.kwtr), r1(x.I.co2), r1(x.I.rec), r1(x.e1), r1(x.e2), r1(x.e3), r.note || ""]; }),
      { title: "รายงานพลังงานและความยั่งยืน (GHI)", period: per, findings,
        notes: [`ค่า CO₂e ใช้ไฟฟ้า ${E.e} kgCO₂e/kWh · ดีเซล ${E.d}/ลิตร · LPG ${E.l}/กก. · น้ำ ${E.w}/m³ (ค่าตั้งต้น TGO ตรวจทานก่อนใช้ทางการ)`, "ผู้ใช้น้ำ = วันนอนผู้ป่วยใน + ผู้ป่วยนอก", "เทียบปีก่อน = ค่าต่อหน่วยปีก่อน ÷ ปีนี้ × 100"] }); };

  // ---------- ภาพรวม 12 โรง ----------
  async function rAll() {
    await rAllWeek();
    const r = await sb.from("energy_monthly").select("*").gte("month", mKey(Y(), 1)).lte("month", mKey(Y(), 12)); if (r.error) throw r.error;
    const list = r.data || [], H = await sb.from("hospitals").select("id,code,name").order("code"); const hs = (H.data || hosps);
    allRows = hs.map(h => { const xs = list.filter(x => x.hospital_id === h.id), eu = xs.filter(x => x.elec_kwh != null && x.area_m2), pd = xs.filter(x => x.elec_kwh != null && x.patient_days);
      const co2 = xs.reduce((s, x) => s + (ind(x, Y(), +x.month.slice(5, 7)).co2 || 0), 0);
      return [h.code, h.name, xs.length, tot(xs, "elec_kwh"), tot(xs, "water_m3"), (tot(xs, "elec_cost") || 0) + (tot(xs, "water_cost") || 0) || null,
        eu.length ? eu.reduce((s, x) => s + x.elec_kwh / (x.area_m2 * days(Y(), +x.month.slice(5, 7))), 0) / eu.length : null,
        pd.length ? tot(pd, "elec_kwh") / tot(pd, "patient_days") : null, xs.length ? co2 : null]; });
    $("#aTable").innerHTML = `<tr><th>โรง</th><th>เดือนที่กรอก</th><th>ไฟฟ้า kWh</th><th>น้ำ m³</th><th>ค่าไฟ + ค่าน้ำ บาท</th><th>kWh/ตร.ม./วัน เฉลี่ย</th><th>kWh/วันนอน</th><th>tCO₂e</th></tr>` +
      allRows.map(a => `<tr><td>${esc(a[0])} · ${esc(a[1])}</td><td>${a[2]}</td><td>${nf(a[3])}</td><td>${nf(a[4])}</td><td>${nf(a[5])}</td><td>${nf(a[6], 3)}</td><td>${nf(a[7], 1)}</td><td>${nf(a[8], 1)}</td></tr>`).join("");
  }
  $("#aX").onclick = () => { const withData = allRows.filter(a => a[2]);
    Office.table(`พลังงาน_12โรง_${Y() + 543}`, ["รหัส", "โรงพยาบาล", "เดือนที่กรอก", "ไฟฟ้า kWh", "น้ำ m³", "ค่าไฟ + ค่าน้ำ บาท", "kWh/ตร.ม./วัน", "kWh/วันนอน", "tCO₂e"],
      allRows.map(a => a.map((v, i) => i > 5 && v != null ? Math.round(v * 1000) / 1000 : v ?? "")),
      { title: "รายงานพลังงาน ภาพรวม 12 โรง", period: `ปี ${Y() + 543}`, findings: [`มีข้อมูล ${withData.length} จาก ${allRows.length} โรง`, `ไฟฟ้ารวม ${nf(withData.reduce((s, a) => s + (a[3] || 0), 0))} kWh · ก๊าซเรือนกระจกรวม ${nf(withData.reduce((s, a) => s + (a[8] || 0), 0), 1)} tCO₂e`] }); };

  // ---------- ประชุม Energy รายสัปดาห์ (Chief sends by Saturday 10:00, meeting 14:00-16:00) ----------
  // Daily kWh = sum of OP usage (kWh) of meters the Chief marks "ไฟเข้า"; baseline = same month last year from the bill (energy_monthly).
  // On save the figures are kept in data.snap so execs (who cannot read another hospital's op_logs) see the same numbers.
  const ELEC = ["OP-01", "OP-02", "OP-22E"], ROLE = { in: "ไฟเข้า (MEA / MDB)", solar: "โซลาร์เซลล์", out: "ไฟออก (EMDB / มิเตอร์ย่อย)", skip: "ไม่นับ" };
  let wk = null, wkPrevRow = null, wData = {}, wCalc = null, wImg = null;
  const iso = d => d.toLocaleDateString("en-CA");
  const addDays = (s, k) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + k); return iso(d); };
  const dTH = s => s ? new Date(s + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";
  const deadline = s => new Date(s + "T10:00:00+07:00");
  function fillWeeks() {
    const t = new Date(today() + "T00:00:00"), next = new Date(t); next.setDate(t.getDate() + ((6 - t.getDay() + 7) % 7));
    const list = [...Array(10)].map((_, i) => { const d = new Date(next); d.setDate(next.getDate() - 7 * i); return iso(d); });
    const opt = list.map(s => `<option value="${s}">${dTH(s)}</option>`).join(""); $("#wk").innerHTML = opt; $("#awk").innerHTML = opt;
  }
  const status = r => !r || !r.submitted_at ? (r ? ["draft", "ร่าง ยังไม่ส่ง"] : ["none", "ยังไม่มีรายงาน"])
    : new Date(r.submitted_at) <= deadline(r.week_date) ? ["ok", "ส่งตรงเวลา " + new Date(r.submitted_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })]
    : ["late", "ส่งช้า " + new Date(r.submitted_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })];
  $("#wk").onchange = () => rWeek().catch(e => toast(errText(e), true));
  $("#awk").onchange = () => rAll().catch(e => toast(errText(e), true));

  async function rWeek() {
    const h = $("#h").value, sat = $("#wk").value;
    const r = await sb.from("energy_weekly").select("*").eq("hospital_id", h).gte("week_date", addDays(sat, -7)).lte("week_date", sat); if (r.error) throw r.error;
    wk = (r.data || []).find(x => x.week_date === sat) || null; wkPrevRow = (r.data || []).find(x => x.week_date === addDays(sat, -7)) || null;
    wData = JSON.parse(JSON.stringify((wk && wk.data) || {})); wData.prev = wData.prev || []; wData.meas = wData.meas || []; wData.roles = wData.roles || {};
    const st = status(wk); $("#wStat").innerHTML = `<span class="st ${st[0]}">${esc(st[1])}</span> <span class="sub">กำหนดส่ง ${dTH(sat)} 10.00 น.</span>`;
    document.querySelectorAll("[data-w]").forEach(i => i.value = wData[i.dataset.w] || "");
    await wNumbers(); rows2("prev"); rows2("meas"); drawChk(); drawAi();
    $("#wMsg").textContent = wk ? `บันทึกล่าสุด ${new Date(wk.updated_at).toLocaleString("th-TH")}` : "";
  }

  async function wNumbers() {
    const h = $("#h").value, H = hosp(), sat = $("#wk").value, fri = addDays(sat, -1), endD = fri < today() ? fri : addDays(today(), -1);
    const m0 = fri.slice(0, 8) + "01", y = +fri.slice(0, 4), mo = +fri.slice(5, 7), ly = `${y - 1}-${fri.slice(5, 8)}01`;
    const em = await sb.from("energy_monthly").select("*").eq("hospital_id", h).gte("month", `${y - 1}-01-01`).lte("month", `${y}-12-01`);
    const E = em.data || [], base = E.find(x => x.month === ly), lastArea = E.filter(x => x.area_m2).sort((a, b) => b.month.localeCompare(a.month))[0];
    if (!$("#wCost").value) $("#wCost").value = wData.cost ?? (base && base.elec_cost && base.elec_kwh ? Math.round(base.elec_cost / base.elec_kwh * 100) / 100 : 4);
    if (!$("#wTgt").value) $("#wTgt").value = wData.tgt ?? 5;
    if (!$("#wArea").value) $("#wArea").value = wData.area ?? (lastArea ? lastArea.area_m2 : "");
    const own = h === me.hospital_id; let pts = [], days = {};
    if (own) {
      const [f, p, l] = await Promise.all([sb.from("op_forms").select("id,code"), sb.from("op_points").select("id,form_id,name,active,meter_no").eq("hospital_id", h),
        sb.from("op_logs").select("point_id,log_date,usage").eq("hospital_id", h).gte("log_date", m0 < addDays(sat, -7) ? m0 : addDays(sat, -7)).lte("log_date", endD)]);
      const fc = id => ((f.data || []).find(x => x.id === id) || {}).code;
      pts = (p.data || []).filter(x => ELEC.includes(fc(x.form_id))).map(x => ({ id: x.id, name: x.name, no: x.meter_no, code: fc(x.form_id), role: wData.roles[x.id] || (fc(x.form_id) === "OP-01" ? "in" : fc(x.form_id) === "OP-02" ? "out" : "skip") }));
      (l.data || []).forEach(x => { const pt = pts.find(q => q.id === x.point_id), v = n((x.usage || {}).kwh); if (!pt || v == null) return; const d = days[x.log_date] = days[x.log_date] || { in: 0, solar: 0, out: 0, n: {} }; if (pt.role !== "skip") d[pt.role] += v; d.n[pt.id] = v; });
    }
    if (!own && wData.snap) { wCalc = wData.snap; } else {
      const mDays = Object.keys(days).filter(d => d >= m0 && d <= endD && days[d].in > 0).sort(), wDays = Object.keys(days).filter(d => d >= addDays(sat, -7) && d <= fri && days[d].in > 0);
      const mtd = mDays.reduce((s, d) => s + days[d].in, 0), avg = mDays.length ? mtd / mDays.length : null, nd = new Date(y, mo, 0).getDate();
      const bDay = base && base.elec_kwh ? base.elec_kwh / nd : null, tgt = +$("#wTgt").value || 0, cost = +$("#wCost").value || 0, area = +$("#wArea").value || 0;
      const mx = mDays.slice().sort((a, b) => days[b].in - days[a].in)[0], mn = mDays.slice().sort((a, b) => days[a].in - days[b].in)[0];
      const ytdMonths = E.filter(x => x.month.startsWith(y + "-") && x.month < m0 && x.elec_kwh != null), ytd = ytdMonths.reduce((s, x) => s + +x.elec_kwh, 0);
      const ytdL = E.filter(x => x.month.startsWith((y - 1) + "-") && ytdMonths.some(z => z.month.slice(5) === x.month.slice(5)) && x.elec_kwh != null).reduce((s, x) => s + +x.elec_kwh, 0);
      const solar = mDays.reduce((s, d) => s + days[d].solar, 0), wk7 = wDays.reduce((s, d) => s + days[d].in, 0);
      wCalc = { month: `${TH_M[mo - 1]} ${y + 543}`, from: m0, to: endD, nDays: mDays.length, mtd, avg, bDay, bMonth: base ? +base.elec_kwh : null, tgt, cost, area,
        tDay: bDay != null ? bDay * (1 - tgt / 100) : null, saveMonth: base ? base.elec_kwh * tgt / 100 : null, mx: mx ? [mx, days[mx].in] : null, mn: mn ? [mn, days[mn].in] : null,
        ytd: ytdMonths.length ? ytd : null, ytdL: ytdL || null, ytdN: ytdMonths.length, solar, wk7, wkN: wDays.length,
        expDays: endD >= m0 ? +endD.slice(8) : 0, lastBill: !!E.find(x => x.month === (mo === 1 ? `${y - 1}-12-01` : `${y}-${String(mo - 1).padStart(2, "0")}-01`) && x.elec_kwh != null),
        days: Object.keys(days).filter(d => d >= m0 && d <= endD).sort().map(d => [d, days[d].in, days[d].solar, days[d].out]),
        pts: pts.map(p => { const v = mDays.map(d => days[d].n[p.id]).filter(x => x != null); return { id: p.id, name: p.name, no: p.no, code: p.code, role: p.role, avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }; }) };
    }
    const C = wCalc, ch = C.avg != null && C.bDay ? (C.avg - C.bDay) * 100 / C.bDay : null, yc = C.ytd != null && C.ytdL ? (C.ytd - C.ytdL) * 100 / C.ytdL : null;
    $("#wk1").innerHTML = [[`ไฟฟ้า ${C.month} (1 – ${dTH(C.to)}, ${C.nDays} วัน)`, nf(C.mtd), C.mtd && C.cost ? `≈ ${nf(C.mtd * C.cost)} บาท` : ""],
      ["เฉลี่ยต่อวัน (kWh)", nf(C.avg), ch != null ? `${ch > 0 ? "▲ +" : "▼ "}${nf(ch, 1)}% จาก ${C.month.split(" ")[0]} ปีก่อน (${nf(C.bDay)}/วัน)` : "ยังไม่มีบิลเดือนเดียวกันปีก่อน"],
      [`เป้าหมาย ประหยัด ${C.tgt}% (kWh/วัน)`, nf(C.tDay), C.saveMonth != null ? `เท่ากับ ${nf(C.saveMonth)} kWh/เดือน` : ""],
      ["สูงสุด / ต่ำสุด (kWh/วัน)", C.mx ? `${nf(C.mx[1])} / ${nf(C.mn[1])}` : "-", C.mx ? `วันที่ ${+C.mx[0].slice(8)} / วันที่ ${+C.mn[0].slice(8)}` : ""],
      [`สัปดาห์นี้ (${C.wkN} วัน)`, nf(C.wk7), C.wk7 && C.cost ? `≈ ${nf(C.wk7 * C.cost)} บาท` : ""],
      [`ตั้งแต่ ม.ค. (${C.ytdN} เดือน ตามบิล)`, nf(C.ytd), yc != null ? `${yc > 0 ? "▲ +" : "▼ "}${nf(yc, 1)}% จากปีก่อน (${nf(C.ytdL)})` : ""]]
      .map(([l, v, s2]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}${s2 ? "<br>" + esc(s2) : ""}</span></div>`).join("");
    wImg = null; if (C.days.length) { const g = dayChart(C); toPng(g.svg, g.w * 2, g.h * 2).then(x => { wImg = x; }); }
    $("#wChart").innerHTML = C.days.length ? dayChart(C).svg : `<p class="sub">ยังไม่มีบันทึกมิเตอร์ไฟฟ้ารายวันใน "บันทึก OP" ของเดือนนี้${own ? "" : ` (ดูยอดรายวันได้เฉพาะโรงที่สังกัด หรือหลังจาก Chief กดบันทึก)`} ให้ช่างเพิ่มจุดตรวจแบบ OP-01 (MDB) หรือ OP-22E (มิเตอร์ไฟ) แล้วจดเลขมิเตอร์ทุกวัน</p>`;
    $("#wPts").innerHTML = `<tr><th>มิเตอร์</th><th>แบบ</th><th>นับเป็น</th><th>เฉลี่ย kWh/วัน</th><th>สัดส่วนในกลุ่ม</th></tr>` + (C.pts.length ? C.pts.map(p => { const g = C.pts.filter(q => q.role === p.role).reduce((s, q) => s + (q.avg || 0), 0);
      return `<tr><td>${esc(p.name)}${p.no ? ` <span class="sub">No.${esc(p.no)}</span>` : ""}</td><td>${esc(p.code)}</td><td>${canWrite && own ? `<select data-role="${p.id}">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}"${k === p.role ? " selected" : ""}>${v}</option>`).join("")}</select>` : esc(ROLE[p.role])}</td>
        <td>${nf(p.avg)}</td><td>${p.role !== "skip" && g && p.avg != null ? nf(p.avg * 100 / g, 0) + "%" : ""}</td></tr>`; }).join("") : `<tr><td colspan="5">ยังไม่มีมิเตอร์ไฟฟ้าใน "บันทึก OP"</td></tr>`);
    $("#wk2").innerHTML = [["kWh/ตร.ม./วัน (เดือนนี้)", nf(C.avg != null && C.area ? C.avg / C.area : null, 3), C.area ? `พื้นที่ ${nf(C.area)} ตร.ม.` : "ใส่พื้นที่ด้านบน"],
      ["โซลาร์เซลล์ (kWh เดือนนี้)", nf(C.solar || null), C.solar && C.nDays ? `${nf(C.solar / C.nDays)} kWh/วัน` : ""],
      ["ค่าไฟฟ้าโดยประมาณ (บาท/วัน)", nf(C.avg != null && C.cost ? C.avg * C.cost : null), `ต้นทุน ${C.cost} บาท/หน่วย`]]
      .map(([l, v, s2]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}${s2 ? "<br>" + esc(s2) : ""}</span></div>`).join("");
    document.querySelectorAll("[data-role]").forEach(sel => sel.onchange = () => { wData.roles[sel.dataset.role] = sel.value; wNumbers().catch(e => toast(errText(e), true)); });
    drawChk();
  }
  ["#wCost", "#wTgt", "#wArea"].forEach(k => $(k).onchange = () => { wData.snap = null; wNumbers().catch(e => toast(errText(e), true)); });
  function dayChart(C) {
    const W = 900, H = 260, L = 60, B = 34, ds = C.days, max = Math.max(1, ...ds.map(d => d[1]), C.bDay || 0), bw = (W - L - 10) / Math.max(ds.length, 1);
    const yv = v => H - B - (v / max) * (H - B - 26);
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Tahoma,sans-serif" role="img" aria-label="ไฟฟ้ารายวัน"><rect width="${W}" height="${H}" fill="#fff"/><text x="${L}" y="16" font-size="13" fill="#17212b">ไฟฟ้ารายวัน (kWh) ${esc(C.month)}</text>`;
    [0, .5, 1].forEach(f => { const y = yv(max * f); s += `<line x1="${L}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="#e5e9f0"/><text x="${L - 6}" y="${y + 4}" font-size="11" text-anchor="end" fill="#4b5563">${nf(max * f)}</text>`; });
    ds.forEach((d, i) => { const x0 = L + i * bw + 2, w = Math.max(2, bw - 4), over = C.tDay != null && d[1] > C.tDay;
      s += `<rect x="${x0}" y="${yv(d[1])}" width="${w}" height="${H - B - yv(d[1])}" fill="${over ? "#c2410c" : "#0b5cad"}"><title>${dTH(d[0])}: ${nf(d[1])} kWh</title></rect><text x="${x0 + w / 2}" y="${H - 18}" font-size="10" text-anchor="middle" fill="#17212b">${+d[0].slice(8)}</text>`; });
    if (C.bDay) s += `<line x1="${L}" x2="${W - 10}" y1="${yv(C.bDay)}" y2="${yv(C.bDay)}" stroke="#6b7280" stroke-dasharray="6 4"/><text x="${L + 4}" y="${yv(C.bDay) - 4}" font-size="11" fill="#374151" stroke="#fff" stroke-width="3" paint-order="stroke">ปีก่อน ${nf(C.bDay)}/วัน</text>`;
    if (C.tDay) s += `<line x1="${L}" x2="${W - 10}" y1="${yv(C.tDay)}" y2="${yv(C.tDay)}" stroke="#15803d" stroke-width="2"/><text x="${L + 4}" y="${yv(C.tDay) + 14}" font-size="11" fill="#15803d" stroke="#fff" stroke-width="3" paint-order="stroke">เป้าหมาย ${nf(C.tDay)}/วัน</text>`;
    s += `<text x="${L}" y="${H - 3}" font-size="11" fill="#374151">แท่งสีส้ม = วันที่ใช้เกินเป้าหมาย</text>`;
    return { svg: s + "</svg>", w: W, h: H };
  }
  // editable rows: 1 วาระครั้งก่อน, 2.4 มาตรการ
  const COLS = { prev: [["t", "เรื่อง"], ["g", "เป้าหมาย"], ["p", "รายงานความก้าวหน้า"], ["r", "ผลลัพธ์และแผนงาน"]],
    meas: [["n", "มาตรการ / โครงการ"], ["per", "ระยะเวลา"], ["b", "ก่อนทำ kWh/วัน"], ["a", "หลังทำ kWh/วัน"], ["note", "หมายเหตุ"]] };
  function rows2(k) {
    const list = wData[k], cols = COLS[k], ro = !canWrite, cost = +$("#wCost").value || 0;
    $(k === "prev" ? "#wPrev" : "#wMeas").innerHTML = `<tr>${cols.map(c => `<th>${c[1]}</th>`).join("")}${k === "meas" ? "<th>ประหยัด kWh/วัน</th><th>บาท/เดือน</th>" : ""}${ro ? "" : "<th></th>"}</tr>` +
      (list.length ? list.map((r, i) => `<tr>${cols.map(([c]) => `<td>${ro ? esc(r[c] ?? "") : `<${["b", "a"].includes(c) ? 'input type="number" step="any"' : "textarea rows=\"2\""} data-r="${k}" data-i="${i}" data-c="${c}"${["b", "a"].includes(c) ? ` value="${esc(r[c] ?? "")}">` : `>${esc(r[c] ?? "")}</textarea>`}`}</td>`).join("")}
        ${k === "meas" ? `<td class="sv">${nf(r.b !== "" && r.a !== "" && r.b != null && r.a != null ? r.b - r.a : null)}</td><td class="sv">${nf(r.b != null && r.a != null && r.b !== "" && r.a !== "" ? (r.b - r.a) * 30 * cost : null)}</td>` : ""}
        ${ro ? "" : `<td><button class="btn small" type="button" data-del="${k}" data-i="${i}">ลบ</button></td>`}</tr>`).join("") : `<tr><td colspan="${cols.length + 3}" class="sub">ยังไม่มีรายการ</td></tr>`);
  }
  document.addEventListener("input", ev => { const t = ev.target; if (t.dataset && t.dataset.r) { const v = t.type === "number" ? (t.value === "" ? null : +t.value) : t.value; wData[t.dataset.r][+t.dataset.i][t.dataset.c] = v; } });
  document.addEventListener("input", ev => { const t = ev.target; if (!(t.dataset && t.dataset.r === "meas" && ["b", "a"].includes(t.dataset.c))) return;   // update the saving cells in place (re-drawing the table would drop typing)
    const r = wData.meas[+t.dataset.i], ok = r.b != null && r.a != null && r.b !== "" && r.a !== "", tr = t.closest("tr"), c = tr.querySelectorAll("td.sv");
    c[0].textContent = nf(ok ? r.b - r.a : null); c[1].textContent = nf(ok ? (r.b - r.a) * 30 * (+$("#wCost").value || 0) : null); });
  document.addEventListener("click", ev => { const a = ev.target.closest("[data-add]"), d = ev.target.closest("[data-del]");
    if (a) { wData[a.dataset.add].push({}); rows2(a.dataset.add); } if (d) { wData[d.dataset.del].splice(+d.dataset.i, 1); rows2(d.dataset.del); } });
  $("#wCopy").onclick = () => { const p = wkPrevRow && wkPrevRow.data; if (!p) { toast("สัปดาห์ก่อนยังไม่มีรายงาน", true); return; }
    const add = [...(p.prev || []).filter(r => !/เสร็จ|ปิด/.test(r.r || "")), ...(p.meas || []).map(m => ({ t: m.n, g: m.b != null && m.a != null ? `ลด ${m.b - m.a} kWh/วัน` : "", p: m.note || "", r: "" }))];
    wData.prev = [...wData.prev, ...add.map(r => ({ ...r }))]; rows2("prev"); toast(`ดึงมา ${add.length} เรื่อง`); };
  const wSync = () => document.querySelectorAll("[data-w]").forEach(i => wData[i.dataset.w] = i.value.trim());
  async function wSave(send) {
    wSync();
    wData.cost = +$("#wCost").value || null; wData.tgt = +$("#wTgt").value || 0; wData.area = +$("#wArea").value || null;
    if ($("#h").value === me.hospital_id || !wData.snap) wData.snap = wCalc;
    const row = { hospital_id: $("#h").value, week_date: $("#wk").value, data: wData, updated_by: me.id, updated_at: new Date().toISOString() };
    if (send) { row.submitted_at = new Date().toISOString(); row.submitted_by = me.id; }
    const { error } = await sb.from("energy_weekly").upsert(row, { onConflict: "hospital_id,week_date" }); if (error) throw error;
    await rWeek(); toast(send ? (new Date() <= deadline(row.week_date) ? "ส่งรายงานแล้ว ทันกำหนด" : "ส่งรายงานแล้ว (เลยกำหนดเสาร์ 10.00 น.)") : "บันทึกร่างแล้ว");
  }
  $("#wSave").onclick = guard(() => wSave(false));
  $("#wSend").onclick = guard(() => wSave(true));
  $("#wX").onclick = () => { const C = wCalc || { days: [] };
    Office.table(`พลังงานรายวัน_${hosp().code || ""}_${$("#wk").value}`, ["วันที่", "ไฟเข้า kWh", "โซลาร์ kWh", "ไฟออก kWh", "เป้าหมาย kWh/วัน", "เกินเป้า"],
      C.days.map(d => [dTH(d[0]), d[1], d[2], d[3], C.tDay != null ? Math.round(C.tDay) : "", C.tDay != null && d[1] > C.tDay ? "เกิน" : ""]),
      { title: "ไฟฟ้ารายวัน ประชุม Energy รายสัปดาห์", period: `${hosp().code || ""} · ${C.month || ""}`, findings: wFindings() }); };
  function wFindings() { const C = wCalc || {}, ch = C.avg != null && C.bDay ? (C.avg - C.bDay) * 100 / C.bDay : null, out = [];
    if (C.mtd) out.push(`${C.month} ใช้ไฟ ${nf(C.mtd)} kWh ใน ${C.nDays} วัน เฉลี่ย ${nf(C.avg)} kWh/วัน${ch != null ? ` ${ch > 0 ? "เพิ่มขึ้น" : "ลดลง"} ${nf(Math.abs(ch), 1)}% จากเดือนเดียวกันปีก่อน` : ""}`);
    if (C.tDay != null) out.push(`เป้าหมายประหยัด ${C.tgt}% = ไม่เกิน ${nf(C.tDay)} kWh/วัน (${nf(C.saveMonth)} kWh/เดือน)${C.avg != null ? ` ตอนนี้${C.avg > C.tDay ? "เกินเป้า " + nf(C.avg - C.tDay) + " kWh/วัน" : "อยู่ในเป้า"}` : ""}`);
    if (C.mx) out.push(`สูงสุด ${nf(C.mx[1])} kWh (วันที่ ${+C.mx[0].slice(8)}) ต่ำสุด ${nf(C.mn[1])} kWh (วันที่ ${+C.mn[0].slice(8)})`);
    if (C.ytd != null && C.ytdL) out.push(`ตั้งแต่ ม.ค. ${nf(C.ytd)} kWh เทียบปีก่อน ${nf(C.ytdL)} kWh (${C.ytd > C.ytdL ? "+" : ""}${nf((C.ytd - C.ytdL) * 100 / C.ytdL, 1)}%)`);
    const sv = (wData.meas || []).reduce((s, m) => s + (m.b != null && m.a != null && m.b !== "" && m.a !== "" ? m.b - m.a : 0), 0); if (sv) out.push(`มาตรการที่ดำเนินการประหยัดรวม ${nf(sv)} kWh/วัน ≈ ${nf(sv * 30 * (C.cost || 0))} บาท/เดือน`);
    return out.length ? out : ["ยังไม่มีตัวเลขพลังงานในสัปดาห์นี้"]; }
  $("#wP").onclick = () => {   // must call Office.pptx synchronously so the Word / PDF buttons beside it keep their mode
    wSync();
    const C = wCalc || { days: [], pts: [] }, H = hosp(), img = wImg;
    const txt = (t, v) => v ? [[t, v]] : [];
    const d = { title: `ประชุม Energy รายสัปดาห์ · ${H.code}`, org: H.name, period: `ประชุมวันเสาร์ที่ ${dTH($("#wk").value)} 14.00–16.00 น.`,
      findings: wFindings(), kpis: [["kWh เดือนนี้", nf(C.mtd)], ["เฉลี่ย kWh/วัน", nf(C.avg)], ["เป้าหมาย kWh/วัน", nf(C.tDay)], ["ปีก่อน kWh/วัน", nf(C.bDay)], ["สูงสุด kWh/วัน", C.mx ? nf(C.mx[1]) : "-"], ["ต่ำสุด kWh/วัน", C.mn ? nf(C.mn[1]) : "-"], ["kWh/ตร.ม./วัน", nf(C.avg != null && C.area ? C.avg / C.area : null, 3)], ["ต้นทุน บาท/หน่วย", nf(C.cost, 2)]],
      analysis: [...txt("ผู้รับเหมา", wData.f_contractor), ...txt("ห้องประชุม", wData.f_meeting), ...txt("ระบบวิศวกรรม", wData.f_eng), ...txt("อุณหภูมิภายนอก", wData.f_weather)].map(([a, b]) => `${a}: ${b}`),
      sections: [{ title: "1. วาระครั้งก่อน", head: ["เรื่อง", "เป้าหมาย", "ความก้าวหน้า", "ผลลัพธ์และแผนงาน"], rows: wData.prev.map(r => [r.t || "", r.g || "", r.p || "", r.r || ""]) },
        ...(img ? [{ title: `2.1 สรุปค่าพลังงานไฟฟ้า ${C.month}`, img, imgR: 260 / 900 }] : []),
        { title: "2.2 ไฟเข้า (INCOME) / ไฟออก (OUTCOME)", head: ["มิเตอร์", "นับเป็น", "เฉลี่ย kWh/วัน"], rows: (C.pts || []).filter(p => p.role !== "skip").map(p => [p.name, ROLE[p.role], nf(p.avg)]) },
        { title: "2.3 ปัจจัยที่มีผลต่อการใช้พลังงาน", head: ["ปัจจัย", "รายละเอียด"], rows: [...txt("ผู้รับเหมา", wData.f_contractor), ...txt("ห้องประชุม", wData.f_meeting), ...txt("ระบบวิศวกรรม", wData.f_eng), ...txt("อุณหภูมิภายนอก", wData.f_weather)] },
        { title: "2.4 มาตรการดำเนินการ", head: ["มาตรการ", "ระยะเวลา", "ก่อน kWh/วัน", "หลัง kWh/วัน", "ประหยัด kWh/วัน", "บาท/เดือน"], rows: wData.meas.map(m => [m.n || "", m.per || "", nf(m.b), nf(m.a), nf(m.b != null && m.a != null ? m.b - m.a : null), nf(m.b != null && m.a != null ? (m.b - m.a) * 30 * (C.cost || 0) : null)]) },
        { title: "2.5 – 5. มาตรการเชิงรุก · กิจกรรมส่วนกลาง · ขอสนับสนุน · ข้อเสนอแนะ", head: ["หัวข้อ", "รายละเอียด"], rows: [...txt("2.5 มาตรการเชิงรุกภายในพื้นที่", wData.proactive), ...txt("3. กิจกรรมส่วนกลาง", wData.central), ...txt("4. ขอสนับสนุนทางโรงพยาบาล", wData.support), ...txt("5. ข้อเสนอแนะ", wData.suggest)] },
        { title: `รายการข้อมูลที่โรงต้องใส่ · ครบ ${wScore(wData, C).pct}%`, head: ["ข้อมูล", "ใครใส่", "สถานะ"], rows: wItems(wData, C).map(i => [i.t, i.who, i.ok ? "ครบ" : i.req ? "ยังไม่มี" : "-"]) },
        ...(wData.ai && wData.ai.report ? [{ title: "บทสรุปโดย AI 3 คน", head: ["บทสรุปผู้บริหาร"], rows: [[wData.ai.report.summary]] }, ...(wData.ai.report.swot ? [{ title: "SWOT (AI 3 คน)", img: swImg, imgR: 0.5, svg: swotSvg(wData.ai.report.swot), note: "S, W = ปัจจัยภายในทีม · O, T = ปัจจัยภายนอก" }] : []), ...aiSections(wData.ai)] : [])],
      notes: ["ตัวเลขรายวันรวมจากมิเตอร์ที่ตั้งเป็น \"ไฟเข้า\" ในบันทึก OP · ค่าเดือนเดียวกันปีก่อนจากบิลค่าไฟ (บันทึกรายเดือน)"] };
    return Office.pptx(`ประชุมEnergy_${H.code}_${$("#wk").value}`, d).catch(e => toast(errText(e), true));
  };
  const toPng = (svg, w, h) => new Promise(ok => { const img = new Image();
    img.onload = () => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").drawImage(img, 0, 0, w, h); try { ok(cv.toDataURL("image/png")); } catch (e) { ok(null); } };
    img.onerror = () => ok(null); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });

  // ---------- SWOT, RCA 4M fishbone + 5 Why and Gantt for the AI 3-role report (same as KPI / Bi-Weekly) ----------
  const M4 = [["man", "คน (Man)"], ["machine", "เครื่องจักร (Machine)"], ["method", "วิธีการ (Method)"], ["material", "วัสดุ / อะไหล่ (Material)"]];
  const lines = t => String(t || "").split("\n").map(x => x.replace(/^\s*(?:[-•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  // Thai vowel and tone marks take no width, so count only the letters that do
  const vis = t => t.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
  const cut = (t, n) => { if (vis(t) <= n) return t; let k = t.length; while (k > 0 && vis(t.slice(0, k)) > n - 1) k--; return t.slice(0, k) + "…"; };
  const short = t => String(t || "").replace(/\s*\(.*$/, "");
  const wrap = (t, n) => { const out = []; let rest = String(t || ""); while (rest.length > n && out.length < 2) { let k = rest.lastIndexOf(" ", n); if (k < n / 2) k = n; out.push(rest.slice(0, k).trim()); rest = rest.slice(k).trim(); } out.push(cut(rest, n)); return out; };
  // full text rule (user 2026-11-20): every line is written out in full, never cut with "…": long text wraps onto more lines and drawings grow
  const MARK_ = /[ัิ-ฺ็-๎]/, LEAD_ = /[เ-ไ]/;
  const SEG_ = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("th", { granularity: "word" }) : null;
  // Thai has no spaces between words: break lines at word boundaries (Intl.Segmenter) so no word is split
  const wrapAll = (t, n) => { const src = String(t ?? "").replace(/\s+/g, " ").trim(); if (!SEG_) return wrapRaw(src, n);
    const out = []; let cur = "";
    for (const { segment: w, isWordLike } of SEG_.segment(src)) {
      if (vis(cur + w) <= n || (!isWordLike && w.trim() && cur.trim() && vis(cur + w) <= n + 3)) { cur += w; continue; }   // closing marks like ")" stay on their line
      if (cur.trim()) { out.push(cur.trim()); cur = ""; }
      if (vis(w) > n) { const parts = wrapRaw(w, n); cur = parts.pop(); out.push(...parts); } else cur = w.trimStart(); }
    if (cur.trim() || !out.length) out.push(cur.trim()); return out; };
  const wrapRaw = (t, n) => { const out = []; let rest = t;
    while (vis(rest) > n) { let k = 0, v = 0; while (k < rest.length && (v < n || MARK_.test(rest[k]))) { if (!MARK_.test(rest[k])) v++; k++; }
      const b = rest.lastIndexOf(" ", k); if (b > k * 0.45) { out.push(rest.slice(0, b)); rest = rest.slice(b + 1); continue; }
      while (k > 1 && LEAD_.test(rest[k - 1])) k--;
      out.push(rest.slice(0, k)); rest = rest.slice(k).trimStart(); }
    if (rest || !out.length) out.push(rest); return out; };
  const svgWH = svg => { const m = String(svg).match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); return m ? [+m[1], +m[2]] : [1400, 600]; };
  const pngOf = svg => { const [w, h] = svgWH(svg); return toPng(svg, w, h); };
  const gRowH = r => Math.max(34, 14 + wrapAll(r.step, 44).length * 20);
  const gChunks = (P, max = 520) => { const out = []; let cur = [], h = 0; P.forEach(r => { const rh = gRowH(r); if (cur.length && h + rh > max) { out.push(cur); cur = []; h = 0; } cur.push(r); h += rh; }); if (cur.length) out.push(cur); return out; };
  // fishbone 4M with every cause in full: bones grow longer when there is more to write
  function fishDraw(label, title, get) {
    const W = 1400, x = v => esc(v), FL = 20;
    const B = M4.map(([k, lab], i) => { const items = (get(k) || []).map(t => wrapAll(t, 26)), need = items.reduce((a, l) => a + l.length * FL + 14, 0); return { lab, i, items, len: Math.max(230, need + 70) }; });
    const TL = wrapAll(title, 17), hh = Math.max(184, 88 + TL.length * 28), up = Math.max(B[0].len, B[1].len, hh / 2 + 10), dn = Math.max(B[2].len, B[3].len, hh / 2 + 10), Y = 70 + up, H = Math.round(Y + dn + 70);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Tahoma, 'IBM Plex Sans Thai', sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/>` +
      `<line x1="30" y1="${Y}" x2="1132" y2="${Y}" stroke="#1F2A37" stroke-width="6"/><polygon points="1126,${Y - 24} 1150,${Y} 1126,${Y + 24}" fill="#1F2A37"/>` +
      `<rect x="1152" y="${Y - hh / 2}" width="236" height="${hh}" rx="14" fill="#FDE8E6" stroke="#B42318" stroke-width="3"/>` +
      `<text x="1270" y="${Y - hh / 2 + 40}" text-anchor="middle" font-size="22" font-weight="bold" fill="#9B1C13">${x(label)}</text>` +
      TL.map((t, i) => `<text x="1270" y="${Y - hh / 2 + 78 + i * 28}" text-anchor="middle" font-size="18" fill="#1F2A37">${x(t)}</text>`).join("");
    B.forEach(b => { const J = b.i % 2 ? 1040 : 560, top = b.i < 2, ex = J - 220, ey = top ? Y - b.len : Y + b.len, bxAt = yy => top ? ex + 220 * (yy - ey) / b.len : ex + 220 * (ey - yy) / b.len;
      s += `<line x1="${ex}" y1="${ey}" x2="${J}" y2="${Y}" stroke="#0B5CAD" stroke-width="4"/>` +
        `<rect x="${ex - 125}" y="${top ? ey - 52 : ey + 6}" width="250" height="46" rx="9" fill="#0B5CAD"/><text x="${ex}" y="${top ? ey - 21 : ey + 37}" text-anchor="middle" fill="#ffffff" font-size="19" font-weight="bold">${b.lab}</text>`;
      let yy = top ? ey + 42 : Y + 52;
      b.items.forEach(L => { const bx = bxAt(yy); s += `<line x1="${Math.round(bx - 24)}" y1="${yy}" x2="${Math.round(bx)}" y2="${yy}" stroke="#0B5CAD" stroke-width="2"/>`;
        L.forEach((t, j) => { s += `<text x="${Math.round(bxAt(yy + j * FL + (top ? 0 : 6)) - 30)}" y="${yy + 6 + j * FL}" text-anchor="end" font-size="16" fill="#1F2A37">${x(t)}</text>`; }); yy += L.length * FL + 14; }); });
    return s + "</svg>";
  }
  // SWOT 4 boxes with every point in full: boxes grow taller when there is more to write
  function swotSvg(sw) {
    const W = 1400, x = v => esc(v), LH = 32;
    const B = SW.map(([k]) => ((sw && sw[k]) || []).map(t => wrapAll(t, 44))), bh = L => Math.max(320, 98 + L.reduce((a, l) => a + l.length * LH + 14, 0));
    const R1 = Math.max(bh(B[0]), bh(B[1])), R2 = Math.max(bh(B[2]), bh(B[3])), H = 60 + R1 + R2;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Tahoma, 'IBM Plex Sans Thai', sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/>`;
    SW.forEach(([k, lab, ink, bg], i) => { const X = 20 + (i % 2) * 690, Y = i < 2 ? 20 : 40 + R1, h = i < 2 ? R1 : R2;
      s += `<rect x="${X}" y="${Y}" width="670" height="${h}" rx="12" fill="#${bg}" stroke="#${ink}" stroke-width="3"/><text x="${X + 24}" y="${Y + 44}" font-size="26" font-weight="bold" fill="#${ink}">${lab}</text>`;
      let yy = Y + 98; B[i].forEach(L => { L.forEach((t, j) => { s += `<text x="${X + (j ? 52 : 30)}" y="${yy}" font-size="23" fill="#1F2A37">${x((j ? "" : "• ") + t)}</text>`; yy += LH; }); yy += 14; }); });
    return s + "</svg>";
  }
  function fishSvg(head, title, r) { return fishDraw(head, title, k => lines(r[k])); }
  const dAdd = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const dm = iso => new Date(iso + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  const PGX = rows => Math.max(70, 32 + Math.max(...rows.map(r => vis(String(r.grp || "")))) * 10);
  function ganttSvg(rows) {
    const W = 1400, L = 600, R = 1330, top = 58, LH = 20, GX = PGX(rows), GW = Math.max(20, Math.floor((L - 90 - GX) / 10.4)), RL = rows.map(r => wrapAll(r.step, GW)), RH = RL.map(l => Math.max(34, 14 + l.length * LH)), YS = RH.map((_, i) => top + RH.slice(0, i).reduce((a, b) => a + b, 0)), H = top + RH.reduce((a, b) => a + b, 0) + 16, x = v => esc(v);
    const d0 = rows.reduce((m, r) => r.start < m ? r.start : m, rows[0].start), d1 = rows.reduce((m, r) => r.end > m ? r.end : m, rows[0].end);
    const span = Math.max(7, dDiff(d0, d1) + 1), px = d => L + (R - L) * dDiff(d0, d) / span, t = today();
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Tahoma, 'IBM Plex Sans Thai', sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/>` +
      `<text x="20" y="34" font-size="17" font-weight="bold" fill="#1F2A37">ข้อ · ขั้นตอน</text><text x="${L - 10}" y="34" text-anchor="end" font-size="15" fill="#5B6776">วางเสร็จ</text>`;
    for (let k = 0; k <= span; k += 7) { const d = dAdd(d0, k), xx = px(d); s += `<line x1="${xx}" y1="${top - 8}" x2="${xx}" y2="${H - 12}" stroke="#E3E9F1"/><text x="${xx + 3}" y="34" font-size="14" fill="#5B6776">${x(dm(d))}</text>`; }
    rows.forEach((r, i) => { const y = YS[i], rh = RH[i], late = r.status !== "เสร็จ" && r.end < t, col = r.status === "เสร็จ" ? "#14632F" : late ? "#B42318" : r.status === "กำลังทำ" ? "#0B5CAD" : "#7F9CC0";
      if (i % 2) s += `<rect x="10" y="${y}" width="${W - 20}" height="${rh}" fill="#F6F8FB"/>`;
      s += `<text x="20" y="${y + 22}" font-size="15" font-weight="bold" fill="#1F2A37">${x(r.grp)}</text>${RL[i].map((l, j) => `<text x="${GX}" y="${y + 22 + j * LH}" font-size="15" fill="#1F2A37">${x(l)}</text>`).join("")}<text x="${L - 10}" y="${y + 22}" text-anchor="end" font-size="14" fill="${late ? "#B42318" : "#1F2A37"}">${x(dm(r.end))}</text>` +
        `<rect x="${px(r.start)}" y="${y + rh / 2 - 10}" width="${Math.max(6, px(dAdd(r.end, 1)) - px(r.start))}" height="20" rx="5" fill="${col}"/>`; });
    if (t >= d0 && t <= d1) s += `<line x1="${px(t)}" y1="${top - 8}" x2="${px(t)}" y2="${H - 12}" stroke="#B42318" stroke-width="2" stroke-dasharray="6 4"/><text x="${px(t) + 4}" y="${top - 12}" font-size="13" fill="#B42318">วันนี้</text>`;
    return { svg: s + "</svg>", w: W, h: H };
  }
  const SW = [["strengths", "S จุดแข็ง", "14632F", "E3F3E8"], ["weaknesses", "W จุดอ่อน", "B42318", "FDE8E6"], ["opportunities", "O โอกาส", "0B5CAD", "E3EEFA"], ["threats", "T อุปสรรค", "8A5A00", "FCEFD2"]];
  // SWOT always goes into the executive summary and the analysis of every AI 3-role report
  const swotLines = R => R && R.swot ? SW.map(([k, lab]) => `SWOT ${lab}: ${(R.swot[k] || []).join("; ") || "-"}`) : ["SWOT: รายงาน AI รอบนี้ทำก่อนมี SWOT กดปุ่ม 🤖 ใหม่เพื่อให้ AI 3 คนทำ SWOT"];
  const swotNote = R => R && R.swot ? [] : [swotLines(R)[0]];   // old reports made before SWOT: tell the user to run 🤖 again
  // SWOT is always the 4-box chart, placed right after the executive summary (screen, PPT, Word, PDF, Excel)
  const swotLead = async (R, title = "SWOT") => R && R.swot ? [{ title, img: await pngOf(swotSvg(R.swot)), svg: swotSvg(R.swot), note: "S, W = ปัจจัยภายในทีม · O, T = ปัจจัยภายนอก" }] : [];
  const TM = [["ม.ค.", "มกราคม"], ["ก.พ.", "กุมภาพันธ์"], ["มี.ค.", "มีนาคม"], ["เม.ย.", "เมษายน"], ["พ.ค.", "พฤษภาคม"], ["มิ.ย.", "มิถุนายน"], ["ก.ค.", "กรกฎาคม"], ["ส.ค.", "สิงหาคม"], ["ก.ย.", "กันยายน"], ["ต.ค.", "ตุลาคม"], ["พ.ย.", "พฤศจิกายน"], ["ธ.ค.", "ธันวาคม"]];
  function parseDue(v) {   // "15 ธ.ค. 2569", "15 ธันวาคม 69", "2026-12-15", "15/12/2569" -> ISO (CE); null when no date
    const t = String(v || "").trim(), pad = n => String(n).padStart(2, "0"); let m, d, mo, y;
    if ((m = t.match(/(\d{4})-(\d{2})-(\d{2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else { const k = TM.findIndex(([a, b]) => t.includes(b) || t.includes(a) || t.includes(a.replace(/\./g, "")));
      if (k < 0) return null; const ix = Math.max(...TM[k].map(n => t.indexOf(n))), before = t.slice(0, ix).match(/(\d{1,2})\D*$/), after = t.slice(ix).match(/(\d{2,4})/);
      mo = k + 1; d = before ? +before[1] : (k === 11 || k === 1 ? 28 : 30); y = after ? +after[1] : 0; if (!before) d = new Date(2026, mo, 0).getDate(); }
    if (!y) { y = +today().slice(0, 4); if (`${y}-${pad(mo)}-${pad(d)}` < dAdd(today(), -60)) y++; }
    if (y < 100) y += 2500; if (y > 2400) y -= 543;
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    return `${y}-${pad(mo)}-${pad(Math.min(d, new Date(y, mo, 0).getDate()))}`;
  }
  const thd = d => d ? new Date(d + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";
  // Gantt of the AI measures: each measure runs from the previous due date (or today) to its own due date
  function aiPlanRows(R) { const out = [], t = today(); let prev = t;
    (R && R.actions || []).forEach((a, i) => { const end = parseDue(a.due); if (!end) return;
      out.push({ grp: `${i + 1}.`, step: a.action, owner: a.owner, start: end < prev ? (end < t ? dAdd(end, -7) : t) : prev, end, status: "ยังไม่เริ่ม", due: a.due }); prev = end; });
    return out; }
  const aiRca = R => Object.fromEntries(M4.map(m => [m[0], ((R.rca && R.rca.m4 && R.rca.m4[m[0]]) || []).join("\n")]));
  // ---------- รายการข้อมูลที่แต่ละโรงต้องใส่ (checklist of what each hospital must enter before Saturday 10:00) ----------
  // req 1 = needed for the report, 0 = optional. The same list scores every hospital in the 12-hospital table.
  function wItems(D, C) {
    D = D || {}; C = C || {}; const has = v => !!(v && String(v).trim()), num = v => v != null && v !== "";
    const exp = C.expDays != null ? C.expDays : (C.to && C.from && C.to >= C.from ? +C.to.slice(8) : 0);
    return [
      { g: "ตัวเลข (ระบบรวมให้)", t: "มิเตอร์ไฟฟ้ารายวันใน \"บันทึก OP\" ครบทุกวันของเดือน", who: "ช่างทุกกะ", ok: exp > 0 && (C.nDays || 0) >= exp, v: `${C.nDays || 0}/${exp} วัน`, req: 1, fix: "ให้ช่างจดเลขมิเตอร์ OP-01 (MDB) หรือ OP-22E ทุกวันในหน้า บันทึก OP" },
      { g: "ตัวเลข (ระบบรวมให้)", t: "ตั้งมิเตอร์ที่เป็น \"ไฟเข้า\" (INCOME) อย่างน้อย 1 จุด", who: "Chief · ข้อ 2.2", ok: (C.pts || []).some(p => p.role === "in"), req: 1, fix: "ในตารางข้อ 2.2 เลือก นับเป็น = ไฟเข้า" },
      { g: "บิลรายเดือน", t: "บิลค่าไฟเดือนเดียวกันของปีก่อน (ใช้เป็นฐานเทียบ)", who: "Chief · แท็บ บันทึกรายเดือน", ok: C.bMonth != null, v: C.bMonth != null ? nf(C.bMonth) + " kWh" : "", req: 1, fix: "แท็บ บันทึกรายเดือน (บิล) เลือกปีก่อน เดือนเดียวกัน ใส่ kWh และบาท" },
      { g: "บิลรายเดือน", t: "บิลค่าไฟเดือนที่แล้ว", who: "Chief · แท็บ บันทึกรายเดือน", ok: !!C.lastBill, req: 1, fix: "ใส่บิลเดือนที่แล้วในแท็บ บันทึกรายเดือน (บิล)" },
      { g: "ตั้งค่า", t: "ต้นทุนไฟฟ้า (บาท/หน่วย)", who: "Chief · ข้อ 2.1", ok: C.cost > 0, v: C.cost ? nf(C.cost, 2) : "", req: 1, fix: "ใส่ในช่อง ต้นทุนไฟฟ้า ข้อ 2.1 (ค่าไฟ ÷ หน่วย จากบิล)" },
      { g: "ตั้งค่า", t: "พื้นที่อาคาร (ตร.ม.)", who: "Chief · ข้อ 2.1", ok: C.area > 0, v: C.area ? nf(C.area) : "", req: 1, fix: "ใส่ในช่อง พื้นที่ ข้อ 2.1" },
      { g: "Chief พิมพ์", t: "1. วาระครั้งก่อน อย่างน้อย 1 เรื่อง พร้อมความก้าวหน้า", who: "Chief", ok: (D.prev || []).some(r => has(r.t) && has(r.p)), req: 1, fix: "กด ดึงเรื่องจากสัปดาห์ก่อน หรือ + เพิ่มเรื่อง แล้วเขียนความก้าวหน้า" },
      { g: "Chief พิมพ์", t: "2.3 อุณหภูมิภายนอก", who: "Chief", ok: has(D.f_weather), req: 1, fix: "เช่น สูงสุด 35 °C ร้อนกว่าปีก่อน 1.5 °C" },
      { g: "Chief พิมพ์", t: "2.3 ปัจจัยอื่น (ผู้รับเหมา · ห้องประชุม · ระบบวิศวกรรม) อย่างน้อย 1 ข้อ", who: "Chief", ok: has(D.f_contractor) || has(D.f_meeting) || has(D.f_eng), req: 1, fix: "เขียนสิ่งที่ทำให้ไฟขึ้นหรือลงในสัปดาห์นี้" },
      { g: "Chief พิมพ์", t: "2.4 มาตรการ อย่างน้อย 1 เรื่อง มีค่าก่อนทำและหลังทำ (kWh/วัน)", who: "Chief", ok: (D.meas || []).some(m => has(m.n) && num(m.b) && num(m.a)), req: 1, fix: "+ เพิ่มมาตรการ ใส่ชื่อ ระยะเวลา ก่อน/หลังทำ" },
      { g: "Chief พิมพ์", t: "2.5 มาตรการเชิงรุกภายในพื้นที่", who: "Chief", ok: has(D.proactive), req: 1, fix: "เช่น ตั้งเวลาปิด AHU ห้องประชุม, เดินตรวจปิดไฟ" },
      { g: "Chief พิมพ์", t: "3. กิจกรรมส่วนกลาง", who: "Chief", ok: has(D.central), req: 0, fix: "ถ้ามี" },
      { g: "Chief พิมพ์", t: "4. ขอสนับสนุนทางโรงพยาบาล", who: "Chief", ok: has(D.support), req: 0, fix: "ถ้ามี" },
      { g: "Chief พิมพ์", t: "5. ข้อเสนอแนะ", who: "Chief", ok: has(D.suggest), req: 0, fix: "ถ้ามี" }];
  }
  const wScore = (D, C) => { const L = wItems(D, C).filter(i => i.req), k = L.filter(i => i.ok).length; return { k, n: L.length, pct: Math.round(k * 100 / L.length) }; };
  function drawChk() {
    wSync(); const L = wItems(wData, wCalc), S = wScore(wData, wCalc), open = $("#wChk").open;
    $("#wChk").innerHTML = `<summary>รายการข้อมูลที่โรงต้องใส่ก่อนส่ง · ครบ ${S.k}/${S.n} ข้อ (${S.pct}%)</summary><div class="bar"><i style="width:${S.pct}%"></i></div>
      <table><tr><th>#</th><th>ข้อมูล</th><th>ใครใส่ / ที่ไหน</th><th>สถานะ</th><th>วิธีใส่</th></tr>${L.map((i, x) => `<tr><td>${x + 1}</td><td>${esc(i.t)}${i.req ? "" : ' <span class="o">(ถ้ามี)</span>'}</td><td>${esc(i.who)}</td>
      <td class="${i.ok ? "y" : i.req ? "n" : "o"}">${i.ok ? "✓ ครบ" : i.req ? "✗ ยังไม่มี" : "–"}${i.v ? ` <span class="o">${esc(i.v)}</span>` : ""}</td><td>${i.ok ? "" : esc(i.fix)}</td></tr>`).join("")}</table>`;
    $("#wChk").open = open;
  }
  let chkT = 0; document.addEventListener("input", ev => { if (!ev.target.closest("#tab-week")) return; clearTimeout(chkT); chkT = setTimeout(drawChk, 300); });
  document.addEventListener("click", ev => { if (ev.target.closest("[data-add],[data-del],#wCopy")) setTimeout(drawChk, 0); });

  // ---------- AI 3 คน: AI 1 นำเสนอ, AI 2 วิเคราะห์ทบทวน, AI 3 ตรวจสอบ; if AI 3 asks for changes, AI 1 and AI 2 revise ONE more round ----------
  const r0 = v => v == null || isNaN(v) ? null : Math.round(v * 10) / 10;
  function aiInput() {
    wSync(); const C = wCalc || {}, H = hosp(), ch = C.avg != null && C.bDay ? (C.avg - C.bDay) * 100 / C.bDay : null, has = v => v != null && v !== "";
    return { hospital: `${H.code} ${H.name}`, meeting: `วันเสาร์ ${dTH($("#wk").value)} 14.00-16.00 น.`, month: C.month, period: `${C.from || ""} ถึง ${C.to || ""}`,
      figures: { kwh_month_to_date: r0(C.mtd), days_logged: C.nDays, days_elapsed: C.expDays, avg_kwh_per_day: r0(C.avg), last_year_same_month_kwh_per_day: r0(C.bDay), last_year_same_month_kwh: r0(C.bMonth),
        change_vs_last_year_pct: r0(ch), saving_target_pct: C.tgt, target_kwh_per_day: r0(C.tDay), target_saving_kwh_month: r0(C.saveMonth), max_day: C.mx ? { date: C.mx[0], kwh: r0(C.mx[1]) } : null, min_day: C.mn ? { date: C.mn[0], kwh: r0(C.mn[1]) } : null,
        this_week_kwh: r0(C.wk7), this_week_days: C.wkN, ytd_kwh_from_bills: r0(C.ytd), ytd_last_year_kwh: r0(C.ytdL), ytd_months: C.ytdN, solar_kwh_month: r0(C.solar), cost_baht_per_kwh: C.cost, area_m2: C.area,
        kwh_per_m2_day: C.avg != null && C.area ? Math.round(C.avg / C.area * 1000) / 1000 : null },
      daily_kwh: (C.days || []).map(d => ({ date: d[0], in: r0(d[1]), solar: r0(d[2]), out: r0(d[3]), over_target: C.tDay != null && d[1] > C.tDay })),
      meters: (C.pts || []).map(p => ({ name: p.name, role: ROLE[p.role], avg_kwh_per_day: r0(p.avg) })),
      previous_agenda: (wData.prev || []).map(r => ({ topic: r.t || "", target: r.g || "", progress: r.p || "", result_plan: r.r || "" })),
      factors: { contractor: wData.f_contractor || "", meeting_rooms: wData.f_meeting || "", engineering: wData.f_eng || "", outside_temperature: wData.f_weather || "" },
      measures: (wData.meas || []).map(m => { const ok = has(m.b) && has(m.a); return { name: m.n || "", period: m.per || "", before_kwh_day: m.b ?? null, after_kwh_day: m.a ?? null, saving_kwh_day: ok ? r0(m.b - m.a) : null, saving_baht_month: ok ? Math.round((m.b - m.a) * 30 * (C.cost || 0)) : null, note: m.note || "" }; }),
      proactive: wData.proactive || "", central: wData.central || "", support_requested: wData.support || "", suggestions: wData.suggest || "",
      missing_data: wItems(wData, C).filter(i => i.req && !i.ok).map(i => i.t) };
  }
  const AI_ROLES = '<div class="who3"><span>🤖 AI 1 ผู้นำเสนอ</span><span>🤖 AI 2 ผู้วิเคราะห์ ทบทวน</span><span>🤖 AI 3 ผู้ตรวจสอบ</span></div>';
  $("#wAI").onclick = guard(async () => {
    if (!wCalc) return toast("ยังโหลดตัวเลขไม่เสร็จ", true);
    const H = hosp(), box = $("#aiBox"), input = aiInput(); box.hidden = false;
    box.innerHTML = `<h3>AI 3 คน กำลังทำรายงาน ${esc(H.code)}</h3>${AI_ROLES}<p>รอบ 1: AI 1 นำเสนอ → AI 2 วิเคราะห์ทบทวน → AI 3 ตรวจสอบ · ถ้า AI 3 สั่งแก้ รอบ 2: AI 1 และ AI 2 แก้ไขอีก 1 รอบ → AI 3 ตรวจอีกครั้งและเรียบเรียงรายงาน ใช้เวลาหลายนาที อย่าเพิ่งปิดหน้านี้</p><ol id="aiSteps"></ol>`;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    const body = { hospital_id: H.id, input };
    let model = "";
    const call = async (extra, label) => { const li = document.createElement("li"); li.textContent = label + " …"; $("#aiSteps").appendChild(li);
      let data, error, msg;
      for (let t = 0; t < 4; t++) {
        ({ data, error } = await sb.functions.invoke("energy-ai", { body: { ...body, ...extra } }));
        const st = error && error.context && error.context.status, j = error && error.context && typeof error.context.json === "function" ? await error.context.json().catch(() => ({})) : {};
        msg = error ? (j.error || (st === 546 || st === 504 ? "AI ใช้เวลานานเกินที่เซิร์ฟเวอร์อนุญาต (150 วินาที)" : j.message || error.message)) + (st ? ` (รหัส ${st})` : "") : data && data.error;
        if (!msg || /โควตา|limit: 0/.test(msg) || !(st === 546 || st === 504 || /ช้าเกิน|503|429|high demand|overload|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg)) || t === 3) break;
        li.textContent = `${label} … AI ไม่ว่างหรือช้า กำลังลองใหม่อัตโนมัติ (ครั้งที่ ${t + 1}/3)`;
        await new Promise(ok => setTimeout(ok, 10000 * (t + 1)));
      }
      if (msg) { li.innerHTML = `${esc(label)} <b class="bad">ไม่สำเร็จ: ${esc(msg)}</b>`; throw Object.assign(new Error(msg), { shown: 1 }); }
      if (data.model) model = data.model; li.textContent = label + " ✓"; return { data, li }; };
    const log = [];
    try {
      let p1 = (await call({ step: "propose" }, "รอบ 1: AI 1 เตรียมเนื้อหานำเสนอ")).data.text;
      log.push({ r: 1, who: "AI 1 ผู้นำเสนอ", what: "เตรียมเนื้อหานำเสนอตามวาระ", text: p1 });
      let p2 = (await call({ step: "review", p1 }, "รอบ 1: AI 2 วิเคราะห์ ทบทวน")).data.text;
      log.push({ r: 1, who: "AI 2 ผู้วิเคราะห์ ทบทวน", what: "วิเคราะห์สาเหตุและทบทวนข้อเสนอ", text: p2 });
      const ckLi = async (r, extra) => { const { data, li } = await call({ step: "check", p1, p2, ...extra }, `รอบ ${r}: AI 3 ตรวจสอบ`), c = data.check;
        li.innerHTML = `รอบ ${r}: AI 3 ตรวจสอบ ✓ <b class="${c.approved ? "ok" : "bad"}">${c.approved ? "ผ่าน" : `สั่งแก้ ${c.issues.length} เรื่อง`}</b>` + (c.approved ? "" : `<ul>${c.issues.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`);
        log.push({ r, who: "AI 3 ผู้ตรวจสอบ", what: c.approved ? "ผ่าน" : `สั่งแก้ ${c.issues.length} เรื่อง`, approved: c.approved, issues: c.issues || [], text: c.summary || "" }); return c; };
      let c = await ckLi(1);
      if (!c.approved) {   // one more round only, as asked: AI 1 and AI 2 fix what AI 3 listed
        const issues = c.issues;
        p1 = (await call({ step: "propose", p1, p2, issues }, "รอบ 2: AI 1 แก้ไขตามที่ AI 3 สั่ง")).data.text;
        log.push({ r: 2, who: "AI 1 ผู้นำเสนอ", what: "แก้ไขตามที่ AI 3 สั่ง", text: p1 });
        p2 = (await call({ step: "review", p1, issues }, "รอบ 2: AI 2 ทบทวนฉบับแก้ไข")).data.text;
        log.push({ r: 2, who: "AI 2 ผู้วิเคราะห์ ทบทวน", what: "ทบทวนฉบับแก้ไข", text: p2 });
        c = await ckLi(2);
      }
      const logTxt = log.filter(x => x.who.startsWith("AI 3")).map(x => `รอบ ${x.r}: ${x.what}${x.issues && x.issues.length ? " - " + x.issues.join("; ") : ""} ${x.text}`).join("\n");
      const R = (await call({ step: "report", p1, p2, log: logTxt }, "AI 3 เรียบเรียงรายงานฉบับสุดท้าย")).data.report;
      wData.ai = { at: new Date().toISOString(), by: me.id, model, rounds: Math.max(...log.map(x => x.r)), approved: !!c.approved, report: R, log };
      drawAi();
      if (canWrite) { await wSave(false); toast("เก็บผล AI ไว้กับรายงานสัปดาห์นี้แล้ว (บันทึกร่าง)"); } else toast("AI ทำรายงานเสร็จแล้ว");
    } catch (e) { if (!e.shown) box.insertAdjacentHTML("beforeend", `<p class="note bad">ทำไม่สำเร็จ: ${esc(errText(e))}</p>`); }
  });
  const aiLogRows = A => A.log.map(x => [`รอบ ${x.r}`, x.who, x.what, x.issues && x.issues.length ? x.issues.join("\n") : (x.who.startsWith("AI 3") ? x.text : "")]);
  let swImg = null;
  function drawAi() {
    const A = wData.ai, box = $("#aiBox"); if (!A || !A.report) { box.hidden = true; box.innerHTML = ""; return; }
    if (A.report.swot) pngOf(swotSvg(A.report.swot)).then(x => { swImg = x; });
    const R = A.report, li = a => `<ul>${(a || []).map(x => `<li>${esc(x)}</li>`).join("") || "<li>-</li>"}</ul>`, tb = (h, rows) => `<div class="tw"><table><tr>${h.map(x => `<th>${esc(x)}</th>`).join("")}</tr>${rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${h.length}">-</td></tr>`}</table></div>`;
    box.hidden = false;
    box.innerHTML = `<h3>รายงานโดย AI 3 คน</h3>${AI_ROLES}<p class="sub">ทำเมื่อ ${new Date(A.at).toLocaleString("th-TH")} · ${A.rounds} รอบ · AI 3 ${A.approved ? "ให้ผ่าน" : "ยังมีข้อสังเกต (ดูตารางการตรวจ)"}${A.model ? ` · ${esc(A.model)}` : ""} · ตรวจทานก่อนนำเสนอทุกครั้ง</p>` +
      `<h3>บทสรุปผู้บริหาร</h3><p>${esc(R.summary)}</p>` +
      (R.swot ? `<h3>SWOT</h3><div class="fish">${swotSvg(R.swot)}</div>` : `<p class="note">${esc(swotLines(R)[0])}</p>`) +
      `<h3>บทวิเคราะห์ตัวเลข</h3>${li(R.analysis)}` +
      (R.rca ? `<h3>RCA ก้างปลา 4M</h3><div class="fish">${fishSvg("ปัญหา", R.rca.problem, aiRca(R))}</div><p><b>5 Why:</b></p><ol>${(R.rca.why5 || []).map(x => `<li>${esc(x)}</li>`).join("")}</ol><p><b>สาเหตุราก:</b> ${esc(R.rca.root_cause)}</p>` : "") +
      `<h3>ปัจจัยที่มีผล</h3>${tb(["ปัจจัย", "ผลต่อการใช้ไฟ"], R.factors.map(f => [f.factor, f.impact]))}` +
      `<h3>มาตรการที่เสนอ</h3>${tb(["มาตรการ", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "ผลประหยัด"], R.actions.map(a => [a.action, a.owner, a.due, a.saving]))}` +
      (() => { const P = aiPlanRows(R); return P.length ? `<h3>แผนงานและวันวางเสร็จ (Gantt)</h3><div class="fish">${ganttSvg(P).svg}</div>` : ""; })() +
      `<h3>วาระติดตามครั้งหน้า</h3>${tb(["เรื่อง", "เป้าหมาย"], R.next_agenda.map(a => [a.topic, a.target]))}` +
      `<h3>ขอสนับสนุนจากโรงพยาบาล</h3>${li(R.support)}<h3>ข้อมูลที่ยังขาด</h3>${li(R.data_gaps)}` +
      `<h3>การทำงานของ AI 3 คน</h3>${tb(["รอบ", "AI", "ทำอะไร", "สิ่งที่สั่งแก้ / สรุปผลตรวจ"], aiLogRows(A))}<h3>สิ่งที่ AI 2 และ AI 3 ทักและแก้แล้ว</h3>${li(R.review_notes)}` +
      `<details><summary>ดูเนื้อหาเต็มของ AI 1 และ AI 2 แต่ละรอบ</summary>${A.log.filter(x => !x.who.startsWith("AI 3")).map(x => `<p><b>รอบ ${x.r} · ${esc(x.who)}</b></p><div style="white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px">${esc(x.text)}</div>`).join("")}</details>` +
      `<div class="acts"><button class="btn" type="button" id="aiP">รายงาน AI (PPT)</button><button class="btn" type="button" id="aiW">รายงาน AI (Word)</button><button class="btn" type="button" id="aiF">รายงาน AI (PDF)</button><button class="btn" type="button" id="aiX">รายงาน AI (Excel)</button>` +
      (canWrite ? `<button class="btn" type="button" id="aiUse">เพิ่มมาตรการของ AI ลงข้อ 2.4</button>` : "") + `</div>`;
    const go = fn => () => { aiDeck().then(fn).catch(e => toast(errText(e), true)); };
    $("#aiP").onclick = go(d => Office.pptx(aiName(), d));
    $("#aiW").onclick = go(d => Office.docx(aiName(), d));
    $("#aiF").onclick = go(d => Office.pdf(aiName(), d));
    $("#aiX").onclick = go(d => Office.xlsx(aiName(), [Office.summarySheet({ title: d.title, org: d.org, period: d.period, findings: d.findings, notes: d.notes }),
      { name: "มาตรการ", rows: [["มาตรการ", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "ผลประหยัด"], ...R.actions.map(a => [a.action, a.owner, a.due, a.saving])], header: 0 },
      { name: "ปัจจัย", rows: [["ปัจจัย", "ผลต่อการใช้ไฟ"], ...R.factors.map(f => [f.factor, f.impact])], header: 0 },
      { name: "วาระครั้งหน้า", rows: [["เรื่อง", "เป้าหมาย"], ...R.next_agenda.map(a => [a.topic, a.target])], header: 0 },
      { name: "การทำงานของ AI", rows: [["รอบ", "AI", "ทำอะไร", "สิ่งที่สั่งแก้ / สรุปผลตรวจ"], ...aiLogRows(A)], header: 0 },
      ...(R.swot ? [{ name: "SWOT", rows: [["หัวข้อ", "รายการ"], ...SW.flatMap(([kk, lab]) => (R.swot[kk] || []).map((t, i) => [i ? "" : lab, t]))], header: 0 }] : []),
      ...(R.rca ? [{ name: "RCA ก้างปลา 4M", rows: [["ปัญหา", ...M4.map(m => m[1]), "5 Why", "สาเหตุราก"], [R.rca.problem, ...M4.map(m => ((R.rca.m4 || {})[m[0]] || []).join("\n")), (R.rca.why5 || []).join("\n"), R.rca.root_cause]], header: 0 }] : []),
      ...(aiPlanRows(R).length ? [{ name: "แผนงาน Gantt", rows: [["ลำดับ", "มาตรการ", "ผู้รับผิดชอบ", "เริ่ม", "วางเสร็จ", "กำหนดเสร็จ (AI)"], ...aiPlanRows(R).map(p => [p.grp, p.step, p.owner, thd(p.start), thd(p.end), p.due])], header: 0 }] : []),
      { name: "บทวิเคราะห์", rows: [["บทวิเคราะห์"], ...R.analysis.map(x => [x]), [], ["ขอสนับสนุน"], ...R.support.map(x => [x]), [], ["ข้อมูลที่ยังขาด"], ...R.data_gaps.map(x => [x]), [], ["AI 2 / AI 3 ทักและแก้แล้ว"], ...R.review_notes.map(x => [x])], header: 0 }, ...Office.drawSheets(d)]));
    if ($("#aiUse")) $("#aiUse").onclick = () => { R.actions.forEach(a => wData.meas.push({ n: a.action, per: a.due, note: `${a.owner} · คาดประหยัด ${a.saving} (เสนอโดย AI)` }));
      rows2("meas"); drawChk(); toast(`เพิ่ม ${R.actions.length} มาตรการแล้ว ใส่ค่าก่อน/หลังทำ แล้วกด บันทึกร่าง`); $("#wMeas").scrollIntoView({ behavior: "smooth", block: "center" }); };
  }
  const aiName = () => `ประชุมEnergy_AI_${hosp().code || ""}_${$("#wk").value}`;
  const aiSections = A => { const R = A.report; return [
    { title: "บทวิเคราะห์ตัวเลข (AI)", head: ["บทวิเคราะห์"], rows: R.analysis.map(x => [x]) },
    ...(R.rca ? [{ title: "5 Why และสาเหตุราก (AI)", head: ["หัวข้อ", "รายละเอียด"], rows: [["ปัญหา", R.rca.problem], ...(R.rca.why5 || []).slice(0, 5).map((x, i) => [i ? "" : "5 Why", x]), ["สาเหตุราก", R.rca.root_cause]] }] : []),
    { title: "ปัจจัยที่มีผล (AI)", head: ["ปัจจัย", "ผลต่อการใช้ไฟ"], rows: R.factors.map(f => [f.factor, f.impact]) },
    { title: "มาตรการที่เสนอ (AI)", head: ["มาตรการ", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "ผลประหยัด"], rows: R.actions.map(a => [a.action, a.owner, a.due, a.saving]) },
    { title: "วาระติดตามครั้งหน้า · ขอสนับสนุน (AI)", head: ["หัวข้อ", "รายละเอียด"], rows: [...R.next_agenda.map(a => ["ติดตาม: " + a.topic, a.target]), ...R.support.map(x => ["ขอสนับสนุน", x]), ...R.data_gaps.map(x => ["ข้อมูลที่ยังขาด", x])] },
    { title: "การทำงานของ AI 3 คน", head: ["รอบ", "AI", "ทำอะไร", "สิ่งที่สั่งแก้ / สรุปผลตรวจ"], rows: aiLogRows(A) }]; };
  async function aiDeck() {
    const A = wData.ai, R = A.report, H = hosp(), C = wCalc || {};
    const fsv = R.rca ? fishSvg("ปัญหา", R.rca.problem, aiRca(R)) : null, fPic = fsv ? await pngOf(fsv) : null;
    const PR = aiPlanRows(R), ch = gChunks(PR);
    const gp = await Promise.all(ch.map(c => { const g = ganttSvg(c); return toPng(g.svg, g.w, g.h).then(img => ({ ...g, img })); }));
    return { title: `รายงานพลังงานโดย AI 3 คน · ${H.code}`, org: H.name, period: `ประชุมวันเสาร์ที่ ${dTH($("#wk").value)} · ${C.month || ""}`,
      findings: [R.summary, ...swotNote(R), ...R.analysis.slice(0, 3)], lead: await swotLead(R), kpis: [["kWh เดือนนี้", nf(C.mtd)], ["เฉลี่ย kWh/วัน", nf(C.avg)], ["เป้าหมาย kWh/วัน", nf(C.tDay)], ["ปีก่อน kWh/วัน", nf(C.bDay)], ["ข้อมูลครบ", wScore(wData, C).pct + "%"], ["รอบที่ AI ตรวจ", String(A.rounds)]],
      analysis: R.analysis,
      sections: [...(fsv ? [{ title: "RCA ก้างปลา 4M", img: fPic, svg: fsv, note: "สาเหตุราก: " + R.rca.root_cause }] : []),
        ...gp.map((g, i) => ({ title: `แผนงานและวันวางเสร็จ (Gantt)${gp.length > 1 ? ` ${i + 1}/${gp.length}` : ""}`, img: g.img, imgR: g.h / g.w, svg: g.svg, note: `ทั้งหมด ${PR.length} มาตรการ วางเสร็จทั้งหมด ${thd(PR.reduce((m, p) => p.end > m ? p.end : m, PR[0].end))}` })),
        ...aiSections(A), { title: "สิ่งที่ AI 2 และ AI 3 ทักและแก้แล้ว", head: ["ทบทวนแล้ว"], rows: R.review_notes.map(x => [x]) }],
      notes: ["AI 1 นำเสนอ · AI 2 วิเคราะห์ทบทวน · AI 3 ตรวจสอบ ถ้า AI 3 สั่งแก้ AI 1 และ AI 2 แก้อีก 1 รอบ", "ตัวเลขทั้งหมดมาจากรายงานของโรงในหน้านี้ ผู้นำเสนอต้องตรวจทานก่อนใช้"] };
  }

  // exec: who sent this week's report
  async function rAllWeek() {
    const sat = $("#awk").value, r = await sb.from("energy_weekly").select("*").eq("week_date", sat); if (r.error) throw r.error;
    const H = await sb.from("hospitals").select("id,code,name").order("code"), list = r.data || [];
    $("#aWeek").innerHTML = `<tr><th>โรง</th><th>สถานะ</th><th>เฉลี่ย kWh/วัน</th><th>เทียบปีก่อน</th><th>เป้าหมาย kWh/วัน</th><th>ข้อมูลครบ</th><th>AI 3 คน</th><th>ขอสนับสนุน</th></tr>` +
      (H.data || []).map(h => { const x = list.find(q => q.hospital_id === h.id), st = status(x), C = (x && x.data && x.data.snap) || {}, ch = C.avg != null && C.bDay ? (C.avg - C.bDay) * 100 / C.bDay : null;
        return `<tr><td>${esc(h.code)} · ${esc(h.name)}</td><td><span class="st ${st[0]}">${esc(st[1])}</span></td><td>${nf(C.avg)}</td><td class="${ch == null ? "" : ch > 0 ? "up" : "down"}">${ch == null ? "-" : (ch > 0 ? "+" : "") + nf(ch, 1) + "%"}</td><td>${nf(C.tDay)}</td><td>${x ? (sc => `<span class="st ${sc.pct >= 100 ? "ok" : sc.pct >= 70 ? "draft" : "late"}">${sc.k}/${sc.n} (${sc.pct}%)</span>`)(wScore(x.data || {}, C)) : "-"}</td><td>${x && x.data && x.data.ai ? (x.data.ai.approved ? "✓ ผ่าน" : "✓ มีข้อสังเกต") : "-"}</td><td style="white-space:normal;text-align:left">${esc((x && x.data && x.data.support) || "")}</td></tr>`; }).join("");
  }
})();
