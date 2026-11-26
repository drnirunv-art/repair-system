// Water Management (JCI FMS.08.04): one AI helper (Gemini when GEMINI_API_KEY is set, else Claude).
//   step "read":    reads one lab-result file a hospital attached for a month (PDF, picture, or text the page took out of
//                   Excel / Word / CSV) and maps every value to the central template (the hospital's water_plans).
//                   It only PROPOSES rows: a person checks them on the page and saves. Proposal kept in water_files.ai.
//   step "summary": executive summary + analysis + action plan for one hospital or for all 12 hospitals (hospital_id null,
//                   executives only) from the figures the page computed; kept in water_ai.
// Only water-quality figures are sent; no patient or staff personal data. The caller must be signed in and allowed to see the hospital.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";

const MODEL = "claude-opus-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const FULL = `กฎบังคับเรื่องข้อความครบถ้วน (ทุกครั้ง): ทุกข้อความต้องเป็นประโยคสมบูรณ์ครบถ้วน มีตัวเลขและหน่วยครบ ห้ามย่อ ห้ามตัดท้ายด้วย "..." หรือ "…" ใช้คำว่า Owner แทน GM เสมอ ปีให้เขียนเป็น พ.ศ.`;

const Read = z.object({
  lab: z.string().nullable().optional(), report_no: z.string().nullable().optional(),
  rows: z.array(z.object({ plan_id: z.number().nullable(), point_in_file: z.string().optional().default(""), param_in_file: z.string().optional().default(""),
    value: z.string(), sampled_on: z.string().nullable().optional(), report_no: z.string().nullable().optional(), note: z.string().nullable().optional() })),
  notes: z.array(z.string()).optional().default([]),
});
const READ_SHAPE = `ตอบเป็น JSON อย่างเดียว รูปแบบ:
{"lab":"ชื่อห้องปฏิบัติการตามไฟล์","report_no":"เลขที่รายงานหลัก","rows":[{"plan_id":123,"point_in_file":"จุดเก็บตัวอย่างตามที่เขียนในไฟล์","param_in_file":"ชื่อรายการตามที่เขียนในไฟล์","value":"ค่าตามที่เขียนในไฟล์ เช่น 12 หรือ <0.1 หรือ >16,000 หรือ ND หรือ ไม่พบ หรือ พบ หรือ ผ่าน","sampled_on":"YYYY-MM-DD (ค.ศ.)","report_no":"","note":""}],"notes":["ข้อสังเกตสั้น ๆ"]}`;
const Sum = z.object({
  summary: z.array(z.string()), analysis: z.array(z.string()), risks: z.array(z.string()).optional().default([]),
  plan: z.array(z.object({ issue: z.string(), action: z.string(), owner: z.string(), start: z.string(), due: z.string() })),
  data_gaps: z.array(z.string()).optional().default([]),
});
const SUM_SHAPE = `ตอบเป็น JSON อย่างเดียว รูปแบบ:
{"summary":["บทสรุปผู้บริหาร ข้อละ 1 ประโยค 4-7 ข้อ"],"analysis":["บทวิเคราะห์ 4-10 ข้อ"],"risks":["ความเสี่ยงต่อผู้ป่วย การตรวจ JCI หรือกฎหมาย"],"plan":[{"issue":"ประเด็น","action":"มาตรการ","owner":"ตำแหน่งผู้รับผิดชอบ","start":"YYYY-MM-DD","due":"YYYY-MM-DD"}],"data_gaps":["ข้อมูลที่ยังขาด"]}
start / due เป็นวันที่ ค.ศ. รูปแบบ YYYY-MM-DD เริ่มไม่ก่อนวันนี้ แผน 3-8 ข้อ`;

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

