// Cross-hospital parts market: shop + cart → memo → buyer chief → seller confirms → central round → ship → receive → counts.
// No prices in this flow. Stock only moves when each side confirms its count.
(() => {
  const { sb, $, esc, fmt, errText } = RS;
  const TABS = ["shop", "mine", "orders", "dash", "central"];
  const REASONS = ["ขอแบ่งซื้อ", "ช่วยระบาย", "ขาดคราว/ด่วน", "อื่น ๆ"];
  const ST = { memo: "รอ Chief ผู้ซื้ออนุมัติ Memo", memo_ok: "รอผู้ขายยืนยันจำนวน", seller_ok: "รอส่วนกลางอนุมัติ", central_ok: "รอผู้ขายส่งของ",
    shipped: "ส่งของแล้ว รอผู้ซื้อรับ", received: "รับของแล้ว รอตรวจนับ", done: "ครบทุกขั้น", rejected: "ไม่อนุมัติ / ปฏิเสธ", cancelled: "ยกเลิก" };
  const FLOW = ["เลือกของ", "ส่ง Memo", "อนุมัติ Memo", "ยืนยันจำนวน", "ส่วนกลางอนุมัติ", "ส่งของ", "รับของ", "ตรวจนับ"];
  const STEP_OF = { memo: 2, memo_ok: 3, seller_ok: 4, central_ok: 5, shipped: 6, received: 7, done: 8 };
  let me = null, H = null, hosp = [], central = { can_approve: false, can_account: false }, market = [], cart = [], orders = [], mine = [], cur = null, curRound = null, mvFilter = "", channel = null;
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const role = () => (me && me.role) || "";
  const opener = () => ["owner", "admin", "chief_engineer", "supervisor"].includes(role());
  const chief = () => ["owner", "chief_engineer"].includes(role());
  const isCentral = () => central.can_approve || central.can_account;
  const hName = id => { const h = hosp.find(x => x.id === id); return h ? h.name : "?"; };
  const hCode = id => (hosp.find(x => x.id === id) || {}).code || "?";
  const mv = s => s ? `<span class="mv ${s === "NON MOVE" ? "NON" : s}">${s === "NEW" ? "ของใหม่" : s}</span>` : '<span class="meta">ไม่มีในสต็อก</span>';
  const n = v => v == null ? "–" : (+v).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  const thDate = d => new Date(d).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" });
  function toast(m) { $("#toast").textContent = m; $("#toast").hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $("#toast").hidden = true, 6000); }
  const bad = (el, e) => { $(el).innerHTML = `<div class="note bad">${esc(typeof e === "string" ? e : errText(e))}</div>`; };
  function csv(name, head, rows) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const blob = new Blob(["﻿" + [head.map(q).join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  const badge = (el, k) => { $(el).textContent = k; $(el).hidden = !k; };

  /* ---------- boot ---------- */
  const q0 = new URLSearchParams(location.search);
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    me = data;
    if (!me || !me.hospital_id) { $("#gate").hidden = false; return; }
    H = me.hospitals; $("#gate").hidden = true;
    $("#title").textContent = "ตลาดอะไหล่ 12 รพ. · " + H.name; $("#who").textContent = me.full_name || session.user.email;
    const [hs, c] = await Promise.all([sb.rpc("xh_hospitals"), sb.from("xh_central").select("*").eq("profile_id", me.id).maybeSingle()]);
    hosp = hs.data || []; if (c.data) central = c.data;
    $("#tabCentral").hidden = !isCentral() && role() !== "owner";
    try { cart = JSON.parse(store.get("rs-xh-cart-" + H.id, "[]")) || []; } catch { cart = []; }
    $("#tabs").hidden = false;
    await loadOrders();
    channel = sb.channel("xh-" + H.id).on("postgres_changes", { event: "*", schema: "public", table: "xh_orders" }, async () => { await loadOrders(); if (!$("#tab-orders").hidden && !cur) renderOrders(); }).subscribe();
    show(q0.get("tab") || store.get("rs-xh-tab", "shop"));
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    if (!TABS.includes(t) || (t === "central" && $("#tabCentral").hidden)) t = "shop";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    TABS.forEach(x => $("#tab-" + x).hidden = x !== t);
    store.set("rs-xh-tab", t); cur = null; curRound = null;
    ({ shop: renderShop, mine: renderMine, orders: renderOrders, dash: renderDash, central: renderCentral })[t]();
  }

  /* ---------- orders data + what waits for me ---------- */
  async function loadOrders() {
    const r = await sb.from("xh_orders").select("*, xh_items(*)").order("created_at", { ascending: false }).range(0, 999);
    const rr = await sb.from("xh_rounds").select("id,round_no"), rn = Object.fromEntries((rr.data || []).map(x => [x.id, x.round_no]));
    orders = (r.data || []).map(o => ({ ...o, round_no: rn[o.round_id], xh_items: (o.xh_items || []).sort((a, b) => a.line - b.line) }));
    badge("#nTodo", orders.filter(todo).length);
    badge("#nRound", isCentral() ? orders.filter(o => o.status === "seller_ok").length : 0);
    badge("#nCart", cart.length);
  }
  const buyer = o => o.buyer_hospital === H.id, seller = o => o.seller_hospital === H.id;
  const needSellerCount = o => seller(o) && ["shipped", "received"].includes(o.status) && !o.seller_count_at;
  const needBuyerCount = o => buyer(o) && o.status === "received" && !o.buyer_count_at;
  function todo(o) {
    if (o.status === "memo") return buyer(o) && chief() && o.created_by !== me.id;
    if (o.status === "memo_ok" || o.status === "central_ok") return seller(o) && chief();
    if (o.status === "shipped" && buyer(o) && opener()) return true;
    return opener() && (needSellerCount(o) || needBuyerCount(o));
  }

  /* ---------- shop + cart ---------- */
  let sTimer = null;
  $("#sQ").oninput = () => { clearTimeout(sTimer); sTimer = setTimeout(renderShop, 350); };
  async function renderShop() {
    renderCart();
    const q = $("#sQ").value.trim();
    const { data, error } = await sb.rpc("xh_market", { p_q: q.length >= 2 ? q : null });
    if (error) { $("#sList").innerHTML = `<div class="note bad">${esc(errText(error))}</div>`; return; }
    market = data || [];
    $("#sList").innerHTML = market.map(p => `<div class="card"><div class="meta">${esc(p.hospital_code)} · ${esc(p.hospital_name)} ${p.consigned ? '<span class="pill">ฝากขาย</span>' : '<span class="pill">ขอแบ่งซื้อ</span>'}</div>
      <b>${esc(p.name)}</b><span class="mono">${esc(p.code)}</span>
      <div>มีให้ <b>${n(p.available)}</b> ${esc(p.unit)}${p.warranty_until ? ` · ประกันถึง ${esc(p.warranty_until)}` : ""}</div>
      <div class="meta">ผู้ขาย ${mv(p.mv_seller)} · เรา ${mv(p.mv_buyer)}</div>
      <div class="meta">เราใช้ 3 เดือน ${n(p.use3_buyer)} · เรามีคงเหลือ ${n(p.buyer_qty)}</div>
      ${p.listing_reason ? `<div class="meta">เหตุผลฝากขาย: ${esc(p.listing_reason)}</div>` : ""}
      ${opener() ? `<div class="addrow"><input type="number" min="1" max="${p.available}" step="any" value="1" aria-label="จำนวน" data-qty="${p.part_id}"><button class="btn small primary" type="button" data-add="${p.part_id}">ใส่ตะกร้า</button></div>` : ""}</div>`).join("")
      || `<div class="empty">${q.length >= 2 ? "ไม่พบอะไหล่ตามคำค้น" : "ยังไม่มีของฝากขาย พิมพ์คำค้น 2 ตัวอักษรขึ้นไปเพื่อค้นสต็อกทั้งเครือ"}</div>`;
  }
  $("#sList").onclick = ev => {
    const id = ev.target.dataset.add; if (!id) return;
    const p = market.find(x => x.part_id === id), qty = +document.querySelector(`[data-qty="${id}"]`).value;
    if (!(qty > 0) || qty > p.available) return toast(`ใส่จำนวน 1–${p.available}`);
    const ex = cart.find(c => c.part_id === id);
    if (ex) ex.qty = Math.min(p.available, qty); else cart.push({ part_id: id, qty, reason_kind: p.consigned ? "ช่วยระบาย" : "ขอแบ่งซื้อ", reason: "", code: p.code, name: p.name, unit: p.unit, h: p.hospital_code, max: +p.available, mvs: p.mv_seller, mvb: p.mv_buyer, use3: p.use3_buyer });
    saveCart(); renderCart(); toast("ใส่ตะกร้าแล้ว");
  };
  function saveCart() { store.set("rs-xh-cart-" + H.id, JSON.stringify(cart)); badge("#nCart", cart.length); }
  function renderCart() {
    if (!cart.length || !opener()) { $("#sCart").innerHTML = opener() ? "" : '<div class="note">บัญชีนี้ดูได้อย่างเดียว เปิด Memo ขอซื้อได้เฉพาะ Admin / หัวหน้าช่าง / Chief</div>'; return; }
    const sellers = [...new Set(cart.map(c => c.h))];
    $("#sCart").innerHTML = `<div class="panel" style="margin-bottom:14px"><h3>ตะกร้า ${cart.length} รายการ จาก ${sellers.length} โรง${sellers.length > 1 ? " (ระบบแยกเป็นใบละ 1 โรงผู้ขายให้เอง)" : ""}</h3>
      <div class="scroll"><table class="lines"><tr><th>ผู้ขาย</th><th>รายการ</th><th>จำนวน</th><th>เหตุผล</th><th>รายละเอียดเหตุผล</th><th></th></tr>
      ${cart.map((c, i) => `<tr><td>${esc(c.h)}</td><td><b>${esc(c.name)}</b><div class="meta">${esc(c.code)} · ผู้ขาย ${mv(c.mvs)} เรา ${mv(c.mvb)} · ใช้ 3 เดือน ${n(c.use3)}</div></td>
        <td><input type="number" min="1" max="${c.max}" step="any" value="${c.qty}" data-ci="${i}" data-cf="qty"> ${esc(c.unit)}</td>
        <td><select data-ci="${i}" data-cf="reason_kind">${REASONS.map(r => `<option${r === c.reason_kind ? " selected" : ""}>${r}</option>`).join("")}</select></td>
        <td><input type="text" value="${esc(c.reason || "")}" data-ci="${i}" data-cf="reason" placeholder="${c.reason_kind === "อื่น ๆ" ? "ต้องพิมพ์" : "ถ้ามี"}"></td>
        <td><button class="btn small" type="button" data-cdel="${i}">ลบ</button></td></tr>`).join("")}</table></div>
      <label style="margin-top:8px">เหตุผลขอซื้อ (ขึ้นใน Memo)<textarea id="cReason" rows="2">ขอซื้ออะไหล่จากสต็อกของโรงพยาบาลในเครือ เพื่อช่วยระบายของค้างและลดการสั่งซื้อใหม่</textarea></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="cSend">ส่ง Memo ขอซื้อ</button><button class="btn" type="button" id="cClear">ล้างตะกร้า</button></div><div id="cMsg"></div></div>`;
  }
  $("#sCart").onchange = ev => {
    const i = ev.target.dataset.ci; if (i == null) return;
    const f = ev.target.dataset.cf; cart[i][f] = f === "qty" ? Math.max(0, Math.min(cart[i].max, +ev.target.value || 0)) : ev.target.value;
    saveCart(); if (f !== "reason") renderCart();
  };
  $("#sCart").onclick = async ev => {
    if (ev.target.dataset.cdel != null) { cart.splice(+ev.target.dataset.cdel, 1); saveCart(); return renderCart(); }
    if (ev.target.id === "cClear") { cart = []; saveCart(); return renderCart(); }
    if (ev.target.id !== "cSend") return;
    if (cart.some(c => !(c.qty > 0))) return bad("#cMsg", "ใส่จำนวนทุกบรรทัด");
    if (cart.some(c => c.reason_kind === "อื่น ๆ" && !String(c.reason || "").trim())) return bad("#cMsg", 'เหตุผล "อื่น ๆ" ต้องพิมพ์รายละเอียด');
    ev.target.disabled = true;
    const { data, error } = await sb.rpc("xh_create", { p_items: cart.map(c => ({ part_id: c.part_id, qty: c.qty, reason_kind: c.reason_kind, reason: c.reason })), p_reason: $("#cReason").value });
    if (error) { ev.target.disabled = false; return bad("#cMsg", error); }
    cart = []; saveCart(); toast("ส่ง Memo แล้ว: " + (data || []).join(", ")); await loadOrders(); $("#oFilter").value = "open"; show("orders");
  };

  /* ---------- consignment ---------- */
  async function renderMine() {
    const { data, error } = await sb.rpc("xh_my_parts");
    if (error) { $("#mListed").innerHTML = `<tr><td class="note bad">${esc(errText(error))}</td></tr>`; return; }
    mine = data || [];
    const row = (p, listed) => `<tr><td><b>${esc(p.name)}</b><div class="meta mono">${esc(p.code)}</div></td><td>${n(p.qty)} ${esc(p.unit)}</td><td>${mv(p.mv)}</td><td>${n(p.use3)}</td><td>${p.cover_months == null ? "ไม่ถูกเบิก" : n(p.cover_months) + " เดือน"}</td>
      ${chief() ? `<td><input type="number" min="0" max="${p.qty}" step="any" value="${listed ? p.listed : p.suggest ?? ""}" data-lq="${p.part_id}" style="width:80px" aria-label="จำนวนฝากขาย"></td>
      <td><input type="date" value="${p.warranty_until || ""}" data-lw="${p.part_id}" aria-label="วันหมดประกัน"></td><td><input type="text" value="${esc(p.listing_reason || "")}" data-lr="${p.part_id}" placeholder="เหตุผล" style="min-width:110px"></td>
      <td style="white-space:nowrap"><button class="btn small primary" type="button" data-list="${p.part_id}">${listed ? "บันทึก" : "ฝากขาย"}</button>${listed ? ` <button class="btn small" type="button" data-unlist="${p.part_id}">ปิดฝากขาย</button>` : ""}</td>`
      : `<td>${listed ? n(p.listed) : "–"}</td><td>${esc(p.warranty_until || "")}</td><td>${esc(p.listing_reason || "")}</td><td></td>`}</tr>`;
    const head = "<tr><th>รายการ</th><th>คงเหลือ</th><th>Movement</th><th>ใช้ 3 เดือน</th><th>พอใช้</th><th>ฝากขาย</th><th>หมดประกัน</th><th>เหตุผล</th><th></th></tr>";
    const a = mine.filter(p => p.listing_id), b = mine.filter(p => !p.listing_id && p.suggest > 0);
    $("#mListed").innerHTML = a.length ? head + a.map(p => row(p, true)).join("") : '<tr><td class="empty">ยังไม่ได้ฝากขายรายการใด</td></tr>';
    $("#mSuggest").innerHTML = b.length ? head + b.map(p => row(p, false)).join("") : '<tr><td class="empty">ไม่มีของค้างที่ควรฝากขายตอนนี้</td></tr>';
  }
  $("#tab-mine").onclick = async ev => {
    const id = ev.target.dataset.list || ev.target.dataset.unlist; if (!id) return;
    const qty = ev.target.dataset.unlist ? 0 : +document.querySelector(`[data-lq="${id}"]`).value;
    if (ev.target.dataset.list && !(qty > 0)) return toast("ใส่จำนวนที่จะฝากขาย");
    ev.target.disabled = true;
    const { error } = await sb.rpc("xh_list", { p_part: id, p_qty: qty, p_warranty: document.querySelector(`[data-lw="${id}"]`).value || null, p_reason: document.querySelector(`[data-lr="${id}"]`).value });
    if (error) { ev.target.disabled = false; return toast(errText(error)); }
    toast(qty ? "ฝากขายแล้ว" : "ปิดฝากขายแล้ว"); renderMine();
  };

  /* ---------- orders ---------- */
  $("#oFilter").onchange = () => { cur = null; renderOrders(); };
  $("#oCsv").onclick = () => csv(`ทะเบียนคุม-XH-${H.code}.csv`, ["เลขที่ใบ", "วันที่", "ผู้ซื้อ", "ผู้ขาย", "สถานะ", "รอบ", "รหัส", "รายการ", "หน่วย", "ขอซื้อ", "ผู้ขายให้", "ส่วนกลางอนุมัติ", "นับผู้ขาย", "นับผู้ซื้อ", "เหตุผล", "Movement ผู้ขาย", "Movement ผู้ซื้อ"],
    orders.flatMap(o => o.xh_items.map(i => [o.doc_no, fmt(o.created_at), hCode(o.buyer_hospital), hCode(o.seller_hospital), ST[o.status], o.round_no || "", i.code, i.name, i.unit, i.qty_req, i.qty_seller ?? "", i.qty_central ?? "", i.count_seller ?? "", i.count_buyer ?? "", i.reason_kind + (i.reason ? " — " + i.reason : ""), i.mv_seller || "", i.mv_buyer || ""])));
  function renderOrders() {
    $("#oDetail").innerHTML = "";
    const f = $("#oFilter").value;
    const l = orders.filter(o => f === "todo" ? todo(o) : f === "open" ? !["done", "rejected", "cancelled"].includes(o.status) : f === "count" ? needSellerCount(o) || needBuyerCount(o) : true);
    $("#oList").hidden = false;
    $("#oList").innerHTML = l.map(o => `<button type="button" class="job" data-o="${o.id}" style="text-align:left;font:inherit;color:inherit;cursor:pointer"><div class="row" style="justify-content:space-between"><b class="mono">${esc(o.doc_no)}</b><span class="pill">${ST[o.status]}</span></div>
      <div class="meta">${buyer(o) ? "เราซื้อจาก " + esc(hName(o.seller_hospital)) : seller(o) ? "เราขายให้ " + esc(hName(o.buyer_hospital)) : esc(hCode(o.buyer_hospital)) + " ซื้อจาก " + esc(hCode(o.seller_hospital))} · ${o.xh_items.length} รายการ · ${fmt(o.created_at)}${todo(o) ? ' · <b style="color:var(--accent)">รอคุณ</b>' : ""}</div></button>`).join("")
      || '<div class="empty">ไม่มีใบในกลุ่มนี้</div>';
  }
  $("#oList").onclick = ev => { const b = ev.target.closest("[data-o]"); if (b) openOrder(b.dataset.o); };
  async function openOrder(id) {
    cur = orders.find(o => o.id === id); if (!cur) return;
    const o = cur, pp = await sb.rpc("xh_people", { p_order: id }); o.people = pp.data || [];
    const who = pid => (o.people.find(p => p.id === pid) || {}).full_name || "";
    const step = STEP_OF[o.status] || 0, dead = ["rejected", "cancelled"].includes(o.status);
    const mode = o.status === "memo_ok" && seller(o) && chief() ? "seller" : opener() && needSellerCount(o) ? "count_seller" : opener() && needBuyerCount(o) ? "count_buyer" : "";
    const lines = o.xh_items.filter(i => !mode.startsWith("count") || i.qty_central > 0);
    const acts = [];
    if (o.status === "memo" && buyer(o) && chief()) acts.push(o.created_by === me.id ? '<span class="meta">ผู้อนุมัติ Memo ต้องไม่ใช่คนเปิดใบ</span>' : '<button class="btn primary" data-act="memo_ok">อนุมัติ Memo</button><button class="btn" data-act="memo_no">ไม่อนุมัติ</button>');
    if (mode === "seller") acts.push('<button class="btn primary" data-act="seller">ยืนยันจำนวนที่ให้ได้</button><button class="btn" data-act="seller_no">ปฏิเสธทั้งใบ</button>');
    if (o.status === "central_ok" && seller(o) && chief()) acts.push('<button class="btn primary" data-act="ship">ส่งของ (ออกใบรับ/ส่งสินค้า)</button><button class="btn" data-act="reject_ship">ของไม่พอ ปฏิเสธใบ</button>');
    if (o.status === "shipped" && buyer(o) && opener()) acts.push('<button class="btn primary" data-act="receive">รับของแล้ว</button>');
    if (mode === "count_seller") acts.push('<button class="btn primary" data-act="count_seller">ยืนยันตรวจนับ · ตัดสต็อกเรา</button>');
    if (mode === "count_buyer") acts.push('<button class="btn primary" data-act="count_buyer">ยืนยันตรวจนับ · เข้าสต็อกเรา</button>');
    if (buyer(o) && opener() && ["memo", "memo_ok", "seller_ok", "central_ok"].includes(o.status)) acts.push('<button class="btn" data-act="cancel">ยกเลิกใบ</button>');
    $("#oList").hidden = true;
    $("#oDetail").innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0" class="mono">${esc(o.doc_no)}</h3><button class="btn small" type="button" id="oBack">← กลับรายการ</button></div>
      <div class="meta">ผู้ซื้อ ${esc(hName(o.buyer_hospital))} · ผู้ขาย ${esc(hName(o.seller_hospital))} · <b>${ST[o.status]}</b>${o.round_no ? " · รอบ " + esc(o.round_no) : ""}</div>
      ${dead ? `<div class="note bad">${esc(o.reject_note || ST[o.status])}${who(o.rejected_by) ? " · " + esc(who(o.rejected_by)) : ""}</div>` : `<div class="flow">${FLOW.map((t, i) => `<span class="${i < step ? "done" : i === step ? "now" : ""}">${i + 1} ${t}</span>`).join("")}</div>`}
      ${o.reason ? `<p class="sub">เหตุผล: ${esc(o.reason)}</p>` : ""}
      <div class="scroll"><table class="lines"><tr><th>#</th><th>รายการ</th><th>ขอซื้อ</th><th>ผู้ขายให้</th><th>ส่วนกลาง</th><th>นับผู้ขาย</th><th>นับผู้ซื้อ</th>${mode.startsWith("count") ? "<th>นับจริง</th><th>หมายเหตุ (ถ้าไม่ตรง)</th>" : ""}</tr>
      ${lines.map(i => `<tr><td>${i.line}</td><td><b>${esc(i.name)}</b><div class="meta">${esc(i.code)} · ${esc(i.reason_kind)}${i.reason ? " — " + esc(i.reason) : ""}</div><div class="meta">ผู้ขาย ${mv(i.mv_seller)} ผู้ซื้อ ${mv(i.mv_buyer)} · ผู้ซื้อใช้ 3 เดือน ${n(i.use3_buyer)}</div></td>
        <td>${n(i.qty_req)} ${esc(i.unit)}</td><td>${mode === "seller" ? `<input type="number" min="0" max="${i.qty_req}" step="any" value="${i.qty_req}" data-lq="${i.id}">` : n(i.qty_seller)}</td>
        <td>${i.central_ok == null ? "–" : i.central_ok ? n(i.qty_central) : '<b style="color:var(--bad)">ไม่อนุมัติ</b>'}</td><td>${n(i.count_seller)}${i.note_seller ? `<div class="meta">${esc(i.note_seller)}</div>` : ""}</td><td>${n(i.count_buyer)}${i.note_buyer ? `<div class="meta">${esc(i.note_buyer)}</div>` : ""}</td>
        ${mode.startsWith("count") ? `<td><input type="number" min="0" step="any" value="${i.qty_central}" data-lc="${i.id}"></td><td><input type="text" data-ln="${i.id}"></td>` : ""}</tr>`).join("")}</table></div>
      ${mode === "seller" ? '<p class="sub">ใส่ 0 = ไม่ขายบรรทัดนั้น</p>' : ""}${mode.startsWith("count") ? '<p class="sub">สต็อกในระบบเปลี่ยนเมื่อกดยืนยันตรวจนับเท่านั้น</p>' : ""}
      <div class="row" style="margin-top:10px">${acts.join("")}</div><div id="oMsg"></div>
      <div class="row" style="margin-top:12px"><button class="btn small" type="button" data-doc="memo">① Memo ขอซื้อ</button>${o.central_at && !dead ? '<button class="btn small" type="button" data-doc="po">② ใบจัดซื้อ</button>' : ""}${o.shipped_at ? '<button class="btn small" type="button" data-doc="dn">③ ใบรับ/ส่งสินค้า</button>' : ""}</div>
      <div class="meta" style="margin-top:8px">${[["เปิดใบ", o.created_by, o.created_at], ["อนุมัติ Memo", o.memo_by, o.memo_at], ["ผู้ขายยืนยัน", o.seller_by, o.seller_at], ["ส่วนกลาง", o.central_by, o.central_at], ["ส่งของ", o.shipped_by, o.shipped_at], ["รับของ", o.received_by, o.received_at], ["นับฝั่งผู้ขาย", o.seller_count_by, o.seller_count_at], ["นับฝั่งผู้ซื้อ", o.buyer_count_by, o.buyer_count_at]]
        .filter(x => x[2]).map(x => `${x[0]}: ${esc(who(x[1]))} ${fmt(x[2])}`).join(" · ")}</div></div>`;
  }
  $("#oDetail").onclick = async ev => {
    if (ev.target.id === "oBack") { cur = null; return renderOrders(); }
    if (ev.target.dataset.doc) return printDoc(cur, ev.target.dataset.doc);
    const act = ev.target.dataset.act; if (!act) return;
    const o = cur; let lines = [], note = null;
    if (act === "seller") lines = o.xh_items.map(i => ({ id: i.id, qty: +document.querySelector(`[data-lq="${i.id}"]`).value || 0 }));
    if (act.startsWith("count")) {
      lines = o.xh_items.filter(i => i.qty_central > 0).map(i => ({ id: i.id, count: document.querySelector(`[data-lc="${i.id}"]`).value, note: document.querySelector(`[data-ln="${i.id}"]`).value }));
      const miss = o.xh_items.find(i => { const l = lines.find(x => x.id === i.id); return l && (l.count === "" || (+l.count !== +i.qty_central && !l.note.trim())); });
      if (miss) return bad("#oMsg", `${miss.name}: ใส่จำนวนนับจริง และถ้าไม่ตรงเอกสารต้องใส่หมายเหตุ`);
      lines.forEach(l => l.count = +l.count);
    }
    if (["memo_no", "seller_no", "reject_ship", "cancel"].includes(act)) {
      if (ev.target.dataset.sure !== "1") { ev.target.dataset.sure = "1"; ev.target.textContent = "กดอีกครั้งเพื่อยืนยัน"; return; }
      note = { memo_no: "ไม่อนุมัติ Memo", seller_no: "ผู้ขายปฏิเสธทั้งใบ", reject_ship: "ของไม่พอส่ง", cancel: "ผู้ซื้อยกเลิก" }[act];
    }
    ev.target.disabled = true;
    const { error } = await sb.rpc("xh_step", { p_order: o.id, p_step: act, p_lines: lines, p_note: note });
    if (error) { ev.target.disabled = false; return bad("#oMsg", error); }
    toast("บันทึกแล้ว"); await loadOrders(); openOrder(o.id);
  };

  /* ---------- documents (no prices) ---------- */
  function printDoc(o, kind) {
    const who = pid => (o.people || []).find(p => p.id === pid) || {}, nm = pid => esc(who(pid).full_name || "..........................");
    const at = t => t ? new Date(t).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }) : "";
    const sign = (label, pid, t) => `<div>${label}<br>( ${nm(pid)} )<br>${at(t)}</div>`;
    const B = esc(hName(o.buyer_hospital)), S = esc(hName(o.seller_hospital)), its = o.xh_items;
    let h = "";
    if (kind === "memo") h = `<h2>MEMO — ขอซื้ออะไหล่ข้ามโรงพยาบาล</h2><p>เลขที่ ${esc(o.doc_no)} · วันที่ ${thDate(o.created_at)}</p>
      <table><tr><th style="width:90px">เรื่อง</th><td>ขอซื้ออะไหล่จาก${S} จำนวน ${its.length} รายการ</td></tr><tr><th>เรียน</th><td>ผู้อนุมัติ แผนกวิศวกรรม ${B}</td></tr><tr><th>จาก</th><td>${nm(o.created_by)} — แผนกวิศวกรรม ${B}</td></tr><tr><th>ผู้ขาย</th><td>${S}</td></tr></table>
      <p><b>หลักการและเหตุผล</b> ${esc(o.reason || "-")}</p>
      <table><tr><th>ที่</th><th>รหัส</th><th>รายการ</th><th>จำนวน</th><th>หน่วย</th></tr>${its.map(i => `<tr><td>${i.line}</td><td>${esc(i.code)}</td><td>${esc(i.name)}<br><small>เหตุผล: ${esc(i.reason_kind)}${i.reason ? " — " + esc(i.reason) : ""} · ผู้ขาย ${i.mv_seller || "-"} · เรา ${i.mv_buyer || "ไม่มีในสต็อก"} · เราใช้ 3 เดือน ${n(i.use3_buyer)}</small></td><td>${n(i.qty_req)}</td><td>${esc(i.unit)}</td></tr>`).join("")}
      <tr><td colspan="3" style="text-align:right">รวม ${its.length} รายการ</td><td>${n(its.reduce((s, i) => s + +i.qty_req, 0))}</td><td></td></tr></table>
      <p>ผู้ขายยืนยันจำนวนที่ให้ได้ → ส่วนกลางอนุมัติเป็นรอบ → ออกใบจัดซื้อ · เอกสารนี้ไม่มีราคา</p>
      <div class="signs">${sign("ผู้ขอซื้อ", o.created_by, o.created_at)}${sign("ผู้อนุมัติ", o.memo_by, o.memo_at)}</div>`;
    if (kind === "po") h = `<h2>ใบจัดซื้ออะไหล่ข้ามโรงพยาบาล</h2><p>เลขที่ ${esc(o.doc_no)} · วันที่ ${thDate(o.central_at)}${o.round_no ? " · รอบ " + esc(o.round_no) : ""}</p>
      <table><tr><th style="width:90px">ผู้ซื้อ</th><td>${B} — แผนกวิศวกรรม</td></tr><tr><th>ผู้ขาย</th><td>${S} — แผนกวิศวกรรม</td></tr><tr><th>อ้างถึง</th><td>Memo ขอซื้อเลขที่ ${esc(o.doc_no)} ลงวันที่ ${thDate(o.created_at)}</td></tr></table>
      <table><tr><th>ที่</th><th>รหัส</th><th>รายการ</th><th>ขอซื้อ</th><th>จัดซื้อ</th><th>ผลส่วนกลาง</th></tr>${its.map(i => `<tr><td>${i.line}</td><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td>${n(i.qty_req)}</td><td>${n(i.qty_central)}</td><td>${i.central_ok ? "อนุมัติ" : "ไม่อนุมัติ"}</td></tr>`).join("")}
      <tr><td colspan="4" style="text-align:right">รวม ${its.length} รายการ</td><td>${n(its.reduce((s, i) => s + +(i.qty_central || 0), 0))}</td><td></td></tr></table>
      <p>หมายเหตุ: เอกสารนี้ไม่มีราคา — ฝ่ายจัดซื้อเป็นผู้กำหนดราคาและดำเนินการชำระเงินระหว่างโรงพยาบาล</p><p>ส่วนกลางอนุมัติโดย ${nm(o.central_by)} เมื่อ ${at(o.central_at)}</p>
      <div class="signs">${sign("ผู้ขอซื้อ", o.created_by, o.created_at)}${sign("ผู้อนุมัติ (ผู้ซื้อ)", o.memo_by, o.memo_at)}${sign("ผู้ยืนยันจำนวน (ผู้ขาย)", o.seller_by, o.seller_at)}${sign("ส่วนกลาง", o.central_by, o.central_at)}</div>`;
    if (kind === "dn") h = `<h2>ใบรับ/ส่งสินค้า (อะไหล่ข้ามโรงพยาบาล)</h2><p>เลขที่ ${esc(o.doc_no)} · วันที่ ${thDate(o.shipped_at)}</p>
      <table><tr><th style="width:90px">ผู้ส่ง</th><td>${S} — แผนกวิศวกรรม</td></tr><tr><th>ผู้รับ</th><td>${B} — แผนกวิศวกรรม</td></tr><tr><th>อ้างถึง</th><td>ใบจัดซื้อเลขที่ ${esc(o.doc_no)}</td></tr></table>
      <table><tr><th>ที่</th><th>รหัส</th><th>รายการ</th><th>จำนวนส่ง</th><th>นับจริง ผู้ขาย</th><th>นับจริง ผู้ซื้อ</th><th>หมายเหตุ</th></tr>${its.filter(i => i.qty_central > 0).map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td>${n(i.qty_central)}</td><td>${i.count_seller == null ? "" : n(i.count_seller)}</td><td>${i.count_buyer == null ? "" : n(i.count_buyer)}</td><td>${esc([i.note_seller, i.note_buyer].filter(Boolean).join(" / "))}</td></tr>`).join("")}</table>
      <p>ผู้รับตรวจนับและสภาพสินค้าแล้วจึงลงชื่อ · สต็อกในระบบเปลี่ยนเมื่อแต่ละฝั่งยืนยันตรวจนับ</p>
      <div class="signs">${sign("ผู้ส่งของ", o.shipped_by, o.shipped_at)}${sign("ผู้รับของ", o.received_by, o.received_at)}</div>`;
    doPrint(h);
  }
  function doPrint(h) {
    $("#mDoc").innerHTML = `<div class="doc"><p style="text-align:center;margin:0"><b>บริษัท เทคนิคอล วอเตอร์ จำกัด</b><br>TECHNICAL WATER CO., LTD.</p>${h}</div>`;
    document.body.classList.add("docprint");
    const off = () => { document.body.classList.remove("docprint"); window.removeEventListener("afterprint", off); };
    window.addEventListener("afterprint", off);
    setTimeout(() => window.print(), 50);
  }

  /* ---------- dashboard ---------- */
  let dash = [];
  $("#dQ").oninput = () => renderDashParts();
  $("#dCsv").onclick = () => csv(`อะไหล่รายตัว-${H.code}.csv`, ["รหัส", "รายการ", "หน่วย", "คงเหลือ", "Movement", "ใช้ 3 เดือน", "พอใช้ (เดือน)", "ฝากขาย"], dashParts().map(p => [p.code, p.name, p.unit, p.qty, p.mv, p.use3, p.cover_months ?? "", p.listed ?? ""]));
  const dashParts = () => { const q = $("#dQ").value.trim().toLowerCase(); return mine.filter(p => (!mvFilter || p.mv === mvFilter) && (!q || (p.code + " " + p.name).toLowerCase().includes(q))); };
  async function renderDash() {
    const [d, m] = await Promise.all([sb.rpc("xh_dashboard"), sb.rpc("xh_my_parts")]);
    dash = d.data || []; mine = m.data || [];
    const my = dash.find(x => x.hospital_id === H.id) || {}, stuck = +(my.slow_v || 0) + +(my.non_v || 0), all = stuck + +(my.fast_v || 0) + +(my.normal_v || 0) + +(my.new_v || 0);
    $("#dKpi").innerHTML = [["ฝากขายอยู่ (รายการ)", n(my.listed_n || 0)], ["ฝากขายอยู่ (ชิ้น)", n(my.listed_qty || 0)], ["ใบที่เรากำลังซื้อ", n(my.buying || 0)], ["ใบที่เรากำลังขาย", n(my.selling || 0)], ["ตรวจนับค้าง", n(my.count_wait || 0)], ["มูลค่าของค้าง SLOW+NON", n(stuck)]]
      .map(([a, b]) => `<div class="kpi"><b>${b}</b><span>${a}</span></div>`).join("");
    const bar = x => { const t = +x.fast_v + +x.normal_v + +x.slow_v + +x.non_v + +x.new_v || 1; return `<div class="bar" title="FAST / NORMAL / SLOW / NON MOVE / ของใหม่">${[["fast_v", "#3dbb6b"], ["normal_v", "#5b9bf0"], ["slow_v", "#f0c23b"], ["non_v", "#e5584f"], ["new_v", "#aaa"]].map(([k, c]) => `<i style="width:${100 * x[k] / t}%;background:${c}"></i>`).join("")}</div>`; };
    $("#dAll").innerHTML = dash.length > 1
      ? `<h3>เทียบทุกโรง (มุมมองส่วนกลาง)</h3><div class="scroll"><table><tr><th>โรง</th><th>รายการ</th><th style="min-width:140px">สุขภาพสต็อก</th><th>FAST</th><th>NORMAL</th><th>SLOW</th><th>NON MOVE</th><th>% ของค้าง</th><th>ฝากขาย</th><th>ซื้อ / ขาย</th><th>นับค้าง</th></tr>
        ${dash.map(x => { const t = +x.fast_v + +x.normal_v + +x.slow_v + +x.non_v + +x.new_v; return `<tr><td><b>${esc(x.code)}</b></td><td>${n(x.items)}</td><td>${bar(x)}</td><td>${n(x.fast_v)}</td><td>${n(x.normal_v)}</td><td>${n(x.slow_v)}</td><td>${n(x.non_v)}</td><td>${t ? Math.round(100 * (+x.slow_v + +x.non_v) / t) + "%" : "–"}</td><td>${n(x.listed_n)}</td><td>${n(x.buying)} / ${n(x.selling)}</td><td>${n(x.count_wait)}</td></tr>`; }).join("")}</table></div>`
      : `<h3>สุขภาพสต็อกของโรงเรา</h3>${bar({ fast_v: my.fast_v || 0, normal_v: my.normal_v || 0, slow_v: my.slow_v || 0, non_v: my.non_v || 0, new_v: my.new_v || 0 })}<p class="sub">มูลค่าในคลัง ${n(all)} (คงเหลือ × ราคาในสต็อกของโรงเรา) · เขียว FAST · ฟ้า NORMAL · เหลือง SLOW · แดง NON MOVE ยิ่งส่วนเหลือง/แดงยาว เงินจมในของค้างมาก</p>`;
    renderDashParts();
    $("#dHints").innerHTML = "";
    if (isCentral()) {
      const h = await sb.rpc("xh_transfer_hints");
      $("#dHints").innerHTML = `<h3 style="margin-top:16px">แนะนำโอน (สเปคเดียวกันข้ามโรง)</h3><p class="sub">จากโรงที่ของค้าง (เหลือไว้ใช้เอง 3 เดือน) ไปโรงที่ใช้เร็วและของพอใช้ไม่ถึง 1.5 เดือน · เป็นข้อเสนอ การโอนจริงยังเดินตามขั้นตอนเดิม</p>
        <div class="scroll"><table><tr><th>สเปค</th><th>จาก</th><th>สถานะ</th><th>คงเหลือ</th><th>โอนได้</th><th>ไป</th><th>ใช้/เดือน</th><th>พอใช้</th></tr>${(h.data || []).map(x => `<tr><td>${esc(x.spec)}</td><td>${esc(x.from_code)}</td><td>${mv(x.from_mv)}</td><td>${n(x.from_qty)}</td><td><b>${n(x.can_give)}</b></td><td>${esc(x.to_code)} ${mv(x.to_mv)}</td><td>${n(x.to_use_month)}</td><td>${n(x.to_cover)} เดือน</td></tr>`).join("") || '<tr><td colspan="8" class="empty">ยังไม่มีคู่ที่ควรโอน</td></tr>'}</table></div>`;
    }
  }
  function renderDashParts() {
    const cnt = k => mine.filter(p => p.mv === k).length;
    $("#dChips").innerHTML = [["", "ทั้งหมด " + mine.length], ...["FAST", "NORMAL", "SLOW", "NON MOVE", "NEW"].map(k => [k, `${k === "NEW" ? "ของใหม่" : k} ${cnt(k)}`])].map(([k, t]) => `<button type="button" class="chip${mvFilter === k ? " on" : ""}" data-mv="${k}">${t}</button>`).join("");
    $("#dParts").innerHTML = `<tr><th>รหัส</th><th>รายการ</th><th>คงเหลือ</th><th>Movement</th><th>ใช้ 3 เดือน</th><th>พอใช้</th><th>ฝากขาย</th></tr>` + (dashParts().slice(0, 500).map(p => `<tr><td class="mono">${esc(p.code)}</td><td>${esc(p.name)}</td><td>${n(p.qty)} ${esc(p.unit)}</td><td>${mv(p.mv)}</td><td>${n(p.use3)}</td><td>${p.cover_months == null ? "–" : n(p.cover_months) + " เดือน"}</td><td>${p.listed ? n(p.listed) : ""}</td></tr>`).join("") || '<tr><td colspan="7" class="empty">ไม่มีรายการ</td></tr>');
  }
  $("#dChips").onclick = ev => { if (ev.target.dataset.mv == null) return; mvFilter = ev.target.dataset.mv; renderDashParts(); };

  /* ---------- central rounds ---------- */
  let rounds = [];
  async function renderCentral() {
    await loadOrders();
    const r = await sb.from("xh_rounds").select("*").order("created_at", { ascending: false }); rounds = r.data || [];
    const wait = orders.filter(o => o.status === "seller_ok" && !o.round_id);
    $("#cWait").innerHTML = `<div class="panel"><b>ใบที่ผู้ขายยืนยันแล้ว รอเข้ารอบ: ${wait.length} ใบ</b> ${wait.map(o => `<span class="pill">${esc(o.doc_no)}</span>`).join(" ")}
      ${central.can_account && wait.length ? '<div class="row" style="margin-top:8px"><button class="btn primary" type="button" id="cNew">จัดรอบใหม่</button></div>' : ""}<div id="cWaitMsg"></div></div>`;
    $("#cRounds").innerHTML = `<tr><th>รอบ</th><th>วันที่จัด</th><th>จำนวนใบ</th><th>สถานะ</th><th></th></tr>` + (rounds.map(x => `<tr><td class="mono">${esc(x.round_no)}</td><td>${fmt(x.created_at)}</td><td>${orders.filter(o => o.round_id === x.id).length}</td><td>${x.status === "open" ? "<b>รออนุมัติ</b>" : "ตัดสินแล้ว " + fmt(x.decided_at) + (x.paper ? " (กระดาษ · " + esc(x.signer_name || "") + ")" : "")}</td><td><button class="btn small" type="button" data-round="${x.id}">เปิด</button></td></tr>`).join("") || '<tr><td colspan="5" class="empty">ยังไม่มีรอบ</td></tr>');
    $("#cPeople").innerHTML = role() === "owner" ? `<p class="sub">ผู้อนุมัติส่วนกลางและบัญชีส่วนกลาง กำหนดโดย Owner · ตอนนี้บัญชีของคุณ: ${central.can_approve ? "อนุมัติรอบได้" : "อนุมัติรอบไม่ได้"} · ${central.can_account ? "จัดรอบได้" : "จัดรอบไม่ได้"}</p>` : "";
    if (curRound) openRound(curRound);
  }
  $("#tab-central").onclick = async ev => {
    if (ev.target.id === "cNew") {
      ev.target.disabled = true; const { data, error } = await sb.rpc("xh_round_create");
      if (error) { ev.target.disabled = false; return bad("#cWaitMsg", error); }
      toast("จัดรอบ " + data + " แล้ว"); return renderCentral();
    }
    if (ev.target.dataset.round) return openRound(ev.target.dataset.round);
    if (ev.target.id === "rPrint") return printRound();
    if (ev.target.id === "rOk" || ev.target.id === "rPaper") {
      const paper = ev.target.id === "rPaper", lines = [...document.querySelectorAll("[data-rk]")].map(c => ({ id: c.dataset.rk, ok: c.checked }));
      let scan = null;
      if (paper) {
        const f = $("#rScan").files[0];
        if (!$("#rSigner").value.trim() || !f) return bad("#rMsg", "ใส่ชื่อผู้เซ็นและแนบไฟล์สแกนแบบฟอร์ม");
        ev.target.disabled = true;
        scan = `XH/${curRound}/${crypto.randomUUID()}.${(f.name.split(".").pop() || "pdf").toLowerCase()}`;
        const up = await sb.storage.from("docs").upload(scan, f, { contentType: f.type || undefined });
        if (up.error) { ev.target.disabled = false; return bad("#rMsg", up.error); }
      }
      ev.target.disabled = true;
      const { error } = await sb.rpc("xh_round_decide", { p_round: curRound, p_lines: lines, p_paper: paper, p_signer: paper ? $("#rSigner").value : null, p_scan: scan, p_note: $("#rNote").value });
      if (error) { ev.target.disabled = false; return bad("#rMsg", error); }
      toast("บันทึกผลอนุมัติแล้ว"); renderCentral();
    }
  };
  const roundLines = id => orders.filter(o => o.round_id === id).flatMap(o => o.xh_items.map(i => ({ o, i })));
  function openRound(id) {
    curRound = id; const rd = rounds.find(x => x.id === id); if (!rd) return;
    const ls = roundLines(id), open = rd.status === "open";
    $("#cRound").innerHTML = `<div class="panel" style="margin-top:12px"><div class="row" style="justify-content:space-between"><h3 style="margin:0">รอบ ${esc(rd.round_no)}</h3><button class="btn small" type="button" id="rPrint">พิมพ์แบบฟอร์มรอบอนุมัติ</button></div>
      <div class="scroll"><table><tr><th>${open ? "อนุมัติ" : "ผล"}</th><th>เลขที่ใบ</th><th>ผู้ซื้อ</th><th>ผู้ขาย</th><th>รายการ</th><th>จำนวน</th><th>เหตุผล</th><th>Movement ผู้ขาย / ผู้ซื้อ</th><th>ผู้ซื้อใช้ 3 เดือน</th></tr>
      ${ls.map(({ o, i }) => `<tr><td>${open ? (i.qty_seller > 0 ? `<input type="checkbox" checked data-rk="${i.id}" aria-label="อนุมัติ ${esc(i.name)}">` : "ผู้ขายไม่ให้") : i.central_ok ? "อนุมัติ" : '<b style="color:var(--bad)">ไม่อนุมัติ</b>'}</td><td class="mono">${esc(o.doc_no)}</td><td>${esc(hCode(o.buyer_hospital))}</td><td>${esc(hCode(o.seller_hospital))}</td>
        <td>${esc(i.name)}<div class="meta">${esc(i.code)}</div></td><td>${n(i.qty_seller)} ${esc(i.unit)}</td><td>${esc(i.reason_kind)}${i.reason ? " — " + esc(i.reason) : ""}</td><td>${mv(i.mv_seller)} / ${mv(i.mv_buyer)}</td><td>${n(i.use3_buyer)}</td></tr>`).join("")}</table></div>
      ${open ? `<label style="margin-top:8px">หมายเหตุ<input id="rNote"></label>
        ${central.can_approve ? '<div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="rOk">ยืนยันผลอนุมัติ (ติ๊กออก = ไม่อนุมัติบรรทัดนั้น)</button></div>' : ""}
        ${central.can_account ? `<details style="margin-top:12px"><summary>ทางสำรอง: บันทึกผลจากแบบฟอร์มที่เซ็นบนกระดาษ</summary><div class="grid" style="margin-top:8px"><label>ชื่อผู้เซ็นอนุมัติ<input id="rSigner"></label><label>ไฟล์สแกนแบบฟอร์ม (บังคับ)<input id="rScan" type="file" accept=".pdf,image/*"></label></div><div class="row" style="margin-top:8px"><button class="btn" type="button" id="rPaper">บันทึกผลจากกระดาษ</button></div></details>` : ""}` : `<p class="sub">${rd.note ? "หมายเหตุ: " + esc(rd.note) : ""}</p>`}<div id="rMsg"></div></div>`;
  }
  function printRound() {
    const rd = rounds.find(x => x.id === curRound), ls = roundLines(curRound);
    doPrint(`<h2>แบบฟอร์มการขอซื้อ-ขายอะไหล่ระหว่างโรงพยาบาล</h2><p>รอบ ${esc(rd.round_no)} · จัดเมื่อ ${thDate(rd.created_at)}</p>
      <table><tr><th>No.</th><th>เลขที่ใบ</th><th>รหัส</th><th>รายการ</th><th>จำนวน</th><th>โรงที่ขอซื้อ</th><th>โรงที่ขาย</th><th>Movement ผู้ขาย / ผู้ซื้อ</th><th>เหตุผล</th><th>อนุมัติ / ไม่อนุมัติ</th></tr>
      ${ls.map(({ o, i }, k) => `<tr><td>${k + 1}</td><td>${esc(o.doc_no)}</td><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td>${n(i.qty_seller)}</td><td>${esc(hName(o.buyer_hospital))}</td><td>${esc(hName(o.seller_hospital))}</td><td>${i.mv_seller || "-"} / ${i.mv_buyer || "ไม่มีสต็อก"}</td><td>${esc(i.reason_kind)}</td><td>${i.central_ok == null ? "" : i.central_ok ? "อนุมัติ" : "ไม่อนุมัติ"}</td></tr>`).join("")}</table>
      <p>เอกสารนี้ไม่มีราคา — ฝ่ายจัดซื้อเป็นผู้กำหนดราคาและดำเนินการชำระเงินระหว่างโรงพยาบาล · Movement Status คำนวณจากประวัติเบิกจริงของแต่ละโรง ณ วันที่เปิดใบ</p>
      <div class="signs"><div>ผู้จัดทำ (ส่วนกลาง)<br>( .......................... )</div><div>ผู้ตรวจสอบ<br>( .......................... )</div><div>ผู้อนุมัติ<br>( ${esc(rd.signer_name || "..........................")} )</div></div>`);
  }
})();
