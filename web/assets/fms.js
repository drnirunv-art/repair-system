// FMS Round (Tracer JCI 8th): the FMS committee walks each area with the check-list of one category, answers every item
// (pass / fail with detail + photo / not relevant with a reason), the head of the area acknowledges, and every failed item
// becomes a finding that can be sent into the repair queue and closed with an after-photo.
// Three kinds of round, each with its own form grouped by FMS category and ME:
//   doc    = document review: evidence per ME (มีครบ / ไม่ครบ / ไม่มี) → ME status Met / Partially Met / Not Met
//   walk   = field walk per area
//   tracer = follow the surveyor by strategy: Reverse-Tracer on high-risk machines (FMEA), Zero-Red sweep, staff Q&A,
//            contractor Work Permit / ICRA, utility failure, the physician / nurse focus points
// Each form is the central JCI 8th list unless the hospital uploaded its own. Drafts stay in this browser until saved.
(() => {
  const { sb, $, esc, fmt, errText, uploadMedia, signed } = RS;
  const RUN = ["owner", "admin", "chief_engineer", "supervisor", "safety_officer"], MGR = ["owner", "admin", "chief_engineer", "supervisor"];
  const NA = ["ไม่มีพื้นที่ / อุปกรณ์นี้ในหน่วยงาน", "ไม่อยู่ในขอบเขตของหน่วยงานนี้", "พื้นที่อยู่ระหว่างปรับปรุง / ปิดใช้งาน", "อื่น ๆ (ระบุ)"];
  const KIND = { doc: "ตรวจเอกสาร (ตาม ME)", walk: "เดินตรวจหน้างาน", tracer: "เดินตามรอยผู้ตรวจ" };
  const HELP = {
    doc: "ตรวจว่าเอกสาร/หลักฐานของแต่ละ ME มีครบและเป็นปัจจุบัน (ปีล่าสุด) ตอบ มีครบ / มีไม่ครบหรือไม่เป็นปัจจุบัน / ไม่มี ระบบสรุปสถานะ ME เป็น Met / Partially Met / Not Met ให้ ช่อง \"หน่วยงาน\" ใส่เจ้าของเอกสาร เช่น งานวิศวกรรม",
    walk: "เดินดูพื้นที่จริงทีละหน่วยงาน ตอบ ผ่าน / ไม่ผ่าน (กรอกรายละเอียด + แนบรูป) / ไม่เกี่ยว ข้อที่มีแถบแดงคือจุดเสี่ยงสูงตาม JCI 8th และ Zero-Red",
    tracer: "เดินตามรอยแบบที่ผู้ตรวจ JCI ทำ แยกตามกลยุทธ์: TR1 Reverse-Tracer สุ่ม 10 จุด ดึงหลักฐานให้ได้ใน 15 นาที (สัปดาห์ละ 2 รอบ เป้า ดึงทัน 100%) · TR2 กวาด Zero-Red 5 จุดหลายแผนก (เป้า 0 จุดแดง) · TR3 Micro-Drill ถาม-ตอบครบ 3 กะ รวม Outsource (เป้า ตอบถูก ≥ 90%) · TR4 ตามงานผู้รับเหมาที่มี Work Permit / ICRA · TR5 ซ้อมสถานการณ์ระบบล้มเหลว · TR6 จุดที่ผู้ตรวจแพทย์/พยาบาลเพ่งเล็ง · TR7 เครื่องจักรความเสี่ยงสูงจาก FMEA · TR8 สัญญา SLA และงานค้าง ช่อง \"เป้าหมาย\" ใส่จุดที่สุ่ม TAG เครื่อง เลขใบอนุญาต หรือหน่วยงาน" };
  const FMEA = /FACP|fire ?alarm|แจ้งเหตุเพลิง|fire ?pump|jockey|ปั๊มดับเพลิง|transformer|หม้อแปลง|switchgear|MDB|generator|เครื่องกำเนิด|ATS|UPS|chiller|ชิลเลอร์|lift|elevator|ลิฟต์|medical gas|ก๊าซทางการแพทย์|manifold|boiler|หม้อไอน้ำ|RO\b/i;
  const BE = +new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }).slice(0, 4) + 543;
  let me = null, H = null, exec = false, can = false, hospitals = [], allItems = [], items = [], MEs = {}, own = false, K = "walk", targets = { eq: [], wp: [] }, rounds = [], R = null, checks = [], finds = [], areas = [], cur = "walk", W = null, busy = false;
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; };
  const guard = fn => async ev => { if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const n = v => (+v || 0).toLocaleString("th-TH"), pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : null;
  const none = (c, w) => `<tr><td colspan="${c}"><div class="empty">${w}</div></td></tr>`;
  const kpis = l => l.map(([k, v, bad]) => `<div class="kpi"><b style="${bad && +String(v).replace(/[^\d.]/g, "") ? "color:var(--bad)" : ""}">${esc(v)}</b><span>${esc(k)}</span></div>`).join("");
  const cls = s => s == null ? "na" : s >= 90 ? "g" : s >= 80 ? "o" : "rd";
  const cats = () => { const m = new Map(); items.forEach(i => { if (!m.has(i.cat)) m.set(i.cat, { cat: i.cat, name: i.cat_name, n: 0 }); m.get(i.cat).n++; }); return [...m.values()]; };
  const catName = c => (cats().find(x => x.cat === c) || {}).name || c;
  // items of one category grouped by ME, in form order: [{ ref, text, list: [index into the given array] }]
  const byMe = list => { const g = []; list.forEach((x, i) => { const r = x.ref || x.c || ""; let last = g[g.length - 1]; if (!last || last.ref !== r) g.push(last = { ref: r, text: MEs[r] || "", list: [] }); last.list.push(i); }); return g; };
  const meHead = g => `<div class="mh"><b>${esc(g.ref || "ไม่ระบุ ME")}</b>${g.text ? ` · ${esc(g.text)}` : ""}</div>`;
  const hid = () => exec ? ($("#hSel").value || me.hospital_id) : me.hospital_id;
  const mine = () => (hid() === me.hospital_id && can) || exec;
  const roundName = r => r ? `ครั้งที่ ${r.no}/${r.year_be}${r.title ? " · " + r.title : ""}` : "";
  const dkey = (area, cat) => `rs-fms-${R && R.id}-${K}-${area}-${cat}`;
  const ck = () => checks.filter(c => c.kind === K);
  const store = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };

  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (me) return;
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,phone,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    if (!data || !data.hospital_id) { $("#gate").hidden = false; return; }
    me = data; H = me.hospitals; exec = (await sb.rpc("am_exec")).data === true; can = RUN.includes(me.role);
    if (!can && !exec) { $("#gateH").textContent = "หน้านี้สำหรับคณะกรรมการ FMS"; $("#gateP").textContent = "เปิดได้เฉพาะ Owner / Admin / Chief Engineer / Supervisor / จป. (Safety Officer) หากต้องใช้ ให้หัวหน้าเปลี่ยนสิทธิ์ในหน้าตั้งค่า"; $("#gate").hidden = false; return; }
    $("#who").textContent = `${me.full_name || ""} · ${H.name}`;
    if (exec) { hospitals = (await sb.from("hospitals").select("id,code,name").order("code")).data || []; $("#hSel").innerHTML = hospitals.map(h => `<option value="${h.id}">${esc(h.code)} · ${esc(h.name)}</option>`).join(""); const pt2 = hospitals.find(x => x.code === "PT2"), keepH = store.get("rs-fms-h"); $("#hSel").value = keepH && hospitals.some(x => x.id === keepH) ? keepH : pt2 ? pt2.id : me.hospital_id; $("#hBox").hidden = false; }
    $("#wName").value = me.full_name || ""; $("#wPhone").value = me.phone || ""; K = store.get("rs-fms-kind") || "walk";
    $("#body").hidden = false; $("#tabs").hidden = false;
    await loadHospital();
    show(new URLSearchParams(location.search).get("tab") || "walk");
  }
  $("#hSel").onchange = guard(async () => { W = null; store.set("rs-fms-h", $("#hSel").value); await loadHospital(); show(cur); });

  async function loadHospital() {
    const h = hid();
    if (!Object.keys(MEs).length) ((await sb.from("fms_me").select("code,text")).data || []).forEach(m => MEs[m.code] = m.text);
    const [it, rs, lo] = await Promise.all([
      sb.from("fms_items").select("*").eq("active", true).or(`hospital_id.is.null,hospital_id.eq.${h}`).order("cat").order("no"),
      sb.from("fms_rounds").select("*").eq("hospital_id", h).order("year_be", { ascending: false }).order("no", { ascending: false }),
      sb.from("locations").select("building,floor,department").eq("hospital_id", h).limit(3000)]);
    if (it.error) return toast(errText(it.error), true);
    allItems = it.data || [];
    rounds = rs.data || [];
    const [eq, wp] = await Promise.all([sb.from("equipment").select("tag,name,eq_type,building").eq("hospital_id", h).eq("active", true).limit(6000),
      sb.from("wp_permits").select("permit_no,title,company,status").eq("hospital_id", h).in("status", ["approved", "working", "fix", "finished"]).limit(300)]);
    targets.eq = (eq.data || []).filter(e => e.tag && FMEA.test(`${e.name} ${e.eq_type}`)).slice(0, 800);
    targets.wp = wp.data || [];
    areas = [...new Set((lo.data || []).map(l => (l.department || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
    setKind(K, true);
    $("#rSel").innerHTML = rounds.length ? rounds.map(r => `<option value="${r.id}">${esc(roundName(r))}${r.status === "closed" ? " (ปิดแล้ว)" : ""}</option>`).join("") : `<option value="">ยังไม่มีรอบตรวจ</option>`;
    const keep = store.get("rs-fms-round"); if (keep && rounds.some(r => r.id === keep)) $("#rSel").value = keep;
    $("#rNew").hidden = !mine(); $("#fFree").hidden = !mine() || K !== "walk";
    await loadRound();
  }
  // ---------- kind (doc / walk / tracer) ----------
  function setKind(k, quiet) {
    K = KIND[k] ? k : "walk"; store.set("rs-fms-kind", K); W = null;
    const h = hid(), ownRows = allItems.filter(i => i.hospital_id === h && i.kind === K); own = ownRows.length > 0;
    items = own ? ownRows : allItems.filter(i => !i.hospital_id && i.kind === K);
    document.querySelectorAll("#kChips .chip").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === K));
    $("#kHelp").textContent = HELP[K];
    $("#wAreaL").firstChild.textContent = K === "doc" ? "หน่วยงาน / เจ้าของเอกสาร * " : K === "tracer" ? "เป้าหมายที่ตามรอย (TAG เครื่อง / เลข Work Permit / หน่วยงาน) * " : "พื้นที่ / หน่วยงานที่ตรวจ * ";
    $("#wArea").placeholder = K === "doc" ? "เช่น งานวิศวกรรม" : "พิมพ์หรือเลือก";
    if (K === "doc" && !$("#wArea").value) $("#wArea").value = "งานวิศวกรรม";
    const opt = v => `<option value="${esc(v)}">`;
    $("#areas").innerHTML = K === "tracer" ? [...targets.eq.map(e => `${e.tag} · ${e.name}`), ...targets.wp.map(p => `${p.permit_no} · ${p.title} (${p.company})`), ...areas].map(opt).join("") : K === "doc" ? ["งานวิศวกรรม", "คณะกรรมการ FMS", "งานรักษาความปลอดภัย", "งานอาชีวอนามัย (จป.)", "งานเครื่องมือแพทย์", ...areas].map(opt).join("") : areas.map(opt).join("");
    $("#wCat").innerHTML = cats().map(c => `<option value="${esc(c.cat)}">${esc(c.name)} (${c.n} ข้อ)</option>`).join("");
    $("#fCat").innerHTML = `<option value="">ทุกหมวด</option>` + cats().map(c => `<option value="${esc(c.cat)}">${esc(c.name)}</option>`).join("");
    $("#tHint").innerHTML = K === "tracer" ? `<b>เป้าหมายที่แนะนำ</b> TR1: สุ่ม 10 จุด (เกจ AIIR, ตู้ยา/ตู้เลือด, Zone valve ก๊าซ, ถังดับเพลิง, ประตูหนีไฟ/Damper, พัดลมห้องผ้าเปื้อน, Gen/ATS, Eyewash, น้ำ RO, AED) · TR7: เครื่องกลุ่มความเสี่ยงสูงตาม FMEA (FACP, Fire pump, หม้อแปลง, HV Switchgear, Generator/ATS, UPS, Chiller, ลิฟต์, ก๊าซทางการแพทย์) พบในทะเบียน ${n(targets.eq.length)} เครื่อง · TR4: Work Permit ที่กำลังทำงาน ${n(targets.wp.length)} ใบ${targets.wp.length ? ` (${targets.wp.slice(0, 3).map(p => esc(p.permit_no)).join(", ")}${targets.wp.length > 3 ? " …" : ""})` : ""} · พิมพ์ในช่องเป้าหมายเพื่อเลือก` : "";
    $("#tHint").hidden = K !== "tracer";
    $("#fFree").hidden = !mine() || K !== "walk";
    if (!quiet) show(cur);
  }
  $("#kChips").onclick = ev => { const b = ev.target.closest(".chip[data-k]"); if (b) setKind(b.dataset.k); };

  $("#rSel").onchange = guard(async () => { W = null; store.set("rs-fms-round", $("#rSel").value); await loadRound(); show(cur); });

  async function loadRound() {
    R = rounds.find(r => r.id === $("#rSel").value) || null;
    $("#rClose").hidden = !(R && mine()); if (R) $("#rClose").textContent = R.status === "open" ? "ปิดรอบตรวจ" : "เปิดรอบอีกครั้ง";
    const yr = R ? rounds.filter(r => r.year_be === R.year_be).map(r => r.id) : [];
    const [c, f] = await Promise.all([
      yr.length ? sb.from("fms_checks").select("*").in("round_id", yr).limit(5000) : { data: [] },
      sb.from("fms_findings").select("*").eq("hospital_id", hid()).order("created_at", { ascending: false }).limit(3000)]);
    checks = c.data || []; finds = f.data || [];
    const rc = checks.filter(x => R && x.round_id === R.id);
    $("#rInfo").textContent = R ? `ตรวจแล้ว ${n(rc.length)} จุด · ${n(new Set(rc.map(x => x.area)).size)} พื้นที่ · ${R.status === "open" ? "เปิดอยู่" : "ปิดแล้ว"}` : "";
    $("#findN").textContent = finds.filter(x => x.status === "open").length || "";
  }

  $("#rNew").onclick = () => {
    const next = Math.max(0, ...rounds.filter(r => r.year_be === BE).map(r => r.no)) + 1;
    dlg(`<h3>เปิดรอบตรวจใหม่</h3><p class="meta">ปีเป็น พ.ศ. · ครั้งที่ 1–24</p>
      <div class="fg" style="grid-template-columns:1fr 1fr"><label>ปี (พ.ศ.)<input id="nY" inputmode="numeric" value="${BE}"></label><label>ครั้งที่<input id="nN" inputmode="numeric" value="${next}"></label>
      <label style="grid-column:1/-1">ชื่อรอบ (ไม่บังคับ)<input id="nT" maxlength="120" placeholder="เช่น Tracer ก่อน Mock Survey"></label></div>
      <div class="row"><button class="btn primary" id="nOk">เปิดรอบ</button><button class="btn" data-close>ยกเลิก</button></div>`);
    $("#nOk").onclick = guard(async () => { const id = await rpc("fms_round_open", { p_year_be: +$("#nY").value, p_no: +$("#nN").value, p_title: $("#nT").value, p_hospital: hid() });
      $("#dlg").close(); store.set("rs-fms-round", id); await loadHospital(); show("walk"); toast("เปิดรอบตรวจแล้ว"); });
  };
  $("#rClose").onclick = guard(async () => { await rpc("fms_round_status", { p_round: R.id, p_status: R.status === "open" ? "closed" : "open" });
    rounds = (await sb.from("fms_rounds").select("*").eq("hospital_id", hid()).order("year_be", { ascending: false }).order("no", { ascending: false })).data || []; await loadRound(); show(cur); });

  // ---------- tabs ----------
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    cur = ["walk", "find", "rep", "board", "form"].includes(t) ? t : "walk";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    document.querySelectorAll("main section[id^=tab-]").forEach(s => s.hidden = s.id !== "tab-" + cur);
    ({ walk: drawWalk, find: drawFind, rep: drawRep, board: drawBoard, form: drawForm })[cur]();
  }

  // ---------- walk ----------
  function drawWalk() {
    const why = !mine() ? "ดูผลได้อย่างเดียว: บันทึกผลตรวจได้เฉพาะคณะกรรมการ FMS ของโรงพยาบาลนี้" : !R ? "ยังไม่มีรอบตรวจ กด \"+ เปิดรอบใหม่\" ก่อน" : R.status !== "open" ? "รอบนี้ปิดแล้ว เปิดรอบอีกครั้งหรือเลือกรอบอื่นเพื่อบันทึก" : "";
    $("#wNo").hidden = !why; $("#wNo").textContent = why;
    $("#wStart").disabled = !!why;
    const rc = ck().filter(x => R && x.round_id === R.id).sort((a, b) => a.updated_at < b.updated_at ? 1 : -1);
    $("#wDone").innerHTML = `<tr><th>${K === "doc" ? "หน่วยงาน" : K === "tracer" ? "เป้าหมาย" : "พื้นที่"}</th><th>หมวด</th><th class="r">คะแนน</th><th class="r">ผ่าน</th>${K === "doc" ? `<th class="r">ไม่ครบ</th>` : ""}<th class="r">ไม่ผ่าน</th><th class="r">ไม่เกี่ยว</th><th>ผู้ประเมิน</th><th>หัวหน้ารับทราบ</th><th>บันทึกเมื่อ</th></tr>` +
      (rc.map(c => `<tr class="click" data-c="${c.id}"><td>${esc(c.area)}</td><td>${esc(catName(c.cat))}</td><td class="sc ${cls(c.score)}">${c.score ?? "-"}</td><td class="r">${c.pass}</td>${K === "doc" ? `<td class="r">${c.part}</td>` : ""}<td class="r">${c.fail}</td><td class="r">${c.na}</td><td>${esc(c.assessor)}</td><td>${esc(c.ack_name || "-")}</td><td>${fmt(c.updated_at)}</td></tr>`).join("") || none(10, "ยังไม่มีผลตรวจในรอบนี้"));
    if (W) drawList(); else $("#wList").innerHTML = "";
    const d = R && Object.keys(localStorage).filter(k => k.startsWith(`rs-fms-${R.id}-${K}-`)).length;
    $("#wDraft").textContent = d ? `มีร่างที่ยังไม่บันทึก ${d} ชุดในเครื่องนี้ (เลือกพื้นที่และหมวดเดิมแล้วกดเริ่มตรวจเพื่อทำต่อ)` : "";
  }
  $("#wDone").onclick = ev => { const tr = ev.target.closest("tr[data-c]"); if (!tr) return; const c = ck().find(x => x.id === tr.dataset.c); $("#wArea").value = c.area; $("#wCat").value = c.cat; start(); };
  $("#wStart").onclick = () => start();
  function start() {
    const area = $("#wArea").value.trim(), cat = $("#wCat").value;
    if (!area) return toast("เลือกหรือพิมพ์พื้นที่ที่ตรวจ", true);
    const list = items.filter(i => i.cat === cat), old = ck().find(c => R && c.round_id === R.id && c.area === area && c.cat === cat), draft = store.get(dkey(area, cat));
    const prev = draft ? draft.ans : old ? old.answers : [];
    W = { area, cat, list, old, ack: draft ? draft.ack : old ? old.ack_name || "" : "",
      ans: list.map(i => { const p = prev.find(a => a.id === i.id) || {}; return { id: i.id, t: i.text, c: i.ref || "", r: !!i.red, v: p.v || "", n: p.n || "", na: p.na || "", ph: p.ph || [] }; }) };
    drawList(); if (draft) toast("เปิดร่างที่บันทึกไว้ในเครื่องนี้");
    $("#wList").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const saveDraft = () => { if (W) store.set(dkey(W.area, W.cat), { ans: W.ans, ack: W.ack, at: Date.now() }); };
  async function drawList() {
    const done = W.ans.filter(a => a.v).length, ro = !mine() || !R || R.status !== "open";
    const urls = await signed(W.ans.flatMap(a => a.ph));
    $("#wList").innerHTML = `<h3 class="sec">${esc(W.area)} · ${esc(catName(W.cat))}</h3>
      <p class="meta">${W.old ? `เคยบันทึกเมื่อ ${fmt(W.old.updated_at)} โดย ${esc(W.old.assessor)} · แก้แล้วกดบันทึกใหม่ได้` : "ยังไม่เคยตรวจพื้นที่นี้ในหมวดนี้ของรอบนี้"} · ข้อที่มีแถบแดง = จุดเสี่ยงสูงตาม JCI 8th / Zero-Red</p>
      ${byMe(W.ans).map(g => meHead(g) + g.list.map(i => { const a = W.ans[i]; return `<div class="q${a.r ? " red" : ""}${a.v === "fail" || a.v === "part" ? " f" : a.v ? " done" : ""}" data-i="${i}">
        <div class="t">${i + 1}. ${esc(a.t)}${a.r ? `<span class="tagr r">จุดเสี่ยงสูง</span>` : ""}</div>
        <div class="ans">${(K === "doc" ? [["pass", "p", "มีครบ เป็นปัจจุบัน"], ["part", "o", "มีไม่ครบ / ไม่เป็นปัจจุบัน"], ["fail", "f", "ไม่มี"], ["na", "n", "ไม่เกี่ยว"]] : [["pass", "p", "มี / ผ่าน"], ["fail", "f", "ไม่มี / ไม่ผ่าน"], ["na", "n", "ไม่เกี่ยว"]]).map(([v, c, l]) => `<button type="button" class="${c}" data-v="${v}" aria-pressed="${a.v === v}" ${ro ? "disabled" : ""}>${l}</button>`).join("")}</div>
        ${a.v === "fail" || a.v === "part" ? `<div class="more"><textarea data-n rows="2" placeholder="${K === "doc" ? "ขาดเอกสารอะไร / ฉบับปีไหน (บังคับ)" : "พบอะไร ที่ไหน (บังคับ)"}" ${ro ? "disabled" : ""}>${esc(a.n)}</textarea>
          <div class="ph">${a.ph.map((p, k) => urls[p] ? `<span><a href="${urls[p]}" target="_blank" rel="noopener"><img src="${urls[p]}" alt="รูปข้อ ${i + 1}"></a>${ro ? "" : `<br><button class="btn small" type="button" data-del="${k}">ลบ</button>`}</span>` : "").join("")}</div>
          ${ro ? "" : `<label class="btn small" style="justify-self:start">+ แนบรูป (${K === "doc" ? "ไม่บังคับ" : "บังคับอย่างน้อย 1 รูป"} สูงสุด 10)<input type="file" accept="image/*" capture="environment" multiple hidden data-ph></label>`}</div>` : ""}
        ${a.v === "na" ? `<div class="more"><select data-na ${ro ? "disabled" : ""}><option value="">เลือกเหตุผล</option>${NA.map(x => `<option ${a.na === x || (x.startsWith("อื่น") && a.na && !NA.includes(a.na)) ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
          ${a.na && !NA.slice(0, 3).includes(a.na) ? `<input data-nax maxlength="200" placeholder="ระบุเหตุผล" value="${esc(NA.includes(a.na) ? "" : a.na)}" ${ro ? "disabled" : ""}>` : ""}</div>` : ""}
      </div>`; }).join("")).join("")}
      <div class="sticky"><div class="meta">ตอบแล้ว ${done}/${W.ans.length} ข้อ · ผ่าน ${W.ans.filter(a => a.v === "pass").length}${K === "doc" ? ` · ไม่ครบ ${W.ans.filter(a => a.v === "part").length}` : ""} · ไม่ผ่าน ${W.ans.filter(a => a.v === "fail").length} · ไม่เกี่ยว ${W.ans.filter(a => a.v === "na").length}</div>
        <div class="pbar"><i style="width:${Math.round(done * 100 / W.ans.length)}%"></i></div>
        ${ro ? "" : `<div class="row"><input id="wAck" maxlength="120" placeholder="ชื่อหัวหน้าหน่วยงานที่รับทราบผล" value="${esc(W.ack)}" style="flex:1;min-width:200px;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px">
          <button class="btn" type="button" id="wAllP">ตอบ "ผ่าน" ข้อที่เหลือ</button><button class="btn primary" type="button" id="wSave">บันทึกผลตรวจ</button><button class="btn" type="button" id="wDrop">ล้างร่าง</button></div>`}</div>`;
  }
  $("#wList").addEventListener("click", ev => {
    const q = ev.target.closest(".q"), b = ev.target.closest("button[data-v]");
    if (b && q) { const a = W.ans[+q.dataset.i]; a.v = b.dataset.v; if (a.v !== "na") a.na = ""; saveDraft(); return drawList(); }
    const del = ev.target.closest("button[data-del]");
    if (del && q) { W.ans[+q.dataset.i].ph.splice(+del.dataset.del, 1); saveDraft(); return drawList(); }
    if (ev.target.id === "wAllP") { W.ans.forEach(a => { if (!a.v) a.v = "pass"; }); saveDraft(); return drawList(); }
    if (ev.target.id === "wDrop") { store.del(dkey(W.area, W.cat)); W = null; toast("ล้างร่างแล้ว"); return drawWalk(); }
    if (ev.target.id === "wSave") return save();
  });
  $("#wList").addEventListener("input", ev => {
    const q = ev.target.closest(".q");
    if (ev.target.id === "wAck") { W.ack = ev.target.value; return saveDraft(); }
    if (!q) return; const a = W.ans[+q.dataset.i];
    if (ev.target.matches("[data-n]")) a.n = ev.target.value;
    if (ev.target.matches("[data-nax]")) a.na = ev.target.value || "อื่น ๆ (ระบุ)";
    saveDraft();
  });
  $("#wList").addEventListener("change", guard(async ev => {
    const q = ev.target.closest(".q"); if (!q) return; const a = W.ans[+q.dataset.i];
    if (ev.target.matches("[data-na]")) { a.na = ev.target.value; saveDraft(); return drawList(); }
    if (ev.target.matches("[data-ph]")) {
      const files = [...ev.target.files].slice(0, 10 - a.ph.length); ev.target.value = ""; if (!files.length) return toast("แนบได้ไม่เกิน 10 รูปต่อข้อ", true);
      toast("กำลังส่งรูป…"); a.ph.push(...await uploadMedia(files, codeOf(hid()), "fms")); saveDraft(); drawList(); toast("แนบรูปแล้ว");
    }
  }));
  const codeOf = h => h === H.id ? H.code : (hospitals.find(x => x.id === h) || {}).code || H.code;
  async function save() {
    const miss = W.ans.map((a, i) => a.v ? 0 : i + 1).filter(Boolean);
    if (miss.length) return toast(`ยังไม่ได้ตอบข้อ ${miss.slice(0, 8).join(", ")}${miss.length > 8 ? " …" : ""}`, true);
    const bad = W.ans.map((a, i) => (a.v === "fail" || a.v === "part") && (!a.n.trim() || (K !== "doc" && !a.ph.length)) ? i + 1 : 0).filter(Boolean);
    if (bad.length) return toast(K === "doc" ? `ข้อ ${bad.join(", ")}: เขียนว่าขาดเอกสารอะไร` : `ข้อ ${bad.join(", ")} ไม่ผ่าน: ต้องกรอกรายละเอียดและแนบรูปอย่างน้อย 1 รูป`, true);
    const nr = W.ans.map((a, i) => a.v === "na" && (!a.na || a.na === "อื่น ๆ (ระบุ)") ? i + 1 : 0).filter(Boolean);
    if (nr.length) return toast(`ข้อ ${nr.join(", ")} ไม่เกี่ยว: เลือกหรือระบุเหตุผล`, true);
    const name = $("#wName").value.trim(), phone = $("#wPhone").value.trim();
    if (!name || !phone) return toast("ใส่ชื่อและเบอร์โทรผู้ประเมินด้านบน", true);
    if (busy) return; busy = true;
    try {
      const r = await rpc("fms_save", { p_round: R.id, p_kind: K, p_area: W.area, p_cat: W.cat, p_assessor: name, p_phone: phone, p_answers: W.ans, p_ack: W.ack || null });
      store.del(dkey(W.area, W.cat)); W = null; await loadRound(); drawWalk();
      toast(`บันทึกแล้ว คะแนน ${r.score ?? "-"} · ไม่ผ่าน ${r.fail} ข้อ (เข้ารายการข้อบกพร่องแล้ว)`);
    } catch (e) { toast(errText(e), true); } finally { busy = false; }
  }

  // ---------- findings ----------
  const findRows = () => { const st = $("#fSt").value, c = $("#fCat").value, q = $("#fQ").value.trim().toLowerCase(), all = $("#fAll").checked;
    return finds.filter(f => (!st || f.status === st) && (!c || f.cat === c) && f.kind === K && (all || !R || f.round_id === R.id || (f.free && !f.round_id)) && (!q || (f.area + " " + f.title + " " + (f.detail || "")).toLowerCase().includes(q))); };
  ["#fSt", "#fCat", "#fAll"].forEach(s => $(s).onchange = () => drawFind()); $("#fQ").oninput = () => drawFind();
  async function drawFind() {
    const l = findRows(), all = finds.filter(f => f.kind === K && ($("#fAll").checked || !R || f.round_id === R.id));
    const isRed = f => { const it = allItems.find(i => i.id === f.item_id); return !!(it && it.red); };
    $("#fK").innerHTML = kpis([["ทั้งหมด", n(all.length)], ["ยังไม่ปิด", n(all.filter(f => f.status === "open").length), true], ["จุดเสี่ยงสูงยังไม่ปิด", n(all.filter(f => f.status === "open" && isRed(f)).length), true], ["พบซ้ำจากรอบก่อน", n(all.filter(f => f.repeat_n > 0).length), true], ["ส่งเข้าใบแจ้งซ่อมแล้ว", n(all.filter(f => f.job_id).length)], ["ปิดแล้ว", `${n(all.filter(f => f.status === "done").length)} (${pct(all.filter(f => f.status === "done").length, all.length) ?? 0}%)`]]);
    const urls = await signed(l.slice(0, 200).flatMap(f => [...f.photos.slice(0, 2), ...f.after_photos.slice(0, 1)]));
    const jobs = l.filter(f => f.job_id).map(f => f.job_id), jm = {};
    if (jobs.length) ((await sb.from("jobs").select("id,job_no,status").in("id", jobs.slice(0, 300))).data || []).forEach(j => jm[j.id] = j);
    const img = p => urls[p] ? `<a href="${urls[p]}" target="_blank" rel="noopener"><img src="${urls[p]}" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:5px"></a>` : "";
    $("#fT").innerHTML = `<tr><th>สถานะ</th><th>พื้นที่</th><th>หมวด</th><th>ข้อบกพร่อง</th><th>รูปที่พบ</th><th>ใบแจ้งซ่อม</th><th>หลังแก้ไข</th><th>พบเมื่อ</th><th></th></tr>` +
      (l.slice(0, 500).map(f => `<tr data-f="${f.id}"><td><span class="st ${f.status}">${f.status === "open" ? "ยังไม่ปิด" : "ปิดแล้ว"}</span>${f.repeat_n ? `<br><span class="st rep">ซ้ำ ${f.repeat_n} รอบ</span>` : ""}${isRed(f) ? `<br><span class="tagr r">จุดเสี่ยงสูง</span>` : ""}</td>
        <td>${esc(f.area)}</td><td>${f.free ? "แจ้งอิสระ" : esc(catName(f.cat))}</td><td><b>${esc(f.title)}</b>${f.detail ? `<div class="meta">${esc(f.detail)}</div>` : ""}</td>
        <td><div class="ph">${f.photos.slice(0, 2).map(img).join("")}</div></td>
        <td>${f.job_id ? `<a href="staff.html">${esc((jm[f.job_id] || {}).job_no || "เปิดแล้ว")}</a><div class="meta">${esc(RS.STATUS[(jm[f.job_id] || {}).status] || "")}</div>` : mine() && f.status === "open" ? `<button class="btn small" data-job>ส่งเข้าใบแจ้งซ่อม</button>` : "-"}</td>
        <td>${f.status === "done" ? `<div class="ph">${f.after_photos.slice(0, 1).map(img).join("")}</div><div class="meta">${esc(f.close_note || "")} ${fmt(f.closed_at)}</div>` : ""}</td>
        <td>${fmt(f.created_at)}</td><td>${mine() && f.status === "open" ? `<button class="btn small primary" data-close>ปิดงาน</button>` : ""}</td></tr>`).join("") || none(9, "ไม่มีข้อบกพร่องตามตัวกรอง"));
  }
  $("#fT").onclick = guard(async ev => {
    const tr = ev.target.closest("tr[data-f]"); if (!tr) return; const f = finds.find(x => x.id === tr.dataset.f);
    if (ev.target.closest("[data-job]")) { const no = await rpc("fms_to_job", { p_id: f.id }); toast(`เปิดใบแจ้งซ่อม ${no} แล้ว`); await loadRound(); return drawFind(); }
    if (ev.target.closest("[data-close]")) closeDlg(f);
  });
  function closeDlg(f) {
    let after = [];
    dlg(`<h3>ปิดข้อบกพร่อง</h3><p class="meta">${esc(f.area)} · ${esc(f.title)}</p>
      <div class="more"><label class="btn small" style="justify-self:start">+ แนบรูปหลังแก้ไข${f.kind === "doc" ? " / รูปเอกสาร (หรือเขียนว่าเอกสารฉบับไหนพร้อมแล้ว)" : " (บังคับ)"}<input type="file" id="cPh" accept="image/*" capture="environment" multiple hidden></label><div class="ph" id="cList"></div>
      <textarea id="cNote" rows="2" placeholder="แก้ไขอย่างไร (ไม่บังคับ)"></textarea></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="cOk">ปิดงาน</button><button class="btn" data-close>ยกเลิก</button></div>`);
    $("#cPh").onchange = guard(async ev => { const files = [...ev.target.files].slice(0, 10); toast("กำลังส่งรูป…"); after.push(...await uploadMedia(files, codeOf(hid()), "fms-after"));
      const u = await signed(after); $("#cList").innerHTML = after.map(p => u[p] ? `<img src="${u[p]}" alt="">` : "").join(""); toast("แนบรูปแล้ว"); });
    $("#cOk").onclick = guard(async () => { await rpc("fms_close", { p_id: f.id, p_after: after, p_note: $("#cNote").value }); $("#dlg").close(); toast("ปิดงานแล้ว"); await loadRound(); drawFind(); });
  }
  $("#fFree").onclick = () => {
    let ph = [];
    dlg(`<h3>แจ้งอิสระ (สิ่งที่พบนอกแบบฟอร์ม)</h3>
      <div class="fg" style="grid-template-columns:1fr"><label>พื้นที่ *<input id="eA" list="areas" maxlength="200"></label><label>หัวข้อสิ่งที่พบ *<input id="eT" maxlength="200"></label><label>รายละเอียด<textarea id="eD" rows="3"></textarea></label></div>
      <label class="btn small">+ แนบรูป<input type="file" id="ePh" accept="image/*" capture="environment" multiple hidden></label><div class="ph" id="eList" style="margin:8px 0"></div>
      <div class="row"><button class="btn primary" id="eOk">บันทึก</button><button class="btn" data-close>ยกเลิก</button></div>`);
    $("#ePh").onchange = guard(async ev => { toast("กำลังส่งรูป…"); ph.push(...await uploadMedia([...ev.target.files].slice(0, 10), codeOf(hid()), "fms")); const u = await signed(ph); $("#eList").innerHTML = ph.map(p => u[p] ? `<img src="${u[p]}" alt="">` : "").join(""); });
    $("#eOk").onclick = guard(async () => { await rpc("fms_free", { p_round: R ? R.id : null, p_area: $("#eA").value, p_title: $("#eT").value, p_detail: $("#eD").value, p_photos: ph }); $("#dlg").close(); toast("บันทึกแล้ว"); await loadRound(); drawFind(); });
  };
  $("#fX").onclick = () => { const l = findRows();
    Office.table(`ข้อบกพร่อง_FMS_${K}_${codeOf(hid())}_${R ? R.year_be + "-" + R.no : BE}`, ["สถานะ", "พื้นที่", "หมวด", "ข้อบกพร่อง", "รายละเอียด", "จุดเสี่ยงสูง", "พบซ้ำ (รอบ)", "ใบแจ้งซ่อม", "พบเมื่อ", "ปิดเมื่อ", "การแก้ไข"],
      l.map(f => [f.status === "open" ? "ยังไม่ปิด" : "ปิดแล้ว", f.area, f.free ? "แจ้งอิสระ" : catName(f.cat), f.title, f.detail || "", (allItems.find(i => i.id === f.item_id) || {}).red ? "ใช่" : "", f.repeat_n, f.job_id ? "ส่งแล้ว" : "", fmt(f.created_at), f.closed_at ? fmt(f.closed_at) : "", f.close_note || ""]),
      { title: `ข้อบกพร่องจาก FMS Round · ${KIND[K]}`, org: codeOf(hid()), period: roundName(R) }); };

  // ---------- report ----------
  function stats(list) {
    const p = list.reduce((s, c) => s + c.pass, 0), pt = list.reduce((s, c) => s + (c.part || 0), 0), f = list.reduce((s, c) => s + c.fail, 0);
    return { checks: list.length, pass: p, part: pt, fail: f, na: list.reduce((s, c) => s + c.na, 0), score: pct(p + pt / 2, p + pt + f) };
  }
  function report() {
    const rc = ck().filter(c => R && c.round_id === R.id), all = stats(rc);
    const byCat = cats().map(c => ({ ...c, ...stats(rc.filter(x => x.cat === c.cat)) }));
    const am = new Map(); rc.forEach(c => (am.get(c.area) || am.set(c.area, []).get(c.area)).push(c));
    const byArea = [...am].map(([a, l]) => ({ area: a, cats: l.length, ...stats(l) })).sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
    const im = new Map(); rc.forEach(c => c.answers.forEach(a => { if (a.v !== "fail") return; const k = a.id; if (!im.has(k)) im.set(k, { t: a.t, c: a.c, r: a.r, cat: c.cat, n: 0, areas: [] }); const x = im.get(k); x.n++; x.areas.push(c.area); }));
    const top = [...im.values()].sort((a, b) => b.n - a.n).slice(0, 15);
    const mm = new Map(); rc.forEach(c => c.answers.forEach(a => { const k = a.c || "ไม่ระบุ ME"; if (!mm.has(k)) mm.set(k, { ref: k, cat: c.cat, pass: 0, fail: 0, na: 0 }); const x = mm.get(k); x[a.v] = (x[a.v] || 0) + 1; }));
    const meSt = x => x.pass + (x.part || 0) + x.fail === 0 ? "ไม่เกี่ยว" : !x.fail && !(x.part || 0) ? "Met" : !x.pass ? "Not Met" : "Partially Met";
    const kmeOrder = r => { const m = /^(\D+)\.(\d+)\.(\d+) ME (\d+)/.exec(r) || []; return [m[1] === "FMS" ? 0 : 1, +m[2] || 99, +m[3] || 0, +m[4] || 0]; };
    const byMeR = [...mm.values()].map(x => ({ ...x, part: x.part || 0, text: MEs[x.ref] || "", score: pct(x.pass + (x.part || 0) / 2, x.pass + (x.part || 0) + x.fail), st: meSt(x) })).sort((a, b) => { const p = kmeOrder(a.ref), q = kmeOrder(b.ref); for (let i = 0; i < 4; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; });
    const redFail = rc.reduce((s, c) => s + c.answers.filter(a => a.v === "fail" && a.r).length, 0);
    const byRound = rounds.filter(r => R && r.year_be === R.year_be).sort((a, b) => a.no - b.no).map(r => ({ r, ...stats(ck().filter(c => c.round_id === r.id)), open: finds.filter(f => f.kind === K && f.round_id === r.id && f.status === "open").length }));
    const rf = finds.filter(f => f.kind === K && R && f.round_id === R.id), done = rf.filter(f => f.status === "done").length;
    const fl = [];
    if (rc.length) {
      fl.push(`${KIND[K]} · ${roundName(R)} ตรวจ ${n(rc.length)} จุด (${n(am.size)} พื้นที่) คะแนนรวม ${all.score ?? "-"} จาก 100 · ผ่าน ${n(all.pass)} ข้อ${K === "doc" ? ` มีไม่ครบ ${n(all.part)} ข้อ` : ""} ไม่ผ่าน ${n(all.fail)} ข้อ`);
      const low = byCat.filter(c => c.score != null).sort((a, b) => a.score - b.score)[0]; if (low) fl.push(`หมวดที่คะแนนต่ำสุด: ${low.name} ได้ ${low.score}`);
      if (redFail) fl.push(`จุดเสี่ยงสูง (JCI 8th / Zero-Red) ไม่ผ่าน ${n(redFail)} ข้อ ต้องแก้ก่อนรอบตรวจจริง`);
      if (top[0]) fl.push(`ข้อที่ไม่ผ่านบ่อยที่สุด: "${top[0].t}" พบ ${top[0].n} พื้นที่`);
      if (byArea[0] && byArea[0].score != null) fl.push(`พื้นที่คะแนนต่ำสุด: ${byArea[0].area} ได้ ${byArea[0].score}`);
      fl.push(`ข้อบกพร่องของรอบนี้ ${n(rf.length)} รายการ ปิดแล้ว ${n(done)} (${pct(done, rf.length) ?? 0}%) พบซ้ำจากรอบก่อน ${n(rf.filter(f => f.repeat_n).length)} รายการ`);
    }
    const notes = ["คะแนน = ผ่าน ÷ (ผ่าน + ไม่ผ่าน) × 100 ไม่นับข้อที่ไม่เกี่ยว", "ข้อตรวจกำหนดจาก JCI 8th Edition (FMS.03–FMS.10, HCT, GHI) จุดเสี่ยงสูง 5 มิติ และ SAF Matrix Zero-Red 5 จุด", "ข้อที่พบซ้ำหลายพื้นที่ (≥ 3 จุด) ผู้ตรวจ JCI ถือเป็น Pattern/Widespread ควรแก้แบบปูพรมทั้งโรงพยาบาล"];
    const weakMe = byMeR.filter(x => x.score != null && x.score < 80);
    const stN = s => byMeR.filter(x => x.st === s).length;
    if (byMeR.length) fl.splice(1, 0, `สถานะ ME (${KIND[K]}): Met ${stN("Met")} · Partially Met ${stN("Partially Met")} · Not Met ${stN("Not Met")} จาก ${byMeR.length} ME ที่ตรวจ`);
    if (weakMe.length) fl.push(`ME ที่คะแนนต่ำกว่า 80 มี ${weakMe.length} ข้อ: ${weakMe.slice(0, 4).map(x => `${x.ref} (${x.score})`).join(", ")}${weakMe.length > 4 ? " …" : ""}`);
    return { rc, all, byCat, byArea, byMeR, top, redFail, byRound, rf, done, fl, notes };
  }
  function drawRep() {
    const d = report();
    $("#pK").innerHTML = kpis([["จุดที่ตรวจ (พื้นที่ × หมวด)", n(d.all.checks)], ["คะแนนรวม", d.all.score ?? "-"], ["ข้อไม่ผ่าน", n(d.all.fail), true], ["จุดเสี่ยงสูงไม่ผ่าน", n(d.redFail), true], ["ข้อบกพร่องยังไม่ปิด", n(d.rf.length - d.done), true], ["ปิดแล้ว", `${pct(d.done, d.rf.length) ?? 0}%`]]);
    $("#pExec").innerHTML = d.fl.length ? `<div class="panel" style="margin:10px 0"><b>บทสรุปผู้บริหาร</b><ol style="margin:6px 0 0 18px;padding:0">${d.fl.map(x => `<li>${esc(x)}</li>`).join("")}</ol></div>` : `<div class="empty">ยังไม่มีผลตรวจในรอบนี้</div>`;
    $("#pCat").innerHTML = `<tr><th>หมวด</th><th class="r">จุดที่ตรวจ</th><th class="r">ผ่าน</th>${K === "doc" ? `<th class="r">ไม่ครบ</th>` : ""}<th class="r">ไม่ผ่าน</th><th class="r">ไม่เกี่ยว</th><th class="r">คะแนน</th></tr>` + d.byCat.map(c => `<tr><td>${esc(c.name)}</td><td class="r">${c.checks}</td><td class="r">${c.pass}</td>${K === "doc" ? `<td class="r">${c.part}</td>` : ""}<td class="r">${c.fail}</td><td class="r">${c.na}</td><td class="sc ${cls(c.score)}">${c.score ?? "-"}</td></tr>`).join("");
    const stc = s => s === "Met" ? "g" : s === "Partially Met" ? "o" : s === "Not Met" ? "rd" : "na";
    $("#pMe").innerHTML = `<tr><th>ME</th><th>หัวข้อ</th><th class="r">ผ่าน</th>${K === "doc" ? `<th class="r">ไม่ครบ</th>` : ""}<th class="r">ไม่ผ่าน</th><th class="r">ไม่เกี่ยว</th><th class="r">คะแนน</th><th>สถานะ ME</th></tr>` + (d.byMeR.map(x => `<tr><td style="white-space:nowrap">${esc(x.ref)}</td><td>${esc(x.text)}</td><td class="r">${x.pass}</td>${K === "doc" ? `<td class="r">${x.part}</td>` : ""}<td class="r">${x.fail}</td><td class="r">${x.na || 0}</td><td class="sc ${cls(x.score)}">${x.score ?? "-"}</td><td class="sc ${stc(x.st)}">${x.st}</td></tr>`).join("") || none(8, "ยังไม่มีผลตรวจ"));
    $("#pArea").innerHTML = `<tr><th>พื้นที่</th><th class="r">หมวดที่ตรวจ</th><th class="r">ผ่าน</th><th class="r">ไม่ผ่าน</th><th class="r">คะแนน</th></tr>` + (d.byArea.map(a => `<tr><td>${esc(a.area)}</td><td class="r">${a.cats}</td><td class="r">${a.pass}</td><td class="r">${a.fail}</td><td class="sc ${cls(a.score)}">${a.score ?? "-"}</td></tr>`).join("") || none(5, "ยังไม่มีผลตรวจ"));
    $("#pTop").innerHTML = `<tr><th>ข้อตรวจ</th><th>หมวด</th><th>ME</th><th class="r">ไม่ผ่าน (พื้นที่)</th><th>พื้นที่</th></tr>` + (d.top.map(t => `<tr><td>${esc(t.t)}${t.r ? `<span class="tagr r">จุดเสี่ยงสูง</span>` : ""}</td><td>${esc(t.cat)}</td><td>${esc(t.c || "")}</td><td class="r">${t.n}</td><td>${esc([...new Set(t.areas)].join(", "))}</td></tr>`).join("") || none(5, "ไม่มีข้อที่ไม่ผ่าน"));
    $("#pRound").innerHTML = `<tr><th>รอบ</th><th class="r">จุดที่ตรวจ</th><th class="r">ไม่ผ่าน</th><th class="r">คะแนน</th><th class="r">ข้อบกพร่องค้าง</th></tr>` + (d.byRound.map(x => `<tr><td>${esc(roundName(x.r))}</td><td class="r">${x.checks}</td><td class="r">${x.fail}</td><td class="sc ${cls(x.score)}">${x.score ?? "-"}</td><td class="r">${x.open}</td></tr>`).join("") || none(5, "ยังไม่มีรอบ"));
  }
  $("#pX").onclick = () => { const d = report(), org = `${codeOf(hid())}`;
    Office.xlsx(`FMS_Round_${K}_${org}_${R ? R.year_be + "-" + R.no : BE}`, [
      Office.summarySheet({ title: `รายงาน FMS Round · ${KIND[K]} (JCI 8th)`, org, period: roundName(R), findings: d.fl, notes: d.notes,
        figures: [["จุดที่ตรวจ", d.all.checks], ["คะแนนรวม", d.all.score ?? "-"], ["ข้อไม่ผ่าน", d.all.fail], ["จุดเสี่ยงสูงไม่ผ่าน", d.redFail], ["ข้อบกพร่อง", d.rf.length], ["ปิดแล้ว", d.done]],
        groups: [{ title: "คะแนนรายหมวด", head: ["คะแนน", "ไม่ผ่าน"], rows: d.byCat.map(c => [c.name, c.score ?? "-", c.fail]) }] }),
      { name: "ราย ME", header: 0, rows: [["ME", "หัวข้อ ME", "หมวด", "ผ่าน", "ไม่ครบ", "ไม่ผ่าน", "ไม่เกี่ยว", "คะแนน", "สถานะ ME"], ...d.byMeR.map(x => [x.ref, x.text, x.cat, x.pass, x.part, x.fail, x.na || 0, x.score ?? "", x.st])] },
      { name: "รายพื้นที่", header: 0, rows: [["พื้นที่", "หมวดที่ตรวจ", "ผ่าน", "ไม่ผ่าน", "คะแนน"], ...d.byArea.map(a => [a.area, a.cats, a.pass, a.fail, a.score ?? ""])] },
      { name: "ข้อไม่ผ่านบ่อย", header: 0, rows: [["ข้อตรวจ", "หมวด", "ME", "จุดเสี่ยงสูง", "ไม่ผ่าน (พื้นที่)", "พื้นที่"], ...d.top.map(t => [t.t, t.cat, t.c || "", t.r ? "ใช่" : "", t.n, [...new Set(t.areas)].join(", ")])] },
      { name: "ผลตรวจทุกข้อ", header: 0, rows: [["พื้นที่", "หมวด", "ข้อ", "ข้อตรวจ", "ME", "จุดเสี่ยงสูง", "ผล", "รายละเอียด / เหตุผล", "ผู้ประเมิน", "หัวหน้ารับทราบ"],
        ...d.rc.flatMap(c => c.answers.map((a, i) => [c.area, c.cat, i + 1, a.t, a.c || "", a.r ? "ใช่" : "", { pass: K === "doc" ? "มีครบ" : "ผ่าน", part: "มีไม่ครบ", fail: K === "doc" ? "ไม่มี" : "ไม่ผ่าน", na: "ไม่เกี่ยว" }[a.v] || "", a.v === "fail" || a.v === "part" ? a.n : a.v === "na" ? a.na : "", c.assessor, c.ack_name || ""]))] },
      { name: "เทียบรอบ", header: 0, rows: [["รอบ", "จุดที่ตรวจ", "ไม่ผ่าน", "คะแนน", "ข้อบกพร่องค้าง"], ...d.byRound.map(x => [roundName(x.r), x.checks, x.fail, x.score ?? "", x.open])] }]); };
  $("#pP").onclick = guard(async () => { const d = report();
    await Office.pptx(`บทสรุปผู้บริหาร_FMS_Round_${codeOf(hid())}`, { title: `บทสรุปผู้บริหาร FMS Round · ${KIND[K]}`, org: codeOf(hid()), period: roundName(R), findings: d.fl, notes: d.notes,
      kpis: [["จุดที่ตรวจ", d.all.checks], ["คะแนนรวม", d.all.score ?? "-"], ["ข้อไม่ผ่าน", d.all.fail], ["จุดเสี่ยงสูงไม่ผ่าน", d.redFail], ["ข้อบกพร่อง", d.rf.length], ["ปิดแล้ว", d.done]],
      analysis: d.notes, sections: [{ title: "คะแนนรายหมวด", head: ["หมวด", "คะแนน"], rows: d.byCat.filter(c => c.score != null).map(c => [c.name, c.score]) },
        { title: "ME ที่คะแนนต่ำสุด", head: ["ME", "คะแนน"], rows: d.byMeR.filter(x => x.score != null).sort((a, b) => a.score - b.score).slice(0, 10).map(x => [x.ref, x.score]) },
        { title: "พื้นที่คะแนนต่ำสุด", head: ["พื้นที่", "คะแนน"], rows: d.byArea.filter(a => a.score != null).slice(0, 10).map(a => [a.area, a.score]) },
        { title: "ข้อที่ไม่ผ่านบ่อยที่สุด", head: ["ข้อตรวจ", "จำนวนพื้นที่"], rows: d.top.slice(0, 10).map(t => [t.t, t.n]) }] }); });

  // ---------- board ----------
  function drawBoard() {
    const rc = ck().filter(c => R && c.round_id === R.id), cs = cats(), al = [...new Set(rc.map(c => c.area))].sort((a, b) => a.localeCompare(b, "th"));
    $("#bT").innerHTML = `<tr><th>พื้นที่</th>${cs.map(c => `<th class="r" title="${esc(c.name)}">${esc(c.cat.replace("FMS", "FMS "))}</th>`).join("")}<th class="r">รวม</th></tr>` +
      (al.map(a => { const l = rc.filter(c => c.area === a), s = stats(l);
        return `<tr><td>${esc(a)}</td>${cs.map(c => { const x = l.find(y => y.cat === c.cat); return `<td class="sc ${cls(x ? x.score : null)}${x ? " click" : ""}" data-a="${esc(a)}" data-c="${esc(c.cat)}" style="${x ? "cursor:pointer" : ""}">${x ? x.score ?? "ไม่เกี่ยว" : "-"}</td>`; }).join("")}<td class="sc ${cls(s.score)}">${s.score ?? "-"}</td></tr>`; }).join("") || none(cs.length + 2, "ยังไม่มีผลตรวจในรอบนี้"));
  }
  $("#bT").onclick = ev => { const td = ev.target.closest("td[data-c]"); if (!td || !ck().some(c => R && c.round_id === R.id && c.area === td.dataset.a && c.cat === td.dataset.c)) return; $("#wArea").value = td.dataset.a; $("#wCat").value = td.dataset.c; show("walk"); start(); };

  // ---------- form ----------
  function drawForm() {
    const mgr = hid() === me.hospital_id && MGR.includes(me.role);
    $("#iInfo").textContent = `${KIND[K]}: ` + (own ? `โรงพยาบาลนี้ใช้แบบฟอร์มของตัวเอง ${items.length} ข้อ ${cats().length} หมวด` : `ใช้แบบฟอร์มกลางตามมาตรฐาน JCI 8th Edition ${items.length} ข้อ ${cats().length} หมวด (FMS 03–10) ข้อที่ติดป้าย "จุดเสี่ยงสูง" มาจาก High-Risk Checkpoints และ SAF Zero-Red · โรงพยาบาลปรับเป็นแบบฟอร์มของตัวเองได้โดยดาวน์โหลด Excel แก้ แล้วนำเข้า`);
    $("#iImp").hidden = !mgr; $("#iBack").hidden = !(mgr && own);
    $("#iT").innerHTML = `<tr><th class="r">ข้อ</th><th>ข้อตรวจ</th><th>จุดเสี่ยงสูง</th></tr>` + cats().map(c => { const l = items.filter(i => i.cat === c.cat);
      return `<tr class="ch"><td colspan="3">${esc(c.name)} · ${l.length} ข้อ</td></tr>` + byMe(l).map(g => `<tr class="mr"><td colspan="3">${meHead(g)}</td></tr>` + g.list.map(k => { const i = l[k];
        return `<tr><td class="r">${i.no}</td><td>${esc(i.text)}</td><td>${i.red ? `<span class="tagr r">ใช่</span>` : ""}</td></tr>`; }).join("")).join(""); }).join("");
  }
  const HEAD = ["รหัสหมวด", "ชื่อหมวด", "ข้อ", "ข้อตรวจ", "ME อ้างอิง", "จุดเสี่ยงสูง (ใช่/ว่าง)", "หัวข้อ ME"];
  $("#iX").onclick = () => Office.xlsx(`แบบฟอร์ม_FMS_Round_${K}_${codeOf(hid())}`, [
    { name: "แบบฟอร์ม", header: 2, rows: [[`แบบฟอร์มข้อตรวจ FMS Round · ${KIND[K]} (JCI 8th)`], ["แก้ข้อความ เพิ่มหรือลบแถวได้ · หนึ่งแถวต่อหนึ่งข้อ · รหัสหมวดเดียวกันจะรวมเป็นหมวดเดียว · ME อ้างอิงเขียนแบบ FMS.06.01 ME 3 ข้อที่ ME เดียวกันควรอยู่ติดกัน · ช่องจุดเสี่ยงสูงใส่ \"ใช่\" หรือเว้นว่าง"], HEAD,
      ...items.map(i => [i.cat, i.cat_name, i.no, i.text, i.ref || "", i.red ? "ใช่" : "", MEs[i.ref] || ""])], styles: { 0: 2 } }]);
  $("#iImp").onclick = () => $("#iFile").click();
  $("#iFile").onchange = guard(async ev => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    const wb = await Office.readXlsx(f), sh = wb["แบบฟอร์ม"] || Object.values(wb)[0] || [];
    const hi = sh.findIndex(r => r.some(c => /ข้อตรวจ/.test(c)) && r.some(c => /รหัสหมวด/.test(c))); if (hi < 0) throw new Error("ไม่พบหัวตาราง \"รหัสหมวด\" และ \"ข้อตรวจ\" ใช้แบบฟอร์มที่ดาวน์โหลดจากหน้านี้");
    const h = sh[hi], ix = k => h.findIndex(c => c.startsWith(k));
    const rows = sh.slice(hi + 1).filter(r => (r[ix("ข้อตรวจ")] || "").trim()).map(r => ({ cat: r[ix("รหัสหมวด")], cat_name: r[ix("ชื่อหมวด")], no: r[ix("ข้อ")], text: r[ix("ข้อตรวจ")], ref: r[ix("ME")], red: /^(ใช่|y|yes|1|x|✓|true)$/i.test((r[ix("จุดเสี่ยงสูง")] || "").trim()) ? "true" : "false" }));
    if (!rows.length) throw new Error("ไม่มีแถวข้อตรวจในไฟล์");
    if (!confirm(`นำเข้า ${rows.length} ข้อ แทนแบบฟอร์ม "${KIND[K]}" ที่ใช้อยู่? ผลตรวจที่บันทึกแล้วไม่เปลี่ยน`)) return;
    const k = await rpc("fms_items_replace", { p_kind: K, p_rows: rows }); toast(`นำเข้าแล้ว ${k} ข้อ`); await loadHospital(); drawForm();
  });
  $("#iBack").onclick = guard(async () => { if (!confirm("กลับไปใช้แบบฟอร์มกลาง JCI 8th?")) return; await rpc("fms_items_replace", { p_kind: K, p_rows: [] }); toast("กลับไปใช้แบบฟอร์มกลางแล้ว"); await loadHospital(); drawForm(); });

  // ---------- dialog ----------
  function dlg(html) { $("#dlgIn").innerHTML = html; $("#dlg").showModal(); }
  $("#dlg").addEventListener("click", ev => { if (ev.target.closest("[data-close]") || ev.target === $("#dlg")) $("#dlg").close(); });
})();