// Gemini call with any parts (text and inline files). The free plan stops a function after 150 s, so each call gets 110 s.
let THINK: Record<string, unknown> | null = { thinkingLevel: "low" };
// deno-lint-ignore no-explicit-any
async function gem(key: string, system: string, parts: any[], again = true, tries = 0): Promise<string> {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 110000);
  let r: Response;
  try {
    r = await fetch(`${G}/models/${GEMINI}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: ac.signal,
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 16000, ...(THINK ? { thinkingConfig: THINK } : {}), responseMimeType: "application/json" } }),
    });
  } catch (e) {
    if (ac.signal.aborted) throw new Error("AI ตอบช้าเกิน 110 วินาที กดปุ่มอีกครั้ง หรือแบ่งไฟล์ให้เล็กลง");
    throw e;
  } finally { clearTimeout(timer); }
  // deno-lint-ignore no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 404 && again) { GEMINI = await pickModel(key); return gem(key, system, parts, false); }
  if ((r.status === 503 || r.status === 429) && tries < 3) {
    const next = await altModel(key, GEMINI);
    if (next) { GEMINI = next; await new Promise((ok) => setTimeout(ok, 1000)); return gem(key, system, parts, again, tries + 1); }
  }
  if (r.status === 429) throw new Error("โควตาฟรีของ Gemini วันนี้หมดแล้วทุกรุ่นที่ลองได้ ลองใหม่พรุ่งนี้ หรือเปิดการชำระเงินใน Google AI Studio");
  if (r.status === 400 && THINK && /thinking/i.test(j?.error?.message ?? "")) {
    THINK = "thinkingLevel" in THINK ? { thinkingBudget: 1024 } : null;
    return gem(key, system, parts, again, tries);
  }
  if (!r.ok) throw new Error(`Gemini ขัดข้อง (${r.status}) ${j?.error?.message ?? ""}`.trim());
  // deno-lint-ignore no-explicit-any
  const t = (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("").trim();
  if (!t) throw new Error("AI ไม่ตอบคำขอนี้ ลองใหม่อีกครั้ง");
  return t;
}
// the same request to Claude: text + a PDF document block or an image block
// deno-lint-ignore no-explicit-any
async function claude(key: string, system: string, text: string, file?: { mime: string; b64: string }): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const content: any[] = [];
  if (file) content.push(file.mime === "application/pdf" ? { type: "document", source: { type: "base64", media_type: file.mime, data: file.b64 } }
    : { type: "image", source: { type: "base64", media_type: file.mime, data: file.b64 } });
  content.push({ type: "text", text });
  // deno-lint-ignore no-explicit-any
  const r: any = await new Anthropic({ apiKey: key }).messages.create({ model: MODEL, max_tokens: 16000, system, messages: [{ role: "user", content }] } as any);
  if (r.stop_reason === "refusal") throw new Error("AI ไม่ตอบคำขอนี้ ลองใหม่อีกครั้ง");
  // deno-lint-ignore no-explicit-any
  return (r.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const IMG = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"];

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
    // a JSON answer, asked up to twice when the shape is wrong
    // deno-lint-ignore no-explicit-any
    const obj = async (sys: string, shape: string, text: string, schema: any, file?: { mime: string; b64: string }) => {
      for (let i = 0; i < 2; i++) {
        const t = gkey ? await gem(gkey, `${sys}\n${shape}`, [...(file ? [{ inlineData: { mimeType: file.mime, data: file.b64 } }] : []), { text }])
          : await claude(key!, `${sys}\n${shape}`, text, file);
        try { const v = schema.safeParse(JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, ""))); if (v.success) return v.data; } catch (_) { /* once more */ }
      }
      throw new Error("AI ตอบไม่ตรงรูปแบบ ลองใหม่อีกครั้ง");
    };
    const model = () => gkey ? GEMINI : MODEL;

    if (body.step === "read") {
      // the file row and the plans are read with the caller's own rights (RLS), so nobody reads another hospital's file
      const f = await db.from("water_files").select("*").eq("id", body.file_id).maybeSingle();
      if (f.error || !f.data) return out({ error: "ไม่พบไฟล์ หรือไม่มีสิทธิ์ดูไฟล์นี้" }, 404);
      const F = f.data;
      const ok = await db.rpc("water_can_record", { h: F.hospital_id });
      if (!ok.data) return out({ error: "ไม่มีสิทธิ์บันทึกผลของโรงพยาบาลนี้" }, 403);
      const [pt, pl] = await Promise.all([db.from("water_points").select("id,system,code,name,location").eq("hospital_id", F.hospital_id).eq("active", true),
        db.from("water_plans").select("id,point_id,template_code,param,unit,kind,lo,hi,test_type").eq("hospital_id", F.hospital_id).eq("active", true)]);
      if (pt.error || pl.error) throw pt.error || pl.error;
      // deno-lint-ignore no-explicit-any
      const P = new Map((pt.data ?? []).map((p: any) => [p.id, p]));
      const GRP: Record<string, string> = { DW: "DRINK", WW: "WASTE", WW_IN: "WASTE", WW_AER: "WASTE" };
      // deno-lint-ignore no-explicit-any
      const tpl = (pl.data ?? []).filter((x: any) => P.has(x.point_id) && (F.grp === "ALL" || (GRP[(P.get(x.point_id) as any).system] ?? "USE") === F.grp))
        // deno-lint-ignore no-explicit-any
        .map((x: any) => { const p: any = P.get(x.point_id); return { plan_id: x.id, point: `${p.code} ${p.name}${p.location ? " (" + p.location + ")" : ""}`, system: p.system, param: x.param, unit: x.unit, kind: x.kind }; });
      if (!tpl.length) return out({ error: "โรงนี้ยังไม่มีจุดตรวจและรายการตรวจในหมวดนี้ ให้หัวหน้าเพิ่มที่แท็บ \"ทะเบียนจุดตรวจ\" ก่อน แล้วให้ AI อ่านใหม่" }, 400);
      let file: { mime: string; b64: string } | undefined, text = String(body.text ?? "").slice(0, 120000);
      if (!text) {
        const mime = String(F.mime || "").toLowerCase();
        if (mime !== "application/pdf" && !IMG.includes(mime)) return out({ error: "AI อ่านไฟล์ชนิดนี้โดยตรงไม่ได้ ให้บันทึกเป็น PDF หรือรูปภาพ หรือ Excel (.xlsx) / Word (.docx) / CSV แล้วแนบใหม่" }, 400);
        const dl = await db.storage.from("water-lab").download(F.path);
        if (dl.error || !dl.data) return out({ error: "เปิดไฟล์จากที่เก็บไม่ได้ ลองใหม่อีกครั้ง" }, 500);
        const buf = new Uint8Array(await dl.data.arrayBuffer());
        if (buf.length > 15 * 1024 * 1024) return out({ error: "ไฟล์ใหญ่เกิน 15 MB ให้แบ่งไฟล์หรือลดขนาดก่อน" }, 400);
        file = { mime, b64: b64(buf) };
      }
      const m = String(F.month).slice(0, 7);
      const sys = `คุณคือผู้ช่วยนำเข้าผลตรวจคุณภาพน้ำของโรงพยาบาล (JCI FMS.08.04) แต่ละโรงจ้างห้องปฏิบัติการต่างกัน รายงานจึงหน้าตาไม่เหมือนกัน
งานของคุณ: อ่านผลตรวจทุกค่าในไฟล์ แล้วจับคู่กับรายการในแบบฟอร์มกลางของโรงนี้ (plan_id) ให้ถูกต้อง
กฎ:
- ใช้ plan_id จากรายการที่ให้เท่านั้น จับคู่ด้วยจุดเก็บตัวอย่าง (เช่น น้ำเสียเข้าระบบ Influent / น้ำทิ้ง Effluent / บ่อเติมอากาศ / ตู้น้ำดื่ม / ถังน้ำ) และชื่อรายการ (BOD, COD, SS/TSS, TKN, pH, Coliform ฯลฯ) และหน่วย
- ถ้าค่าใดจับคู่ไม่ได้แน่ชัด ให้ plan_id เป็น null และเขียนเหตุผลใน note ห้ามเดา
- value เขียนตามที่ไฟล์รายงานจริง (เช่น <0.1, >16,000, ND, ไม่พบ, 1,250) ห้ามแต่งตัวเลข ห้ามคำนวณใหม่
- sampled_on คือวันที่เก็บตัวอย่าง เป็น ค.ศ. (พ.ศ. ลบ 543) ถ้าไม่มีวันที่ในไฟล์ ให้ใช้วันที่ 1 ของเดือน ${m}
- ไฟล์อาจมีหลายเดือน (เช่นตาราง ม.ค.-ธ.ค.) ให้แยกแถวตามเดือนพร้อมวันที่ของแต่ละเดือน
- ค่าสถิติสรุป (ต่ำสุด สูงสุด เฉลี่ย % การบำบัด) ไม่ใช่ผลตรวจ ห้ามใส่เป็นแถว
${FULL}`;
      const user = `เดือนของไฟล์นี้: ${m} · หมวด: ${F.grp} · ห้องปฏิบัติการที่ผู้แนบระบุ: ${F.lab ?? "-"}
แบบฟอร์มกลาง (รายการที่จับคู่ได้):\n${JSON.stringify(tpl)}
${text ? `\nเนื้อหาไฟล์ "${F.file_name}" (แปลงเป็นข้อความแล้ว):\n${text}` : `\nไฟล์ "${F.file_name}" แนบมาด้วย`}`;
      try {
        const R = await obj(sys, READ_SHAPE, user, Read, file);
        // deno-lint-ignore no-explicit-any
        const ids = new Set(tpl.map((t: any) => t.plan_id));
        // deno-lint-ignore no-explicit-any
        R.rows = R.rows.map((r: any) => ({ ...r, plan_id: ids.has(r.plan_id) ? r.plan_id : null, sampled_on: /^\d{4}-\d{2}-\d{2}$/.test(r.sampled_on ?? "") ? r.sampled_on : `${m}-01` }));
        await db.from("water_files").update({ ai: R, ai_model: model(), ai_at: new Date().toISOString(), status: F.status === "saved" ? "saved" : "read", error: null }).eq("id", F.id);
        return out({ read: R, model: model() });
      } catch (e) {
        await db.from("water_files").update({ status: F.status === "saved" ? "saved" : "error", error: String((e as Error)?.message ?? e) }).eq("id", F.id);
        throw e;
      }
    }

    if (body.step === "summary") {
      const h = body.hospital_id ?? null, grp = String(body.grp ?? "ALL"), year = +body.year;
      if (h) { const ok = await db.rpc("water_can_record", { h }); if (!ok.data) return out({ error: "ไม่มีสิทธิ์ของโรงพยาบาลนี้" }, 403); }
      else { const ex = await db.rpc("am_exec"); if (!ex.data) return out({ error: "สรุป 12 โรงทำได้เฉพาะผู้บริหาร" }, 403); }
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
      const sys = `คุณคือผู้เชี่ยวชาญระบบน้ำโรงพยาบาลและแผนจัดการน้ำตาม JCI 8th FMS.08.04 เขียนบทสรุปผู้บริหารและบทวิเคราะห์ผลตรวจคุณภาพน้ำ
${h ? "ของโรงพยาบาลหนึ่งโรง" : "ของโรงพยาบาลในเครือ 12 โรง เปรียบเทียบระหว่างโรง ชี้โรงที่ต้องเร่งแก้ และสิ่งที่ส่วนกลางควรทำ"} สำหรับผู้บริหารและ Owner
ค่ามาตรฐาน: น้ำทิ้งตามประกาศกระทรวงทรัพยากรธรรมชาติฯ มาตรฐานน้ำทิ้งจากอาคารประเภท ก (พ.ศ. 2548) · น้ำดื่มตามประกาศกระทรวงสาธารณสุข ฉบับที่ 61 · น้ำประปาตามเกณฑ์กรมอนามัย · น้ำ RO ไตเทียมตาม ISO 23500 · Legionella ตาม HSE ACOP L8
ทุกตัวเลขต้องมาจากข้อมูลที่ให้เท่านั้น ห้ามแต่ง ถ้าข้อมูลไม่พอให้ระบุใน data_gaps · ผู้รับผิดชอบเขียนเป็นตำแหน่ง ไม่ใส่ชื่อคน · วันนี้คือ ${today}
${FULL}`;
      const S = await obj(sys, SUM_SHAPE, `หมวด: ${grp} · ปี ค.ศ. ${year} (พ.ศ. ${year + 543})\nข้อมูลที่ระบบคำนวณแล้ว (JSON):\n${JSON.stringify(body.input ?? {}).slice(0, 60000)}`, Sum);
      const ins = await db.from("water_ai").insert({ hospital_id: h, grp, year, report: S, model: model(), created_by: u.user.id }).select("id,created_at").single();
      if (ins.error) throw ins.error;
      return out({ report: S, model: model(), id: ins.data.id, created_at: ins.data.created_at });
    }
    return out({ error: "step ไม่ถูกต้อง" }, 400);
  } catch (e) {
    console.error(e);
    return out({ error: e instanceof Anthropic.APIError ? `AI ขัดข้อง (${e.status}) ลองใหม่อีกครั้ง` : String((e as Error)?.message ?? e) }, 500);
  }
});
