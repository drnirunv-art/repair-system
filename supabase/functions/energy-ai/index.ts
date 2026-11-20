// Weekly Energy meeting report (ประชุม Energy รายสัปดาห์) written by three AI roles (Gemini when GEMINI_API_KEY is set, else Claude):
//   AI 1 (ผู้นำเสนอ) drafts the presentation and recommendations from the Chief's figures and notes,
//   AI 2 (ผู้วิเคราะห์ทบทวน) analyses the causes and reviews the draft,
//   AI 3 (ผู้ตรวจสอบ) checks both; when it asks for changes, AI 1 and AI 2 revise ONE more round, then AI 3 writes the final report (JSON).
// The page drives it one step per call (body.step = propose | review | check | report), so no call runs long on the free plan.
// Only energy figures and the Chief's notes are sent; no patient or staff personal data. Caller must be signed in and allowed to see the hospital.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod";

const MODEL = "claude-opus-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Report = z.object({
  summary: z.string(),
  analysis: z.array(z.string()),
  factors: z.array(z.object({ factor: z.string(), impact: z.string() })),
  actions: z.array(z.object({ action: z.string(), owner: z.string(), due: z.string(), saving: z.string() })),
  next_agenda: z.array(z.object({ topic: z.string(), target: z.string() })),
  support: z.array(z.string()),
  data_gaps: z.array(z.string()),
  review_notes: z.array(z.string()),
  swot: z.object({ strengths: z.array(z.string()), weaknesses: z.array(z.string()), opportunities: z.array(z.string()), threats: z.array(z.string()) }).optional(),
  rca: z.object({ problem: z.string(), m4: z.object({ man: z.array(z.string()), machine: z.array(z.string()), method: z.array(z.string()), material: z.array(z.string()) }), why5: z.array(z.string()), root_cause: z.string() }).optional(),
});
const SHAPE = `ตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น รูปแบบ:
{"summary":"","analysis":[""],"factors":[{"factor":"","impact":""}],"actions":[{"action":"","owner":"","due":"","saving":""}],"next_agenda":[{"topic":"","target":""}],"support":[""],"data_gaps":[""],"review_notes":[""],"swot":{"strengths":[""],"weaknesses":[""],"opportunities":[""],"threats":[""]},"rca":{"problem":"","m4":{"man":[""],"machine":[""],"method":[""],"material":[""]},"why5":[""],"root_cause":""}}
swot แต่ละช่อง 3-5 ข้อ แต่ละข้อสั้นไม่เกิน 40 ตัวอักษร · rca.m4 แต่ละช่อง 1-4 ข้อ สั้นไม่เกิน 28 ตัวอักษร`;
const Check = z.object({ approved: z.boolean(), issues: z.array(z.string()), summary: z.string() });
const CHECK_SHAPE = `ตอบเป็น JSON อย่างเดียว รูปแบบ: {"approved":true,"issues":["สิ่งที่ต้องแก้ 1"],"summary":"สรุปผลการตรวจ 1-2 ประโยค"}
approved = true เมื่อไม่มีสิ่งที่ต้องแก้แล้วเท่านั้น ถ้า approved = false ต้องมี issues อย่างน้อย 1 ข้อ เขียนแต่ละข้อให้แก้ได้ทันที`;
const CONTEXT = `บริบท: ผู้รับจ้างงานบริหารวิศวกรรมอาคารของโรงพยาบาลในเครือ 12 โรง ทุกวันเสาร์ Chief Engineer ของแต่ละโรงต้องส่งรายงานพลังงานก่อน 10.00 น. และนำเสนอในประชุม Energy รายสัปดาห์ 14.00-16.00 น.
วาระรายงาน: 1 วาระครั้งก่อน (ติดตามผล) · 2.1 สรุปค่าพลังงานไฟฟ้าเทียบเดือนเดียวกันปีก่อนและเป้าหมายประหยัด · 2.2 ดัชนีการใช้พลังงาน ไฟเข้า/ไฟออก · 2.3 ปัจจัยที่มีผล (ผู้รับเหมา ห้องประชุม ระบบวิศวกรรม อุณหภูมิภายนอก) · 2.4 มาตรการที่ดำเนินการ · 2.5 มาตรการเชิงรุก · 3 กิจกรรมส่วนกลาง · 4 ขอสนับสนุนจากโรงพยาบาล · 5 ข้อเสนอแนะ
ผู้ฟังคือผู้บริหารเครือและผู้จัดการส่วนวิศวกรรมพลังงาน เขียนภาษาไทยกระชับ เป็นข้อ ๆ ทุกตัวเลขต้องมาจากข้อมูลที่ให้เท่านั้น ห้ามแต่งตัวเลข ถ้าข้อมูลไม่พอให้บอกว่าต้องเก็บอะไรเพิ่ม
กฎบังคับเรื่องข้อความครบถ้วน (ทุกครั้ง): ทุกข้อความ ทุกขั้นตอน ทุกบรรทัด ต้องเขียนเป็นประโยคสมบูรณ์ครบถ้วน มีเวลา ตัวเลข และหน่วยครบ ห้ามย่อ ห้ามตัดท้ายด้วย "..." หรือ "…" ห้ามเขียนค้างครึ่งประโยค AI 3 ต้องสั่งแก้ทันทีถ้าพบข้อความไม่ครบ
มาตรการต้องทำได้จริงในโรงพยาบาล (Chiller, AHU, แสงสว่าง, ปั๊ม, ตั้งเวลาเปิดปิด, พฤติกรรมผู้ใช้) มีผู้รับผิดชอบระดับตำแหน่ง (ไม่ใส่ชื่อคน) กำหนดเสร็จเป็นวันที่ และประมาณผลประหยัดเป็น kWh/วัน หรือบาท/เดือน เมื่อคำนวณได้จากข้อมูล`;
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
let THINK: Record<string, unknown> | null = { thinkingLevel: "low" };
async function gem(key: string, system: string, user: string, json = false, again = true, tries = 0): Promise<string> {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 110000);
  let r: Response;
  try {
    r = await fetch(`${G}/models/${GEMINI}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: ac.signal,
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 12000, ...(THINK ? { thinkingConfig: THINK } : {}), ...(json ? { responseMimeType: "application/json" } : {}) } }),
    });
  } catch (e) {
    if (ac.signal.aborted) throw new Error("Gemini ตอบช้าเกิน 110 วินาที กดปุ่ม 🤖 อีกครั้ง");
    throw e;
  } finally { clearTimeout(timer); }
  // deno-lint-ignore no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 404 && again) { GEMINI = await pickModel(key); return gem(key, system, user, json, false); }
  // Busy or no quota: move on to the next standard Flash model (up to 3 switches per call; these errors come back fast).
  if ((r.status === 503 || r.status === 429) && tries < 3) {
    const next = await altModel(key, GEMINI);
    if (next) { GEMINI = next; await new Promise((ok) => setTimeout(ok, 1000)); return gem(key, system, user, json, again, tries + 1); }
  }
  if (r.status === 429) throw new Error("โควตาฟรีของ Gemini วันนี้หมดแล้วทุกรุ่นที่ลองได้ ลองใหม่พรุ่งนี้ หรือเปิดการชำระเงินใน Google AI Studio");
  // Older models reject thinkingLevel; fall back to a small thinking budget, then to none.
  if (r.status === 400 && THINK && /thinking/i.test(j?.error?.message ?? "")) {
    THINK = "thinkingLevel" in THINK ? { thinkingBudget: 1024 } : null;
    return gem(key, system, user, json, again, tries);
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
    const ex = await db.rpc("am_exec"), mh = await db.rpc("my_hospitals");
    // deno-lint-ignore no-explicit-any
    if (!ex.data && !((mh.data ?? []) as any[]).some((h) => h.id === body.hospital_id)) return out({ error: "ไม่มีสิทธิ์ดูข้อมูลของโรงพยาบาลนี้" }, 403);
    const data = JSON.stringify(body.input ?? {}).slice(0, 30000);
    const txt = (sys: string, user: string) => gkey ? gem(gkey, sys, user) : ask(new Anthropic({ apiKey: key }), sys, user);
    // deno-lint-ignore no-explicit-any
    const obj = async (sys: string, shape: string, user: string, schema: any) => {
      if (!gkey) {
        const r = await new Anthropic({ apiKey: key }).messages.parse({ model: MODEL, max_tokens: 16000, system: sys, messages: [{ role: "user", content: user }], output_config: { format: zodOutputFormat(schema), effort: "medium" } });
        if (r.stop_reason === "refusal" || !r.parsed_output) throw new Error("AI ตอบไม่สำเร็จ ลองใหม่อีกครั้ง");
        return r.parsed_output;
      }
      const t0 = Date.now();
      for (let i = 0; i < 2 && (i === 0 || Date.now() - t0 < 35000); i++) {
        const t = await gem(gkey, `${sys}\n${shape}`, user, true);
        try { const v = schema.safeParse(JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, ""))); if (v.success) return v.data; } catch (_) { /* try once more */ }
      }
      throw new Error("AI ตอบไม่ตรงรูปแบบ ลองใหม่อีกครั้ง");
    };
    const p1 = String(body.p1 ?? ""), p2 = String(body.p2 ?? ""), fb = (body.issues ?? []).map((x: string, i: number) => `${i + 1}. ${x}`).join("\n");
    const model = gkey ? GEMINI : MODEL;
    const S1 = `${CONTEXT}\nบทบาทของคุณ: AI 1 ผู้นำเสนอ เตรียมเนื้อหานำเสนอในที่ประชุมตามวาระ และเสนอมาตรการประหยัดพลังงาน`;
    const S2 = `${CONTEXT}\nบทบาทของคุณ: AI 2 ผู้วิเคราะห์และทบทวน วิเคราะห์สาเหตุที่ใช้ไฟเพิ่มหรือลด (ปัจจัย 2.3 อุณหภูมิ ผู้รับเหมา Chiller) และทบทวนข้อเสนอของ AI 1 อย่างตรงไปตรงมา`;
    if (body.step === "propose") {
      const t = !fb ? await txt(S1, `ข้อมูลรายงานของโรงพยาบาลสัปดาห์นี้ (JSON):\n${data}\n\nเตรียมเนื้อหานำเสนอ: บทสรุปผู้บริหาร 3-5 ประโยค, สรุปตัวเลข 2.1-2.2 เทียบปีก่อนและเป้าหมาย, ติดตามวาระครั้งก่อน, ปัจจัยที่มีผล, มาตรการที่ควรทำต่อ (ผู้รับผิดชอบ กำหนดเสร็จ ผลประหยัด), เรื่องที่ควรขอสนับสนุน และวาระที่จะติดตามครั้งหน้า`)
        : await txt(`${S1}\nตอนนี้เป็นการแก้ไขรอบสุดท้ายตามคำสั่งของ AI 3 ให้แก้ครบทุกข้อ แล้วเขียนฉบับเต็มใหม่`, `ข้อมูล (JSON):\n${data}\n\nฉบับเดิมของคุณ:\n${p1}\n\nผลทบทวนของ AI 2:\n${p2}\n\nสิ่งที่ AI 3 สั่งให้แก้:\n${fb}\n\nเขียนฉบับแก้ไขเต็ม และบอกท้ายเรื่องว่าแก้อะไรไปบ้าง`);
      return out({ text: t, model });
    }
    if (body.step === "review") {
      const t = await txt(S2, `ข้อมูล (JSON):\n${data}\n\nเนื้อหาของ AI 1:\n${p1}\n\nวิเคราะห์: ตัวเลขถูกต้องตามข้อมูลหรือไม่ สาเหตุที่ใช้ไฟเพิ่มหรือลดคืออะไร มาตรการใดไม่ตรงสาเหตุ ทำไม่ได้จริง ไม่มีผู้รับผิดชอบหรือวันที่ ผลประหยัดเกินจริง และสิ่งที่ควรเพิ่มหรือตัด${fb ? `\n\nฉบับนี้แก้ตามที่ AI 3 สั่ง:\n${fb}\nตรวจด้วยว่าแก้ครบหรือไม่ แล้วแก้ผลทบทวนของคุณให้เป็นฉบับสุดท้าย` : ""}`);
      return out({ text: t, model });
    }
    if (body.step === "check") {
      const c = await obj(`${CONTEXT}\nบทบาทของคุณ: AI 3 ผู้ตรวจสอบ ตรวจเนื้อหาของ AI 1 และผลทบทวนของ AI 2 ว่าพร้อมนำเสนอผู้บริหารหรือยัง: ตัวเลขตรงข้อมูล ครบทุกวาระ มาตรการมีผู้รับผิดชอบ วันที่ และผลประหยัด ประเด็นที่ AI 2 ทักได้รับการแก้`,
        CHECK_SHAPE, `ข้อมูล (JSON):\n${data}\n\nเนื้อหาของ AI 1:\n${p1}\n\nผลทบทวนของ AI 2:\n${p2}`, Check);
      return out({ check: c, model });
    }
    if (body.step === "report") {
      const rep = await obj(`${CONTEXT}\nบทบาทของคุณ: AI 3 ผู้ตรวจสอบ เรียบเรียงรายงานฉบับสุดท้ายจากเนื้อหาของ AI 1 และผลทบทวนของ AI 2`, SHAPE,
        `ข้อมูล (JSON):\n${data}\n\nเนื้อหาของ AI 1:\n${p1}\n\nผลทบทวนของ AI 2:\n${p2}\n\nผลการตรวจของ AI 3:\n${String(body.log ?? "")}\n\nsummary = บทสรุปผู้บริหาร 3-5 ประโยค, analysis = บทวิเคราะห์ตัวเลข, factors = ปัจจัยและผลต่อการใช้ไฟ, actions = มาตรการ (due เป็นวันที่ เช่น 30 พ.ย. 2569, saving เป็น kWh/วัน หรือบาท/เดือน หรือ "ประเมินไม่ได้"), next_agenda = เรื่องติดตามครั้งหน้าพร้อมเป้าหมาย, support = เรื่องที่ขอสนับสนุนจากโรงพยาบาล, data_gaps = ข้อมูลที่ยังขาด, review_notes = สิ่งที่ AI 2 และ AI 3 ทักและแก้แล้ว, swot = SWOT ของการใช้พลังงานโรงนี้ (S/W ปัจจัยภายในทีม, O/T ปัจจัยภายนอก) ต้องมีทุกครั้ง, rca = ปัญหาหลักด้านพลังงานสัปดาห์นี้ (problem สั้นไม่เกิน 30 ตัวอักษร) พร้อมสาเหตุก้างปลา 4M (คน เครื่องจักร วิธีการ วัสดุ) 5 Why และสาเหตุราก ต้องมีทุกครั้ง`, Report);
      return out({ report: rep, model });
    }
    return out({ error: "step ไม่ถูกต้อง" }, 400);
  } catch (e) {
    console.error(e);
    return out({ error: e instanceof Anthropic.APIError ? `AI ขัดข้อง (${e.status}) ลองใหม่อีกครั้ง` : String((e as Error)?.message ?? e) }, 500);
  }
});
