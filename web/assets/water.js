// Water Management · ตรวจคุณภาพน้ำ (JCI 8th FMS.08.04): register of sampling points per hospital, a test plan per point
// (parameter, limits, frequency), results graded by the database against the limits, schedule by frequency,
// out-of-range results → corrective action → repair job, trends, 12-hospital overview, and 4 exports (Excel, PPT, Word, PDF).
(() => {
  const { sb, $, esc, errText } = RS;
  const MGR = ["owner", "admin", "chief_engineer", "supervisor"];
  // three water groups (user 2026-11-25): น้ำกินดื่ม / น้ำใช้ / น้ำเสีย; every test is ตรวจเชื้อ or สารเคมี
  const SYS = { DW: "น้ำดื่ม (ตู้กดน้ำดื่ม / เครื่องกรองน้ำดื่ม)", POT: "น้ำประปา (ถังเก็บ / ก๊อกปลายทาง)", CT: "หอผึ่งเย็น (Cooling tower)", RO_HD: "น้ำ RO ไตเทียม (Hemodialysis)", RO_CSSD: "น้ำ RO หน่วยจ่ายกลาง (CSSD)", HW: "น้ำร้อน (ควบคุม Legionella)", WW: "น้ำเสีย (ระบบบำบัดน้ำเสีย / น้ำทิ้ง)", OTH: "อื่น ๆ" };
  const GRP = { DRINK: "น้ำกินดื่ม", USE: "น้ำใช้", WASTE: "น้ำเสีย" };
  const grpOf = sys => sys === "DW" ? "DRINK" : sys === "WW" ? "WASTE" : "USE";
  const TT = { bio: "ตรวจเชื้อ", chem: "สารเคมี" };
  const ttPill = pl => `<span class="pill ${pl.test_type === "bio" ? "bio" : "chem"}">${TT[pl.test_type] || TT.chem}</span>`;
  const FREQ = { D: "ทุกวัน", W: "ทุกสัปดาห์", M: "ทุกเดือน", Q: "ทุก 3 เดือน", S: "ทุก 6 เดือน", Y: "ทุกปี" };
  const SOON = { D: 0, W: 2, M: 7, Q: 14, S: 14, Y: 30 };
  const DST = { ok: "ยังไม่ถึงกำหนด", soon: "ใกล้ถึงกำหนด", over: "เลยกำหนด", never: "ยังไม่เคยตรวจ" };
  const RST = { pass: "ผ่าน", warn: "ผ่าน (ระดับเฝ้าระวัง)", fail: "นอกเกณฑ์" };
  const QUAL = { nd: "ไม่พบ", detected: "พบ", pass: "ผ่าน", fail: "ไม่ผ่าน" };
  let me = null, exec = false, hosps = [], canRec = false, canMan = false, cur = "sum", busy = false;
  let tpl = [], points = [], plans = [], results = [], actions = [];
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
  const valTxt = r => { const pl = plOf(r.plan_id); return r.qual ? QUAL[r.qual] : num(r.value) + (pl.unit ? " " + pl.unit : ""); };
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
    points = p.data || []; plans = l.data || []; results = r.data || []; actions = a.data || [];
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  const TABS = ["sum", "due", "rec", "hist", "act", "reg", "std", "all"];
  function show(t) {
    cur = TABS.includes(t) ? t : "sum";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    TABS.forEach(k => $("#tab-" + k).hidden = k !== cur);
    try { ({ sum: rSum, due: rDue, rec: rRec, hist: rHist, act: rAct, reg: rReg, std: rStd, all: rAll })[cur](); } catch (e) { toast(errText(e), true); }
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
  const resRow = r => { const pl = plOf(r.plan_id), pt = ptOf(pl.point_id); return [dTH(r.sampled_on), GRP[grpOf(pt.system)], SYS[pt.system] || "", TT[pl.test_type] || "", pt.code || "", pt.name || "", pl.param || "", r.qual ? QUAL[r.qual] : r.value, pl.unit || "", crit(pl), RST[r.status], r.lab || "", r.report_no || "", r.note || ""]; };
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
        const inp = pl.kind === "num" ? `<input class="sm" type="number" step="any" inputmode="decimal" data-v="${pl.id}" aria-label="ค่า ${esc(pl.param)}"> ${esc(pl.unit || "")}`
          : `<select data-v="${pl.id}" aria-label="ผล ${esc(pl.param)}"><option value="">ไม่ได้ตรวจ</option>${(pl.kind === "detect" ? ["nd", "detected"] : ["pass", "fail"]).map(k => `<option value="${k}">${QUAL[k]}</option>`).join("")}</select>`;
        return `<tr><td>${ttPill(pl)} ${esc(pl.param)}${pl.method ? `<br><span class="sub">${esc(pl.method)}</span>` : ""}</td><td>${esc(crit(pl))}</td><td class="${d.st}">${FREQ[pl.freq]}<br>${d.next ? "ครบ " + dTH(d.next) : "ยังไม่เคยตรวจ"}</td><td>${inp}</td><td><input data-n="${pl.id}" aria-label="หมายเหตุ"></td></tr>`; }).join("")
        : `<tr><td colspan="5">จุดนี้ยังไม่มีรายการตรวจ ให้หัวหน้าเพิ่มที่แท็บ "ทะเบียนจุดตรวจ"</td></tr>`);
  }
  $("#rP").onchange = () => recRows();
  $("#fR").onsubmit = guard(async () => {
    const rows = [...document.querySelectorAll("#rRows [data-v]")].filter(i => i.value !== "").map(i => { const pl = plOf(+i.dataset.v), n = document.querySelector(`#rRows [data-n="${pl.id}"]`).value.trim();
      return { plan_id: pl.id, hospital_id: pl.hospital_id, sampled_on: $("#rD").value, value: pl.kind === "num" ? +i.value : null, qual: pl.kind === "num" ? null : i.value,
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
})();
