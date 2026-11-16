const RS = (() => {
  const cfg = window.RS_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const STATUS = {register:"รอรับงาน",assign:"มอบหมายแล้ว",work_on:"กำลังซ่อม",on_hold:"พักงาน",clear:"ซ่อมเสร็จ รอตรวจ",evaluated:"ประเมินแล้ว",close:"ปิดงาน",cancel:"ยกเลิก"};
  const OPEN = ["register","assign","work_on","on_hold","clear"];
  const fmt = iso => iso ? new Date(iso).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "-";
  const fmtDate = d => d ? new Date(d + (String(d).length === 10 ? "T00:00:00+07:00" : "")).toLocaleDateString("th-TH",{timeZone:"Asia/Bangkok",day:"numeric",month:"short",year:"2-digit"}) : "-";
  const mins = (a,b) => Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 60000);
  const dur = m => m < 60 ? m + " นาที" : m < 1440 ? (m/60).toFixed(1) + " ชม." : (m/1440).toFixed(1) + " วัน";
  const hospitalCode = () => new URLSearchParams(location.search).get("h") || cfg.defaultHospital || "";
  const statusLabel = j => j.status === "assign" && j.accepted_at ? "รับงานแล้ว" : STATUS[j.status] || j.status;
  const pill = (s, label) => `<span class="pill" style="color:var(--s-${s})">${esc(label || STATUS[s] || s)}</span>`;
  const errText = e => (e && (e.message || e.error_description)) || "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
  const opts = (sel, items, keep=true) => { const v = sel.value; sel.innerHTML = items.map(([val,label]) => `<option value="${esc(val)}">${esc(label)}</option>`).join(""); if (keep && items.some(i => String(i[0]) === v)) sel.value = v; };
  // working minutes: elapsed time minus time spent on hold (SLA pauses during hold)
  const workMins = (j, until) => {
    const end = until || j.cleared_at || j.closed_at;
    let m = mins(j.created_at, end) - (j.hold_minutes || 0);
    if (!end && j.status === "on_hold" && j.hold_started_at) m -= mins(j.hold_started_at);
    return Math.max(0, m);
  };
  // photos are shrunk before upload so they send fast on weak signal; videos and unreadable files (some HEIC) go as-is
  async function shrink(file) {
    if (!file.type.startsWith("image/")) return { blob: file, ext: (file.name.split(".").pop() || "mp4").toLowerCase(), type: file.type || "video/mp4" };
    try {
      const img = await createImageBitmap(file); const s = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
      return { blob, ext: "jpg", type: "image/jpeg" };
    } catch { return { blob: file, ext: (file.name.split(".").pop() || "jpg").toLowerCase(), type: file.type || "image/heic" }; }
  }
  async function uploadMedia(files, hospitalCode, kind) {
    const out = [];
    for (const f of files) {
      if (f.size > 50 * 1024 * 1024) throw new Error(`ไฟล์ ${f.name} ใหญ่เกิน 50 MB`);
      const m = await shrink(f);
      const path = `${hospitalCode}/${new Date().toISOString().slice(0,10)}/${kind}-${crypto.randomUUID()}.${m.ext}`;
      const up = await sb.storage.from("job-photos").upload(path, m.blob, { contentType: m.type });
      if (up.error) throw up.error;
      out.push(path);
    }
    return out;
  }
  const isVideo = p => /\.(mp4|mov|webm|m4v)$/i.test(p);
  async function signed(paths) {
    if (!paths.length) return {};
    const { data } = await sb.storage.from("job-photos").createSignedUrls(paths, 3600);
    return Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
  }
  return { sb, $, esc, STATUS, OPEN, fmt, fmtDate, mins, dur, hospitalCode, pill, statusLabel, errText, opts, workMins, uploadMedia, isVideo, signed };
})();

