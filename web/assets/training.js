// อบรม · แฟ้มสมรรถนะ: course list (central + per hospital), people (ช่าง แม่บ้าน รปภ. ผู้รับเหมา), training sessions with attendance,
// and the competency matrix worked out here: latest passed session of a course + its valid_months = still valid / expiring in 30 days / expired / never.
// JCI 8th FMS.01.01 / FMS.09.01 / SQE (outsource staff files) and contract KPI item 7 (emergency training).
(() => {
  const { sb, $, esc, errText } = RS;
  const MGR = ["owner", "admin", "chief_engineer", "supervisor"], GRPS = ["ช่าง", "แม่บ้าน", "รปภ.", "ผู้รับเหมา", "อื่น ๆ"], SOON = 30;
  const RES = { pass: "ผ่าน", fail: "ไม่ผ่าน", attend: "เข้าร่วม" };
  const ST = { ok: ["✓", "ยังไม่หมดอายุ"], soon: ["⚠", "หมดใน 30 วัน"], exp: ["✗", "หมดอายุแล้ว"], none: ["–", "ยังไม่เคยอบรม"] };
  let me = null, exec = false, hosps = [], canWrite = false, cur = "sum", busy = false;
  let courses = [], people = [], sessions = [], att = [];
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const guard = fn => async ev => { if (ev && ev.preventDefault) ev.preventDefault(); if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const dTH = d => d ? new Date(d + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";
  const addM = (d, m) => { const x = new Date(d + "T00:00:00"); x.setMonth(x.getMonth() + m); return x.toLocaleDateString("en-CA"); };
  const addD = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); };
  const pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : null;
  const hosp = () => hosps.find(h => h.id === $("#h").value) || {};
  const grp = () => $("#g").value;

  // ---------- competency ----------
  const applies = (c, p) => c.active && c.mandatory && (!c.groups || !c.groups.length || c.groups.includes(p.grp));
  const sesOf = id => sessions.find(s => s.id === id);
  function status(p, c) {
    let last = null;
    att.forEach(a => { if (a.person_id !== p.id || a.result !== "pass") return; const s = sesOf(a.session_id); if (s && s.course_id === c.id && (!last || s.held_on > last)) last = s.held_on; });
    if (!last) return { st: "none" };
    const until = c.valid_months ? addM(last, c.valid_months) : null, t = today();
    return { st: !until || until > addD(t, SOON) ? "ok" : until >= t ? "soon" : "exp", last, until };
  }
  const activePeople = () => people.filter(p => p.active && (!grp() || p.grp === grp()));
  const mandCourses = () => courses.filter(c => c.active && c.mandatory && (!grp() || !c.groups.length || c.groups.includes(grp())));
  function cells() {   // every (person, mandatory course that applies) pair
    const out = []; activePeople().forEach(p => courses.forEach(c => { if (applies(c, p)) out.push({ p, c, ...status(p, c) }); })); return out;
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
    $("#h").value = hosps.some(h => h.id === me.hospital_id) ? me.hospital_id : hosps[0].id; $("#h").disabled = hosps.length < 2;
    const ty = +today().slice(0, 4); $("#sy").innerHTML = [ty, ty - 1, ty - 2].map(y => `<option value="${y}">${y + 543}</option>`).join("");
    $("#sD").value = today();
    $("#body").hidden = false; $("#tabs").hidden = false;
    const q = new URLSearchParams(location.search);
    await load(); show(q.get("tab") || "sum");
  }
  async function load() {
    const h = $("#h").value;
    canWrite = exec || (MGR.includes(me.role) && hosps.some(x => x.id === h));
    $("#ro").textContent = canWrite ? "" : "ดูได้อย่างเดียว (บันทึกได้เฉพาะหัวหน้าของโรงนี้)";
    ["#sesForm", "#pplForm", "#crsForm"].forEach(s => $(s).hidden = !canWrite);
    $("#cScope").innerHTML = `<option value="h">เฉพาะ ${esc(hosp().code || "")}</option>` + (exec ? `<option value="all">หลักสูตรกลาง ทั้ง 12 โรง</option>` : "");
    const [c, p, s] = await Promise.all([
      sb.from("training_courses").select("*").order("code"),
      sb.from("training_people").select("*").eq("hospital_id", h).order("full_name"),
      sb.from("training_sessions").select("*").eq("hospital_id", h).order("held_on", { ascending: false })]);
    for (const r of [c, p, s]) if (r.error) throw r.error;
    courses = (c.data || []).filter(x => !x.hospital_id || x.hospital_id === h).map(x => ({ ...x, groups: x.groups || [] }));
    people = p.data || []; sessions = s.data || [];
    att = [];
    if (sessions.length) { const a = await sb.from("training_attendance").select("*").in("session_id", sessions.map(x => x.id)); if (a.error) throw a.error; att = a.data || []; }
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    cur = ["sum", "mx", "ses", "ppl", "crs", "file"].includes(t) ? t : "sum";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    ["sum", "mx", "ses", "ppl", "crs", "file"].forEach(k => $("#tab-" + k).hidden = k !== cur);
    try { ({ sum: rSum, mx: rMx, ses: rSes, ppl: rPpl, crs: rCrs, file: rFile })[cur](); } catch (e) { toast(errText(e), true); }
  }
  $("#h").onchange = guard(async () => { await load(); show(cur); });
  $("#g").onchange = () => show(cur);
  $("#sy").onchange = () => rSes();

  // ---------- ภาพรวม ----------
  function summary() {
    const all = cells(), n = all.length, ok = all.filter(x => x.st === "ok" || x.st === "soon").length;
    const ppl = activePeople(), full = ppl.filter(p => all.filter(x => x.p === p).every(x => x.st === "ok" || x.st === "soon")).length;
    const k7 = all.filter(x => x.c.kpi7), k7ok = k7.filter(x => x.st === "ok" || x.st === "soon").length;
    const y = today().slice(0, 4), sesY = sessions.filter(s => s.held_on.startsWith(y));
    return { all, n, ok, ppl, full, k7, k7ok, sesY, soon: all.filter(x => x.st === "soon").length, exp: all.filter(x => x.st === "exp").length, none: all.filter(x => x.st === "none").length };
  }
  const cls = v => v == null ? "" : v >= 95 ? "ok" : v >= 80 ? "mid" : "bad";
  function rSum() {
    const S = summary(), P = pct(S.ok, S.n), K = pct(S.k7ok, S.k7.length);
    $("#tot").innerHTML = [["บุคลากรที่ใช้งาน", S.ppl.length], ["ผ่านภาคบังคับ (ช่อง)", P == null ? "-" : P + "%", cls(P)], ["ผ่านครบทุกหลักสูตร (คน)", `${S.full}/${S.ppl.length}`],
      ["จะหมดใน 30 วัน", S.soon, S.soon ? "mid" : ""], ["หมดอายุ / ยังไม่เคย", S.exp + S.none, S.exp + S.none ? "bad" : ""], [`อบรมปี ${+today().slice(0, 4) + 543} (ครั้ง)`, S.sesY.length]]
      .map(([l, v, c]) => `<div class="kpi"><b class="${c || ""}">${esc(String(v))}</b><span>${esc(l)}</span></div>`).join("");
    $("#k7").innerHTML = `<b>KPI ข้อ 7 ของสัญญา</b> (พนักงานเข้าร่วมฝึกอบรมรับเหตุฉุกเฉิน: ลิฟต์ ไฟฟ้าขัดข้อง อัคคีภัย, 2 คะแนน เกณฑ์ 100%): ` +
      (S.k7.length ? `ผ่าน ${S.k7ok} จาก ${S.k7.length} ช่อง = <b>${K}%</b> ${K >= 100 ? "✅ ได้ 2 คะแนน" : "❌ ยังไม่ครบ 100% ดูรายชื่อในตาราง \"ต้องนัดอบรม\""}` : "ยังไม่มีบุคลากรหรือหลักสูตรที่นับใน KPI ข้อ 7") +
      ` <span class="sub">หลักสูตรที่นับ: ${courses.filter(c => c.kpi7 && c.active).map(c => esc(c.code)).join(", ") || "-"} · ใช้ผลนี้ประกอบการกรอกข้อ 7 ในหน้า <a href="kpi.html">KPI ตามสัญญา</a></span>`;
    const bc = byCourse(S.all), bg = byGroup(S.all);
    $("#byCourse").innerHTML = `<tr><th>รหัส</th><th>หลักสูตร</th><th>รอบ</th><th>ต้องอบรม</th><th>ผ่าน</th><th>หมดใน 30 วัน</th><th>หมดอายุ</th><th>ยังไม่เคย</th><th>%</th></tr>` +
      (bc.length ? bc.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}${r[9] ? ' <span class="pill">KPI 7</span>' : ""}</td><td>${esc(r[2])}</td>${r.slice(3, 8).map(v => `<td class="n">${v}</td>`).join("")}<td class="n ${r[8] == null ? "" : r[8] >= 95 ? "ok" : r[8] >= 80 ? "soon" : "exp"}">${r[8] ?? "-"}</td></tr>`).join("") : `<tr><td colspan="9">ยังไม่มีบุคลากร เพิ่มที่แท็บ "รายชื่อบุคลากร"</td></tr>`);
    $("#byGroup").innerHTML = `<tr><th>กลุ่ม</th><th>คน</th><th>ช่องที่ต้องผ่าน</th><th>ผ่าน</th><th>%</th><th>ผ่านครบทุกหลักสูตร (คน)</th></tr>` +
      bg.map(r => `<tr><td>${esc(r[0])}</td>${r.slice(1, 4).map(v => `<td class="n">${v}</td>`).join("")}<td class="n ${r[4] == null ? "" : r[4] >= 95 ? "ok" : r[4] >= 80 ? "soon" : "exp"}">${r[4] ?? "-"}</td><td class="n">${r[5]}</td></tr>`).join("");
    const due = dueList(S.all);
    $("#due").innerHTML = `<tr><th>ชื่อ</th><th>กลุ่ม</th><th>หลักสูตร</th><th>สถานะ</th><th>ผ่านล่าสุด</th><th>หมดอายุ</th></tr>` +
      (due.length ? due.slice(0, 300).map(x => `<tr><td>${esc(x.p.full_name)}</td><td>${esc(x.p.grp)}</td><td>${esc(x.c.code)} ${esc(x.c.name)}</td><td class="${x.st}">${ST[x.st].join(" ")}</td><td>${dTH(x.last)}</td><td>${dTH(x.until)}</td></tr>`).join("") : `<tr><td colspan="6">ไม่มี ทุกคนผ่านภาคบังคับและยังไม่หมดอายุ</td></tr>`);
  }
  const byCourse = all => mandCourses().map(c => { const r = all.filter(x => x.c === c), g = k => r.filter(x => x.st === k).length, okN = g("ok") + g("soon");
    return [c.code, c.name, c.valid_months ? `ทุก ${c.valid_months} เดือน` : "ครั้งเดียว", r.length, okN, g("soon"), g("exp"), g("none"), pct(okN, r.length), c.kpi7]; }).filter(r => r[3]);
  const byGroup = all => GRPS.filter(g => !grp() || g === grp()).map(g => { const ppl = activePeople().filter(p => p.grp === g), r = all.filter(x => x.p.grp === g), okN = r.filter(x => x.st === "ok" || x.st === "soon").length;
    return [g, ppl.length, r.length, okN, pct(okN, r.length), ppl.filter(p => r.filter(x => x.p === p).every(x => x.st === "ok" || x.st === "soon")).length]; }).filter(r => r[1]);
  const dueList = all => all.filter(x => x.st !== "ok").sort((a, b) => ({ exp: 0, none: 1, soon: 2 })[a.st] - ({ exp: 0, none: 1, soon: 2 })[b.st] || a.p.full_name.localeCompare(b.p.full_name, "th"));
  const period = () => `${hosp().code || ""} · ข้อมูล ณ ${dTH(today())}${grp() ? " · กลุ่ม " + grp() : ""}`;
  $("#oX").onclick = () => { const S = summary(), P = pct(S.ok, S.n), K = pct(S.k7ok, S.k7.length), bc = byCourse(S.all), worst = bc.slice().sort((a, b) => (a[8] ?? 101) - (b[8] ?? 101))[0];
    const findings = [`บุคลากรที่ใช้งาน ${S.ppl.length} คน ผ่านหลักสูตรภาคบังคับ ${S.ok} จาก ${S.n} ช่อง (${P ?? "-"}%) ผ่านครบทุกหลักสูตร ${S.full} คน`,
      `KPI ข้อ 7 (อบรมรับเหตุฉุกเฉิน): ${S.k7.length ? `${K}% ${K >= 100 ? "ผ่าน ได้ 2 คะแนน" : "ยังไม่ครบ 100%"}` : "ยังไม่มีข้อมูล"}`,
      `ต้องนัดอบรม: หมดอายุ ${S.exp} · ยังไม่เคยอบรม ${S.none} · จะหมดใน 30 วัน ${S.soon}`];
    if (worst && worst[8] != null && worst[8] < 100) findings.push(`หลักสูตรที่ผ่านน้อยที่สุด: ${worst[0]} ${worst[1]} (${worst[8]}%) ควรจัดอบรมเป็นลำดับแรก`);
    const opts = { title: "สรุปการอบรมและสมรรถนะบุคลากร", period: period(), findings, notes: ["หลักฐานสำหรับ JCI 8th FMS.01.01 / FMS.09.01 / SQE (แฟ้มอบรมบุคลากร outsource)", "ผลอบรมหมดอายุตามรอบของหลักสูตร นับเฉพาะผล 'ผ่าน'"] };
    Office.table("อบรม_ตามหลักสูตร_" + (hosp().code || ""), ["รหัส", "หลักสูตร", "รอบ", "ต้องอบรม", "ผ่าน", "หมดใน 30 วัน", "หมดอายุ", "ยังไม่เคย", "% ผ่าน", "KPI 7"], bc.map(r => [...r.slice(0, 9), r[9] ? "ใช่" : ""]), opts);
    Office.table("อบรม_ต้องนัด_" + (hosp().code || ""), ["ชื่อ", "กลุ่ม", "รหัสหลักสูตร", "หลักสูตร", "สถานะ", "ผ่านล่าสุด", "หมดอายุ"], dueList(S.all).map(x => [x.p.full_name, x.p.grp, x.c.code, x.c.name, ST[x.st][1], dTH(x.last), dTH(x.until)]),
      { title: "รายชื่อที่ต้องนัดอบรม", period: period() }); };

  // ---------- Matrix ----------
  function rMx() {
    const cs = mandCourses(), ppl = activePeople();
    if (!ppl.length) { $("#mx").innerHTML = `<tr><td>ยังไม่มีบุคลากร เพิ่มที่แท็บ "รายชื่อบุคลากร"</td></tr>`; return; }
    $("#mx").innerHTML = `<tr><th>ชื่อ</th><th>กลุ่ม</th>${cs.map(c => `<th class="c" title="${esc(c.name)}">${esc(c.code)} ${esc(c.name.slice(0, 20))}</th>`).join("")}<th>ผ่าน</th></tr>` +
      ppl.map(p => { let a = 0, b = 0; const tds = cs.map(c => { if (!applies(c, p)) return `<td class="c"></td>`; const s = status(p, c); b++; if (s.st === "ok" || s.st === "soon") a++;
        return `<td class="c ${s.st}" title="${esc(c.name)}: ${ST[s.st][1]}${s.until ? " ถึง " + dTH(s.until) : ""}">${ST[s.st][0]} ${s.last ? esc(dTH(s.last)) : ""}</td>`; }).join("");
        return `<tr><td><a href="#" data-file="${p.id}">${esc(p.full_name)}</a></td><td>${esc(p.grp)}</td>${tds}<td class="n">${a}/${b}</td></tr>`; }).join("");
  }
  $("#mx").onclick = ev => { const a = ev.target.closest("[data-file]"); if (!a) return; ev.preventDefault(); $("#fp").dataset.want = a.dataset.file; show("file"); };
  $("#mX").onclick = () => { const cs = mandCourses(), S = summary();
    Office.table("อบรม_Matrix_" + (hosp().code || ""), ["ชื่อ", "กลุ่ม", "ตำแหน่ง", ...cs.map(c => c.code), "ผ่าน/ต้องผ่าน"],
      activePeople().map(p => { let a = 0, b = 0; const v = cs.map(c => { if (!applies(c, p)) return ""; const s = status(p, c); b++; if (s.st === "ok" || s.st === "soon") a++; return s.last ? `${ST[s.st][0]} ${dTH(s.last)}` : ST[s.st][0]; });
        return [p.full_name, p.grp, p.position || "", ...v, `${a}/${b}`]; }),
      { title: "ตารางสมรรถนะบุคลากร (Competency matrix)", period: period(), findings: [`ผ่านภาคบังคับ ${S.ok} จาก ${S.n} ช่อง (${pct(S.ok, S.n) ?? "-"}%)`, `ผ่านครบทุกหลักสูตร ${S.full} จาก ${S.ppl.length} คน`],
        notes: ["✓ ยังไม่หมดอายุ · ⚠ หมดใน 30 วัน · ✗ หมดอายุแล้ว · – ยังไม่เคยอบรม · ช่องว่าง = ไม่ใช่หลักสูตรของกลุ่มนี้", ...cs.map(c => `${c.code} = ${c.name}`)] }); };

  // ---------- บันทึกการอบรม ----------
  function rSes() {
    $("#sC").innerHTML = courses.filter(c => c.active).map(c => `<option value="${c.id}">${esc(c.code)} · ${esc(c.name)}${c.hospital_id ? "" : ""}</option>`).join("");
    const ppl = activePeople();
    $("#sPeople").innerHTML = ppl.length ? ppl.map(p => `<label><input type="checkbox" data-p="${p.id}"> ${esc(p.full_name)} <span class="sub">${esc(p.grp)}</span>
      <select data-r="${p.id}" aria-label="ผล">${Object.entries(RES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>`).join("") : `<span class="sub">ยังไม่มีบุคลากร เพิ่มที่แท็บ "รายชื่อบุคลากร" ก่อน</span>`;
    const y = $("#sy").value, list = sessions.filter(s => s.held_on.startsWith(y));
    $("#sList").innerHTML = `<tr><th>วันที่</th><th>หลักสูตร</th><th>ชม.</th><th>วิทยากร</th><th>สถานที่</th><th>เข้า</th><th>ผ่าน</th><th>ผู้เข้าอบรม</th></tr>` +
      (list.length ? list.map(s => { const c = courses.find(x => x.id === s.course_id) || {}, a = att.filter(x => x.session_id === s.id);
        return `<tr><td>${dTH(s.held_on)}</td><td>${esc(c.code || "")} ${esc(c.name || "")}</td><td class="n">${s.hours ?? c.hours ?? ""}</td><td>${esc(s.trainer || "")}</td><td>${esc(s.place || "")}</td><td class="n">${a.length}</td><td class="n">${a.filter(x => x.result === "pass").length}</td>
          <td>${a.map(x => { const p = people.find(q => q.id === x.person_id); return esc(p ? p.full_name : "?") + (x.result === "pass" ? "" : ` (${RES[x.result]})`); }).join(", ")}${s.note ? `<br><span class="sub">${esc(s.note)}</span>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="8">ยังไม่มีการอบรมในปีนี้</td></tr>`);
  }
  $("#sC").onchange = () => { const c = courses.find(x => String(x.id) === $("#sC").value); if (c) $("#sH").value = c.hours ?? ""; };
  $("#sAll").onclick = () => document.querySelectorAll("#sPeople input[data-p]").forEach(i => i.checked = true);
  $("#sNone").onclick = () => document.querySelectorAll("#sPeople input[data-p]").forEach(i => i.checked = false);
  $("#fS").onsubmit = guard(async () => {
    const ticks = [...document.querySelectorAll("#sPeople input[data-p]:checked")].map(i => +i.dataset.p);
    if (!ticks.length) throw new Error("ติ๊กผู้เข้าอบรมอย่างน้อย 1 คน");
    const row = { hospital_id: $("#h").value, course_id: +$("#sC").value, held_on: $("#sD").value, hours: $("#sH").value === "" ? null : +$("#sH").value,
      trainer: $("#sT").value.trim() || null, place: $("#sP").value.trim() || null, note: $("#sN").value.trim() || null, created_by: me.id };
    const { data: s, error } = await sb.from("training_sessions").insert(row).select().single(); if (error) throw error;
    const rows = ticks.map(id => ({ session_id: s.id, person_id: id, result: document.querySelector(`#sPeople select[data-r="${id}"]`).value }));
    const r2 = await sb.from("training_attendance").insert(rows); if (r2.error) throw r2.error;
    ["#sT", "#sP", "#sN"].forEach(k => $(k).value = "");
    await load(); rSes(); toast(`บันทึกการอบรมแล้ว ${rows.length} คน`);
  });
  $("#sX").onclick = () => { const y = $("#sy").value, list = sessions.filter(s => s.held_on.startsWith(y)), rows = [];
    list.forEach(s => { const c = courses.find(x => x.id === s.course_id) || {}; att.filter(x => x.session_id === s.id).forEach(a => { const p = people.find(q => q.id === a.person_id) || {};
      rows.push([dTH(s.held_on), c.code || "", c.name || "", s.hours ?? c.hours ?? "", s.trainer || "", s.place || "", p.full_name || "", p.grp || "", RES[a.result]]); }); });
    Office.table(`อบรม_ประวัติ_${hosp().code || ""}_${+y + 543}`, ["วันที่", "รหัส", "หลักสูตร", "ชั่วโมง", "วิทยากร", "สถานที่", "ชื่อ", "กลุ่ม", "ผล"], rows,
      { title: `ประวัติการอบรม ปี ${+y + 543}`, period: period(), findings: [`จัดอบรม ${list.length} ครั้ง ผู้เข้าอบรมรวม ${rows.length} คน-ครั้ง ผ่าน ${rows.filter(r => r[8] === "ผ่าน").length}`] }); };

  // ---------- รายชื่อบุคลากร ----------
  function rPpl() {
    const list = people.filter(p => !grp() || p.grp === grp());
    $("#pList").innerHTML = `<tr><th>ชื่อ</th><th>กลุ่ม</th><th>ตำแหน่ง</th><th>บริษัท</th><th>เริ่มงาน</th><th>ผ่านภาคบังคับ</th><th>สถานะ</th></tr>` +
      (list.length ? list.map(p => { const cs = courses.filter(c => applies(c, p)), okN = cs.filter(c => ["ok", "soon"].includes(status(p, c).st)).length;
        return `<tr><td><a href="#" data-file="${p.id}">${esc(p.full_name)}</a></td><td>${esc(p.grp)}</td><td>${esc(p.position || "")}</td><td>${esc(p.company || "")}</td><td>${dTH(p.start_date)}</td><td class="n">${okN}/${cs.length}</td>
          <td>${p.active ? "ใช้งาน" : "พ้นสภาพ"}${canWrite ? ` <button class="btn small" type="button" data-act="${p.id}">${p.active ? "ปิด (ลาออก)" : "เปิดใช้"}</button>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="7">ยังไม่มีรายชื่อ</td></tr>`);
  }
  $("#pList").onclick = guard(async ev => { const f = ev.target.closest("[data-file]"); if (f) { $("#fp").dataset.want = f.dataset.file; show("file"); return; }
    const b = ev.target.closest("[data-act]"); if (!b) return; const p = people.find(x => x.id === +b.dataset.act);
    const { error } = await sb.from("training_people").update({ active: !p.active }).eq("id", p.id); if (error) throw error; await load(); rPpl(); });
  $("#fP").onsubmit = guard(async () => {
    const row = { hospital_id: $("#h").value, full_name: $("#pN").value.trim(), grp: $("#pG").value, position: $("#pPos").value.trim() || null, company: $("#pCo").value.trim() || null, start_date: $("#pSt").value || null, created_by: me.id };
    if (!row.full_name) throw new Error("กรอกชื่อ");
    const { error } = await sb.from("training_people").insert(row); if (error) throw error;
    ["#pN", "#pPos", "#pSt"].forEach(k => $(k).value = ""); await load(); rPpl(); toast("เพิ่มรายชื่อแล้ว"); });
  $("#pImp").onclick = guard(async () => {
    const { data, error } = await sb.from("profiles").select("id,full_name,role,active").eq("hospital_id", $("#h").value); if (error) throw error;
    const have = new Set(people.map(p => p.profile_id).filter(Boolean)), names = new Set(people.map(p => (p.full_name || "").trim()));
    const rows = (data || []).filter(p => p.active !== false && p.full_name && !have.has(p.id) && !names.has(p.full_name.trim()))
      .map(p => ({ hospital_id: $("#h").value, full_name: p.full_name.trim(), grp: "ช่าง", position: p.role, profile_id: p.id, company: "TW", created_by: me.id }));
    if (!rows.length) { $("#pMsg").textContent = "ไม่มีรายชื่อใหม่ให้ดึง (มีครบแล้ว)"; return; }
    const r = await sb.from("training_people").insert(rows); if (r.error) throw r.error;
    $("#pMsg").textContent = `ดึงมาแล้ว ${rows.length} คน (ตั้งกลุ่มเป็น "ช่าง" ไว้ก่อน)`; await load(); rPpl(); });
  $("#pX").onclick = () => { const list = people.filter(p => !grp() || p.grp === grp());
    Office.table("อบรม_รายชื่อ_" + (hosp().code || ""), ["ชื่อ", "กลุ่ม", "ตำแหน่ง", "บริษัท", "เริ่มงาน", "ผ่านภาคบังคับ", "ต้องผ่าน", "สถานะ"],
      list.map(p => { const cs = courses.filter(c => applies(c, p)); return [p.full_name, p.grp, p.position || "", p.company || "", dTH(p.start_date), cs.filter(c => ["ok", "soon"].includes(status(p, c).st)).length, cs.length, p.active ? "ใช้งาน" : "พ้นสภาพ"]; }),
      { title: "รายชื่อบุคลากรและผลอบรมภาคบังคับ", period: period(), findings: [`ใช้งาน ${list.filter(p => p.active).length} คน จากทั้งหมด ${list.length} คน`] }); };

  // ---------- หลักสูตร ----------
  function rCrs() {
    $("#cList").innerHTML = `<tr><th>รหัส</th><th>หลักสูตร</th><th>หมวด</th><th>กลุ่ม</th><th>รอบ</th><th>ชม.</th><th>อ้างอิง</th><th>ใช้กับ</th><th>สถานะ</th></tr>` +
      courses.map(c => { const mine = exec || (!!c.hospital_id && canWrite);
        return `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}${c.kpi7 ? ' <span class="pill">KPI 7</span>' : ""}${c.mandatory ? "" : ' <span class="pill">ไม่บังคับ</span>'}</td><td>${esc(c.category)}</td><td>${esc(c.groups.length ? c.groups.join(", ") : "ทุกกลุ่ม")}</td>
          <td>${c.valid_months ? `ทุก ${c.valid_months} เดือน` : "ครั้งเดียว"}</td><td class="n">${c.hours ?? ""}</td><td>${esc(c.ref || "")}</td><td>${c.hospital_id ? esc(hosp().code || "") : "กลาง 12 โรง"}</td>
          <td>${c.active ? "ใช้งาน" : "ปิด"}${mine ? ` <button class="btn small" type="button" data-cact="${c.id}">${c.active ? "ปิด" : "เปิด"}</button>` : ""}</td></tr>`; }).join("");
  }
  $("#cList").onclick = guard(async ev => { const b = ev.target.closest("[data-cact]"); if (!b) return; const c = courses.find(x => x.id === +b.dataset.cact);
    const { error } = await sb.from("training_courses").update({ active: !c.active }).eq("id", c.id); if (error) throw error; await load(); rCrs(); });
  $("#fC").onsubmit = guard(async () => {
    const row = { hospital_id: $("#cScope").value === "all" && exec ? null : $("#h").value, code: $("#cCode").value.trim(), name: $("#cName").value.trim(), category: $("#cCat").value.trim() || "อื่น ๆ",
      groups: [...document.querySelectorAll("#cGrp input:checked")].map(i => i.value), mandatory: $("#cMand").checked, kpi7: $("#cK7").checked,
      valid_months: +$("#cVm").value || 0, hours: +$("#cHr").value || 0, ref: $("#cRef").value.trim() || null, created_by: me.id };
    if (!row.code || !row.name) throw new Error("กรอกรหัสและชื่อหลักสูตร");
    if (courses.some(c => c.code.toLowerCase() === row.code.toLowerCase() && (c.hospital_id || null) === row.hospital_id)) throw new Error("รหัสนี้มีแล้ว");
    const { error } = await sb.from("training_courses").insert(row); if (error) throw error;
    ["#cCode", "#cName", "#cRef"].forEach(k => $(k).value = ""); await load(); rCrs(); toast("เพิ่มหลักสูตรแล้ว"); });

  // ---------- แฟ้มรายบุคคล ----------
  function rFile() {
    const list = people.filter(p => !grp() || p.grp === grp()), want = $("#fp").dataset.want || $("#fp").value;
    $("#fp").innerHTML = list.map(p => `<option value="${p.id}">${esc(p.full_name)} · ${esc(p.grp)}${p.active ? "" : " (พ้นสภาพ)"}</option>`).join("");
    if (want && list.some(p => String(p.id) === String(want))) $("#fp").value = want; delete $("#fp").dataset.want;
    const p = people.find(x => String(x.id) === $("#fp").value);
    if (!p) { $("#fBody").innerHTML = `<p class="sub">ยังไม่มีบุคลากร</p>`; return; }
    const cs = courses.filter(c => applies(c, p)), hist = att.filter(a => a.person_id === p.id).map(a => ({ a, s: sesOf(a.session_id) })).filter(x => x.s).sort((x, y) => y.s.held_on.localeCompare(x.s.held_on));
    const hrs = hist.filter(x => x.a.result !== "fail").reduce((t, x) => t + (+(x.s.hours ?? (courses.find(c => c.id === x.s.course_id) || {}).hours) || 0), 0);
    $("#fBody").innerHTML = `<div class="panel"><h2>${esc(p.full_name)}</h2>
      <p>${esc(hosp().code || "")} · กลุ่ม ${esc(p.grp)}${p.position ? " · " + esc(p.position) : ""}${p.company ? " · " + esc(p.company) : ""} · เริ่มงาน ${dTH(p.start_date)} · อบรมรวม ${Math.round(hrs * 10) / 10} ชั่วโมง</p>
      <h3>หลักสูตรภาคบังคับ</h3><div class="tw"><table class="tt"><tr><th>รหัส</th><th>หลักสูตร</th><th>สถานะ</th><th>ผ่านล่าสุด</th><th>หมดอายุ</th></tr>
      ${cs.map(c => { const s = status(p, c); return `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td class="${s.st}">${ST[s.st].join(" ")}</td><td>${dTH(s.last)}</td><td>${s.last ? (s.until ? dTH(s.until) : "ไม่หมดอายุ") : "-"}</td></tr>`; }).join("") || `<tr><td colspan="5">-</td></tr>`}</table></div>
      <h3>ประวัติการอบรมทั้งหมด</h3><div class="tw"><table class="tt"><tr><th>วันที่</th><th>หลักสูตร</th><th>ชม.</th><th>วิทยากร</th><th>ผล</th></tr>
      ${hist.map(({ a, s }) => { const c = courses.find(x => x.id === s.course_id) || {}; return `<tr><td>${dTH(s.held_on)}</td><td>${esc(c.code || "")} ${esc(c.name || "")}</td><td class="n">${s.hours ?? c.hours ?? ""}</td><td>${esc(s.trainer || "")}</td><td>${RES[a.result]}</td></tr>`; }).join("") || `<tr><td colspan="5">ยังไม่มีประวัติ</td></tr>`}</table></div>
      <p class="sub">ลงชื่อผู้รับรอง ........................................ หัวหน้างาน · วันที่ ....................</p></div>`;
  }
  $("#fp").onchange = () => rFile();
  $("#fPrint").onclick = () => window.print();
})();
