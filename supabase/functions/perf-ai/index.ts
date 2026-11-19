// Bi-Weekly Performance meeting: Action plan for each hospital's problems (backlog by age and cause, CM 24 h KPI, TOR items at risk),
// written by three AI roles in turn (Gemini when GEMINI_API_KEY is set, else Claude):
//   AI 1 (ผู้เสนอ) proposes RCA and a corrective plan, AI 2 (ผู้วิเคราะห์ทบทวน) analyses and reviews it,
//   AI 3 (ผู้ตรวจสอบแก้ไข) checks both; when it asks for changes AI 1 revises and AI 2 reviews again, round after round,
//   until AI 3 passes the work, then AI 3 writes the final report as structured JSON.
// The page drives the rounds one step per call (body.step = propose | review | check | report), so no call runs long.
// Each problem group gets an RCA: fishbone 4M (man, machine, method, material), 5 Why, root cause, a corrective project and steps.
// Secret: GEMINI_API_KEY (optional GEMINI_MODEL) or ANTHROPIC_API_KEY. The caller must be signed in and allowed to see the hospital.
// The page sends counts and open-job descriptions without the names of the staff responsible.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod";

const MODEL = "claude-opus-5-5";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Report = z.object({
  summary: z.string(),
  analysis: z.array(z.string()),
  items: z.array(z.object({
    code: z.string(), title: z.string(), tickets: z.array(z.string()).default([]),
    m4: z.object({ man: z.array(z.string()), machine: z.array(z.string()), method: z.array(z.string()), material: z.array(z.string()) }),
    why5: z.array(z.string()), root_cause: z.string(),
    project: z.object({ name: z.string(), goal: z.string(), budget: z.string() }),
    actions: z.array(z.object({ step: z.string(), owner: z.string(), due: z.string(), measure: z.string() })),
    expected_result: z.string(),
  })),
  timeline: z.array(z.object({ when: z.string(), activity: z.string() })),
  risks: z.array(z.string()),
  review_notes: z.array(z.string()),
  follow_up: z.array(z.string()),
});

