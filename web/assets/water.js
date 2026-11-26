// Water Management · ตรวจคุณภาพน้ำ (JCI 8th FMS.08.04): register of sampling points per hospital, a test plan per point
// (parameter, limits, frequency), results graded by the database against the limits, schedule by frequency,
// out-of-range results → corrective action → repair job, trends, 12-hospital overview, and 4 exports (Excel, PPT, Word, PDF).
(() => {
  const { sb, $, esc, errText } = RS;
  const MGR = ["owner", "admin", "chief_engineer", "supervisor"];
  // three water groups (user 2026-11-25): น้ำกินดื่ม / น้ำใช้ / น้ำเสีย; every test is ตรวจเชื้อ or สารเคมี
  const SYS = { DW: "น้ำดื่ม (ตู้กดน้ำดื่ม / เครื่องกรองน้ำดื่ม)", POT: "น้ำประปา (ถังเก็บ / ก๊อกปลายทาง)", CT: "หอผึ่งเย็น (Cooling tower)", RO_HD: "น้ำ RO ไตเทียม (Hemodialysis)", RO_CSSD: "น้ำ RO หน่วยจ่ายกลาง (CSSD)", HW: "น้ำร้อน (ควบคุม Legionella)", WW: "น้ำทิ้งหลังบำบัด (Effluent)", WW_IN: "น้ำเสียเข้าระบบบำบัด (Influent)", WW_AER: "บ่อเติมอากาศ (Aeration tank)", OTH: "อื่น ๆ" };
  const GRP = { DRINK: "น้ำกินดื่ม", USE: "น้ำใช้", WASTE: "น้ำเสีย" };
  const grpOf = sys => sys === "DW" ? "DRINK" : /^WW/.test(sys || "") ? "WASTE" : "USE";
  const TT = { bio: "ตรวจเชื้อ", chem: "สารเคมี" };
  const ttPill = pl => `<span class="pill ${pl.test_type === "bio" ? "bio" : "chem"}">${TT[pl.test_type] || TT.chem}</span>`;
  const FREQ = { D: "ทุกวัน", W: "ทุกสัปดาห์", M: "ทุกเดือน", Q: "ทุก 3 เดือน", S: "ทุก 6 เดือน", Y: "ทุกปี" };
  const SOON = { D: 0, W: 2, M: 7, Q: 14, S: 14, Y: 30 };
  const DST = { ok: "ยังไม่ถึงกำหนด", soon: "ใกล้ถึงกำหนด", over: "เลยกำหนด", never: "ยังไม่เคยตรวจ" };
  const RST = { pass: "ผ่าน", warn: "ผ่าน (ระดับเฝ้าระวัง)", fail: "นอกเกณฑ์" };
  const QUAL = { nd: "ไม่พบ", detected: "พบ", pass: "ผ่าน", fail: "ไม่ผ่าน" };
  let me = null, exec = false, hosps = [], canRec = false, canMan = false, cur = "sum", busy = false;
  let tpl = [], points = [], plans = [], results = [], actions = [], wfiles = [], aiReps = [];
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const guard = fn => async ev => { if (ev && ev.preventDefault) ev.preventDefault(); if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const dTH = d => d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";
  const addD = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); };
  const addM = (d, m) => { const x = new Date(d + "T00:00:00"); x.setMonth(x.getMonth() + m); return x.toLocaleDateString("en-CA"); };
  const nextDue = (last, f) => !last ? null : f === "D" ? addD(last, 1) : f === "W" ? addD(last, 7) : addM(last, { M: 1, Q: 3, S: 6, Y: 12 }[f] || 12);
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
  const pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : null;
  const num = v => v == null || v === "" ? "" : (+v).toLocaleString("th-TH", { maximumFractionDigits: 3 });
  const hosp = () => hosps.find(h => h.id === $("#h").value) || {};
  const sysF = () => $("#sys").value, grpF = () => $("#grp").value, ttF = () => $("#tt").value;
  const ptOk = p => (!grpF() || grpOf(p.system) === grpF()) && (!sysF() || p.system === sysF());
  const plOk = pl => ptOk(ptOf(pl.point_id)) && (!ttF() || pl.test_type === ttF());
  const ptOf = id => points.find(p => p.id === id) || {};
  const plOf = id => plans.find(p => p.id === id) || {};
  const crit = pl => pl.kind === "detect" ? "ต้องไม่พบ" : pl.kind === "pf" ? "ต้องผ่าน" :
    (pl.lo != null && pl.hi != null ? `${num(pl.lo)} ถึง ${num(pl.hi)}` : pl.hi != null ? `ไม่เกิน ${num(pl.hi)}` : pl.lo != null ? `ไม่ต่ำกว่า ${num(pl.lo)}` : "ไม่มีเกณฑ์") +
    (pl.unit ? " " + pl.unit : "") + (pl.warn != null ? ` (เฝ้าระวังตั้งแต่ ${num(pl.warn)})` : "");
  const valTxt = r => { const pl = plOf(r.plan_id); return r.qual ? QUAL[r.qual] : (r.val_text || num(r.value)) + (pl.unit ? " " + pl.unit : ""); };
  // a lab value as written: 12 · 1,250 · <0.1 · >16,000 · ND / ไม่พบ (= 0) → { value, text } ; text is kept only when it is not a plain number
  const parseVal = raw => { const t = String(raw || "").trim(); if (!t) return null;
    if (/^(nd|n\.d\.|ไม่พบ|not detected)$/i.test(t)) return { value: 0, text: "ND" };
    const m = t.replace(/,/g, "").match(/^([<>≤≥]=?)?\s*(-?\d+(?:\.\d+)?)$/); if (!m) return { bad: true };
    return { value: +m[2], text: m[1] ? m[1] + num(m[2]) : null }; };
  const livePlans = () => plans.filter(p => p.active && ptOf(p.point_id).active && plOk(p));
  const lastOf = id => results.find(r => r.plan_id === id);   // results are newest first
  function dueOf(pl) {
    const l = lastOf(pl.id), last = l ? l.sampled_on : null, nx = nextDue(last, pl.freq), t = today();
    const st = !last ? "never" : nx < t ? "over" : nx <= addD(t, SOON[pl.freq] || 0) ? "soon" : "ok";
    return { pl, pt: ptOf(pl.point_id), last, lastR: l, next: nx, st, late: st === "over" ? daysBetween(nx, t) : 0 };
  }

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
    const pt2 = hosps.find(h => h.code === "PT2"), qh = hosps.find(h => h.code === (new URLSearchParams(location.search).get("h") || "").toUpperCase());
    // a link with ?h=CODE opens that hospital; otherwise PT2 (the JCI survey is at PT2) when this account may see it
    $("#h").value = qh ? qh.id : pt2 ? pt2.id : hosps.some(h => h.id === me.hospital_id) ? me.hospital_id : hosps[0].id; $("#h").disabled = hosps.length < 2;
    $("#grp").innerHTML = `<option value="">ทุกกลุ่ม</option>` + Object.entries(GRP).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    $("#tt").innerHTML = `<option value="">ตรวจเชื้อ + สารเคมี</option>` + Object.entries(TT).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    sysOpts();
    $("#pS").innerHTML = Object.entries(GRP).map(([g, gn]) => `<optgroup label="${esc(gn)}">${Object.entries(SYS).filter(([k]) => grpOf(k) === g).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</optgroup>`).join("");
    $("#rD").value = today(); $("#hT").value = today(); $("#hF").value = addM(today(), -12);
    $("#tabAll").hidden = hosps.length < 2;
    const t = await sb.from("water_templates").select("*").order("system").order("sort"); if (t.error) { toast(errText(t.error), true); return; } tpl = t.data || [];
    $("#body").hidden = false; $("#tabs").hidden = false;
    const q = new URLSearchParams(location.search);
    await load(); show(q.get("tab") || "sum");
  }
  async function load() {
    const h = $("#h").value;
    canMan = exec || (MGR.includes(me.role) && hosps.some(x => x.id === h));
    canRec = exec || (me.role !== "observer" && hosps.some(x => x.id === h));
    $("#ro").textContent = canMan ? "" : canRec ? "บันทึกผลได้ (เพิ่มจุดตรวจ แก้เกณฑ์ และปิดรายการแก้ไขได้เฉพาะหัวหน้า)" : "ดูได้อย่างเดียว";
    $("#regPanel").hidden = !canMan; $("#recPanel").hidden = !canRec;
    const since = addM(today(), -24);
    const [p, l, r, a] = await Promise.all([
      sb.from("water_points").select("*").eq("hospital_id", h).order("system").order("code"),
      sb.from("water_plans").select("*").eq("hospital_id", h).order("sort"),
      sb.from("water_results").select("*").eq("hospital_id", h).gte("sampled_on", since).order("sampled_on", { ascending: false }).order("id", { ascending: false }).limit(5000),
      sb.from("water_actions").select("*").eq("hospital_id", h).order("created_at", { ascending: false })]);
    for (const x of [p, l, r, a]) if (x.error) throw x.error;
    // lab files and saved AI summaries (tables added with the file import; an empty list when not reachable)
    const [wf, wa] = await Promise.all([sb.from("water_files").select("*").eq("hospital_id", h).order("month", { ascending: false }).order("id", { ascending: false }).limit(1000),
      sb.from("water_ai").select("*").eq("hospital_id", h).order("created_at", { ascending: false }).limit(60)]);
    wfiles = wf.error ? [] : wf.data || []; aiReps = wa.error ? [] : wa.data || [];
    points = p.data || []; plans = l.data || []; results = r.data || []; actions = a.data || [];
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  const TABS = ["sum", "c_DRINK", "c_USE", "c_WASTE", "imp", "due", "rec", "hist", "act", "reg", "std", "all"];
  function show(t) {
    cur = TABS.includes(t) ? t : "sum";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    TABS.filter(k => !k.startsWith("c_")).forEach(k => $("#tab-" + k).hidden = k !== cur); $("#tab-cat").hidden = !cur.startsWith("c_");
    if (cur.startsWith("c_")) { try { rCat(cur.slice(2)); } catch (e) { toast(errText(e), true); } return; }
    try { ({ imp: rImp, sum: rSum, due: rDue, rec: rRec, hist: rHist, act: rAct, reg: rReg, std: rStd, all: rAll })[cur](); } catch (e) { toast(errText(e), true); }
  }
  $("#h").onchange = guard(async () => { await load(); show(cur); });
  function sysOpts() { const v = sysF(), ks = Object.keys(SYS).filter(k => !grpF() || grpOf(k) === grpF());
    $("#sys").innerHTML = `<option value="">ทุกระบบ${grpF() ? "ใน" + GRP[grpF()] : ""}</option>` + ks.map(k => `<option value="${k}">${esc(SYS[k])}</option>`).join("");
    if (ks.includes(v)) $("#sys").value = v; }
  $("#sys").onchange = () => show(cur);
  $("#grp").onchange = () => { sysOpts(); show(cur); };
  $("#tt").onchange = () => show(cur);
  $("#per").onchange = () => rSum();
  const period = () => `${hosp().code || ""} · ${sysF() ? SYS[sysF()] : grpF() ? GRP[grpF()] : "ทุกกลุ่มน้ำ"}${ttF() ? " · " + TT[ttF()] : ""} · ข้อมูล ณ ${dTH(today())}`;

  // ---------- ภาพรวม ----------
  function summary() {
    const days = +$("#per").value, from = addD(today(), -days), lp = livePlans(), ids = new Set(lp.map(p => p.id));
    const due = lp.map(dueOf), res = results.filter(r => ids.has(r.plan_id) && r.sampled_on >= from);
    const pts = points.filter(p => p.active && ptOk(p));
    const okSched = due.filter(d => d.st === "ok" || d.st === "soon").length, pass = res.filter(r => r.status !== "fail").length;
    const acts = actions.filter(a => { if (!sysF() && !grpF() && !ttF()) return true; const r = results.find(x => x.id === a.result_id); return !!r && ids.has(r.plan_id); });
    const open = acts.filter(a => a.status === "open"), openLate = open.filter(a => a.due && a.due < today());
    return { days, from, lp, due, res, pts, okSched, pass, fails: res.filter(r => r.status === "fail"), warns: res.filter(r => r.status === "warn"), acts, open, openLate,
      over: due.filter(d => d.st === "over"), never: due.filter(d => d.st === "never"), soon: due.filter(d => d.st === "soon") };
  }
  const cls = v => v == null ? "" : v >= 95 ? "good" : v >= 80 ? "mid" : "bad";
  // กลุ่มน้ำ × ชนิดการตรวจ (น้ำกินดื่ม / น้ำใช้ / น้ำเสีย × ตรวจเชื้อ / สารเคมี)
  function byGT(S) { const out = [];
    Object.keys(GRP).forEach(g => Object.keys(TT).forEach(t => { const d = S.due.filter(x => grpOf(x.pt.system) === g && x.pl.test_type === t), ids = new Set(d.map(x => x.pl.id)), r = S.res.filter(x => ids.has(x.plan_id)), f = r.filter(x => x.status === "fail").length;
      if (d.length) out.push([GRP[g], TT[t], d.length, d.filter(x => x.st === "over").length, d.filter(x => x.st === "never").length, pct(d.filter(x => x.st === "ok" || x.st === "soon").length, d.length), r.length, f, pct(r.length - f, r.length)]); }));
    return out; }
  const GT_HEAD = ["กลุ่มน้ำ", "ชนิดการตรวจ", "รายการ", "เลยกำหนด", "ยังไม่เคย", "ตรวจตามกำหนด %", "ตรวจ (ครั้ง)", "นอกเกณฑ์", "ผ่าน %"];
  function bySys(S) {
    return Object.keys(SYS).map(k => { const d = S.due.filter(x => x.pt.system === k), ids = new Set(d.map(x => x.pl.id)), r = S.res.filter(x => ids.has(x.plan_id)), f = r.filter(x => x.status === "fail").length;
      return [`${GRP[grpOf(k)]} · ${SYS[k]}`, S.pts.filter(p => p.system === k).length, d.length, d.filter(x => x.st === "over").length, d.filter(x => x.st === "never").length, pct(d.filter(x => x.st === "ok" || x.st === "soon").length, d.length), r.length, f, pct(r.length - f, r.length)]; })
      .filter(r => r[1] || r[2]);
  }
  function texts(S) {
    const sch = pct(S.okSched, S.lp.length), pr = pct(S.pass, S.res.length), H = hosp().code || "";
    const findings = [
      `${H} มีจุดตรวจน้ำที่ใช้งาน ${S.pts.length} จุด รายการตรวจตามแผน ${S.lp.length} รายการ (${Object.keys(SYS).filter(k => S.pts.some(p => p.system === k)).map(k => SYS[k]).join(", ") || "ยังไม่มีจุดตรวจ"})`,
      S.lp.length ? `ตรวจตามกำหนด ${S.okSched} จาก ${S.lp.length} รายการ (${sch}%) เลยกำหนด ${S.over.length} รายการ ยังไม่เคยตรวจ ${S.never.length} รายการ` : "ยังไม่มีแผนการตรวจ ให้หัวหน้าเพิ่มจุดตรวจในแท็บ ทะเบียนจุดตรวจ",
      S.res.length ? `ใน ${S.days} วันล่าสุด ตรวจ ${S.res.length} ครั้ง ผ่านเกณฑ์ ${S.pass} ครั้ง (${pr}%) นอกเกณฑ์ ${S.fails.length} ครั้ง อยู่ในระดับเฝ้าระวัง ${S.warns.length} ครั้ง` : `ใน ${S.days} วันล่าสุดยังไม่มีผลตรวจ`,
      `รายการแก้ไขที่ยังไม่ปิด ${S.open.length} รายการ${S.openLate.length ? ` ในจำนวนนี้เลยวันที่ต้องเสร็จแล้ว ${S.openLate.length} รายการ` : ""} ปิดแล้วทั้งหมด ${S.acts.filter(a => a.status === "done").length} รายการ`];
    Object.keys(GRP).forEach(g => { const rows = byGT(S).filter(r => r[0] === GRP[g]); if (!rows.length) return;
      findings.push(`${GRP[g]}: ` + rows.map(r => `${r[1]} ${r[2]} รายการ ตรวจ ${r[6]} ครั้ง นอกเกณฑ์ ${r[7]} ครั้ง${r[4] + r[3] ? ` (เลยกำหนด ${r[3]} ยังไม่เคย ${r[4]})` : ""}`).join(" · ")); });
    const analysis = [];
    const bs = bySys(S);
    bs.filter(r => r[7]).sort((a, b) => (a[8] ?? 100) - (b[8] ?? 100)).forEach((r, i) => analysis.push(`${r[0]}: นอกเกณฑ์ ${r[7]} จาก ${r[6]} ครั้ง (ผ่าน ${r[8]}%) ${i ? "ต้องมีสาเหตุ การแก้ไข และผลตรวจซ้ำของทุกครั้งที่นอกเกณฑ์" : "ผ่านเกณฑ์น้อยที่สุด ควรทบทวนการควบคุมของระบบนี้เป็นลำดับแรก"}`));
    const rep = new Map(); S.fails.forEach(r => rep.set(r.plan_id, (rep.get(r.plan_id) || 0) + 1));
    [...rep].filter(([, n]) => n >= 2).forEach(([id, n]) => { const pl = plOf(id), pt = ptOf(pl.point_id);
      analysis.push(`นอกเกณฑ์ซ้ำ: ${pt.code} ${pt.name} · ${pl.param} นอกเกณฑ์ ${n} ครั้งในช่วงนี้ แสดงว่าการแก้ไขครั้งก่อนยังไม่ได้แก้ที่สาเหตุ ควรทำ RCA และทบทวนวิธีบำบัดน้ำ`); });
    const fb = S.fails.filter(r => plOf(r.plan_id).test_type === "bio"), fc = S.fails.filter(r => plOf(r.plan_id).test_type !== "bio");
    if (fb.length) analysis.push(`ตรวจเชื้อนอกเกณฑ์ ${fb.length} ครั้ง (${fb.map(r => `${GRP[grpOf(ptOf(plOf(r.plan_id).point_id).system)]} ${ptOf(plOf(r.plan_id).point_id).code} ${plOf(r.plan_id).param}`).join(", ")}) มีความเสี่ยงการติดเชื้อโดยตรง ต้องแจ้งคณะกรรมการควบคุมการติดเชื้อทุกครั้ง`);
    if (fc.length) analysis.push(`สารเคมีนอกเกณฑ์ ${fc.length} ครั้ง (${fc.map(r => `${GRP[grpOf(ptOf(plOf(r.plan_id).point_id).system)]} ${ptOf(plOf(r.plan_id).point_id).code} ${plOf(r.plan_id).param}`).join(", ")}) ต้องปรับการบำบัดน้ำหรือการจ่ายสารเคมีและตรวจซ้ำ`);
    const ww = S.fails.filter(r => ptOf(plOf(r.plan_id).point_id).system === "WW");
    if (ww.length) analysis.push(`น้ำทิ้งเกินมาตรฐาน ${ww.length} ครั้ง ต้องแก้ไขก่อนระบายออกสู่ท่อสาธารณะ และเก็บบันทึกตามแบบ ทส.1 / ทส.2 เป็นหลักฐานต่อสำนักงานสิ่งแวดล้อม`);
    const leg = S.fails.filter(r => /legionella/i.test(plOf(r.plan_id).param || ""));
    if (leg.length) analysis.push(`พบ Legionella เกินเกณฑ์ ${leg.length} ครั้ง (${leg.map(r => `${ptOf(plOf(r.plan_id).point_id).code} วันที่ ${dTH(r.sampled_on)} ค่า ${valTxt(r)}`).join(", ")}) ต้องแจ้งคณะกรรมการควบคุมการติดเชื้อ ฆ่าเชื้อแบบเข้มข้น และตรวจซ้ำจนผ่าน`);
    const ro = S.fails.filter(r => ["RO_HD", "RO_CSSD"].includes(ptOf(plOf(r.plan_id).point_id).system));
    if (ro.length) analysis.push(`น้ำ RO นอกเกณฑ์ ${ro.length} ครั้ง มีผลต่อความปลอดภัยผู้ป่วยฟอกไตและการล้างเครื่องมือ ต้องแจ้งหน่วยไตเทียม / หน่วยจ่ายกลาง และบันทึกการหยุดใช้น้ำ`);
    if (S.over.length) analysis.push(`เลยกำหนดตรวจ ${S.over.length} รายการ นานที่สุด ${Math.max(...S.over.map(d => d.late))} วัน (${S.over.sort((a, b) => b.late - a.late).slice(0, 5).map(d => `${d.pt.code} ${d.pl.param} เลย ${d.late} วัน`).join(", ")}) ผู้ตรวจของ JCI จะถามหลักฐานการตรวจตามความถี่ในแผน`);
    if (S.never.length) analysis.push(`ยังไม่เคยมีผลตรวจ ${S.never.length} รายการ ควรเก็บตัวอย่างให้ครบอย่างน้อย 1 รอบก่อนวันตรวจประเมิน`);
    if (S.openLate.length) analysis.push(`รายการแก้ไขเลยวันที่ต้องเสร็จ ${S.openLate.length} รายการ ต้องติดตามผู้รับผิดชอบและบันทึกผลตรวจซ้ำ`);
    const noRetest = S.acts.filter(a => a.status === "done" && !a.retest_result_id).length;
    if (noRetest) analysis.push(`ปิดรายการแก้ไขโดยยังไม่มีผลตรวจซ้ำ ${noRetest} รายการ ควรเก็บตัวอย่างซ้ำเพื่อยืนยันว่าผ่านเกณฑ์แล้ว`);
    if (!analysis.length) analysis.push(S.lp.length ? "ทุกรายการตรวจตามกำหนด ไม่มีผลนอกเกณฑ์ค้าง ให้คงการตรวจตามความถี่และเก็บรายงานผลไว้เป็นหลักฐาน" : "ยังไม่มีข้อมูลให้วิเคราะห์ เริ่มจากเพิ่มจุดตรวจและบันทึกผลตรวจ");
    const notes = ["หลักฐานสำหรับ JCI 8th FMS.08.04: แผนจัดการน้ำ ผลตรวจตามความถี่ ผลนอกเกณฑ์พร้อมการแก้ไข และผลตรวจซ้ำ",
      "เกณฑ์เริ่มต้นตาม HSE ACOP L8, ASHRAE 188, ISO 23500, AAMI ST108 และเกณฑ์น้ำประปาดื่มได้ของกรมอนามัย แต่ละโรงต้องปรับให้ตรงแผนที่คณะกรรมการ IC อนุมัติ",
      "ตัวอย่างที่ส่งห้องปฏิบัติการ ควรใช้ห้องปฏิบัติการที่ได้รับรอง ISO/IEC 17025 และแนบเลขที่รายงานผลทุกครั้ง"];
    return { findings, analysis, notes, sch, pr };
  }
  function rSum() {
    const S = summary(), T = texts(S);
    $("#tot").innerHTML = [["จุดตรวจที่ใช้งาน", S.pts.length], ["ตรวจตามกำหนด", T.sch == null ? "-" : T.sch + "%", cls(T.sch)], [`ผ่านเกณฑ์ (${S.days} วัน)`, T.pr == null ? "-" : T.pr + "%", cls(T.pr)],
      ["เลยกำหนด / ยังไม่เคย", S.over.length + S.never.length, S.over.length + S.never.length ? "bad" : "good"], [`นอกเกณฑ์ (${S.days} วัน)`, S.fails.length, S.fails.length ? "bad" : "good"], ["แก้ไขยังไม่ปิด", S.open.length, S.open.length ? "bad" : "good"]]
      .map(([l, v, c]) => `<div class="kpi"><b class="${c || ""}">${esc(String(v))}</b><span>${esc(l)}</span></div>`).join("");
    $("#alert").innerHTML = S.openLate.length ? `<div class="note bad">มีรายการแก้ไขเลยวันที่ต้องเสร็จ ${S.openLate.length} รายการ ดูที่แท็บ "นอกเกณฑ์ · การแก้ไข"</div>` : "";
    $("#find").innerHTML = T.findings.map(t => `<li>${esc(t)}</li>`).join("");
    $("#anal").innerHTML = T.analysis.map(t => `<li>${esc(t)}</li>`).join("");
    const gt = byGT(S);
    $("#byGT").innerHTML = `<tr>${GT_HEAD.map(h => `<th>${h}</th>`).join("")}</tr>` + (gt.length ? gt.map(r => `<tr><td>${esc(r[0])}</td><td><span class="pill ${r[1] === TT.bio ? "bio" : "chem"}">${esc(r[1])}</span></td>${r.slice(2).map((v, i) => `<td class="n ${i === 3 || i === 6 ? (v == null ? "" : v >= 95 ? "ok" : v >= 80 ? "soon" : "over") : ""}">${v ?? "-"}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="9">ยังไม่มีรายการตรวจ</td></tr>`);
    const bs = bySys(S);
    $("#bySys").innerHTML = `<tr><th>ระบบน้ำ</th><th>จุดตรวจ</th><th>รายการ</th><th>เลยกำหนด</th><th>ยังไม่เคย</th><th>ตรวจตามกำหนด %</th><th>ตรวจ (ครั้ง)</th><th>นอกเกณฑ์</th><th>ผ่าน %</th></tr>` +
      (bs.length ? bs.map(r => `<tr><td>${esc(r[0])}</td>${r.slice(1).map((v, i) => `<td class="n ${i === 4 || i === 7 ? (v == null ? "" : v >= 95 ? "ok" : v >= 80 ? "soon" : "over") : ""}">${v ?? "-"}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="9">ยังไม่มีจุดตรวจ เพิ่มที่แท็บ "ทะเบียนจุดตรวจ"</td></tr>`);
    $("#fails").innerHTML = `<tr><th>วันที่</th><th>กลุ่มน้ำ</th><th>จุดตรวจ</th><th>รายการ</th><th>ผล</th><th>เกณฑ์</th><th>การแก้ไข</th></tr>` +
      (S.fails.length ? S.fails.map(r => { const pl = plOf(r.plan_id), pt = ptOf(pl.point_id), a = actions.find(x => x.result_id === r.id);
        return `<tr><td>${dTH(r.sampled_on)}</td><td>${GRP[grpOf(pt.system)]}</td><td>${esc(pt.code)} ${esc(pt.name)}</td><td>${esc(pl.param)} ${ttPill(pl)}</td><td class="fail">${esc(valTxt(r))}</td><td>${esc(crit(pl))}</td><td>${a ? (a.status === "done" ? "ปิดแล้ว" : "ยังไม่ปิด") + (a.job_no ? " · ใบงาน " + esc(a.job_no) : "") : "-"}</td></tr>`; }).join("") : `<tr><td colspan="7">ไม่มีผลนอกเกณฑ์ในช่วงนี้</td></tr>`);
  }
  const resRow = r => { const pl = plOf(r.plan_id), pt = ptOf(pl.point_id); return [dTH(r.sampled_on), GRP[grpOf(pt.system)], SYS[pt.system] || "", TT[pl.test_type] || "", pt.code || "", pt.name || "", pl.param || "", r.qual ? QUAL[r.qual] : (r.val_text || r.value), pl.unit || "", crit(pl), RST[r.status], r.lab || "", r.report_no || "", r.note || ""]; };
  const RES_HEAD = ["วันที่เก็บตัวอย่าง", "กลุ่มน้ำ", "ระบบน้ำ", "ชนิดการตรวจ", "รหัสจุด", "จุดตรวจ", "รายการ", "ผล", "หน่วย", "เกณฑ์", "สรุป", "ผู้ตรวจ / ห้องปฏิบัติการ", "เลขที่รายงาน", "หมายเหตุ"];
  const dueRow = d => [GRP[grpOf(d.pt.system)], SYS[d.pt.system] || "", TT[d.pl.test_type] || "", d.pt.code, d.pt.name, d.pt.location || "", d.pl.param, FREQ[d.pl.freq], crit(d.pl), dTH(d.last), d.lastR ? RST[d.lastR.status] : "-", dTH(d.next), DST[d.st], d.late || ""];
  const DUE_HEAD = ["กลุ่มน้ำ", "ระบบน้ำ", "ชนิดการตรวจ", "รหัสจุด", "จุดตรวจ", "ที่ตั้ง", "รายการ", "ความถี่", "เกณฑ์", "ตรวจล่าสุด", "ผลล่าสุด", "ครบกำหนด", "สถานะ", "เลยกำหนด (วัน)"];
  const actRow = a => { const r = results.find(x => x.id === a.result_id) || {}, rt = results.find(x => x.id === a.retest_result_id);
    return [dTH(r.sampled_on), a.problem || "", a.cause || "", a.action || "", a.owner || "", dTH(a.due), a.job_no || "", rt ? `${dTH(rt.sampled_on)} ${valTxt(rt)} (${RST[rt.status]})` : "", a.status === "done" ? "ปิดแล้ว" : a.due && a.due < today() ? "ยังไม่ปิด (เลยวันที่ต้องเสร็จ)" : "ยังไม่ปิด", a.closed_at ? dTH(a.closed_at) : ""]; };
  const ACT_HEAD = ["วันที่พบ", "ปัญหา", "สาเหตุ", "การแก้ไข", "ผู้รับผิดชอบ", "ต้องเสร็จ", "ใบแจ้งซ่อม", "ผลตรวจซ้ำ", "สถานะ", "ปิดเมื่อ"];
  const fileName = k => `น้ำ_${k}_${hosp().code || ""}_${dTH(today()).replace(/\s/g, "")}`;
  $("#oX").onclick = () => { const S = summary(), T = texts(S);
    Office.xlsx(fileName("บทสรุป"), [Office.summarySheet({ title: "สรุปแผนจัดการน้ำ (Water Management, JCI FMS.08.04)", org: hosp().name, period: period(), findings: [...T.findings, ...T.analysis], notes: T.notes,
        figures: [["จุดตรวจที่ใช้งาน", S.pts.length], ["รายการตรวจตามแผน", S.lp.length], ["ตรวจตามกำหนด (%)", T.sch ?? "-"], [`ผลตรวจ ${S.days} วัน (ครั้ง)`, S.res.length], ["ผ่านเกณฑ์ (%)", T.pr ?? "-"], ["นอกเกณฑ์ (ครั้ง)", S.fails.length], ["แก้ไขยังไม่ปิด", S.open.length]] }),
      { name: "กลุ่มน้ำ × ชนิดการตรวจ", rows: [GT_HEAD, ...byGT(S)], header: 0 },
      { name: "แยกตามระบบ", rows: [["ระบบน้ำ", "จุดตรวจ", "รายการ", "เลยกำหนด", "ยังไม่เคย", "ตรวจตามกำหนด %", "ตรวจ (ครั้ง)", "นอกเกณฑ์", "ผ่าน %"], ...bySys(S)], header: 0 },
      { name: "ตารางตรวจ", rows: [DUE_HEAD, ...S.due.map(dueRow)], header: 0 },
      { name: "ผลตรวจ", rows: [RES_HEAD, ...S.res.map(resRow)], header: 0 },
      { name: "การแก้ไข", rows: [ACT_HEAD, ...S.acts.map(actRow)], header: 0 }]); };
  $("#wP").onclick = () => { const S = summary(), T = texts(S), bs = bySys(S);
    const d = { title: "สรุปแผนจัดการน้ำ (Water Management, JCI FMS.08.04)", org: hosp().name, period: period(), findings: T.findings, analysis: T.analysis, notes: T.notes,
      kpis: [["จุดตรวจที่ใช้งาน", String(S.pts.length)], ["รายการตรวจตามแผน", String(S.lp.length)], ["ตรวจตามกำหนด", T.sch == null ? "-" : T.sch + "%"], [`ผ่านเกณฑ์ (${S.days} วัน)`, T.pr == null ? "-" : T.pr + "%"], ["นอกเกณฑ์", String(S.fails.length)], ["แก้ไขยังไม่ปิด", String(S.open.length)]],
      sections: [
        { title: "แยกตามกลุ่มน้ำ (น้ำกินดื่ม / น้ำใช้ / น้ำเสีย) และชนิดการตรวจ (ตรวจเชื้อ / สารเคมี)", head: GT_HEAD, rows: byGT(S).map(r => r.map(v => v ?? "-")), chart: false },
        { title: "ผ่านเกณฑ์ แยกตามกลุ่มน้ำและชนิดการตรวจ (%)", head: ["กลุ่มน้ำ · ชนิดการตรวจ", "ผ่าน %"], rows: byGT(S).filter(r => r[8] != null).map(r => [`${r[0]} · ${r[1]}`, r[8]]) },
        { title: "ตรวจตามกำหนด แยกตามระบบน้ำ (%)", head: ["ระบบน้ำ", "ตรวจตามกำหนด %"], rows: bs.filter(r => r[5] != null).map(r => [r[0], r[5]]) },
        { title: "แยกตามระบบน้ำ", head: ["ระบบน้ำ", "จุด", "รายการ", "เลยกำหนด", "ยังไม่เคย", "ตรวจ", "นอกเกณฑ์", "ผ่าน %"], rows: bs.map(r => [r[0], r[1], r[2], r[3], r[4], r[6], r[7], r[8] ?? "-"]), chart: false },
        { title: "ผลนอกเกณฑ์", head: ["วันที่", "กลุ่มน้ำ", "จุดตรวจ", "รายการ", "ชนิด", "ผล", "เกณฑ์", "การแก้ไข"], rows: S.fails.map(r => { const pl = plOf(r.plan_id), pt = ptOf(pl.point_id), a = actions.find(x => x.result_id === r.id);
          return [dTH(r.sampled_on), GRP[grpOf(pt.system)], `${pt.code} ${pt.name}`, pl.param, TT[pl.test_type], valTxt(r), crit(pl), a ? (a.status === "done" ? "ปิดแล้ว" : "ยังไม่ปิด") + (a.action ? ": " + a.action : "") : "-"]; }), chart: false },
        { title: "รายการที่เลยกำหนดตรวจ / ยังไม่เคยตรวจ", head: ["จุดตรวจ", "รายการ", "ความถี่", "ตรวจล่าสุด", "ครบกำหนด", "สถานะ"], rows: [...S.over, ...S.never].map(x => [`${x.pt.code} ${x.pt.name}`, x.pl.param, FREQ[x.pl.freq], dTH(x.last), dTH(x.next), DST[x.st] + (x.late ? ` ${x.late} วัน` : "")]), chart: false },
        { title: "รายการแก้ไขที่ยังไม่ปิด", head: ["ปัญหา", "การแก้ไข", "ผู้รับผิดชอบ", "ต้องเสร็จ", "ใบแจ้งซ่อม"], rows: S.open.map(a => [a.problem || "", a.action || "ยังไม่ได้เขียน", a.owner || "-", dTH(a.due), a.job_no || "-"]), chart: false }] };
    return Office.pptx(fileName("บทสรุปผู้บริหาร"), d).catch(e => toast(errText(e), true)); };

  // ---------- ตารางตรวจ ----------
  const dueList = () => { const f = $("#dF").value, rank = { over: 0, never: 1, soon: 2, ok: 3 };
    return livePlans().map(dueOf).filter(d => !f || (f === "over" ? d.st === "over" : d.st !== "ok"))
      .sort((a, b) => rank[a.st] - rank[b.st] || b.late - a.late || (a.next || "").localeCompare(b.next || "") || a.pt.code.localeCompare(b.pt.code)); };
  function rDue() {
    const L = dueList();
    $("#dList").innerHTML = `<tr><th>จุดตรวจ</th><th>รายการ</th><th>ความถี่</th><th>เกณฑ์</th><th>ตรวจล่าสุด</th><th>ผลล่าสุด</th><th>ครบกำหนด</th><th>สถานะ</th><th></th></tr>` +
      (L.length ? L.map(d => `<tr><td>${esc(d.pt.code)} ${esc(d.pt.name)}<br><span class="sub">${GRP[grpOf(d.pt.system)]} · ${esc(SYS[d.pt.system] || "")}${d.pt.location ? " · " + esc(d.pt.location) : ""}</span></td><td>${esc(d.pl.param)} ${ttPill(d.pl)}</td><td>${FREQ[d.pl.freq]}</td><td>${esc(crit(d.pl))}</td>
        <td>${dTH(d.last)}</td><td class="${d.lastR ? d.lastR.status : ""}">${d.lastR ? esc(valTxt(d.lastR)) : "-"}</td><td>${dTH(d.next)}</td><td class="${d.st}">${DST[d.st]}${d.late ? ` ${d.late} วัน` : ""}</td>
        <td>${canRec ? `<button class="btn small" type="button" data-rec="${d.pt.id}">บันทึกผล</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="9">${livePlans().length ? "ไม่มีรายการที่ต้องตรวจตามตัวกรองนี้" : "ยังไม่มีแผนการตรวจ เพิ่มจุดตรวจที่แท็บ \"ทะเบียนจุดตรวจ\""}</td></tr>`);
  }
  $("#dF").onchange = () => rDue();
  $("#dList").onclick = ev => { const b = ev.target.closest("[data-rec]"); if (!b) return; $("#rP").dataset.want = b.dataset.rec; show("rec"); };
  $("#dX").onclick = () => { const L = dueList();
    Office.table(fileName("ตารางตรวจ"), DUE_HEAD, L.map(dueRow), { title: "ตารางตรวจคุณภาพน้ำตามความถี่", org: hosp().name, period: period(),
      findings: [`แสดง ${L.length} รายการ: เลยกำหนด ${L.filter(d => d.st === "over").length} · ยังไม่เคยตรวจ ${L.filter(d => d.st === "never").length} · ใกล้ถึงกำหนด ${L.filter(d => d.st === "soon").length} · ยังไม่ถึงกำหนด ${L.filter(d => d.st === "ok").length}`],
      notes: ["วันครบกำหนด = วันที่ตรวจครั้งล่าสุด + ความถี่ของรายการตามแผนจัดการน้ำ"] }); };

  // ---------- บันทึกผล ----------
  function rRec() {
    const pts = points.filter(p => p.active && ptOk(p)), want = $("#rP").dataset.want || $("#rP").value;
    $("#rP").innerHTML = pts.length ? pts.map(p => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)} (${GRP[grpOf(p.system)]} · ${esc(SYS[p.system])})</option>`).join("") : `<option value="">ยังไม่มีจุดตรวจ</option>`;
    if (want && pts.some(p => String(p.id) === String(want))) $("#rP").value = want; delete $("#rP").dataset.want;
    recRows();
  }
  function recRows() {
    const id = +$("#rP").value, list = plans.filter(p => p.point_id === id && p.active && (!ttF() || p.test_type === ttF())).sort((a, b) => (a.test_type === "bio" ? 0 : 1) - (b.test_type === "bio" ? 0 : 1) || a.sort - b.sort);
    $("#rRows").innerHTML = `<tr><th>รายการ</th><th>เกณฑ์</th><th>ความถี่ / ครบกำหนด</th><th>ผลตรวจ</th><th>หมายเหตุ</th></tr>` +
      (list.length ? list.map(pl => { const d = dueOf(pl);
        const inp = pl.kind === "num" ? `<input class="sm" type="text" inputmode="decimal" data-v="${pl.id}" placeholder="เช่น 12, <0.1, ND" aria-label="ค่า ${esc(pl.param)}"> ${esc(pl.unit || "")}`
          : `<select data-v="${pl.id}" aria-label="ผล ${esc(pl.param)}"><option value="">ไม่ได้ตรวจ</option>${(pl.kind === "detect" ? ["nd", "detected"] : ["pass", "fail"]).map(k => `<option value="${k}">${QUAL[k]}</option>`).join("")}</select>`;
        return `<tr><td>${ttPill(pl)} ${esc(pl.param)}${pl.method ? `<br><span class="sub">${esc(pl.method)}</span>` : ""}</td><td>${esc(crit(pl))}</td><td class="${d.st}">${FREQ[pl.freq]}<br>${d.next ? "ครบ " + dTH(d.next) : "ยังไม่เคยตรวจ"}</td><td>${inp}</td><td><input data-n="${pl.id}" aria-label="หมายเหตุ"></td></tr>`; }).join("")
        : `<tr><td colspan="5">จุดนี้ยังไม่มีรายการตรวจ ให้หัวหน้าเพิ่มที่แท็บ "ทะเบียนจุดตรวจ"</td></tr>`);
  }
  $("#rP").onchange = () => recRows();
  $("#fR").onsubmit = guard(async () => {
    const rows = [...document.querySelectorAll("#rRows [data-v]")].filter(i => i.value !== "").map(i => { const pl = plOf(+i.dataset.v), n = document.querySelector(`#rRows [data-n="${pl.id}"]`).value.trim();
      const pv = pl.kind === "num" ? parseVal(i.value) : null; if (pv && pv.bad) throw new Error(`ค่า "${i.value}" ของ ${pl.param} อ่านไม่ได้ ให้กรอกตัวเลข เช่น 12 หรือ <0.1 หรือ >16000 หรือ ND`);
      return { plan_id: pl.id, hospital_id: pl.hospital_id, sampled_on: $("#rD").value, value: pv ? pv.value : null, val_text: pv ? pv.text : null, qual: pl.kind === "num" ? null : i.value,
        lab: $("#rLab").value.trim() || null, report_no: $("#rNo").value.trim() || null, note: n || null, recorded_by: me.id }; });
    if (!rows.length) throw new Error("กรอกผลอย่างน้อย 1 รายการ");
    if ($("#rD").value > today()) throw new Error("วันที่เก็บตัวอย่างต้องไม่เป็นวันในอนาคต");
    const { data, error } = await sb.from("water_results").insert(rows).select(); if (error) throw error;
    await load(); recRows();
    const bad = (data || []).filter(r => r.status === "fail");
    $("#rDone").innerHTML = `<div class="note ${bad.length ? "bad" : ""}"><b>บันทึกแล้ว ${data.length} รายการ</b>${(data || []).map(r => `<br>${esc(plOf(r.plan_id).param)} = ${esc(valTxt(r))} · <b>${RST[r.status]}</b>`).join("")}
      ${bad.length ? `<br><br>นอกเกณฑ์ ${bad.length} รายการ ระบบเปิดรายการแก้ไขให้แล้ว <button class="btn small" type="button" id="goAct">ไปที่รายการแก้ไข</button>` : ""}</div>`;
    const g = $("#goAct"); if (g) g.onclick = () => show("act");
    document.querySelectorAll("#rRows [data-v],#rRows [data-n]").forEach(i => i.value = "");
    toast(bad.length ? `บันทึกแล้ว มีนอกเกณฑ์ ${bad.length} รายการ` : "บันทึกแล้ว ผ่านเกณฑ์ทั้งหมด", !!bad.length);
  });

  // ---------- ผลย้อนหลัง · แนวโน้ม ----------
  function rHist() {
    const pts = points.filter(ptOk), pv = $("#hP").value;
    $("#hP").innerHTML = `<option value="">ทุกจุดตรวจ</option>` + pts.map(p => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join("");
    if (pts.some(p => String(p.id) === pv)) $("#hP").value = pv;
    const iv = $("#hI").value, pl = plans.filter(x => (!$("#hP").value || x.point_id === +$("#hP").value) && plOk(x));
    $("#hI").innerHTML = `<option value="">ทุกรายการ</option>` + pl.map(x => `<option value="${x.id}">${esc(ptOf(x.point_id).code)} · ${TT[x.test_type]} · ${esc(x.param)}</option>`).join("");
    if (pl.some(x => String(x.id) === iv)) $("#hI").value = iv;
    const L = histList();
    $("#hList").innerHTML = `<tr><th>วันที่</th><th>จุดตรวจ</th><th>รายการ</th><th>ผล</th><th>เกณฑ์</th><th>สรุป</th><th>ผู้ตรวจ / ห้องปฏิบัติการ</th><th>เลขที่รายงาน</th><th>หมายเหตุ</th></tr>` +
      (L.length ? L.map(r => { const p = plOf(r.plan_id), t = ptOf(p.point_id); return `<tr><td>${dTH(r.sampled_on)}</td><td>${esc(t.code)} ${esc(t.name)}</td><td>${esc(p.param)}</td><td class="n">${esc(valTxt(r))}</td><td>${esc(crit({ ...p, lo: r.lo, hi: r.hi, warn: r.warn }))}</td><td class="${r.status}">${RST[r.status]}</td><td>${esc(r.lab || "")}</td><td>${esc(r.report_no || "")}</td><td>${esc(r.note || "")}</td></tr>`; }).join("")
        : `<tr><td colspan="9">ไม่มีผลตรวจในช่วงที่เลือก</td></tr>`);
    drawTrend();
  }
  const histList = () => { const pid = +$("#hP").value || null, iid = +$("#hI").value || null, f = $("#hF").value, t = $("#hT").value;
    return results.filter(r => { const p = plOf(r.plan_id); return p.id && (!iid || r.plan_id === iid) && (!pid || p.point_id === pid) && plOk(p) && (!f || r.sampled_on >= f) && (!t || r.sampled_on <= t); }); };
  ["#hP", "#hI", "#hF", "#hT"].forEach(s => $(s).onchange = () => rHist());
  function drawTrend() {
    const pl = plOf(+$("#hI").value);
    if (!pl.id || pl.kind !== "num") { $("#trend").innerHTML = `<p class="sub">เลือก "รายการ" ที่เป็นตัวเลข เพื่อดูกราฟแนวโน้มเทียบเกณฑ์</p>`; return; }
    const pts = histList().filter(r => r.value != null).slice().reverse();
    if (pts.length < 2) { $("#trend").innerHTML = `<p class="sub">ต้องมีผลตรวจอย่างน้อย 2 ครั้งจึงแสดงกราฟแนวโน้มได้</p>`; return; }
    const W = 900, H = 300, L = 70, R = 50, Tp = 30, B = 50, vals = pts.map(r => +r.value), lim = [pl.lo, pl.hi, pl.warn].filter(v => v != null).map(Number);
    let mn = Math.min(...vals, ...lim), mx = Math.max(...vals, ...lim); if (mn === mx) { mn -= 1; mx += 1; } const pad = (mx - mn) * 0.1; mn = Math.max(mn - pad, Math.min(0, mn)); mx += pad;
    const x = i => L + i * (W - L - R) / (pts.length - 1), y = v => Tp + (mx - v) * (H - Tp - B) / (mx - mn);
    const line = (v, c, t) => v == null ? "" : `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-dasharray="6 4" stroke-width="1.5"/><text x="${W - R}" y="${y(v) - 4}" text-anchor="end" font-size="12" fill="${c}">${esc(t)} ${num(v)}</text>`;
    const step = Math.ceil(pts.length / 8);
    $("#trend").innerHTML = `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟแนวโน้ม ${esc(pl.param)}">
      <text x="${L}" y="18" font-size="14" font-weight="600" fill="#17212b">${esc(ptOf(pl.point_id).code)} · ${esc(pl.param)}${pl.unit ? " (" + esc(pl.unit) + ")" : ""}</text>
      <line x1="${L}" x2="${L}" y1="${Tp}" y2="${H - B}" stroke="#9aa7b4"/><line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#9aa7b4"/>
      ${[mn, (mn + mx) / 2, mx].map(v => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#4b5563">${num(Math.round(v * 1000) / 1000)}</text>`).join("")}
      ${line(pl.hi, "#b42318", "เกณฑ์สูงสุด")}${line(pl.lo, "#b42318", "เกณฑ์ต่ำสุด")}${line(pl.warn, "#b7791f", "เฝ้าระวัง")}
      <polyline fill="none" stroke="#0b5cad" stroke-width="2" points="${pts.map((r, i) => `${x(i)},${y(+r.value)}`).join(" ")}"/>
      ${pts.map((r, i) => `<circle cx="${x(i)}" cy="${y(+r.value)}" r="4.5" fill="${r.status === "fail" ? "#b42318" : r.status === "warn" ? "#b7791f" : "#1f7a3d"}"><title>${dTH(r.sampled_on)}: ${num(r.value)}</title></circle>`).join("")}
      ${pts.map((r, i) => i % step ? "" : `<text x="${x(i)}" y="${H - B + 18}" text-anchor="middle" font-size="11" fill="#4b5563">${dTH(r.sampled_on)}</text>`).join("")}
    </svg>`;
  }
  $("#hX").onclick = () => { const L = histList();
    Office.table(fileName("ผลตรวจ"), RES_HEAD, L.map(resRow), { title: "ผลตรวจคุณภาพน้ำย้อนหลัง", org: hosp().name, period: `${period()} · ${dTH($("#hF").value)} ถึง ${dTH($("#hT").value)}`,
      findings: [`ผลตรวจ ${L.length} ครั้ง ผ่านเกณฑ์ ${L.filter(r => r.status !== "fail").length} ครั้ง (${pct(L.filter(r => r.status !== "fail").length, L.length) ?? "-"}%) นอกเกณฑ์ ${L.filter(r => r.status === "fail").length} ครั้ง เฝ้าระวัง ${L.filter(r => r.status === "warn").length} ครั้ง`],
      notes: ["เกณฑ์ในตารางเป็นเกณฑ์ที่ใช้ในวันที่ตรวจ (ถ้าแก้เกณฑ์ภายหลัง ผลเดิมไม่เปลี่ยน)"] }); };

  // ---------- นอกเกณฑ์ · การแก้ไข ----------
  const actList = () => { const f = $("#aF").value; return actions.filter(a => (!f || a.status === f) && (!sysF() && !grpF() && !ttF() || (() => { const r = results.find(x => x.id === a.result_id); return r && plOk(plOf(r.plan_id)); })())); };
  function rAct() {
    const L = actList();
    $("#aList").innerHTML = L.length ? L.map(a => { const r = results.find(x => x.id === a.result_id) || {}, late = a.status === "open" && a.due && a.due < today();
      const re = results.filter(x => x.plan_id === r.plan_id && x.sampled_on >= (r.sampled_on || "") && x.id !== r.id);
      const ed = a.status === "open" && canRec;
      return `<div class="act ${a.status}" data-a="${a.id}"><b>${esc(a.problem || "")}</b>
        <div class="sub">พบเมื่อ ${dTH(r.sampled_on)} · ${a.status === "done" ? `ปิดแล้ว ${dTH(a.closed_at)}` : late ? `<b style="color:#9b1c13">เลยวันที่ต้องเสร็จ (${dTH(a.due)})</b>` : `ต้องเสร็จ ${dTH(a.due)}`}${a.job_no ? ` · ใบแจ้งซ่อม <b>${esc(a.job_no)}</b>` : ""}</div>
        ${ed ? `<div class="g"><label>สาเหตุ<textarea data-f="cause">${esc(a.cause || "")}</textarea></label><label>การแก้ไข<textarea data-f="action" placeholder="เช่น ฆ่าเชื้อแบบเข้มข้น ล้างหอผึ่งเย็น เปลี่ยนไส้กรอง">${esc(a.action || "")}</textarea></label>
          <label>ผู้รับผิดชอบ<input data-f="owner" value="${esc(a.owner || "")}"></label><label>วันที่ต้องเสร็จ<input type="date" data-f="due" value="${esc(a.due || "")}"></label>
          <label>ผลตรวจซ้ำ<select data-f="retest"><option value="">ยังไม่มี</option>${re.map(x => `<option value="${x.id}" ${a.retest_result_id === x.id ? "selected" : ""}>${dTH(x.sampled_on)} · ${esc(valTxt(x))} · ${RST[x.status]}</option>`).join("")}</select></label></div>
          <div class="acts"><button class="btn small primary" type="button" data-save>บันทึก</button>${a.job_id ? "" : `<button class="btn small" type="button" data-job>เปิดใบแจ้งซ่อม</button>`}${canMan ? `<button class="btn small" type="button" data-close>ปิดรายการ (แก้ไขแล้ว)</button>` : ""}</div>`
        : `<div class="sub" style="margin-top:6px">สาเหตุ: ${esc(a.cause || "-")}<br>การแก้ไข: ${esc(a.action || "-")}<br>ผู้รับผิดชอบ: ${esc(a.owner || "-")}${(() => { const rt = results.find(x => x.id === a.retest_result_id); return rt ? `<br>ผลตรวจซ้ำ: ${dTH(rt.sampled_on)} ${esc(valTxt(rt))} (${RST[rt.status]})` : ""; })()}</div>`}</div>`; }).join("")
      : `<p class="sub">ไม่มีรายการ</p>`;
  }
  $("#aF").onchange = () => rAct();
  $("#aList").onclick = guard(async ev => {
    const box = ev.target.closest("[data-a]"); if (!box) return; const id = +box.dataset.a, v = k => { const e = box.querySelector(`[data-f="${k}"]`); return e ? e.value : ""; };
    if (ev.target.closest("[data-job]")) { const { data, error } = await sb.rpc("water_to_job", { p_id: id }); if (error) throw error; toast(`เปิดใบแจ้งซ่อม ${data} แล้ว`); await load(); return rAct(); }
    const close = !!ev.target.closest("[data-close]"); if (!close && !ev.target.closest("[data-save]")) return;
    if (close && !v("retest") && !confirm("ยังไม่ได้เลือกผลตรวจซ้ำ ต้องการปิดรายการเลยหรือไม่?")) return;
    const { error } = await sb.rpc("water_action_save", { p_id: id, p_cause: v("cause"), p_action: v("action"), p_owner: v("owner"), p_due: v("due") || null, p_close: close, p_retest: v("retest") ? +v("retest") : null });
    if (error) throw error; toast(close ? "ปิดรายการแล้ว" : "บันทึกแล้ว"); await load(); rAct(); });
  $("#aX").onclick = () => { const L = actList();
    Office.table(fileName("การแก้ไข"), ACT_HEAD, L.map(actRow), { title: "รายการแก้ไขผลตรวจน้ำนอกเกณฑ์", org: hosp().name, period: period(),
      findings: [`${L.length} รายการ: ยังไม่ปิด ${L.filter(a => a.status === "open").length} (เลยวันที่ต้องเสร็จ ${L.filter(a => a.status === "open" && a.due && a.due < today()).length}) · ปิดแล้ว ${L.filter(a => a.status === "done").length} · มีผลตรวจซ้ำ ${L.filter(a => a.retest_result_id).length}`],
      notes: ["ทุกผลนอกเกณฑ์ต้องมีสาเหตุ การแก้ไข และผลตรวจซ้ำที่ผ่านเกณฑ์ เป็นหลักฐานตาม JCI FMS.08.04"] }); };

  // ---------- ทะเบียนจุดตรวจ ----------
  function rReg() {
    const pts = points.filter(ptOk);
    $("#pList").innerHTML = pts.length ? pts.map(p => { const pl = plans.filter(x => x.point_id === p.id);
      return `<div class="pt" data-pt="${p.id}"><h3>${esc(p.code)} · ${esc(p.name)} ${p.active ? "" : '<span class="pill">ปิดใช้งาน</span>'}</h3>
        <div class="sub">${GRP[grpOf(p.system)]} · ${esc(SYS[p.system])}${p.location ? " · " + esc(p.location) : ""} · ${pl.filter(x => x.active).length} รายการตรวจ
          ${canMan ? ` <button class="btn small" type="button" data-pact>${p.active ? "ปิดใช้งานจุดนี้" : "เปิดใช้งาน"}</button>` : ""}</div>
        <div class="tw"><table class="tt"><tr><th>รายการ</th><th>ชนิด</th><th>หน่วย</th><th>ต่ำสุด</th><th>สูงสุด</th><th>เฝ้าระวัง</th><th>ความถี่</th><th>อ้างอิง</th><th>ใช้งาน</th>${canMan ? "<th></th>" : ""}</tr>
        ${pl.map(x => canMan ? `<tr data-pl="${x.id}"><td>${esc(x.param)}${x.kind !== "num" ? `<br><span class="sub">${x.kind === "detect" ? "ผล พบ / ไม่พบ" : "ผล ผ่าน / ไม่ผ่าน"}</span>` : ""}</td><td><select data-k="test_type">${Object.entries(TT).map(([k, v]) => `<option value="${k}" ${x.test_type === k ? "selected" : ""}>${v}</option>`).join("")}</select></td><td>${esc(x.unit || "")}</td>
            ${x.kind === "num" ? ["lo", "hi", "warn"].map(k => `<td><input class="sm" type="number" step="any" data-k="${k}" value="${x[k] ?? ""}" aria-label="${k}"></td>`).join("") : `<td colspan="3">-</td>`}
            <td><select data-k="freq">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${x.freq === k ? "selected" : ""}>${v}</option>`).join("")}</select></td><td>${esc(x.ref || "")}</td>
            <td><input type="checkbox" data-k="active" ${x.active ? "checked" : ""} aria-label="ใช้งาน"></td><td><button class="btn small" type="button" data-plsave>บันทึก</button></td></tr>`
          : `<tr><td>${esc(x.param)}</td><td>${ttPill(x)}</td><td>${esc(x.unit || "")}</td><td>${num(x.lo)}</td><td>${num(x.hi)}</td><td>${num(x.warn)}</td><td>${FREQ[x.freq]}</td><td>${esc(x.ref || "")}</td><td>${x.active ? "ใช้" : "ปิด"}</td></tr>`).join("") || `<tr><td colspan="10">ยังไม่มีรายการตรวจ</td></tr>`}</table></div>
        ${canMan ? `<details><summary class="sub">เพิ่มรายการตรวจเองที่จุดนี้</summary><form class="tf" data-add>
          <label>รายการ<input name="param" required></label><label>หน่วย<input name="unit"></label>
          <label>ชนิดการตรวจ<select name="test_type"><option value="bio">ตรวจเชื้อ</option><option value="chem">สารเคมี</option></select></label><label>ชนิดผล<select name="kind"><option value="num">ตัวเลข</option><option value="detect">พบ / ไม่พบ</option><option value="pf">ผ่าน / ไม่ผ่าน</option></select></label>
          <label>ต่ำสุด<input name="lo" type="number" step="any"></label><label>สูงสุด<input name="hi" type="number" step="any"></label><label>เฝ้าระวัง<input name="warn" type="number" step="any"></label>
          <label>ความถี่<select name="freq">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${k === "M" ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>อ้างอิง<input name="ref"></label>
          <div><button class="btn primary small" type="submit">เพิ่มรายการ</button></div></form></details>` : ""}</div>`; }).join("")
      : `<p class="sub">ยังไม่มีจุดตรวจ${canMan ? " เพิ่มด้วยแบบฟอร์มด้านบน" : ""}</p>`;
  }
  $("#fP").onsubmit = guard(async () => {
    const { error } = await sb.rpc("water_add_point", { p_hospital: $("#h").value, p_system: $("#pS").value, p_code: $("#pC").value.trim(), p_name: $("#pN").value.trim(), p_location: $("#pL").value.trim(), p_template: $("#pT").checked });
    if (error) throw error; ["#pC", "#pN", "#pL"].forEach(k => $(k).value = ""); await load(); rReg(); toast("เพิ่มจุดตรวจแล้ว"); });
  $("#pList").onclick = guard(async ev => {
    const box = ev.target.closest("[data-pt]"); if (!box) return; const pid = +box.dataset.pt;
    if (ev.target.closest("[data-pact]")) { const p = ptOf(pid); const { error } = await sb.from("water_points").update({ active: !p.active }).eq("id", pid); if (error) throw error; await load(); return rReg(); }
    const tr = ev.target.closest("[data-plsave]") && ev.target.closest("[data-pl]"); if (!tr) return;
    const g = k => tr.querySelector(`[data-k="${k}"]`), nv = k => { const e = g(k); return e && e.value !== "" ? +e.value : null; }, x = plOf(+tr.dataset.pl);
    const row = { freq: g("freq").value, active: g("active").checked, test_type: g("test_type").value }; if (x.kind === "num") Object.assign(row, { lo: nv("lo"), hi: nv("hi"), warn: nv("warn") });
    if (x.kind === "num" && row.lo == null && row.hi == null) throw new Error("ต้องมีเกณฑ์ต่ำสุดหรือสูงสุดอย่างน้อย 1 ค่า");
    const { error } = await sb.from("water_plans").update(row).eq("id", x.id); if (error) throw error; await load(); rReg(); toast("บันทึกเกณฑ์แล้ว ผลตรวจครั้งต่อไปใช้เกณฑ์ใหม่"); });
  $("#pList").onsubmit = guard(async ev => { const f = ev.target.closest("[data-add]"); if (!f) return; const box = f.closest("[data-pt]"), fd = new FormData(f), n = k => fd.get(k) === "" ? null : +fd.get(k);
    const row = { point_id: +box.dataset.pt, hospital_id: $("#h").value, param: String(fd.get("param")).trim(), unit: String(fd.get("unit")).trim() || null, kind: fd.get("kind"),
      lo: fd.get("kind") === "num" ? n("lo") : null, hi: fd.get("kind") === "num" ? n("hi") : null, warn: fd.get("kind") === "num" ? n("warn") : null, freq: fd.get("freq"), ref: String(fd.get("ref")).trim() || null, test_type: fd.get("test_type"), sort: 100 };
    if (!row.param) throw new Error("กรอกชื่อรายการ"); if (row.kind === "num" && row.lo == null && row.hi == null) throw new Error("ต้องมีเกณฑ์ต่ำสุดหรือสูงสุดอย่างน้อย 1 ค่า");
    const { error } = await sb.from("water_plans").insert(row); if (error) throw error; await load(); rReg(); toast("เพิ่มรายการตรวจแล้ว"); });
  $("#rX").onclick = () => { const pts = points.filter(ptOk), rows = [];
    pts.forEach(p => plans.filter(x => x.point_id === p.id && (!ttF() || x.test_type === ttF())).forEach(x => rows.push([GRP[grpOf(p.system)], SYS[p.system], p.code, p.name, p.location || "", TT[x.test_type], x.param, x.unit || "", crit(x), FREQ[x.freq], x.ref || "", x.method || "", p.active && x.active ? "ใช้งาน" : "ปิด"])));
    Office.table(fileName("ทะเบียน"), ["กลุ่มน้ำ", "ระบบน้ำ", "รหัสจุด", "จุดตรวจ", "ที่ตั้ง", "ชนิดการตรวจ", "รายการ", "หน่วย", "เกณฑ์", "ความถี่", "อ้างอิง", "วิธีตรวจ", "สถานะ"], rows,
      { title: "ทะเบียนจุดตรวจและแผนการตรวจคุณภาพน้ำ (Water Management Plan)", org: hosp().name, period: period(), findings: [`จุดตรวจ ${pts.length} จุด รายการตรวจ ${rows.length} รายการ`], notes: ["เกณฑ์และความถี่ต้องตรงกับแผนจัดการน้ำที่คณะกรรมการ IC อนุมัติ"] }); };

  // ---------- ค่ามาตรฐาน ----------
  function rStd() {
    const L = tpl.filter(t => (!grpF() || grpOf(t.system) === grpF()) && (!sysF() || t.system === sysF()) && (!ttF() || t.test_type === ttF()))
      .sort((a, b) => Object.keys(SYS).indexOf(a.system) - Object.keys(SYS).indexOf(b.system) || (a.test_type === "bio" ? 0 : 1) - (b.test_type === "bio" ? 0 : 1) || a.sort - b.sort);
    $("#sList").innerHTML = `<tr><th>กลุ่มน้ำ</th><th>ระบบน้ำ</th><th>ชนิดการตรวจ</th><th>รหัส</th><th>รายการ</th><th>เกณฑ์</th><th>ความถี่</th><th>อ้างอิง</th><th>วิธีตรวจ</th><th>เมื่อนอกเกณฑ์</th></tr>` +
      L.map(t => `<tr><td>${GRP[grpOf(t.system)]}</td><td>${esc(SYS[t.system] || t.system)}</td><td>${ttPill(t)}</td><td>${esc(t.code)}</td><td>${esc(t.param)}</td><td>${esc(crit(t))}</td><td>${FREQ[t.freq]}</td><td>${esc(t.ref || "")}</td><td>${esc(t.method || "")}</td><td>${esc(t.note || "")}</td></tr>`).join("");
  }

  // ---------- 12 โรง ----------
  let ov = [];
  async function rAll() {
    vYears(); rV();
    const { data, error } = await sb.rpc("water_overview"); if (error) throw error; ov = data || [];
    $("#vList").innerHTML = `<tr><th>โรง</th><th>จุดตรวจ</th><th>รายการ</th><th>เลยกำหนด</th><th>ยังไม่เคย</th><th>ตรวจตามกำหนด %</th><th>ผลตรวจ 90 วัน</th><th>นอกเกณฑ์ 90 วัน</th><th>ตรวจเชื้อนอกเกณฑ์</th><th>สารเคมีนอกเกณฑ์</th><th>แก้ไขยังไม่ปิด</th><th>ตรวจล่าสุด</th></tr>` +
      ov.map(r => { const s = pct(r.plans - r.overdue - r.never, r.plans); return `<tr><td>${esc(r.code)} · ${esc(r.name)}</td><td class="n">${r.points}</td><td class="n">${r.plans}</td><td class="n ${r.overdue ? "over" : ""}">${r.overdue}</td><td class="n ${r.never ? "never" : ""}">${r.never}</td>
        <td class="n ${s == null ? "" : s >= 95 ? "ok" : s >= 80 ? "soon" : "over"}">${s ?? "-"}</td><td class="n">${r.results_90}</td><td class="n ${r.fail_90 ? "fail" : ""}">${r.fail_90}</td><td class="n ${r.fail_bio_90 ? "fail" : ""}">${r.fail_bio_90}</td><td class="n ${r.fail_chem_90 ? "fail" : ""}">${r.fail_chem_90}</td><td class="n ${r.open_actions ? "fail" : ""}">${r.open_actions}</td><td>${dTH(r.last_test)}</td></tr>`; }).join("");
  }
  $("#vX").onclick = () => { const none = ov.filter(r => !+r.plans).map(r => r.code);
    Office.table(`น้ำ_12โรง_${dTH(today()).replace(/\s/g, "")}`, ["โรง", "ชื่อ", "จุดตรวจ", "รายการ", "เลยกำหนด", "ยังไม่เคย", "ตรวจตามกำหนด %", "ผลตรวจ 90 วัน", "นอกเกณฑ์ 90 วัน", "ตรวจเชื้อนอกเกณฑ์", "สารเคมีนอกเกณฑ์", "แก้ไขยังไม่ปิด", "ตรวจล่าสุด"],
      ov.map(r => [r.code, r.name, r.points, r.plans, r.overdue, r.never, pct(r.plans - r.overdue - r.never, r.plans) ?? "-", r.results_90, r.fail_90, r.fail_bio_90, r.fail_chem_90, r.open_actions, dTH(r.last_test)]),
      { title: "สถานะแผนจัดการน้ำ 12 โรงพยาบาล", period: `ข้อมูล ณ ${dTH(today())}`, findings: [none.length ? `โรงที่ยังไม่มีแผนการตรวจน้ำในระบบ: ${none.join(", ")}` : "ทุกโรงมีแผนการตรวจน้ำในระบบแล้ว",
        `รวมเลยกำหนด ${ov.reduce((t, r) => t + +r.overdue, 0)} รายการ · นอกเกณฑ์ 90 วัน ${ov.reduce((t, r) => t + +r.fail_90, 0)} ครั้ง · แก้ไขยังไม่ปิด ${ov.reduce((t, r) => t + +r.open_actions, 0)} รายการ`] }); };
  // ---------- 3 หมวด (น้ำกินดื่ม / น้ำใช้ / น้ำเสีย): a yearly report per group in the layout of the hospital's yearly
  // wastewater report: executive-summary table (average, min–max, standard, assessment), % removal (wastewater),
  // analysis, month-by-month table per sampling point, monthly charts against the limits, action plan + Gantt, 4 exports ----------
  const MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const CAT_SYS = { DRINK: ["DW"], USE: ["POT", "CT", "RO_HD", "RO_CSSD", "HW", "OTH"], WASTE: ["WW_IN", "WW", "WW_AER"] };
  const CAT_NO = { DRINK: 1, USE: 2, WASTE: 3 };
  const CAT_LAW = { DRINK: "ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม",
    USE: "เกณฑ์คุณภาพน้ำประปาดื่มได้ กรมอนามัย · ISO 23500 (น้ำไตเทียม) · AAMI ST108 (น้ำหน่วยจ่ายกลาง) · HSE ACOP L8 / ASHRAE 188 (Legionella) ตาม JCI FMS.08.04",
    WASTE: "ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2548 · อาคารประเภท ก (โรงพยาบาลตั้งแต่ 30 เตียง)" };
  // % removal pairs: influent template → effluent template, target %
  const REMOVAL = [["BOD", "WI02", "WW03", 85], ["COD", "WI03", "WW10", 70], ["SS (TSS)", "WI04", "WW04", 80], ["TKN", "WI09", "WW05", 60]];
  const ST_TH = { fail: "นอกเกณฑ์", watch: "เฝ้าระวัง", pass: "ผ่าน", none: "ไม่มีผล", info: "ติดตามค่า" };
  const avgOf = a => a.length ? a.reduce((t, v) => t + v, 0) / a.length : null;
  const r2 = v => v == null ? null : Math.abs(v) < 1 ? +(+v).toPrecision(3) : Math.round(v * 100) / 100;
  const cellTxt = list => { if (!list || !list.length) return ""; const r = list[0];
    if (r.qual) return list.length > 1 ? `${QUAL[r.qual]} (${list.length} ครั้ง)` : QUAL[r.qual];
    if (list.length > 1) { const v = avgOf(list.filter(x => x.value != null).map(x => +x.value)); return `เฉลี่ย ${num(r2(v))} (${list.length} ครั้ง)`; }
    return r.val_text || num(r.value); };
  const hasLim = pl => pl.kind !== "num" || pl.lo != null || pl.hi != null;
  function catYears() { const y = +today().slice(0, 4), ys = [...new Set([y, y - 1, ...results.map(r => +r.sampled_on.slice(0, 4))])].sort((a, b) => b - a), v = $("#cY").value;
    $("#cY").innerHTML = ys.map(x => `<option value="${x}">พ.ศ. ${x + 543}</option>`).join(""); if (ys.includes(+v)) $("#cY").value = v; }
  function catPoints(g) { const v = $("#cPt").value, L = points.filter(p => p.active && grpOf(p.system) === g).sort((a, b) => CAT_SYS[g].indexOf(a.system) - CAT_SYS[g].indexOf(b.system) || a.code.localeCompare(b.code));
    $("#cPt").innerHTML = `<option value="">ทุกจุดใน${GRP[g]}</option>` + L.map(p => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join(""); if (L.some(p => String(p.id) === v)) $("#cPt").value = v; }
  function rowAssess(x) { const pl = x.pl;
    if (!x.n) return { st: "none", txt: "ยังไม่มีผลตรวจในปีนี้" };
    if (!hasLim(pl)) return { st: "info", txt: "ไม่มีค่ามาตรฐาน ใช้ติดตามแนวโน้มและคำนวณ % การบำบัด" };
    if (x.fail) return { st: "fail", txt: `นอกเกณฑ์ ${x.fail} ครั้ง จาก ${x.n} ครั้ง ต้องแก้ไขและตรวจซ้ำ` };
    // near a limit: within 10% of the range when both limits exist, else 80% of the upper limit / 110% of the lower limit
    const both = pl.lo != null && pl.hi != null, gap = both ? (pl.hi - pl.lo) * 0.1 : 0;
    const nearHi = pl.hi != null && x.max != null && x.max >= (both ? pl.hi - gap : 0.8 * pl.hi), nearLo = pl.lo != null && x.min != null && x.min <= (both ? +pl.lo + gap : 1.1 * pl.lo);
    if (pl.kind === "num" && (nearHi || nearLo)) return { st: "watch", txt: `ผ่านเกณฑ์ทุกครั้ง แต่ค่า${nearHi ? "สูงสุดใกล้เกณฑ์สูงสุด" : "ต่ำสุดใกล้เกณฑ์ต่ำสุด"} ควรเฝ้าระวัง` };
    if (x.warn) return { st: "watch", txt: `ผ่านเกณฑ์ มีระดับเฝ้าระวัง ${x.warn} ครั้ง` };
    return { st: "pass", txt: `ผ่านเกณฑ์ทุกครั้ง (${x.n} ครั้ง)` }; }
  // C = the data to use (default: the hospital open on the page); the 12-hospital view passes each hospital's own data
  function catData(g, C) {
    C = C || { points, plans, results, actions, Y: $("#cY").value, pid: +$("#cPt").value || null, tt: ttF(), hcode: hosp().code || "" };
    const Y = String(C.Y), pid = C.pid || null, curM = Y === today().slice(0, 4) ? +today().slice(5, 7) : 12;
    const pts = C.points.filter(p => p.active && grpOf(p.system) === g && (!pid || p.id === pid)).sort((a, b) => CAT_SYS[g].indexOf(a.system) - CAT_SYS[g].indexOf(b.system) || a.code.localeCompare(b.code));
    const blocks = pts.map(pt => { const pls = C.plans.filter(pl => pl.point_id === pt.id && pl.active && (!C.tt || pl.test_type === C.tt)).sort((a, b) => a.sort - b.sort);
      const rows = pls.map(pl => { const rs = C.results.filter(r => r.plan_id === pl.id && r.sampled_on.startsWith(Y));
        const cell = MON.map((_, i) => rs.filter(r => +r.sampled_on.slice(5, 7) === i + 1));
        const vals = rs.filter(r => !r.qual && r.value != null).map(r => +r.value);
        const x = { pl, pt, rs, cell, n: rs.length, fail: rs.filter(r => r.status === "fail").length, warn: rs.filter(r => r.status === "warn").length,
          min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, avg: r2(avgOf(vals)),
          mAvg: cell.map(l => { const v = l.filter(r => !r.qual && r.value != null).map(r => +r.value); return v.length ? avgOf(v) : null; }),
          missing: ["D", "W", "M"].includes(pl.freq) ? MON.map((m, i) => i < curM && !cell[i].length ? m : null).filter(Boolean) : [] };
        // min / max shown as the lab wrote them (e.g. >16,000, <0.1)
        const nr = rs.filter(r => !r.qual && r.value != null), lo = nr.find(r => +r.value === x.min), hi = nr.find(r => +r.value === x.max);
        x.minT = lo ? lo.val_text || num(lo.value) : ""; x.maxT = hi ? hi.val_text || num(hi.value) : "";
        x.as = rowAssess(x); return x; });
      const dates = MON.map((_, i) => [...new Set(rows.flatMap(x => x.cell[i].map(r => r.sampled_on)))].sort());
      const reps = MON.map((_, i) => [...new Set(rows.flatMap(x => x.cell[i].map(r => r.report_no).filter(Boolean)))]);
      return { pt, rows, dates, reps }; });
    const all = blocks.flatMap(b => b.rows), res = all.flatMap(x => x.rs);
    // months in which every result passed
    const mons = MON.map((_, i) => all.flatMap(x => x.cell[i])), tested = mons.filter(l => l.length), clean = tested.filter(l => l.every(r => r.status !== "fail"));
    const removal = g !== "WASTE" ? [] : REMOVAL.map(([name, tin, tout, target]) => {
      const pIn = all.filter(x => x.pt.system === "WW_IN" && x.pl.template_code === tin), pOut = all.filter(x => x.pt.system === "WW" && x.pl.template_code === tout);
      if (!pIn.length || !pOut.length) return null;
      const m = MON.map((_, i) => { const a = avgOf(pIn.map(x => x.mAvg[i]).filter(v => v != null)), b = avgOf(pOut.map(x => x.mAvg[i]).filter(v => v != null));
        return a != null && b != null && a > 0 ? Math.round((a - b) * 1000 / a) / 10 : null; });
      const v = m.filter(x => x != null), av = v.length ? Math.round(avgOf(v) * 10) / 10 : null, low = v.filter(x => x < target).length;
      return { name, target, m, avg: av, low, n: v.length, st: !v.length ? "none" : low ? "fail" : "pass" }; }).filter(Boolean);
    const ids = new Set(all.map(x => x.pl.id));
    const acts = C.actions.filter(a => { const r = C.results.find(x => x.id === a.result_id); return r && ids.has(r.plan_id) && (a.status === "open" || r.sampled_on.startsWith(Y)); })
      .map(a => ({ a, r: C.results.find(x => x.id === a.result_id) })).sort((p, q) => (p.a.due || "9") < (q.a.due || "9") ? -1 : 1);
    return { g, Y, YT: +Y + 543, hcode: C.hcode, pmap: new Map(C.plans.map(p => [p.id, p])), pts, blocks, all, res, tested, clean, removal, acts, curM };
  }
  function catTexts(D) {
    const H = D.hcode, G = GRP[D.g], pass = D.res.filter(r => r.status !== "fail").length, bio = D.res.filter(r => (D.pmap.get(r.plan_id) || {}).test_type === "bio"), chem = D.res.filter(r => (D.pmap.get(r.plan_id) || {}).test_type !== "bio");
    const nm = x => `${x.pl.param} (${x.pt.code})`, fails = D.all.filter(x => x.as.st === "fail"), watch = D.all.filter(x => x.as.st === "watch");
    const find = [
      `${H} หมวด ${CAT_NO[D.g]} ${G} ปี พ.ศ. ${D.YT}: จุดตรวจ ${D.pts.length} จุด รายการตรวจ ${D.all.length} รายการ ผลตรวจรวม ${D.res.length} ครั้ง ผ่านเกณฑ์ ${pass} ครั้ง${D.res.length ? ` (${pct(pass, D.res.length)}%)` : ""}`,
      `ตรวจเชื้อ ${bio.length} ครั้ง นอกเกณฑ์ ${bio.filter(r => r.status === "fail").length} ครั้ง · สารเคมี ${chem.length} ครั้ง นอกเกณฑ์ ${chem.filter(r => r.status === "fail").length} ครั้ง`,
      `อัตราการผ่านเกณฑ์รายเดือน (Compliance rate): เดือนที่ผลทุกรายการผ่านเกณฑ์ ${D.clean.length} จาก ${D.tested.length} เดือนที่มีผลตรวจ${D.tested.length ? ` (${pct(D.clean.length, D.tested.length)}%)` : ""}`,
      fails.length ? `รายการนอกเกณฑ์ ${fails.length} รายการ: ${fails.map(x => `${nm(x)} ${x.fail} ครั้ง`).join(" · ")}` : D.res.length ? "ไม่มีผลนอกเกณฑ์ตลอดช่วงที่มีผลตรวจ" : "ยังไม่มีผลตรวจในปีนี้",
      watch.length ? `รายการเฝ้าระวัง (ผ่านเกณฑ์แต่ใกล้ค่ามาตรฐาน) ${watch.length} รายการ: ${watch.map(x => `${nm(x)} สูงสุด ${num(x.max)}${x.pl.unit ? " " + x.pl.unit : ""} เกณฑ์ ${crit(x.pl)}`).join(" · ")}` : null,
      ...D.removal.map(r => `ประสิทธิภาพการบำบัด ${r.name}: เฉลี่ย ${r.avg == null ? "-" : r.avg + "%"} (เป้าหมายมากกว่า ${r.target}%)${r.low ? ` ต่ำกว่าเป้าหมาย ${r.low} เดือน` : r.n ? " ผ่านเป้าหมายทุกเดือน" : " ยังไม่มีผลน้ำเข้าและน้ำทิ้งในเดือนเดียวกัน"}`),
      (() => { const m = D.all.filter(x => x.missing.length); return m.length ? `ขาดผลตรวจตามความถี่ ${m.length} รายการ: ${m.map(x => `${nm(x)} ขาด ${x.missing.length} เดือน (${x.missing.join(" ")})`).join(" · ")}` : D.all.length ? "ตรวจครบทุกเดือนตามความถี่ของรายการรายวัน รายสัปดาห์ และรายเดือน" : null; })(),
      (() => { const o = D.acts.filter(p => p.a.status === "open"), late = o.filter(p => p.a.due && p.a.due < today()); return `รายการแก้ไข ${D.acts.length} รายการ ยังไม่ปิด ${o.length} รายการ${late.length ? ` เลยกำหนด ${late.length} รายการ` : ""}`; })()
    ].filter(Boolean);
    const anal = [];
    D.blocks.forEach((b, i) => { const f = b.rows.filter(x => x.as.st === "fail"), w = b.rows.filter(x => x.as.st === "watch"), n = b.rows.reduce((t, x) => t + x.n, 0);
      anal.push(`ส่วนที่ ${i + 1} ${b.pt.code} ${b.pt.name} (${SYS[b.pt.system]}): ผลตรวจ ${n} ครั้ง${f.length ? ` นอกเกณฑ์ ${f.length} รายการ` : n ? " ผ่านเกณฑ์ทุกรายการ" : ""}${w.length ? ` เฝ้าระวัง ${w.length} รายการ` : ""}`);
      b.rows.filter(x => x.as.st === "fail").forEach(x => anal.push(`${nm(x)} นอกเกณฑ์ ${x.fail} ครั้ง${x.max != null ? ` ค่าสูงสุด ${num(x.max)} ค่าต่ำสุด ${num(x.min)}` : ""} เกณฑ์ ${crit(x.pl)}${x.pl.note ? ` · แนวทางแก้ไข: ${x.pl.note}` : ""}`));
      b.rows.filter(x => x.pl.kind === "num" && x.mAvg.filter(v => v != null).length >= 4).forEach(x => { const v = x.mAvg.filter(v => v != null), a = avgOf(v.slice(0, 3)), z = avgOf(v.slice(-3));
        if (a > 0 && z > a * 1.2 && x.pl.hi != null) anal.push(`${nm(x)} มีแนวโน้มสูงขึ้น (เฉลี่ย 3 เดือนแรก ${num(r2(a))} → 3 เดือนล่าสุด ${num(r2(z))}) ควรหาสาเหตุก่อนเกินเกณฑ์`); }); });
    D.removal.filter(r => r.low).forEach(r => anal.push(`% การบำบัด ${r.name} ต่ำกว่าเป้าหมาย ${r.low} เดือน: ${{ "BOD": "ตรวจออกซิเจนละลาย (DO) ในบ่อเติมอากาศ ค่า MLSS และเวลากักน้ำ", "COD": "ตรวจสารเคมีที่ทิ้งลงระบบ (น้ำยาฆ่าเชื้อ น้ำยาซักฟอก) และการเติมอากาศ", "SS (TSS)": "ตรวจถังตกตะกอน การสูบตะกอนส่วนเกิน และตะกอนลอย", "TKN": "เพิ่มเวลาเติมอากาศให้เกิดไนตริฟิเคชัน (Nitrification) และตรวจ DO" }[r.name] || "ตรวจการเดินระบบบำบัด"}`));
    if (D.g === "WASTE") { const ml = D.all.find(x => x.pl.template_code === "WA01"); if (ml && ml.n) anal.push(`ตะกอนจุลินทรีย์ MLSS เฉลี่ย ${num(ml.avg)} mg/L ช่วง ${num(ml.min)} ถึง ${num(ml.max)} (ช่วงควบคุม ${crit(ml.pl)})${ml.fail ? ` นอกช่วงควบคุม ${ml.fail} ครั้ง ให้ปรับการสูบตะกอนส่วนเกิน` : " อยู่ในช่วงควบคุม"}`); }
    if (!D.res.length) anal.push(`ยังไม่มีผลตรวจของ${G}ในปี พ.ศ. ${D.YT} ให้บันทึกผลที่แท็บ "บันทึกผลตรวจ" ตามรายงานของห้องปฏิบัติการ`);
    watch.forEach(x => anal.push(`ข้อเสนอสำหรับรายการเฝ้าระวัง ${nm(x)}: เพิ่มความถี่การตรวจและทบทวนการเดินระบบก่อนค่าเกินเกณฑ์${x.pl.note ? ` (${x.pl.note})` : ""}`));
    const notes = [`ค่ามาตรฐานอ้างอิง: ${CAT_LAW[D.g]}`, "แต่ละโรงต้องยืนยันเกณฑ์และความถี่ในแท็บ \"ทะเบียนจุดตรวจ\" ให้ตรงกับแผนจัดการน้ำที่คณะกรรมการของโรงพยาบาลอนุมัติ", "หลักฐานสำหรับ JCI 8th FMS.08.04: ผลตรวจตามความถี่ ผลนอกเกณฑ์พร้อมการแก้ไข และผลตรวจซ้ำ"];
    return { find, anal, notes };
  }
  const EXEC_HEAD = ["ส่วน / จุดตรวจ", "รายการ", "ชนิดการตรวจ", "หน่วย", "ค่าเฉลี่ย", "ต่ำสุด – สูงสุด", "ค่ามาตรฐาน", "ตรวจ (ครั้ง)", "นอกเกณฑ์", "การประเมิน", "สถานะ"];
  const execRow = x => [x.pt.code, x.pl.param, TT[x.pl.test_type] || "", x.pl.unit || "", x.pl.kind === "num" ? (x.avg == null ? "-" : num(x.avg)) : `ไม่พบ ${x.rs.filter(r => r.qual === "nd" || r.qual === "pass").length} / พบ ${x.rs.filter(r => r.qual === "detected" || r.qual === "fail").length}`,
    x.min == null ? "-" : `${x.minT} – ${x.maxT}`, hasLim(x.pl) ? crit(x.pl) : "ไม่กำหนด", x.n, x.fail, x.as.txt, ST_TH[x.as.st]];
  const monHead = () => ["รายการ", "หน่วย", "ค่ามาตรฐาน", ...MON, "ต่ำสุด", "สูงสุด", "เฉลี่ย", "สถานะ"];
  const monRows = b => [["วันที่เก็บตัวอย่าง (วันที่ของเดือน)", "", "", ...b.dates.map(l => l.map(d => +d.slice(8, 10)).join(", ")), "", "", "", ""], ["เลขที่รายงานผล", "", "", ...b.reps.map(l => l.join(", ")), "", "", "", ""],
    ...b.rows.map(x => [x.pl.param, x.pl.unit || "", hasLim(x.pl) ? crit(x.pl).replace(x.pl.unit ? " " + x.pl.unit : "", "") : "ไม่กำหนด", ...x.cell.map(cellTxt), x.minT, x.maxT, x.avg == null ? "" : num(x.avg), ST_TH[x.as.st]])];
  const REM_HEAD = ["พารามิเตอร์", "เป้าหมาย", ...MON, "เฉลี่ย", "สถานะ"];
  const remRow = r => [r.name, `มากกว่า ${r.target}%`, ...r.m.map(v => v == null ? "" : v + "%"), r.avg == null ? "-" : r.avg + "%", ST_TH[r.st] === "นอกเกณฑ์" ? "ต่ำกว่าเป้าหมาย" : ST_TH[r.st]];
  const PLAN_HEAD = ["ลำดับ", "วันที่พบ", "ประเด็น", "สาเหตุ", "มาตรการ / การแก้ไข", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "ใบแจ้งซ่อม", "สถานะ"];
  const planRow = (p, i) => [i + 1, dTH(p.r.sampled_on), p.a.problem || "", p.a.cause || "", p.a.action || "", p.a.owner || "", dTH(p.a.due), p.a.job_no || "", p.a.status === "done" ? "ปิดแล้ว" : p.a.due && p.a.due < today() ? "เลยกำหนด" : "กำลังแก้ไข"];
  // one monthly chart (12 months, averages) with the limit lines; only line / rect / text so it becomes editable shapes in Office files
  function monChart(x, ox, oy, W, H) {
    const TL = wrapTxt(`${x.pt.code} · ${x.pl.param}${x.pl.unit ? " (" + x.pl.unit + ")" : ""}`, Math.floor((W - 24) / 8.6));
    const pl = x.pl, L = ox + 56, R = ox + W - 14, T = oy + 18 + TL.length * 17, B = oy + H - 30, v = x.mAvg, vals = v.filter(a => a != null), lim = [pl.lo, pl.hi, pl.warn].filter(a => a != null).map(Number);
    let mn = Math.min(0, ...vals, ...lim), mx = Math.max(...vals, ...lim); if (!isFinite(mx) || mx === mn) mx = mn + 1; mx += (mx - mn) * 0.12;
    const X = i => L + (i + 0.5) * (R - L) / 12, Yv = a => B - (a - mn) * (B - T) / (mx - mn), t = s => esc(String(s));
    let s = `<rect x="${ox + 2}" y="${oy + 2}" width="${W - 4}" height="${H - 4}" fill="#ffffff" stroke="#d5dde7" stroke-width="1"/>` +
      TL.map((l, k) => `<text x="${ox + 12}" y="${oy + 20 + k * 17}" font-size="14" font-weight="bold" fill="#17212b">${t(l)}</text>`).join("") +
      `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#9aa7b4" stroke-width="1"/><line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="#9aa7b4" stroke-width="1"/>` +
      [mn, (mn + mx) / 2, mx].map(a => `<text x="${L - 6}" y="${Yv(a) + 4}" text-anchor="end" font-size="11" fill="#4b5563">${t(num(mx - mn >= 10 ? Math.round(a) : r2(a)))}</text>`).join("") +
      MON.map((m, i) => `<text x="${X(i)}" y="${B + 16}" text-anchor="middle" font-size="11" fill="#4b5563">${m}</text>`).join("");
    [[pl.hi, "#B42318", "เกณฑ์สูงสุด"], [pl.lo, "#B42318", "เกณฑ์ต่ำสุด"], [pl.warn, "#B7791F", "เฝ้าระวัง"]].forEach(([a, c, n]) => { if (a == null) return; const y = Yv(+a);
      s += `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${R - 2}" y="${y - 4}" text-anchor="end" font-size="11" fill="${c}">${t(n + " " + num(a))}</text>`; });
    let prev = null; v.forEach((a, i) => { if (a == null) { prev = null; return; } const xx = X(i), y = Yv(a), bad = x.cell[i].some(r => r.status === "fail");
      if (prev) s += `<line x1="${prev[0]}" y1="${prev[1]}" x2="${xx}" y2="${y}" stroke="#0B5CAD" stroke-width="2"/>`;
      s += `<rect x="${xx - 4}" y="${y - 4}" width="8" height="8" fill="${bad ? "#B42318" : "#0B5CAD"}"/><text x="${xx}" y="${y - 8}" text-anchor="middle" font-size="10" fill="${bad ? "#B42318" : "#17212b"}">${t(num(r2(a)))}</text>`; prev = [xx, y]; });
    return s;
  }
  const chartList = D => D.all.filter(x => x.pl.kind === "num" && x.mAvg.some(a => a != null));
  const svgWrap = (W, H, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Tahoma, 'IBM Plex Sans Thai', sans-serif"><rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>${body}</svg>`;
  // 4 charts per picture for the PPT / Word / PDF / Excel files
  const chartGrids = D => { const L = chartList(D), out = []; for (let i = 0; i < L.length; i += 4) { const c = L.slice(i, i + 4);
    out.push(svgWrap(1300, 620, c.map((x, j) => monChart(x, (j % 2) * 650, Math.floor(j / 2) * 310, 650, 310)).join(""))); } return out; };
  // Gantt of the action plan: from the day the result was found to the due day (red = late)
  // full text, never cut (user rule): wrap at word boundaries (Thai words via Intl.Segmenter)
  const wrapTxt = (str, max) => { const seg = typeof Intl !== "undefined" && Intl.Segmenter ? [...new Intl.Segmenter("th", { granularity: "word" }).segment(str)].map(x => x.segment) : str.split(/(\s+)/), out = [""];
    seg.forEach(w => { if ((out[out.length - 1] + w).length > max && out[out.length - 1].trim()) out.push(w.trimStart()); else out[out.length - 1] += w; }); return out.filter(l => l.trim()); };
  // Gantt: items [{ label, s, e, col }] from start day to due day (full labels, wrapped)
  function ganttSvg(items) {
    if (!items.length) return null; const P = items.map(x => ({ ...x, lines: wrapTxt(x.label, 56) })); P.forEach(x => x.h = Math.max(34, 14 + x.lines.length * 18));
    const YS = P.map((_, i) => P.slice(0, i).reduce((t, x) => t + x.h, 0));
    const d0 = P.reduce((m, x) => x.s < m ? x.s : m, P[0].s), d1 = P.reduce((m, x) => x.e > m ? x.e : m, P[0].e), span = Math.max(14, daysBetween(d0, d1) + 1);
    const W = 1300, L = 560, R = 1280, top = 56, H = top + P.reduce((t, x) => t + x.h, 0) + 20, px = d => L + (R - L) * daysBetween(d0, d) / span, t = today();
    let s = `<text x="16" y="30" font-size="16" font-weight="bold" fill="#17212b">ประเด็น · ผู้รับผิดชอบ</text><text x="${L - 10}" y="30" text-anchor="end" font-size="14" fill="#4b5563">กำหนดเสร็จ</text>`;
    for (let k = 0; k <= span; k += Math.max(7, Math.ceil(span / 6 / 7) * 7)) { const d = addD(d0, k); s += `<line x1="${px(d)}" y1="${top - 8}" x2="${px(d)}" y2="${H - 10}" stroke="#e3e9f1" stroke-width="1"/><text x="${px(d) + 3}" y="30" font-size="12" fill="#4b5563">${esc(dTH(d))}</text>`; }
    P.forEach((x, i) => { const y = top + YS[i], RH = x.h;
      if (i % 2) s += `<rect x="8" y="${y}" width="${W - 16}" height="${RH}" fill="#f6f8fb"/>`;
      s += x.lines.map((l, k) => `<text x="16" y="${y + 22 + k * 18}" font-size="13" fill="#17212b">${esc(l)}</text>`).join("") + `<text x="${L - 10}" y="${y + 22}" text-anchor="end" font-size="12" fill="${x.col}">${esc(dTH(x.e))}</text>` +
        `<rect x="${px(x.s)}" y="${y + RH / 2 - 9}" width="${Math.max(6, px(addD(x.e, 1)) - px(x.s))}" height="18" rx="4" fill="${x.col}"/>`; });
    if (t >= d0 && t <= d1) s += `<line x1="${px(t)}" y1="${top - 8}" x2="${px(t)}" y2="${H - 10}" stroke="#B42318" stroke-width="2"/><text x="${px(t) + 4}" y="${top - 12}" font-size="12" fill="#B42318">วันนี้</text>`;
    return svgWrap(W, H, s);
  }
  // Gantt of the corrective actions: from the day the result was found to the due day (red = late, green = closed)
  const planGantt = D => ganttSvg(D.acts.filter(p => p.r).map((p, i) => { const pl = D.pmap.get(p.r.plan_id) || {}, pt = D.pts.find(x => x.id === pl.point_id) || {}, e = p.a.due || addD(p.r.sampled_on, 7), done = p.a.status === "done";
    return { label: `${i + 1}. ${pl.param || ""} (${pt.code || ""})${p.a.owner ? " · " + p.a.owner : ""}`, s: p.r.sampled_on, e: e < p.r.sampled_on ? p.r.sampled_on : e, col: done ? "#1F7A3D" : e < today() ? "#B42318" : "#0B5CAD" }; }));
  // Gantt of an AI plan (dates YYYY-MM-DD)
  const isD = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  const aiGantt = R => ganttSvg(((R && R.plan) || []).filter(x => isD(x.due)).map((x, i) => { const s0 = isD(x.start) && x.start <= x.due ? x.start : today() <= x.due ? today() : x.due;
    return { label: `${i + 1}. ${x.issue}: ${x.action} · ${x.owner}`, s: s0, e: x.due, col: x.due < today() ? "#B42318" : "#0B5CAD" }; }));
  let catCur = "DRINK";
  function rCat(g) {
    catCur = g; catYears(); catPoints(g); rCatAi(); const D = catData(g), T = catTexts(D), pass = D.res.filter(r => r.status !== "fail").length;
    $("#cTitle").textContent = `หมวด ${CAT_NO[g]} ${GRP[g]} · สรุปผลการตรวจวัดคุณภาพน้ำ ${hosp().name || ""} ปี พ.ศ. ${D.YT}`;
    $("#cSub").textContent = `ค่ามาตรฐานอ้างอิง: ${CAT_LAW[g]}`;
    const cr = pct(D.clean.length, D.tested.length), pr = pct(pass, D.res.length), o = D.acts.filter(p => p.a.status === "open").length;
    $("#cKpi").innerHTML = [["จุดตรวจ", D.pts.length, ""], ["รายการตรวจ", D.all.length, ""], ["ผลตรวจ (ครั้ง)", D.res.length, ""], ["ผ่านเกณฑ์", pr == null ? "-" : pr + "%", cls(pr)],
      ["เดือนที่ผ่านทุกรายการ", `${D.clean.length}/${D.tested.length}`, cls(cr)], ["แก้ไขยังไม่ปิด", o, o ? "bad" : "good"]].map(([l, v, c]) => `<div class="kpi"><span>${l}</span><b class="${c}">${esc(String(v))}</b></div>`).join("");
    $("#cFind").innerHTML = T.find.map(x => `<li>${esc(x)}</li>`).join("");
    $("#cExec").innerHTML = `<tr>${EXEC_HEAD.map(h => `<th>${h}</th>`).join("")}</tr>` + (D.all.length ? D.all.map(x => { const r = execRow(x); return `<tr>${r.map((c, i) => `<td class="${i === 10 ? { fail: "fail", watch: "warn", pass: "ok", none: "never", info: "" }[x.as.st] : [4, 5, 7, 8].includes(i) ? "n" : ""}">${i === 2 ? ttPill(x.pl) : esc(String(c))}</td>`).join("")}</tr>`; }).join("")
      : `<tr><td colspan="11">ยังไม่มีจุดตรวจใน${GRP[g]} ให้หัวหน้าเพิ่มที่แท็บ "ทะเบียนจุดตรวจ" (เลือกระบบน้ำในกลุ่ม${GRP[g]})</td></tr>`);
    $("#cRemBox").hidden = g !== "WASTE";
    $("#cRem").innerHTML = `<tr>${REM_HEAD.map(h => `<th>${h}</th>`).join("")}</tr>` + (D.removal.length ? D.removal.map(r => `<tr>${remRow(r).map((c, i) => `<td class="${i >= 2 && i < 14 && r.m[i - 2] != null && r.m[i - 2] < r.target ? "fail" : i === 15 ? { fail: "fail", pass: "ok", none: "never" }[r.st] : i >= 2 ? "n" : ""}">${esc(String(c))}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="16">ต้องมีจุดน้ำเสียเข้าระบบ (Influent) และจุดน้ำทิ้ง (Effluent) ที่มีรายการ BOD / COD / SS / TKN จึงคำนวณ % การบำบัดได้</td></tr>`);
    $("#cAnal").innerHTML = T.anal.map(x => `<li>${esc(x)}</li>`).join("");
    $("#cMon").innerHTML = D.blocks.length ? D.blocks.map((b, i) => `<h3>ส่วนที่ ${i + 1} ${esc(b.pt.code)} ${esc(b.pt.name)} · ${esc(SYS[b.pt.system])}${b.pt.location ? " · " + esc(b.pt.location) : ""}</h3>
      <div class="tw"><table class="tt mon"><tr>${monHead().map(h => `<th>${h}</th>`).join("")}</tr>${monRows(b).map((r, k) => { const x = k > 1 ? b.rows[k - 2] : null;
        return `<tr>${r.map((c, j) => { const m = j - 3, l = x && m >= 0 && m < 12 ? x.cell[m] : null, st = l && l.length ? (l.some(z => z.status === "fail") ? "fail" : l.some(z => z.status === "warn") ? "warn" : "") : "";
          return `<td class="${k < 2 ? "sub" : ""} ${st} ${j === 18 && x ? { fail: "fail", watch: "warn", pass: "ok", none: "never", info: "" }[x.as.st] : ""} ${j >= 3 && j < 18 ? "n" : ""}">${j === 0 && x ? ttPill(x.pl) + " " : ""}${esc(String(c))}</td>`; }).join("")}</tr>`; }).join("")}</table></div>`).join("")
      : `<p class="sub">ยังไม่มีจุดตรวจในหมวดนี้</p>`;
    const cl = chartList(D);
    $("#cChart").innerHTML = cl.length ? `<div class="charts">${cl.map(x => `<svg class="trend" viewBox="0 0 640 300" role="img" aria-label="กราฟ ${esc(x.pl.param)}">${monChart(x, 0, 0, 640, 300)}</svg>`).join("")}</div>` : `<p class="sub">ยังไม่มีผลตรวจที่เป็นตัวเลขในปีนี้</p>`;
    $("#cPlan").innerHTML = `<tr>${PLAN_HEAD.map(h => `<th>${h}</th>`).join("")}</tr>` + (D.acts.length ? D.acts.map((p, i) => `<tr>${planRow(p, i).map((c, j) => `<td class="${j === 8 ? (p.a.status === "done" ? "ok" : p.a.due && p.a.due < today() ? "fail" : "warn") : ""}">${esc(String(c))}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="9">ไม่มีผลนอกเกณฑ์ที่ต้องแก้ไขในปีนี้</td></tr>`);
    const gs = planGantt(D); $("#cGantt").innerHTML = gs ? `<p class="sub"><b>แผนการแก้ไข (Gantt)</b> จากวันที่พบถึงวันกำหนดเสร็จ · น้ำเงิน = กำลังแก้ไข · แดง = เลยกำหนด · เขียว = ปิดแล้ว</p><div class="tw">${gs.replace("<svg ", '<svg class="trend" ')}</div>` : "";
  }
  ["#cY", "#cPt"].forEach(s => $(s).onchange = () => rCat(catCur));
  const catAi = () => { const a = aiOf(hosp().id, catCur, $("#cY").value); return a && a.report; };
  const catName = k => `น้ำ_หมวด${CAT_NO[catCur]}_${GRP[catCur]}_${k}_${hosp().code || ""}_${dTH(today()).replace(/\s/g, "")}`;
  $("#wcX").onclick = () => { const D = catData(catCur), T = catTexts(D), title = `สรุปผลการตรวจวัดคุณภาพน้ำ หมวด ${CAT_NO[catCur]} ${GRP[catCur]} ปี พ.ศ. ${D.YT}`;
    const mon = [["ตารางสรุปข้อมูลผลตรวจรายเดือน " + GRP[catCur] + " ปี พ.ศ. " + D.YT], []], st = { 0: 2 };
    D.blocks.forEach((b, i) => { st[mon.length] = 2; mon.push([`ส่วนที่ ${i + 1} ${b.pt.code} ${b.pt.name} · ${SYS[b.pt.system]}`]); st[mon.length] = 1; mon.push(monHead()); monRows(b).forEach(r => mon.push(r)); mon.push([]); });
    const sheets = [Office.summarySheet({ title, org: hosp().name, period: `${hosp().code || ""} · ปี พ.ศ. ${D.YT} · ข้อมูล ณ ${dTH(today())}`, findings: [...T.find, ...T.anal], notes: T.notes,
        kpis: [["จุดตรวจ", D.pts.length], ["ผลตรวจ (ครั้ง)", D.res.length], ["เดือนที่ผ่านทุกรายการ", `${D.clean.length}/${D.tested.length}`]] }),
      { name: "ตารางบทสรุป KPI", header: 0, rows: [EXEC_HEAD, ...D.all.map(execRow)] },
      { name: "ตารางสรุปข้อมูล", rows: mon, styles: st },
      ...(catCur === "WASTE" ? [{ name: "% การบำบัด", header: 0, rows: [REM_HEAD, ...D.removal.map(remRow)] }] : []),
      { name: "แผนการแก้ไข", header: 0, rows: [PLAN_HEAD, ...D.acts.map(planRow)] },
      { name: "ผลตรวจทั้งหมด", header: 0, rows: [RES_HEAD, ...D.res.map(resRow)] }];
    const gs = planGantt(D); if (gs) sheets.push({ name: "Gantt แผนแก้ไข", rows: [["แผนการแก้ไข (Gantt)"]], styles: { 0: 2 }, svg: gs });
    sheets.splice(1, 0, ...aiSheets(catAi(), ""));
    chartGrids(D).forEach((svg, i) => sheets.push({ name: `กราฟ ${i + 1}`, rows: [[`กราฟแนวโน้มรายเดือนเทียบค่ามาตรฐาน ชุดที่ ${i + 1}`]], styles: { 0: 2 }, svg }));
    Office.xlsx(catName("รายงาน"), sheets); };
  $("#wcP").onclick = () => { const D = catData(catCur), T = catTexts(D), gs = planGantt(D);
    const d = { title: `สรุปผลการตรวจวัดคุณภาพน้ำ หมวด ${CAT_NO[catCur]} ${GRP[catCur]} ปี พ.ศ. ${D.YT}`, org: hosp().name, period: `${hosp().code || ""} · ปี พ.ศ. ${D.YT} · ข้อมูล ณ ${dTH(today())}`,
      findings: T.find, analysis: T.anal, notes: T.notes,
      kpis: [["จุดตรวจ", D.pts.length], ["ผลตรวจ (ครั้ง)", D.res.length], ["ผ่านเกณฑ์", (pct(D.res.filter(r => r.status !== "fail").length, D.res.length) ?? "-") + "%"], ["เดือนที่ผ่านทุกรายการ", `${D.clean.length}/${D.tested.length}`]],
      sections: [...aiSections(catAi()),
        { title: "ตารางบทสรุป (ค่าเฉลี่ย ต่ำสุด–สูงสุด เทียบค่ามาตรฐาน)", head: ["จุดตรวจ", "รายการ", "ชนิด", "ค่าเฉลี่ย", "ต่ำสุด – สูงสุด", "ค่ามาตรฐาน", "การประเมิน"], colW: [1.0, 3.5, 0.9, 1.1, 1.5, 1.8, 2.5], rows: D.all.map(x => { const r = execRow(x); return [x.pt.code, x.pl.param + (x.pl.unit ? ` (${x.pl.unit})` : ""), r[2], r[4], r[5], r[6], r[9]]; }) },
        ...(catCur === "WASTE" ? [{ title: "ประสิทธิภาพการบำบัด (% Removal)", head: ["พารามิเตอร์", "เป้าหมาย", "เฉลี่ย", "เดือนที่ต่ำกว่าเป้าหมาย", "สถานะ"], colW: [3, 2.3, 2, 2.5, 2.5], rows: D.removal.map(r => [r.name, `มากกว่า ${r.target}%`, r.avg == null ? "-" : r.avg + "%", r.low, remRow(r)[15]]) }] : []),
        ...D.blocks.map((b, i) => ({ title: `ส่วนที่ ${i + 1} ${b.pt.code} ${b.pt.name}: ผลรายเดือน`, head: ["รายการ", "เกณฑ์", ...MON], colW: [3.1, 1.6, ...MON.map(() => 7.6 / 12)], rows: b.rows.map(x => [x.pl.param, hasLim(x.pl) ? crit(x.pl) : "ไม่กำหนด", ...x.cell.map(cellTxt)]) })),
        ...chartGrids(D).map((svg, i) => ({ title: `กราฟแนวโน้มรายเดือนเทียบค่ามาตรฐาน ชุดที่ ${i + 1}`, svg, note: "เส้นประสีแดง = ค่ามาตรฐาน · จุดสีแดง = เดือนที่นอกเกณฑ์" })),
        { title: "แผนการแก้ไข (Action plan)", head: ["ลำดับ", "ประเด็น", "มาตรการ / การแก้ไข", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "สถานะ"], colW: [0.7, 4.2, 3.4, 1.6, 1.3, 1.1], rows: D.acts.map((p, i) => { const r = planRow(p, i); return [r[0], r[2], r[4] || "ยังไม่ได้เขียนการแก้ไข", r[5], r[6], r[8]]; }) },
        ...(gs ? [{ title: "แผนการแก้ไข (Gantt)", svg: gs, note: "น้ำเงิน = กำลังแก้ไข · แดง = เลยกำหนด · เขียว = ปิดแล้ว" }] : [])] };
    return Office.pptx(catName("บทสรุปผู้บริหาร"), d).catch(e => toast(errText(e), true)); };

  // ---------- AI helper (edge function water-ai): retries when the AI is busy or slow ----------
  async function aiCall(body, msgEl) {
    let data, error, msg;
    for (let t = 0; t < 3; t++) {
      ({ data, error } = await sb.functions.invoke("water-ai", { body }));
      const st = error && error.context && error.context.status, j = error && error.context && typeof error.context.json === "function" ? await error.context.json().catch(() => ({})) : {};
      msg = error ? (j.error || (st === 546 || st === 504 ? "AI ใช้เวลานานเกินที่เซิร์ฟเวอร์อนุญาต" : j.message || error.message)) + (st ? ` (รหัส ${st})` : "") : data && data.error;
      if (!msg || /โควตา|limit: 0|สิทธิ์|ชนิดนี้|ยังไม่มีจุดตรวจ/.test(msg) || !(st === 546 || st === 504 || /ช้าเกิน|503|429|high demand|overload|UNAVAILABLE|RESOURCE_EXHAUSTED|ไม่ตรงรูปแบบ/i.test(msg)) || t === 2) break;
      if (msgEl) msgEl.textContent = `AI ไม่ว่างหรือช้า กำลังลองใหม่อัตโนมัติ (ครั้งที่ ${t + 1}/2)`;
      await new Promise(ok => setTimeout(ok, 10000 * (t + 1)));
    }
    if (msg) throw new Error(msg);
    return data;
  }

  // ---------- แนบไฟล์ผลแล็บ · AI ----------
  const FGRP = { DRINK: "หมวด 1 น้ำกินดื่ม", USE: "หมวด 2 น้ำใช้", WASTE: "หมวด 3 น้ำเสีย", ALL: "หลายหมวด" };
  const FST = { uploaded: "แนบแล้ว ยังไม่ให้ AI อ่าน", read: "AI อ่านแล้ว รอตรวจและบันทึก", saved: "บันทึกผลแล้ว", error: "AI อ่านไม่สำเร็จ" };
  const extOf = n => (String(n).match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
  // the text inside a .docx (word/document.xml) read in the browser, so the AI gets it as text
  async function docxText(file) {
    const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer), dec = new TextDecoder();
    let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error("ไฟล์ Word นี้เปิดไม่ได้");
    let p = dv.getUint32(e + 16, true);
    for (let n = dv.getUint16(e + 10, true); n > 0; n--) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      if (dec.decode(buf.subarray(p + 46, p + 46 + nl)) === "word/document.xml") {
        const st = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = buf.subarray(st, st + csize);
        const xml = method === 0 ? dec.decode(raw) : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
        return xml.replace(/<\/w:tc>/g, " | ").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n");
      }
      p += 46 + nl + xl + cl;
    }
    throw new Error("ไม่พบเนื้อหาในไฟล์ Word นี้");
  }
  // Excel / Word / CSV / text become text in the browser; PDF and pictures go to the AI as they are
  async function fileText(file, name) {
    const x = extOf(name);
    if (x === "xlsx" || x === "xlsm") { const sh = await Office.readXlsx(file); return Object.entries(sh).map(([n, rows]) => `=== แผ่นงาน ${n} ===\n` + rows.map(r => r.map(c => String(c ?? "").trim()).join(" | ")).filter(l => l.replace(/[|\s]/g, "")).join("\n")).join("\n\n"); }
    if (x === "docx") return docxText(file);
    if (["csv", "txt", "tsv", "json", "xml", "html", "htm"].includes(x)) return await file.text();
    return "";
  }
  function impYears() { const y = +today().slice(0, 4), ys = [...new Set([y, y - 1, ...wfiles.map(f => +f.month.slice(0, 4))])].sort((a, b) => b - a), v = $("#iY").value;
    $("#iY").innerHTML = ys.map(x => `<option value="${x}">พ.ศ. ${x + 543}</option>`).join(""); if (ys.includes(+v)) $("#iY").value = v; }
  let revId = null;
  function rImp() {
    $("#upPanel").hidden = !canRec; if (!$("#uM").value) $("#uM").value = today().slice(0, 7);
    impYears(); const Y = $("#iY").value, G = ["DRINK", "USE", "WASTE", "ALL"];
    $("#iGrid").innerHTML = `<tr><th>เดือน</th>${G.map(g => `<th>${FGRP[g]}</th>`).join("")}</tr>` + MON.map((m, i) => { const k = `${Y}-${String(i + 1).padStart(2, "0")}`;
      return `<tr><td>${m} ${+Y + 543}</td>${G.map(g => { const L = wfiles.filter(f => f.month.startsWith(k) && f.grp === g);
        return `<td>${L.map(f => `<span class="fchip ${f.status}" data-f="${f.id}" title="${esc(FST[f.status])}">${esc(f.file_name)}${f.status === "saved" ? ` ✓ ${f.saved_count}` : f.status === "read" ? " · รอบันทึก" : f.status === "error" ? " · อ่านไม่สำเร็จ" : ""}</span>`).join("") || (g === "ALL" ? "" : '<span class="sub">ยังไม่มีไฟล์</span>')}</td>`; }).join("")}</tr>`; }).join("");
    if (revId && wfiles.some(f => f.id === revId)) rRev(revId); else $("#iRev").innerHTML = wfiles.length ? `<p class="sub">กดชื่อไฟล์ในตารางเพื่อดูผลที่ AI อ่าน ตรวจ และบันทึก</p>` : "";
  }
  $("#iY").onchange = () => rImp();
  $("#iGrid").onclick = ev => { const c = ev.target.closest("[data-f]"); if (!c) return; revId = +c.dataset.f; rRev(revId); $("#iRev").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("#fU").onsubmit = guard(async () => {
    const fs = [...$("#uF").files], m = $("#uM").value, H = hosp(); if (!fs.length) throw new Error("เลือกไฟล์ก่อน"); if (!m) throw new Error("เลือกเดือนของผลก่อน");
    const big = fs.find(f => f.size > 20 * 1024 * 1024); if (big) throw new Error(`ไฟล์ ${big.name} ใหญ่เกิน 20 MB`);
    const made = [];
    for (const [i, f] of fs.entries()) {
      $("#uMsg").textContent = `กำลังแนบ ${i + 1}/${fs.length}: ${f.name}`;
      const path = `${H.code}/${m}/${Date.now()}-${i}${extOf(f.name) ? "." + extOf(f.name) : ""}`;
      const up = await sb.storage.from("water-lab").upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false }); if (up.error) throw up.error;
      const { data, error } = await sb.from("water_files").insert({ hospital_id: H.id, month: m + "-01", grp: $("#uG").value, path, file_name: f.name, mime: f.type || null, size: f.size, lab: $("#uL").value.trim() || null, created_by: me.id }).select().single();
      if (error) throw error; made.push([data, f]);
    }
    $("#fU").reset(); $("#uM").value = m; await load(); $("#iY").value = m.slice(0, 4); revId = made[made.length - 1][0].id; rImp();
    if ($("#uAuto").checked && made.length) for (const [row, f] of made) await aiRead(row, f);
    $("#uMsg").textContent = `แนบแล้ว ${made.length} ไฟล์`;
  });
  async function aiRead(row, fileObj) {
    const msg = $("#uMsg"); msg.textContent = `AI กำลังอ่าน ${row.file_name} (ประมาณ 20-60 วินาที)`;
    let text = "";
    try {
      if (!fileObj && /^(xlsx|xlsm|docx|csv|txt|tsv|json|xml|html|htm)$/.test(extOf(row.file_name))) { const d = await sb.storage.from("water-lab").download(row.path); if (d.error) throw d.error; fileObj = d.data; }
      if (fileObj) text = await fileText(fileObj, row.file_name);
      await aiCall({ step: "read", file_id: row.id, text }, msg);
      msg.textContent = `AI อ่าน ${row.file_name} แล้ว ตรวจผลด้านล่างก่อนกดบันทึก`;
    } catch (e) { msg.textContent = ""; toast(`AI อ่าน ${row.file_name} ไม่สำเร็จ: ${errText(e)}`, true); }
    await load(); revId = row.id; rImp();
  }
  // plan options grouped by sampling point
  const planOpts = sel => `<option value="">ไม่บันทึก / ยังจับคู่ไม่ได้</option>` + points.filter(p => p.active).map(p => `<optgroup label="${esc(p.code)} ${esc(p.name)}">${plans.filter(x => x.point_id === p.id && x.active).map(x => `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${esc(x.param)}${x.unit ? " (" + esc(x.unit) + ")" : ""}</option>`).join("")}</optgroup>`).join("");
  // what a value means for a พบ/ไม่พบ or ผ่าน/ไม่ผ่าน item
  const qualOf = (pl, v) => { const t = String(v || "").trim().toLowerCase();
    if (pl.kind === "detect") return /ไม่พบ|^nd$|n\.d|not\s*detect|negative|absent|^<\s*\d|^0$/.test(t) ? "nd" : /พบ|detect|positive|present|^\d/.test(t) ? "detected" : null;
    if (pl.kind === "pf") return /ไม่ผ่าน|fail|not\s*pass/.test(t) ? "fail" : /ผ่าน|pass|ok/.test(t) ? "pass" : null; return null; };
  const gradeTxt = (pl, v) => { if (!pl.id || !String(v || "").trim()) return ["", ""];
    if (pl.kind !== "num") { const q = qualOf(pl, v); return q ? [QUAL[q], q === "detected" || q === "fail" ? "fail" : "ok"] : ["อ่านค่าไม่ได้", "warn"]; }
    const pv = parseVal(v); if (!pv || pv.bad) return ["อ่านค่าไม่ได้", "warn"];
    const bad = (pl.lo != null && pv.value < +pl.lo) || (pl.hi != null && pv.value > +pl.hi); return bad ? ["นอกเกณฑ์", "fail"] : pl.lo == null && pl.hi == null ? ["ไม่มีเกณฑ์", ""] : ["ผ่าน", "ok"]; };
  function rRev(id) {
    const f = wfiles.find(x => x.id === id); if (!f) return; const A = f.ai || {}, rows = A.rows || [];
    const dup = (pid, d) => pid && results.some(r => r.plan_id === pid && r.sampled_on === d);
    $("#iRev").innerHTML = `<div class="panel"><h2>${esc(f.file_name)}</h2>
      <p class="sub">${FGRP[f.grp]} · ผลของเดือน ${dTH(f.month).replace(/^\d+\s/, "")} · ${esc(f.lab || A.lab || "ไม่ระบุห้องปฏิบัติการ")}${A.report_no ? " · รายงานเลขที่ " + esc(A.report_no) : ""} · สถานะ: <b>${FST[f.status]}</b>${f.saved_count ? ` (บันทึกแล้ว ${f.saved_count} ค่า)` : ""}${f.ai_model ? ` · อ่านโดย ${esc(f.ai_model)} เมื่อ ${dTH(f.ai_at)}` : ""}</p>
      ${f.error ? `<div class="note bad">${esc(f.error)}</div>` : ""}
      <div class="acts"><button class="btn small" type="button" id="rvOpen">เปิดไฟล์</button>${canRec ? `<button class="btn small" type="button" id="rvRead">🤖 ${f.ai ? "ให้ AI อ่านใหม่" : "ให้ AI อ่านไฟล์นี้"}</button>` : ""}</div>
      ${(A.notes || []).length ? `<div class="note">ข้อสังเกตของ AI:<br>${A.notes.map(esc).join("<br>")}</div>` : ""}
      ${rows.length ? `<p class="sub">ตรวจทุกแถวเทียบกับไฟล์จริง แก้รายการ วันที่ หรือค่าได้ แถวที่ติ๊กเท่านั้นจะถูกบันทึก · แถวสีเหลือง = มีผลของรายการนี้ในวันเดียวกันอยู่แล้ว (ไม่ติ๊กให้)</p>
      <div class="tw"><table class="tt" id="rvT"><tr><th>บันทึก</th><th>ในไฟล์</th><th>จุดตรวจ · รายการ (แบบฟอร์มกลาง)</th><th>วันที่เก็บตัวอย่าง</th><th>ค่า</th><th>เทียบเกณฑ์</th><th>หมายเหตุ AI</th></tr>
      ${rows.map((r, i) => { const pl = plOf(r.plan_id), d = dup(r.plan_id, r.sampled_on), g = gradeTxt(pl, r.value);
        return `<tr class="${d ? "warn" : ""}" data-i="${i}"><td><input type="checkbox" data-k="on" ${r.plan_id && !d && f.status !== "saved" ? "checked" : ""} aria-label="บันทึกแถวนี้"></td><td>${esc(r.point_in_file || "")}<br><b>${esc(r.param_in_file || "")}</b></td>
          <td><select data-k="plan">${planOpts(r.plan_id)}</select></td><td><input type="date" data-k="date" value="${esc(r.sampled_on || "")}" max="${today()}"></td><td><input class="sm" data-k="val" value="${esc(r.value || "")}"></td><td class="${g[1]}" data-k="g">${esc(g[0])}</td><td>${esc(r.note || "")}${d ? "<br>มีผลวันนี้อยู่แล้ว" : ""}</td></tr>`; }).join("")}</table></div>
      ${canRec ? `<div class="acts"><button class="btn primary" type="button" id="rvSave">บันทึกผลที่ติ๊ก</button><span class="sub" id="rvMsg"></span></div>` : ""}` : f.ai ? `<p class="sub">AI ไม่พบค่าที่จับคู่ได้ในไฟล์นี้</p>` : ""}</div>`;
    $("#rvOpen").onclick = guard(async () => { const { data, error } = await sb.storage.from("water-lab").createSignedUrl(f.path, 600); if (error) throw error; window.open(data.signedUrl, "_blank", "noopener"); });
    if ($("#rvRead")) $("#rvRead").onclick = guard(async () => aiRead(f));
    const T = $("#rvT"); if (T) T.oninput = T.onchange = ev => { const tr = ev.target.closest("tr[data-i]"); if (!tr || ev.target.dataset.k === "on") return;
      const g = gradeTxt(plOf(+tr.querySelector('[data-k="plan"]').value), tr.querySelector('[data-k="val"]').value), c = tr.querySelector('[data-k="g"]'); c.textContent = g[0]; c.className = g[1]; };
    if ($("#rvSave")) $("#rvSave").onclick = guard(async () => {
      const out = [];
      for (const tr of T.querySelectorAll("tr[data-i]")) { if (!tr.querySelector('[data-k="on"]').checked) continue;
        const pl = plOf(+tr.querySelector('[data-k="plan"]').value), d = tr.querySelector('[data-k="date"]').value, v = tr.querySelector('[data-k="val"]').value.trim(), r = rows[+tr.dataset.i];
        if (!pl.id) throw new Error(`แถว "${r.param_in_file}" ยังไม่ได้เลือกรายการในแบบฟอร์มกลาง (หรือเอาติ๊กออก)`);
        if (!d || d > today()) throw new Error(`แถว "${r.param_in_file}" วันที่เก็บตัวอย่างไม่ถูกต้อง`);
        let value = null, val_text = null, qual = null;
        if (pl.kind === "num") { const pv = parseVal(v); if (!pv || pv.bad) throw new Error(`ค่า "${v}" ของ ${pl.param} อ่านไม่ได้ ให้แก้เป็นตัวเลข เช่น 12 หรือ <0.1 หรือ ND`); value = pv.value; val_text = pv.text; }
        else { qual = qualOf(pl, v); if (!qual) throw new Error(`ค่า "${v}" ของ ${pl.param} ต้องเป็น พบ / ไม่พบ หรือ ผ่าน / ไม่ผ่าน`); }
        out.push({ plan_id: pl.id, hospital_id: pl.hospital_id, sampled_on: d, value, val_text, qual, lab: f.lab || A.lab || null, report_no: r.report_no || A.report_no || null, note: `นำเข้าจากไฟล์ ${f.file_name}${r.note ? " · " + r.note : ""}`, file_id: f.id, recorded_by: me.id }); }
      if (!out.length) throw new Error("ยังไม่ได้ติ๊กแถวที่จะบันทึก");
      const { data, error } = await sb.from("water_results").insert(out).select(); if (error) throw error;
      const up = await sb.from("water_files").update({ status: "saved", saved_count: (f.saved_count || 0) + data.length, saved_at: new Date().toISOString(), saved_by: me.id }).eq("id", f.id); if (up.error) throw up.error;
      const bad = data.filter(r => r.status === "fail").length;
      toast(`บันทึกแล้ว ${data.length} ค่า${bad ? ` · นอกเกณฑ์ ${bad} ค่า ระบบเปิดรายการแก้ไขให้แล้ว` : ""}`, !!bad); await load(); rImp(); });
  }

  // ---------- AI สรุปผู้บริหาร + วิเคราะห์ ----------
  // the figures the AI gets: computed here from the saved results (no personal data)
  const aiInputOf = D => ({ hospital: D.hcode, group: GRP[D.g], year_be: D.YT, sampling_points: D.pts.map(p => `${p.code} ${p.name} (${SYS[p.system]})`),
    results: D.res.length, passed: D.res.filter(r => r.status !== "fail").length, months_all_pass: D.clean.length, months_with_results: D.tested.length,
    items: D.all.map(x => ({ point: x.pt.code, item: x.pl.param, type: TT[x.pl.test_type], unit: x.pl.unit || "", standard: hasLim(x.pl) ? crit(x.pl) : "ไม่กำหนด", tests: x.n, out_of_range: x.fail,
      avg: x.avg, min: x.minT, max: x.maxT, monthly: Object.fromEntries(x.cell.map((l, i) => [MON[i], cellTxt(l)]).filter(([, v]) => v)), assessment: x.as.txt, missing_months: x.missing })),
    removal: D.removal.map(r => ({ parameter: r.name, target: `>${r.target}%`, avg: r.avg, months_below_target: r.low, monthly: r.m })),
    corrective_actions: D.acts.map(p => ({ problem: p.a.problem, action: p.a.action || "", owner: p.a.owner || "", due: p.a.due, status: p.a.status })) });
  const aiOf = (h, g, y) => aiReps.find(r => (r.hospital_id || null) === (h || null) && r.grp === g && +r.year === +y);
  function aiHtml(rep, when, model) {
    if (!rep) return ""; const R = rep, G = aiGantt(R);
    return `<h3>บทสรุปผู้บริหารโดย AI</h3><ol>${(R.summary || []).map(x => `<li>${esc(x)}</li>`).join("")}</ol><h3>บทวิเคราะห์โดย AI</h3><ol>${(R.analysis || []).map(x => `<li>${esc(x)}</li>`).join("")}</ol>
      ${(R.risks || []).length ? `<h3>ความเสี่ยง</h3><ol>${R.risks.map(x => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
      ${(R.plan || []).length ? `<h3>แผนงานที่ AI เสนอ</h3><div class="tw"><table class="tt"><tr><th>ลำดับ</th><th>ประเด็น</th><th>มาตรการ</th><th>ผู้รับผิดชอบ</th><th>เริ่ม</th><th>กำหนดเสร็จ</th></tr>${R.plan.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.issue)}</td><td>${esc(p.action)}</td><td>${esc(p.owner)}</td><td>${dTH(p.start)}</td><td>${dTH(p.due)}</td></tr>`).join("")}</table></div>` : ""}
      ${G ? `<p class="sub"><b>แผนงาน (Gantt)</b></p><div class="tw">${G.replace("<svg ", '<svg class="trend" ')}</div>` : ""}
      ${(R.data_gaps || []).length ? `<h3>ข้อมูลที่ยังขาด</h3><ol>${R.data_gaps.map(x => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
      <p class="sub">ทำเมื่อ ${dTH(when)}${model ? " · " + esc(model) : ""} · ตัวเลขมาจากผลที่บันทึกในระบบ ให้ผู้รับผิดชอบตรวจทานก่อนนำเสนอ</p>`;
  }
  // AI parts for the exports of a deck / workbook
  const aiSections = R => !R ? [] : [
    { title: "บทสรุปผู้บริหารโดย AI", head: ["ข้อ", "สรุป"], colW: [0.8, 11.5], rows: (R.summary || []).map((x, i) => [i + 1, x]) },
    { title: "บทวิเคราะห์โดย AI", head: ["ข้อ", "วิเคราะห์"], colW: [0.8, 11.5], rows: [...(R.analysis || []), ...(R.risks || []).map(x => "ความเสี่ยง: " + x), ...(R.data_gaps || []).map(x => "ข้อมูลที่ยังขาด: " + x)].map((x, i) => [i + 1, x]) },
    { title: "แผนงานที่ AI เสนอ", head: ["ลำดับ", "ประเด็น", "มาตรการ", "ผู้รับผิดชอบ", "เริ่ม", "กำหนดเสร็จ"], colW: [0.7, 3.2, 4.4, 1.8, 1.1, 1.1], rows: (R.plan || []).map((p, i) => [i + 1, p.issue, p.action, p.owner, dTH(p.start), dTH(p.due)]) },
    ...(aiGantt(R) ? [{ title: "แผนงานที่ AI เสนอ (Gantt)", svg: aiGantt(R), note: "แถบสีแดง = เลยกำหนดแล้ว" }] : [])];
  const aiSheets = (R, tag) => !R ? [] : [{ name: `AI สรุป${tag}`, header: 0, rows: [["ข้อ", "บทสรุปผู้บริหารโดย AI"], ...(R.summary || []).map((x, i) => [i + 1, x]), [], ["ข้อ", "บทวิเคราะห์โดย AI"], ...(R.analysis || []).map((x, i) => [i + 1, x]),
      ...((R.risks || []).length ? [[], ["ข้อ", "ความเสี่ยง"], ...R.risks.map((x, i) => [i + 1, x])] : []), ...((R.data_gaps || []).length ? [[], ["ข้อ", "ข้อมูลที่ยังขาด"], ...R.data_gaps.map((x, i) => [i + 1, x])] : [])] },
    { name: `AI แผนงาน${tag}`, header: 0, rows: [["ลำดับ", "ประเด็น", "มาตรการ", "ผู้รับผิดชอบ", "เริ่ม", "กำหนดเสร็จ"], ...(R.plan || []).map((p, i) => [i + 1, p.issue, p.action, p.owner, dTH(p.start), dTH(p.due)])] },
    ...(aiGantt(R) ? [{ name: `AI Gantt${tag}`, rows: [["แผนงานที่ AI เสนอ (Gantt)"]], styles: { 0: 2 }, svg: aiGantt(R) }] : [])];
  function rCatAi() { const a = aiOf(hosp().id, catCur, $("#cY").value); $("#cAi").innerHTML = a ? aiHtml(a.report, a.created_at, a.model) : `<p class="sub">ยังไม่มีบทสรุปจาก AI ของหมวดนี้ปีนี้ กดปุ่ม 🤖 เพื่อให้ AI อ่านผลทั้งปีแล้วเขียนบทสรุปผู้บริหาร บทวิเคราะห์ และแผนงาน</p>`;
    $("#cAiBtn").hidden = !canRec; }
  $("#cAiBtn").onclick = guard(async () => { const D = catData(catCur); if (!D.res.length) throw new Error("ยังไม่มีผลตรวจของหมวดนี้ในปีที่เลือก");
    $("#cAiMsg").textContent = "AI กำลังอ่านผลทั้งปีและเขียนบทสรุป (ประมาณ 20-60 วินาที)";
    try { const r = await aiCall({ step: "summary", hospital_id: hosp().id, grp: catCur, year: +D.Y, input: aiInputOf(D) }, $("#cAiMsg"));
      aiReps.unshift({ hospital_id: hosp().id, grp: catCur, year: +D.Y, report: r.report, model: r.model, created_at: r.created_at || new Date().toISOString() }); $("#cAiMsg").textContent = "เสร็จแล้ว"; rCatAi(); }
    catch (e) { $("#cAiMsg").textContent = ""; throw e; } });

  // ---------- 12 โรง: one water group compared across hospitals, AI summary of all 12 ----------
  let V = null;
  function vYears() { const y = +today().slice(0, 4); if (!$("#vY").options.length) $("#vY").innerHTML = [y, y - 1, y - 2].map(x => `<option value="${x}">พ.ศ. ${x + 543}</option>`).join(""); }
  const vRow = r => [r.code, r.name, r.D.pts.length, r.D.all.length, r.D.res.length, r.pr == null ? "-" : r.pr + "%", `${r.D.clean.length}/${r.D.tested.length}`, r.fails.length ? r.fails.join(" · ") : r.D.res.length ? "ไม่มี" : "-",
    r.watch.length ? r.watch.join(" · ") : "-", ...(V.g === "WASTE" ? [r.D.removal.map(x => `${x.name} ${x.avg == null ? "-" : x.avg + "%"}`).join(" · ") || "-"] : []), r.D.acts.filter(p => p.a.status === "open").length, r.nf];
  const vHead = () => ["โรง", "ชื่อ", "จุดตรวจ", "รายการ", "ผลตรวจ (ครั้ง)", "ผ่านเกณฑ์", "เดือนที่ผ่านทุกรายการ", "รายการนอกเกณฑ์", "รายการเฝ้าระวัง", ...(V.g === "WASTE" ? ["% การบำบัดเฉลี่ย"] : []), "แก้ไขยังไม่ปิด", "ไฟล์ผลแล็บที่แนบ"];
  $("#vLoad").onclick = guard(async () => {
    const Y = $("#vY").value, g = $("#vG").value, ids = hosps.map(h => h.id); $("#vMsg").textContent = "กำลังโหลด…";
    const [p, l, r, a, f, ai] = await Promise.all([sb.from("water_points").select("*").in("hospital_id", ids), sb.from("water_plans").select("*").in("hospital_id", ids),
      sb.from("water_results").select("*").in("hospital_id", ids).gte("sampled_on", Y + "-01-01").lte("sampled_on", Y + "-12-31").order("sampled_on", { ascending: false }).limit(20000),
      sb.from("water_actions").select("*").in("hospital_id", ids), sb.from("water_files").select("id,hospital_id,month,grp,status").in("hospital_id", ids).gte("month", Y + "-01-01").lte("month", Y + "-12-31"),
      sb.from("water_ai").select("*").is("hospital_id", null).eq("grp", g).eq("year", +Y).order("created_at", { ascending: false }).limit(1)]);
    for (const x of [p, l, r, a]) if (x.error) throw x.error;
    const rows = hosps.slice().sort((x, y) => x.code.localeCompare(y.code)).map(h => { const C = { points: p.data.filter(x => x.hospital_id === h.id), plans: l.data.filter(x => x.hospital_id === h.id), results: r.data.filter(x => x.hospital_id === h.id), actions: a.data.filter(x => x.hospital_id === h.id), Y, pid: null, tt: "", hcode: h.code };
      const D = catData(g, C), pass = D.res.filter(x => x.status !== "fail").length;
      return { code: h.code, name: h.name, D, pr: pct(pass, D.res.length), fails: D.all.filter(x => x.as.st === "fail").map(x => `${x.pl.param} (${x.pt.code}) ${x.fail} ครั้ง`), watch: D.all.filter(x => x.as.st === "watch").map(x => `${x.pl.param} (${x.pt.code})`),
        nf: (f.data || []).filter(x => x.hospital_id === h.id && (x.grp === g || x.grp === "ALL")).length }; });
    V = { g, Y, YT: +Y + 543, rows, ai: ai.data && ai.data[0] }; $("#vMsg").textContent = ""; rV(); });
  function rV() { if (!V) return;
    $("#vGrp").innerHTML = `<tr>${vHead().map(h => `<th>${h}</th>`).join("")}</tr>` + V.rows.map(r => `<tr>${vRow(r).map((c, i) => `<td class="${i === 5 ? cls2(r.pr) : i === 7 && r.fails.length ? "fail" : ""} ${[2, 3, 4, 5].includes(i) ? "n" : ""}">${esc(String(c))}</td>`).join("")}</tr>`).join("");
    $("#vAiBtn").hidden = !exec; $("#vAi").innerHTML = V.ai ? aiHtml(V.ai.report, V.ai.created_at, V.ai.model) : `<p class="sub">${exec ? "กดปุ่ม 🤖 เพื่อให้ AI สรุปและวิเคราะห์หมวดนี้ของทุกโรง" : "สรุป 12 โรงโดย AI ทำได้เฉพาะผู้บริหาร"}</p>`; }
  const cls2 = v => v == null ? "never" : v >= 95 ? "ok" : v >= 80 ? "warn" : "fail";
  const vInput = () => ({ group: GRP[V.g], year_be: V.YT, hospitals: V.rows.map(r => ({ hospital: r.code, sampling_points: r.D.pts.length, items: r.D.all.length, results: r.D.res.length, pass_rate: r.pr, months_all_pass: r.D.clean.length, months_with_results: r.D.tested.length,
    out_of_range: r.D.all.filter(x => x.fail).map(x => ({ item: x.pl.param, point: x.pt.code, times: x.fail, max: x.maxT, min: x.minT, standard: crit(x.pl) })), watch: r.watch,
    removal: r.D.removal.map(x => ({ parameter: x.name, avg: x.avg, target: x.target, months_below: x.low })), missing: r.D.all.filter(x => x.missing.length).map(x => `${x.pl.param} (${x.pt.code}) ขาด ${x.missing.length} เดือน`),
    open_actions: r.D.acts.filter(p => p.a.status === "open").length, lab_files: r.nf })) });
  $("#vAiBtn").onclick = guard(async () => { if (!V) throw new Error("กด \"แสดงข้อมูล\" ก่อน"); $("#vAiMsg").textContent = "AI กำลังเปรียบเทียบ 12 โรง (ประมาณ 30-90 วินาที)";
    try { const r = await aiCall({ step: "summary", hospital_id: null, grp: V.g, year: +V.Y, input: vInput() }, $("#vAiMsg")); V.ai = { report: r.report, model: r.model, created_at: r.created_at || new Date().toISOString() }; $("#vAiMsg").textContent = "เสร็จแล้ว"; rV(); }
    catch (e) { $("#vAiMsg").textContent = ""; throw e; } });
  const vFind = () => { const W = V.rows.filter(r => r.D.res.length), F = V.rows.filter(r => r.fails.length), N = V.rows.filter(r => !r.D.pts.length);
    return [`${GRP[V.g]} ปี พ.ศ. ${V.YT}: มีผลตรวจ ${W.length} จาก ${V.rows.length} โรง ผลตรวจรวม ${V.rows.reduce((t, r) => t + r.D.res.length, 0)} ครั้ง`,
      F.length ? `โรงที่มีผลนอกเกณฑ์ ${F.length} โรง: ${F.map(r => `${r.code} (${r.fails.join(" · ")})`).join(" / ")}` : "ไม่มีโรงใดมีผลนอกเกณฑ์",
      N.length ? `โรงที่ยังไม่มีจุดตรวจในหมวดนี้: ${N.map(r => r.code).join(", ")}` : "ทุกโรงมีจุดตรวจในหมวดนี้แล้ว",
      `ไฟล์ผลแล็บที่แนบในปีนี้รวม ${V.rows.reduce((t, r) => t + r.nf, 0)} ไฟล์`]; };
  $("#vgX").onclick = () => { if (!V) return toast("กด \"แสดงข้อมูล\" ก่อน", true);
    Office.xlsx(`น้ำ_${GRP[V.g]}_12โรง_${V.YT}`, [Office.summarySheet({ title: `ผลตรวจคุณภาพน้ำ ${GRP[V.g]} เปรียบเทียบ 12 โรง ปี พ.ศ. ${V.YT}`, org: "โรงพยาบาลในเครือ 12 โรง", period: `ข้อมูล ณ ${dTH(today())}`, findings: vFind(), notes: [`ค่ามาตรฐานอ้างอิง: ${CAT_LAW[V.g]}`] }),
      { name: "เปรียบเทียบ 12 โรง", header: 0, rows: [vHead(), ...V.rows.map(vRow)] }, ...aiSheets(V.ai && V.ai.report, "")]); };
  $("#vgP").onclick = () => { if (!V) return toast("กด \"แสดงข้อมูล\" ก่อน", true); const R = V.ai && V.ai.report;
    return Office.pptx(`น้ำ_${GRP[V.g]}_12โรง_บทสรุปผู้บริหาร_${V.YT}`, { title: `ผลตรวจคุณภาพน้ำ ${GRP[V.g]} เปรียบเทียบ 12 โรง ปี พ.ศ. ${V.YT}`, org: "โรงพยาบาลในเครือ 12 โรง", period: `ข้อมูล ณ ${dTH(today())}`,
      findings: R ? R.summary : vFind(), analysis: R ? R.analysis : [], notes: [`ค่ามาตรฐานอ้างอิง: ${CAT_LAW[V.g]}`],
      sections: [{ title: "เปรียบเทียบ 12 โรง", head: ["โรง", "ผลตรวจ", "ผ่านเกณฑ์", "เดือนผ่านทุกรายการ", "รายการนอกเกณฑ์", "แก้ไขยังไม่ปิด"], colW: [0.9, 1.1, 1.2, 1.6, 6.3, 1.2], rows: V.rows.map(r => [r.code, r.D.res.length, r.pr == null ? "-" : r.pr + "%", `${r.D.clean.length}/${r.D.tested.length}`, r.fails.join(" · ") || "-", r.D.acts.filter(p => p.a.status === "open").length]) },
        ...aiSections(R).slice(2)] }).catch(e => toast(errText(e), true)); };

})();
