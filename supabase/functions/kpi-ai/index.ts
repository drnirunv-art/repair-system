// Action plan for KPI items that lost points, written by three AI roles in turn (Gemini when GEMINI_API_KEY is set, else Claude):
//   AI 1 (ผู้เสนอ) proposes corrective methods and a plan,
//   AI 2 (ผู้วิเคราะห์ทบทวน) analyses causes and reviews the proposal,
//   AI 3 (ผู้ตรวจสอบแก้ไข) checks both; when it asks for changes AI 1 revises and AI 2 reviews again, round after round,
//   until AI 3 passes the work, then AI 3 writes the final report as structured JSON.
// The page drives the rounds one step per call (body.step = propose | review | check | report), so no call runs long.
// Each item gets an RCA: fishbone 4M (man, machine, method, material), 5 Why, root cause, and a corrective project.
// Secret: GEMINI_API_KEY (optional GEMINI_MODEL) or ANTHROPIC_API_KEY (set by the owner in Supabase > Edge Functions > Secrets). The caller must be signed in and allowed to see the hospital.
// Only KPI figures, targets and the head's notes are sent; no patient or staff personal data.
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
  items: z.array(z.object({
    code: z.string(), title: z.string(),
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

const CONTEXT = `บริบท: บริษัทผู้รับจ้างงานบริหารวิศวกรรมอาคารของโรงพยาบาล ถูกประเมิน KPI ตามสัญญา (เอกสารแนบ 4) ทุกเดือน คะแนนเต็ม 100 ผ่านที่ 90
บางโรงพยาบาลมีส่วนลดค่าบริการเมื่อไม่ผ่าน ผู้อ่านรายงานคือผู้บริหารโรงพยาบาลและหัวหน้างานวิศวกรรม
เขียนเป็นภาษาไทยที่อ่านง่าย ทุกวิธีแก้ต้องทำได้จริงในงานวิศวกรรมอาคารโรงพยาบาล มีผู้รับผิดชอบระดับตำแหน่ง (ไม่ใส่ชื่อคน) มีกำหนดเสร็จเป็นวันที่ และวัดผลได้ด้วยตัวเลข KPI ข้อนั้น
อย่าแต่งตัวเลขที่ไม่มีในข้อมูล ถ้าข้อมูลไม่พอ ให้บอกว่าต้องเก็บข้อมูลอะไรเพิ่ม
ใช้หลัก RCA ทุกข้อที่ตก: ก้างปลา (Ishikawa) แยกสาเหตุตาม 4M คือ คน (Man) เครื่องจักร (Machine) วิธีการ (Method) วัสดุ/อะไหล่ (Material) แล้วถาม 5 Why จนถึงสาเหตุราก และตั้งเป็นโครงการแก้ไขที่มีชื่อ เป้าหมาย และงบประมาณ
ข้อมูลแต่ละข้อมี rca ที่หัวหน้าร่างไว้ (4M, 5 Why, โครงการ) ให้ใช้เป็นจุดเริ่ม
เขียนกระชับ ตรงประเด็น เป็นข้อ ๆ ไม่ต้องเกริ่นหรือทวนข้อมูล`;
const Check = z.object({ approved: z.boolean(), issues: z.array(z.string()), summary: z.string() });
const CHECK_SHAPE = `ตอบเป็น JSON อย่างเดียว รูปแบบ: {"approved":true,"issues":["สิ่งที่ต้องแก้ 1"],"summary":"สรุปผลการตรวจ 1-2 ประโยค"}
approved = true เมื่อไม่มีสิ่งที่ต้องแก้แล้วเท่านั้น ถ้า approved = false ต้องมี issues อย่างน้อย 1 ข้อ เขียนแต่ละข้อให้ AI 1 แก้ได้ทันที`;
const SHAPE = `ตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น รูปแบบ:
{"summary":"","analysis":[""],"items":[{"code":"","title":"","m4":{"man":[""],"machine":[""],"method":[""],"material":[""]},"why5":["ทำไม 1: ...","ทำไม 2: ..."],"root_cause":"","project":{"name":"","goal":"","budget":""},"actions":[{"step":"","owner":"","due":"","measure":""}],"expected_result":""}],"timeline":[{"when":"","activity":""}],"risks":[""],"review_notes":[""],"follow_up":[""]}
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

// The free plan stops a function after 150 s, so each Gemini call gets a 110 s limit and light thinking to answer in time.
let THINK: Record<string, unknown> | null = { thinkingLevel: "low" };
async function gem(key: string, system: string, user: string, json = false, again = true): Promise<string> {
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
  // Older models reject thinkingLevel; fall back to a small thinking budget, then to none.
  if (r.status === 400 && THINK && /thinking/i.test(j?.error?.message ?? "")) {
    THINK = "thinkingLevel" in THINK ? { thinkingBudget: 1024 } : null;
    return gem(key, system, user, json, again);
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
    const { hospital_id, year, month } = body ?? {};
    // the same check the KPI page uses: raises when this person may not see the hospital
    const chk = await db.rpc("kpi_auto", { p_hospital: hospital_id, p_year: year, p_month: month });
    if (chk.error) return out({ error: chk.error.message }, 403);
    const data = JSON.stringify({ hospital: body.hospital, month: body.month_name, total: body.total, pass_mark: 90, discount: body.discount, failed: body.failed, system_figures: chk.data }).slice(0, 30000);
    const S1 = `${CONTEXT}\nบทบาทของคุณ: AI 1 ผู้เสนอ ให้ทำ RCA และเสนอวิธีแก้ไข โครงการ และแผนงานสำหรับทุกข้อ KPI ที่ตก`;
    const U1 = `ข้อมูล KPI เดือนนี้ (JSON):\n${data}\n\nทีละข้อที่ตก (failed): ทำก้างปลา 4M (คน เครื่องจักร วิธีการ วัสดุ) โดยเริ่มจาก rca และสาเหตุที่หัวหน้าเขียน (cause) ถาม 5 Why จนถึงสาเหตุราก ตั้งโครงการแก้ไข (ชื่อ เป้าหมาย งบประมาณ) แล้วเสนอขั้นตอน ผู้รับผิดชอบ กำหนดเสร็จ และตัวชี้วัดผล โดยใช้ร่างวิธีแก้ (draft_action) เป็นจุดเริ่ม สุดท้ายเสนอแผนเวลารวม 4 สัปดาห์`;
    const S2 = `${CONTEXT}\nบทบาทของคุณ: AI 2 ผู้วิเคราะห์และทบทวน ให้ตรวจ RCA ก้างปลา 4M และ 5 Why ว่าถึงสาเหตุรากจริง และทบทวนข้อเสนอของ AI 1 อย่างตรงไปตรงมา`;
    const U2 = (p1: string) => `ข้อมูล KPI (JSON):\n${data}\n\nข้อเสนอของ AI 1:\n${p1}\n\nวิเคราะห์: สาเหตุใน 4M ครบหรือขาดด้านใด 5 Why หยุดเร็วเกินไปหรือไม่ ข้อใดเกี่ยวโยงกัน โครงการและวิธีแก้ใดยังไม่ตรงสาเหตุราก ทำไม่ได้จริง ขาดผู้รับผิดชอบ กำหนดเวลาไม่สมเหตุผล หรือวัดผลไม่ได้ ความเสี่ยงของแผน และสิ่งที่ควรเพิ่มหรือตัดออก`;
    const S3 = `${CONTEXT}\nบทบาทของคุณ: AI 3 ผู้ตรวจสอบแก้ไขและนำเสนอ ให้แก้ข้อเสนอของ AI 1 ตามผลทบทวนของ AI 2 ตรวจว่าครบทุกข้อที่ตก แล้วเรียบเรียงเป็นรายงาน Action plan ฉบับสุดท้าย`;
    const U3 = (p1: string, p2: string) => `ข้อมูล KPI (JSON):\n${data}\n\nข้อเสนอของ AI 1:\n${p1}\n\nผลวิเคราะห์และทบทวนของ AI 2:\n${p2}\n\nเขียนรายงานฉบับสุดท้าย: summary = บทสรุปผู้บริหาร 3-5 ประโยค, analysis = บทวิเคราะห์, items = ทุกข้อที่ตกพร้อมก้างปลา 4M, 5 Why, สาเหตุราก, โครงการแก้ไข และขั้นตอนแก้ไข (due เป็นวันที่ เช่น 15 ธ.ค. 2569), timeline = แผนรายสัปดาห์, risks = ความเสี่ยงของแผน, review_notes = สิ่งที่ AI 2 พบและ AI 3 แก้แล้ว, follow_up = วิธีติดตามผล`;

    // ---- one step per call; the page loops: propose -> review -> check, again until check passes, then report ----
    if (body.step) {
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
            `ข้อมูล KPI (JSON):\n${data}\n\nข้อเสนอเดิมของคุณ:\n${p1}\n\nผลทบทวนเดิมของ AI 2:\n${p2}\n\nสิ่งที่ AI 3 สั่งให้แก้:\n${fb}\n\nเขียนข้อเสนอฉบับแก้ไขเต็ม (ก้างปลา 4M, 5 Why, สาเหตุราก, โครงการ, ขั้นตอน ผู้รับผิดชอบ กำหนดเสร็จ ตัวชี้วัด และแผนเวลา) และบอกท้ายเรื่องว่าแก้อะไรไปบ้าง`);
        return out({ text: t, model });
      }
      if (body.step === "review") {
        const t = await txt(S2, fb ? `${U2(p1)}\n\nข้อเสนอนี้เป็นฉบับแก้ไขตามที่ AI 3 สั่ง:\n${fb}\nตรวจด้วยว่าแก้ครบและถูกต้องหรือไม่` : U2(p1));
        return out({ text: t, model });
      }
      if (body.step === "check") {
        const c = await obj(`${CONTEXT}\nบทบาทของคุณ: AI 3 ผู้ตรวจสอบ ตรวจข้อเสนอของ AI 1 และผลทบทวนของ AI 2 อย่างเข้มงวด ว่าพร้อมเสนอผู้บริหารหรือยัง: ครบทุกข้อที่ตก ก้างปลา 4M ครบ 4 ด้าน 5 Why ถึงสาเหตุรากจริง ทุกขั้นตอนมีผู้รับผิดชอบ วันที่ และตัวชี้วัด ทำได้จริง และประเด็นที่ AI 2 ทักได้รับการแก้แล้ว`,
          CHECK_SHAPE, `ข้อมูล KPI (JSON):\n${data}\n\nข้อเสนอของ AI 1:\n${p1}\n\nผลทบทวนของ AI 2:\n${p2}${hist ? `\n\nประวัติการตรวจรอบก่อน:\n${hist}\nห้ามสั่งแก้เรื่องเดิมซ้ำถ้าแก้แล้ว` : ""}`, Check);
        return out({ check: c, model });
      }
      if (body.step === "report") {
        const rep = await obj(S3, SHAPE, `${U3(p1, p2)}\n\nประวัติการตรวจวนของ AI 3:\n${hist}\nใส่ใน review_notes ว่าแต่ละรอบ AI 3 สั่งแก้อะไรและแก้แล้วอย่างไร`, Report);
        return out({ report: rep, model });
      }
      return out({ error: "step ไม่ถูกต้อง" }, 400);
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