// Sign-in box on the "ต้องเข้าสู่ระบบก่อน" screen of every staff page, so nobody has to go back to staff.html first.
(() => {
  const add = async () => {
    const box = document.querySelector("#gate .panel");
    if (!box || box.querySelector(".gLogin")) return;
    try { const { data } = await RS.sb.auth.getSession(); if (!data || data.session) return; } catch (e) { return; }
    const f = document.createElement("form");
    f.className = "gLogin"; f.style.cssText = "display:flex;flex-direction:column;gap:10px;max-width:420px;margin-top:12px";
    f.innerHTML = `<b>หรือเข้าสู่ระบบที่นี่ได้เลย</b><label>อีเมล<input name="e" type="email" required autocomplete="username" style="width:100%"></label>
      <label>รหัสผ่าน<input name="p" type="password" required autocomplete="current-password" style="width:100%"></label>
      <div class="row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn primary">เข้าสู่ระบบ</button>
        <a href="staff.html">ลืมรหัสผ่าน / สมัครบัญชี</a></div><div class="meta" role="status"></div>`;
    f.addEventListener("submit", async ev => {
      ev.preventDefault(); const b = f.querySelector("button"), m = f.querySelector("[role=status]");
      b.disabled = true; m.textContent = "กำลังเข้าสู่ระบบ…";
      const { error } = await RS.sb.auth.signInWithPassword({ email: f.e.value.trim(), password: f.p.value });
      if (error) { b.disabled = false; m.textContent = /invalid/i.test(error.message) ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : /confirm/i.test(error.message) ? "ยังไม่ได้ยืนยันอีเมล เปิดลิงก์ยืนยันในอีเมลก่อน" : RS.errText(error); return; }
      m.textContent = "เข้าสู่ระบบแล้ว กำลังเปิดหน้า…"; location.reload();
    });
    box.appendChild(f);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
})();

// Page access per person (set by a head in Settings > Staff): which staff pages someone may open. Everyone signs in
// at home.html and sees only their own pages; opening any other page sends them back there. Data rights still follow the role.
const RS_PAGES = [["staff.html", "ใบงานแจ้งซ่อม (ใบงาน อะไหล่ ขอซื้อ รายงาน ตั้งค่า)"], ["fms.html", "FMS Round · Tracer JCI"], ["gate.html", "ป้อม รปภ. ผู้รับเหมา"],
  ["pmboard.html", "PM Board · ความพร้อมอาคาร"], ["pm.html", "PM Inhouse / PM MA"], ["ma.html", "สัญญา MA 12 โรง"], ["op.html", "บันทึก OP"], ["book.html", "Monthly Report"],
  ["market.html", "ตลาดอะไหล่"], ["ref.html", "เบอร์ภายใน · ข้อมูลพื้นที่"], ["ac.html", "งานผู้รับเหมาแอร์"], ["survey.html", "แบบสอบถาม"], ["wp.html", "Work Permit"],
  ["ops.html", "ส่งเวร · รายงานเดือน · คลังวิธีแก้"]];
(() => {
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  if (!RS_PAGES.some(([p]) => p === here)) return;
  // every staff page gets one "🏠 หน้าหลัก" button back to home.html (the person's own list of pages)
  const homeBtn = () => {
    document.querySelectorAll('header a[href="staff.html"]').forEach(a => { if (/^\s*←/.test(a.textContent)) { a.href = "home.html"; a.textContent = "🏠 หน้าหลัก"; } });
    const who = document.querySelector("header .who");
    if (who && !who.querySelector('a[href="home.html"]')) { const a = document.createElement("a"); a.className = "btn small"; a.href = "home.html"; a.textContent = "🏠 หน้าหลัก"; who.prepend(a); }
  };
  homeBtn();
  // while a signed-in person's page list loads, keep the page blank so pages they may not use never flash on screen
  let signedIn = false; try { signedIn = Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)); } catch (e) {}
  const st = document.createElement("style"); st.textContent = "html.rsWait body{visibility:hidden}"; document.head.appendChild(st);
  const show = () => document.documentElement.classList.remove("rsWait");
  if (signedIn) { document.documentElement.classList.add("rsWait"); setTimeout(show, 4000); }
  const check = async session => {
    try {
      if (!session || !session.user) return;
      const { data, error } = await RS.sb.rpc("my_access");
      if (error || !data || !Array.isArray(data.pages)) return;
      const pages = data.pages;
      // a page this person was not given: back to their own home list
      if (!pages.includes(here)) { location.replace("home.html"); return new Promise(() => {}); }
      // links to pages they were not given are taken off the page
      const tidy = () => document.querySelectorAll("header a[href]").forEach(a => {
        const p = (a.getAttribute("href") || "").split("?")[0].toLowerCase(); if (RS_PAGES.some(x => x[0] === p) && !pages.includes(p)) a.hidden = true; });
      tidy(); setTimeout(tidy, 1500);
    } finally { show(); }
  };
  RS.sb.auth.getSession().then(r => { if (!(r.data && r.data.session)) show(); return check(r.data && r.data.session); }).catch(show);
  RS.sb.auth.onAuthStateChange((ev, session) => { if (ev === "SIGNED_IN") check(session); });
})();