const CONTEXT = `บริบท: บริษัทผู้รับจ้างงานบริหารวิศวกรรมอาคารของโรงพยาบาล ประชุม Bi-Weekly Performance ทุกวันเสาร์ 14:00-16:00 น. Chief Engineer ของแต่ละโรงส่งรายงานก่อน 10:00 น.
เป้าหมายองค์กร: คะแนน KPI ตามสัญญา (TOR แนบ 4) ไม่ต่ำกว่า 90, งานแจ้งซ่อม (CM) ดำเนินการภายใน 24 ชั่วโมง (ปิดจริง หรือส่ง PR/ขออนุมัติครบ) 100%, งานค้าง (Backlog) เป็นศูนย์ภายในสิ้นเดือนธันวาคม โดยงานค้างเกิน 60 วันต้องหมดก่อน, PM ตรงแผน ≥ 95%, MA ติดตามสัญญาครบ 100%
ผู้อ่านคือ GM งานบริหารวิศวกรรมอาคารและผู้บริหารโรงพยาบาล เขียนภาษาไทยที่อ่านง่าย กระชับ เป็นข้อ ๆ
ทุกวิธีแก้ต้องทำได้จริงในงานวิศวกรรมอาคารโรงพยาบาล มีผู้รับผิดชอบระดับตำแหน่ง (ไม่ใส่ชื่อคน) มีกำหนดเสร็จเป็นวันที่ และวัดผลได้ด้วยตัวเลข (จำนวนใบงานค้าง, % 24 ชม., คะแนน)
อย่าแต่งตัวเลขที่ไม่มีในข้อมูล ถ้าข้อมูลไม่พอ ให้บอกว่าต้องเก็บข้อมูลอะไรเพิ่ม
ใช้หลัก RCA ทุกกลุ่มปัญหา: ก้างปลา (Ishikawa) แยกสาเหตุตาม 4M คือ คน (Man) เครื่องจักร (Machine) วิธีการ (Method) วัสดุ/อะไหล่ (Material) แล้วถาม 5 Why จนถึงสาเหตุราก และตั้งเป็นโครงการแก้ไขที่มีชื่อ เป้าหมาย และงบประมาณ
แบ่งงานค้างเป็นกลุ่มปัญหาตามสาเหตุที่ค้าง (เช่น คน/เครื่องมือ/งบ, รออะไหล่, รอผู้รับเหมา, รออนุมัติ, เข้าพื้นที่ไม่ได้) และอายุงาน ใส่เลขใบงานที่เกี่ยวข้องใน tickets (ไม่เกิน 10 ใบต่อกลุ่ม เลือกใบที่ค้างนานที่สุด)
ใช้ร่างและข้อมูลที่ Chief กรอกไว้เป็นจุดเริ่ม
ต้องตอบให้เสร็จเร็ว: เขียนสั้น ไม่ทวนข้อมูลที่ให้มา ไม่เกิน 5 กลุ่มปัญหา (รวมกลุ่มเล็กเข้าด้วยกัน) แต่ละกลุ่มไม่เกิน 4 ขั้นตอนแก้ไข ข้อความ AI 1 และ AI 2 ไม่เกิน 600 คำ แผนเวลาไม่เกิน 6 แถว`;
const Check = z.object({ approved: z.boolean(), issues: z.array(z.string()), summary: z.string() });
const CHECK_SHAPE = `ตอบเป็น JSON อย่างเดียว รูปแบบ: {"approved":true,"issues":["สิ่งที่ต้องแก้ 1"],"summary":"สรุปผลการตรวจ 1-2 ประโยค"}
approved = true เมื่อไม่มีสิ่งที่ต้องแก้แล้วเท่านั้น ถ้า approved = false ต้องมี issues อย่างน้อย 1 ข้อ เขียนแต่ละข้อให้ AI 1 แก้ได้ทันที`;
const SHAPE = `ตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น รูปแบบ:
{"summary":"","analysis":[""],"items":[{"code":"","title":"","tickets":[""],"m4":{"man":[""],"machine":[""],"method":[""],"material":[""]},"why5":["ทำไม 1: ...","ทำไม 2: ..."],"root_cause":"","project":{"name":"","goal":"","budget":""},"actions":[{"step":"","owner":"","due":"","measure":""}],"expected_result":""}],"timeline":[{"when":"","activity":""}],"risks":[""],"review_notes":[""],"follow_up":[""]}
m4 แต่ละด้านไม่เกิน 4 สาเหตุ แต่ละสาเหตุสั้นไม่เกิน 25 ตัวอักษร`;
// Google retires model names over time, so the model is picked from the key's own model list when the preferred one is gone.
let GEMINI = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
const G = "https://generativelanguage.googleapis.com/v1beta";
async function pickModel(key: string) {
  const r = await fetch(`${G}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  // deno-lint-ignore no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  // deno-lint-ignore no-explicit-any
  const names: string[] = (j?.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m: any) => String(m.name).replace(/^models\//, ""));
  const ok = (n: string) => /flash/.test(n) && !/lite|image|tts|live|audio|embed|thinking|exp|preview/.test(n);
  const best = names.includes("gemini-flash-latest") ? "gemini-flash-latest"
    : names.filter(ok).sort((a, b) => b.localeCompare(a, "en", { numeric: true }))[0] ?? names.find((n) => /flash/.test(n)) ?? names.find((n) => /gemini/.test(n));
  if (!best) throw new Error("ไม่พบรุ่น Gemini ที่ key นี้ใช้ได้");
  return best;
}

// When a model is busy (503) or has no quota on this key (429, e.g. free tier "limit: 0"), try the next model.
// Only the standard Flash / Flash-Lite names are tried: special models (omni, image, live, preview...) often have no free quota.
const BAD = new Set<string>();
async function altModel(key: string, cur: string) {
  BAD.add(cur);
  const r = await fetch(`${G}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  // deno-lint-ignore no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  // deno-lint-ignore no-explicit-any
  const names: string[] = (j?.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m: any) => String(m.name).replace(/^models\//, ""));
  const std = names.filter((n) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n)).sort((a, b) => Number(/lite/.test(a)) - Number(/lite/.test(b)) || b.localeCompare(a, "en", { numeric: true }));
  const order = ["gemini-flash-latest", "gemini-flash-lite-latest", ...std].filter((n) => names.includes(n) && !BAD.has(n));
  if (!order.length) BAD.clear(); // all tried: start fresh on the next request
  return order[0] ?? null;
}

// The free plan stops a function after 150 s, so each Gemini call gets a 110 s limit and light thinking to answer in time.
let THINK: Record<string, unknown> | null = { thinkingLevel: "minimal" };
async function gem(key: string, system: string, user: string, json = false, again = true, tries = 0, maxTok = json ? 9000 : 5000): Promise<string> {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 110000);
  let r: Response;
  try {
    r = await fetch(`${G}/models/${GEMINI}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: ac.signal,
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: maxTok, ...(THINK ? { thinkingConfig: THINK } : {}), ...(json ? { responseMimeType: "application/json" } : {}) } }),
    });
  } catch (e) {
    if (ac.signal.aborted) throw new Error("Gemini ตอบช้าเกิน 110 วินาที กดปุ่ม 🤖 อีกครั้ง");
    throw e;
  } finally { clearTimeout(timer); }
  // deno-lint-ignore no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 404 && again) { GEMINI = await pickModel(key); return gem(key, system, user, json, false, tries, maxTok); }
  // Busy or no quota: move on to the next standard Flash model (up to 3 switches per call; these errors come back fast).
  if ((r.status === 503 || r.status === 429) && tries < 3) {
    const next = await altModel(key, GEMINI);
    if (next) { GEMINI = next; await new Promise((ok) => setTimeout(ok, 1000)); return gem(key, system, user, json, again, tries + 1, maxTok); }
  }
  if (r.status === 429) throw new Error("โควตาฟรีของ Gemini วันนี้หมดแล้วทุกรุ่นที่ลองได้ ลองใหม่พรุ่งนี้ หรือเปิดการชำระเงินใน Google AI Studio");
  // Older models reject thinkingLevel; fall back to a small thinking budget, then to none.
  if (r.status === 400 && THINK && /thinking/i.test(j?.error?.message ?? "")) {
    THINK = "thinkingLevel" in THINK ? { thinkingBudget: 512 } : null;
    return gem(key, system, user, json, again, tries, maxTok);
  }
  if (!r.ok) throw new Error(`Gemini ขัดข้อง (${r.status}) ${j?.error?.message ?? ""}`.trim());
  // deno-lint-ignore no-explicit-any
  const t = (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("").trim();
  if (!t) throw new Error("Gemini ไม่ตอบคำขอนี้ ลองใหม่อีกครั้ง");
  return t;
}

async function ask(ai: Anthropic, system: string, user: string) {
  // deno-lint-ignore no-explicit-any
  const r: any = await ai.beta.messages.create({
    model: MODEL, max_tokens: 12000, system, messages: [{ role: "user", content: user }],
    output_config: { effort: "medium" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
  // deno-lint-ignore no-explicit-any
  } as any);
  if (r.stop_reason === "refusal") throw new Error("AI ไม่ตอบคำขอนี้ ลองใหม่อีกครั้ง");
  // deno-lint-ignore no-explicit-any
  return (r.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const gkey = Deno.env.get("GEMINI_API_KEY"), key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!gkey && !key) return out({ error: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY (หรือ ANTHROPIC_API_KEY) ในระบบ" }, 503);
    const auth = req.headers.get("Authorization") ?? "";
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await db.auth.getUser();
    if (!u?.user) return out({ error: "ต้องเข้าสู่ระบบก่อน" }, 401);
    const body = await req.json();
    const { hospital_id } = body ?? {};
    const ex = await db.rpc("am_exec"), mh = await db.rpc("my_hospitals");
    // deno-lint-ignore no-explicit-any
    if (!ex.data && !((mh.data ?? []) as any[]).some((h) => h.id === hospital_id)) return out({ error: "ไม่มีสิทธิ์ดูข้อมูลของโรงพยาบาลนี้" }, 403);
    // Background mode (body.job): the work runs on the server one step per call, each call starts the next one,
    // and the state lives in perf_weekly.ai.job, so the person can close the page and come back for the result.
    // deno-lint-ignore no-explicit-any
    let J: any = null, base: any = {};
    if (body.job === "run" || body.job === "start") {
      const r = await db.from("perf_weekly").select("ai").eq("hospital_id", hospital_id).eq("meet_date", body.meet_date).maybeSingle();
      // keep the last finished Action plan visible until the new one is done
      base = { ...(r.data?.ai ?? {}) }; delete base.job;
      if (body.job === "run") {
        J = r.data?.ai?.job;
        if (!J || J.status !== "running" || J.id !== body.id) return out({ skipped: true });
      }
    }
    const src = J ? J.input : body;
    const data = JSON.stringify({ hospital: src.hospital, meeting: src.meeting, period: src.period, figures: src.figures, backlog: src.backlog, chief_notes: src.notes }).slice(0, 40000);
    const S1 = `${CONTEXT}\nบทบาทของคุณ: AI 1 ผู้เสนอ ให้ทำ RCA และเสนอวิธีแก้ไข โครงการ และแผนงาน สำหรับทุกกลุ่มปัญหาของโรงนี้`;
    const U1 = `ข้อมูลรายงานของโรงนี้ (JSON):\n${data}\n\nแบ่งปัญหาเป็นกลุ่ม (งานค้างแยกตามสาเหตุและอายุ, KPI 24 ชม. ที่ไม่ถึง 100%, ข้อ TOR ที่เสี่ยงถูกหักคะแนน, PM/MA/QC ที่ต่ำกว่าเป้า) ทีละกลุ่ม: ทำก้างปลา 4M ถาม 5 Why จนถึงสาเหตุราก ตั้งโครงการแก้ไข (ชื่อ เป้าหมาย งบประมาณ) แล้วเสนอขั้นตอน ผู้รับผิดชอบ กำหนดเสร็จ และตัวชี้วัดผล ให้เคลียร์งานค้างเกิน 60 วันก่อน และทั้งหมดเป็นศูนย์ภายในสิ้นเดือนธันวาคม สุดท้ายเสนอแผนเวลาเป็นรายสัปดาห์จนถึงสิ้นเดือนธันวาคม`;
    const S2 = `${CONTEXT}\nบทบาทของคุณ: AI 2 ผู้วิเคราะห์และทบทวน ให้ตรวจ RCA ก้างปลา 4M และ 5 Why ว่าถึงสาเหตุรากจริง และทบทวนข้อเสนอของ AI 1 อย่างตรงไปตรงมา`;
    const U2 = (p1: string) => `ข้อมูลรายงาน (JSON):\n${data}\n\nข้อเสนอของ AI 1:\n${p1}\n\nวิเคราะห์: แบ่งกลุ่มปัญหาครบหรือไม่ สาเหตุใน 4M ครบหรือขาดด้านใด 5 Why หยุดเร็วเกินไปหรือไม่ แผนเคลียร์งานค้างทันสิ้นเดือนธันวาคมจริงหรือไม่เมื่อเทียบกับจำนวนใบและกำลังคน วิธีแก้ใดยังไม่ตรงสาเหตุราก ทำไม่ได้จริง ขาดผู้รับผิดชอบ กำหนดเวลาไม่สมเหตุผล หรือวัดผลไม่ได้ เรื่องใดต้องขอ GM ตัดสินใจ ความเสี่ยงของแผน และสิ่งที่ควรเพิ่มหรือตัดออก`;
    const S3 = `${CONTEXT}\nบทบาทของคุณ: AI 3 ผู้ตรวจสอบแก้ไขและนำเสนอ ให้แก้ข้อเสนอของ AI 1 ตามผลทบทวนของ AI 2 ตรวจว่าครบทุกกลุ่มปัญหา แล้วเรียบเรียงเป็นรายงาน Action plan ฉบับสุดท้ายสำหรับที่ประชุม`;
    const U3 = (p1: string, p2: string) => `ข้อมูลรายงาน (JSON):\n${data}\n\nข้อเสนอของ AI 1:\n${p1}\n\nผลวิเคราะห์และทบทวนของ AI 2:\n${p2}\n\nเขียนรายงานฉบับสุดท้าย: summary = บทสรุปผู้บริหาร 3-5 ประโยค, analysis = บทวิเคราะห์ (รวมเรื่องที่ต้องขอ GM ตัดสินใจ), items = ทุกกลุ่มปัญหา (code เช่น B1, B2, K1) พร้อม tickets, ก้างปลา 4M, 5 Why, สาเหตุราก, โครงการแก้ไข และขั้นตอนแก้ไข (due เป็นวันที่ เช่น 15 ธ.ค. 2569), timeline = แผนรายสัปดาห์ถึงสิ้นเดือนธันวาคม, risks = ความเสี่ยงของแผน, review_notes = สิ่งที่ AI 2 พบและ AI 3 แก้แล้ว, follow_up = วิธีติดตามผลในการประชุมครั้งถัดไป`;

    // ---- one step per call; the page loops: propose -> review -> check, again until check passes, then report ----
    // deno-lint-ignore no-explicit-any
    const doStep = async (body: any): Promise<any> => {
      const txt = (sys: string, user: string) => gkey ? gem(gkey, sys, user) : ask(new Anthropic({ apiKey: key }), sys, user);
      // deno-lint-ignore no-explicit-any
      const obj = async (sys: string, shape: string, user: string, schema: any) => {
        if (!gkey) {
          const r = await new Anthropic({ apiKey: key }).messages.parse({ model: MODEL, max_tokens: 16000, system: sys, messages: [{ role: "user", content: user }], output_config: { format: zodOutputFormat(schema), effort: "medium" } });
          if (r.stop_reason === "refusal" || !r.parsed_output) throw new Error("AI ตอบไม่สำเร็จ ลองใหม่อีกครั้ง");
          return r.parsed_output;
        }
        const t0 = Date.now();
        // a second try only when the first answer came back fast enough to fit in the 150 s limit
        for (let i = 0; i < 2 && (i === 0 || Date.now() - t0 < 35000); i++) {
          const t = await gem(gkey, `${sys}\n${shape}`, user, true);
          try { const v = schema.safeParse(JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, ""))); if (v.success) return v.data; } catch (_) { /* try once more */ }
        }
        throw new Error("AI ตอบไม่ตรงรูปแบบ ลองใหม่อีกครั้ง");
      };
      const p1 = String(body.p1 ?? ""), p2 = String(body.p2 ?? ""), fb = (body.issues ?? []).map((x: string, i: number) => `${i + 1}. ${x}`).join("\n");
      const hist = (body.history ?? []).map((h: { round: number; approved: boolean; issues: string[] }) => `รอบ ${h.round}: ${h.approved ? "ผ่าน" : "สั่งแก้ " + h.issues.join(" / ")}`).join("\n");
      const model = gkey ? GEMINI : MODEL;
      if (body.step === "propose") {
        const t = !p1 ? await txt(S1, U1)
          : await txt(`${S1}\nตอนนี้เป็นการแก้ไขตามคำสั่งของ AI 3 ผู้ตรวจสอบ ให้แก้ครบทุกข้อที่สั่ง แล้วเขียนข้อเสนอฉบับเต็มใหม่ทั้งหมด`,
            `ข้อมูลรายงาน (JSON):\n${data}\n\nข้อเสนอเดิมของคุณ:\n${p1}\n\nผลทบทวนเดิมของ AI 2:\n${p2}\n\nสิ่งที่ AI 3 สั่งให้แก้:\n${fb}\n\nเขียนข้อเสนอฉบับแก้ไขเต็ม (กลุ่มปัญหา ก้างปลา 4M, 5 Why, สาเหตุราก, โครงการ, ขั้นตอน ผู้รับผิดชอบ กำหนดเสร็จ ตัวชี้วัด และแผนเวลา) และบอกท้ายเรื่องว่าแก้อะไรไปบ้าง`);
        return { text: t, model };
      }
      if (body.step === "review") {
        const t = await txt(S2, fb ? `${U2(p1)}\n\nข้อเสนอนี้เป็นฉบับแก้ไขตามที่ AI 3 สั่ง:\n${fb}\nตรวจด้วยว่าแก้ครบและถูกต้องหรือไม่` : U2(p1));
        return { text: t, model };
      }
      if (body.step === "check") {
        const c = await obj(`${CONTEXT}\nบทบาทของคุณ: AI 3 ผู้ตรวจสอบ ตรวจข้อเสนอของ AI 1 และผลทบทวนของ AI 2 อย่างเข้มงวด ว่าพร้อมเสนอผู้บริหารหรือยัง: ครบทุกกลุ่มปัญหา ก้างปลา 4M ครบ 4 ด้าน 5 Why ถึงสาเหตุรากจริง ทุกขั้นตอนมีผู้รับผิดชอบ วันที่ และตัวชี้วัด ทำได้จริง และประเด็นที่ AI 2 ทักได้รับการแก้แล้ว`,
          CHECK_SHAPE, `ข้อมูลรายงาน (JSON):\n${data}\n\nข้อเสนอของ AI 1:\n${p1}\n\nผลทบทวนของ AI 2:\n${p2}${hist ? `\n\nประวัติการตรวจรอบก่อน:\n${hist}\nห้ามสั่งแก้เรื่องเดิมซ้ำถ้าแก้แล้ว` : ""}`, Check);
        return { check: c, model };
      }
      if (body.step === "report") {
        const rep = await obj(S3, SHAPE, `${U3(p1, p2)}\n\nประวัติการตรวจวนของ AI 3:\n${hist}\nใส่ใน review_notes ว่าแต่ละรอบ AI 3 สั่งแก้อะไรและแก้แล้วอย่างไร`, Report);
        return { report: rep, model };
      }
      throw new Error("step ไม่ถูกต้อง");
    };
    if (body.step) return out(await doStep(body));

    const self = `${Deno.env.get("SUPABASE_URL")}/functions/v1/perf-ai`;
    const chain = (b: unknown) => fetch(self, { method: "POST", headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify(b) })
      .then((r) => r.text()).catch((e) => console.error("chain", e));
    const now = () => new Date().toISOString();
    // deno-lint-ignore no-explicit-any
    const save = (ai: any) => db.from("perf_weekly").update({ ai: ai.report ? ai : { ...base, ...ai }, updated_at: now() }).eq("hospital_id", hospital_id).eq("meet_date", body.meet_date);
    if (body.job === "start") {
      const id = crypto.randomUUID(), input = { hospital: body.hospital, meeting: body.meeting, period: body.period, figures: body.figures, backlog: body.backlog, notes: body.notes };
      const job = { id, status: "running", round: 1, step: "propose", p1: "", p2: "", issues: [], log: [], tries: 0, n: 0, input, events: [], started_at: now(), updated_at: now(), by: u.user.id };
      const { error } = await db.from("perf_weekly").upsert({ hospital_id, meet_date: body.meet_date, ai: { ...base, job }, updated_by: u.user.id, updated_at: now() }, { onConflict: "hospital_id,meet_date" });
      if (error) return out({ error: "เริ่มงานไม่ได้ (ต้องเป็นหัวหน้าของโรงนี้): " + error.message }, 403);
      EdgeRuntime.waitUntil(chain({ job: "run", hospital_id, meet_date: body.meet_date, id }));
      return out({ started: true, id });
    }
    if (body.job === "run") {
      const next = { job: "run", hospital_id, meet_date: body.meet_date, id: J.id };
      const r = J.round, lab: Record<string, string> = { propose: r === 1 ? "รอบ 1: AI 1 เสนอ RCA และวิธีแก้" : `รอบ ${r}: AI 1 แก้ตามที่ AI 3 สั่ง`, review: `รอบ ${r}: AI 2 วิเคราะห์ ทบทวน`, check: `รอบ ${r}: AI 3 ตรวจสอบ`, report: "AI 3 เรียบเรียงรายงานฉบับสุดท้าย" };
      EdgeRuntime.waitUntil((async () => {
        const label = lab[J.step] ?? J.step;
        try {
          if (++J.n > 30) throw new Error("ทำเกินจำนวนขั้นที่กำหนด หยุดไว้ก่อน");
          J.updated_at = now(); await save({ job: J }); // heartbeat: the page sees this step has started
          if (J.step === "propose") { J.p1 = (await doStep({ step: "propose", p1: J.p1, p2: J.p2, issues: J.issues })).text; J.step = "review"; J.events.push({ text: label, ok: true }); }
          else if (J.step === "review") { J.p2 = (await doStep({ step: "review", p1: J.p1, issues: J.issues })).text; J.step = "check"; J.events.push({ text: label, ok: true }); }
          else if (J.step === "check") {
            const c = (await doStep({ step: "check", p1: J.p1, p2: J.p2, history: J.log })).check;
            J.log.push({ round: r, approved: c.approved, issues: c.issues || [], summary: c.summary || "" });
            J.events.push({ text: `${label}: ${c.approved ? "ผ่าน" : `สั่งแก้ ${c.issues.length} เรื่อง`}`, ok: c.approved, issues: c.approved ? [] : c.issues });
            if (c.approved || r >= 4) J.step = "report"; else { J.issues = c.issues; J.round = r + 1; J.step = "propose"; }
          } else if (J.step === "report") {
            const res = await doStep({ step: "report", p1: J.p1, p2: J.p2, history: J.log });
            J.events.push({ text: label, ok: true });
            await save({ report: res.report, log: J.log, model: res.model, at: now(), job: { id: J.id, status: "done", events: J.events, started_at: J.started_at, updated_at: now() } });
            return;
          }
          J.tries = 0; J.updated_at = now(); await save({ job: J }); await chain(next);
        } catch (e) {
          const msg = String((e as Error)?.message ?? e);
          if (!/โควตา|limit: 0/.test(msg) && /ช้าเกิน|503|429|high demand|overload|UNAVAILABLE|RESOURCE_EXHAUSTED|ไม่ตรงรูปแบบ|ไม่ตอบ|ขัดข้อง/i.test(msg) && J.tries < 3) {
            J.tries++; J.n--; J.updated_at = now(); J.events.push({ text: `${label}: AI ไม่ว่างหรือช้า ลองใหม่อัตโนมัติ (ครั้งที่ ${J.tries}/3)`, ok: false, retry: true });
            await save({ job: J }); await new Promise((ok) => setTimeout(ok, 8000)); await chain(next);
          } else { J.status = "error"; J.error = `${label} ไม่สำเร็จ: ${msg}`; J.updated_at = now(); await save({ job: J }); }
        }
      })());
      return out({ accepted: true });
    }

    if (gkey) {
      const p1 = await gem(gkey, S1, U1), p2 = await gem(gkey, S2, U2(p1));
      let rep = null;
      for (let i = 0; i < 2 && !rep; i++) {
        const t = await gem(gkey, `${S3}\n${SHAPE}`, U3(p1, p2), true);
        try { const v = Report.safeParse(JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, ""))); if (v.success) rep = v.data; } catch (_) { /* retry once */ }
      }
      if (!rep) throw new Error("AI 3 เรียบเรียงรายงานไม่สำเร็จ ลองใหม่อีกครั้ง");
      return out({ report: rep, steps: { proposer: p1, reviewer: p2 }, model: GEMINI });
    }
    const ai = new Anthropic({ apiKey: key });
    const p1 = await ask(ai, S1, U1);
    const p2 = await ask(ai, S2, U2(p1));
    const r3 = await ai.messages.parse({
      model: MODEL, max_tokens: 16000, system: S3, messages: [{ role: "user", content: U3(p1, p2) }],
      output_config: { format: zodOutputFormat(Report), effort: "medium" },
    });
    if (r3.stop_reason === "refusal" || !r3.parsed_output) throw new Error("AI 3 เรียบเรียงรายงานไม่สำเร็จ ลองใหม่อีกครั้ง");
    return out({ report: r3.parsed_output, steps: { proposer: p1, reviewer: p2 }, model: MODEL });
  } catch (e) {
    console.error(e);
    return out({ error: e instanceof Anthropic.APIError ? `AI ขัดข้อง (${e.status}) ลองใหม่อีกครั้ง` : String((e as Error)?.message ?? e) }, 500);
  }
});
