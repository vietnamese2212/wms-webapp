import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { encryptSecret, decryptSecret } from '../../utils/secretBox'

// AI VISION đọc chữ in phun trên thùng (Sổ đóng gói) — user chốt 12/08: "AI Vision trước,
// API hết hạn/lỗi thì chuyển OCR; key nằm ở kết nối ERP để thay thế".
// - Key lưu MÃ HÓA (secretBox — cùng cơ chế API key ERP) trong SystemSetting key 'vision_api';
//   listSettings đã LỌC key này khỏi GET /wms/settings (route hở đọc) — KHÔNG lộ cho user thường.
// - PUT /wms/settings/vision_api cũng bị chặn sẵn (không nằm trong KNOWN_SETTINGS → UNKNOWN_SETTING).
// - Provider mặc định Gemini (bậc miễn phí 2.5-flash-lite ~1.000 ảnh/ngày, không cần thẻ);
//   cấu trúc value có 'provider' để sau này thêm Groq/Mistral mà không đổi schema.
// - Endpoint đọc trả 422 (KHÔNG 5xx) khi lỗi/hết quota → FE rơi về Tesseract, không đổ error_logs.

const isSuper = (req: Request) => req.user?.is_superadmin === true || req.user?.name === 'Admin'

const VISION_KEY = 'vision_api'
// Alias '-latest' của Google TỰ TRỎ bản flash-lite mới nhất — model tên cụ thể sẽ nghỉ hưu
// (đo thật 12/08: 'gemini-2.5-flash-lite' trả 404 "no longer available to new users").
const DEFAULT_MODEL = 'gemini-flash-lite-latest'

interface VisionCfg { provider: string; model: string; key_enc: string }

let _cfgCache: { cfg: VisionCfg | null; at: number } | null = null
async function getCfg(): Promise<VisionCfg | null> {
  if (_cfgCache && Date.now() - _cfgCache.at < 30_000) return _cfgCache.cfg
  const { data } = await supabase.from('SystemSetting').select('value').eq('key', VISION_KEY).maybeSingle()
  const v = data?.value as Partial<VisionCfg> | null
  const cfg = v && typeof v.key_enc === 'string' && v.key_enc
    ? { provider: v.provider ?? 'gemini', model: v.model ?? DEFAULT_MODEL, key_enc: v.key_enc }
    : null
  _cfgCache = { cfg, at: Date.now() }
  return cfg
}

// GET /wms/vision-config — trạng thái (KHÔNG bao giờ trả key thô/mã hóa)
export async function getVisionConfig(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 'Chỉ Admin', 403)
  _cfgCache = null
  const cfg = await getCfg()
  const key = cfg ? decryptSecret(cfg.key_enc) : null
  return ok(res, {
    configured: !!key,
    provider: cfg?.provider ?? 'gemini',
    model: cfg?.model ?? DEFAULT_MODEL,
    key_tail: key ? `••••${key.slice(-4)}` : null,
  })
}

// PUT /wms/vision-config — { api_key?: string | null, model?: string }.
// api_key = null → GỠ cấu hình (app quay về thuần OCR). Bỏ trống api_key → chỉ đổi model.
export async function saveVisionConfig(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 'Chỉ Admin', 403)
  const { api_key, model } = req.body as { api_key?: string | null; model?: string }
  const now = new Date().toISOString()

  if (api_key === null) {
    const { error } = await supabase.from('SystemSetting').delete().eq('key', VISION_KEY)
    if (error) return fail(res, error.message, 500)
    _cfgCache = null
    return ok(res, { configured: false })
  }

  const cur = await getCfg()
  const m = (model ?? cur?.model ?? DEFAULT_MODEL).trim()
  if (!/^[\w.-]{3,80}$/.test(m)) return fail(res, 'Tên model không hợp lệ', 400)

  let keyEnc = cur?.key_enc ?? null
  if (typeof api_key === 'string') {
    const raw = api_key.trim()
    if (raw.length < 20 || raw.length > 200) return fail(res, 'API key không hợp lệ (độ dài bất thường)', 400)
    keyEnc = encryptSecret(raw)
    if (!keyEnc) return fail(res, 'Server thiếu JWT_SECRET — không mã hóa được key', 500)
  }
  if (!keyEnc) return fail(res, 'Chưa có API key — dán key vào trước', 400)

  const { error } = await supabase.from('SystemSetting').upsert({
    key: VISION_KEY,
    value: { provider: 'gemini', model: m, key_enc: keyEnc },
    updated_by: req.user?.name ?? null,
    updated_at: now,
  }, { onConflict: 'key' })
  if (error) return fail(res, error.message, 500)
  _cfgCache = null
  return ok(res, { configured: true, provider: 'gemini', model: m })
}

// ─── Gọi Gemini ───────────────────────────────────────────────────────────────
const OCR_PROMPT = `Ảnh chụp chữ IN PHUN (dot-matrix) trên thùng carton trong nhà máy Việt Nam.
Đọc chữ và trả về DUY NHẤT một JSON đúng cấu trúc:
{"time": "HH:MM" | null, "nsx": "DD/MM/YYYY" | null, "hsd": "DD/MM/YYYY" | null, "raw": "toàn bộ chữ đọc được"}
- time = GIỜ SẢN XUẤT in trên thùng (dạng 17:44 hoặc 02:44:16 — nếu có giây thì BỎ giây). Không thấy giờ → null.
- nsx = ngày sản xuất (dòng có nhãn NSX). Năm 2 chữ số hiểu là 20YY.
- hsd = hạn sử dụng (dòng có nhãn HSD).
- KHÔNG đoán: ký tự nào không chắc thì để null field đó.`

interface GeminiResult { time: string | null; nsx: string | null; hsd: string | null; raw: string | null }

// TỰ CHỮA MODEL NGHỈ HƯU (đo thật 12/08 — Google 404 model cũ với user mới, tài liệu ngoài lỗi thời
// rất nhanh): gặp 404 → hỏi ListModels bằng CHÍNH key đó → chọn flash-lite/flash còn sống → thử lại
// + LƯU model mới vào config. Model sau này nghỉ hưu tiếp cũng tự chữa, không cần ai sửa tay.
async function discoverModel(key: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!r.ok) return null
    const j = await r.json() as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> }
    const gen = (j.models ?? [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => (m.name ?? '').replace(/^models\//, ''))
      .filter(n => !/preview|exp|thinking|tts|image|audio|embed/.test(n))
    const pick = (re: RegExp) => {
      const c = gen.filter(n => re.test(n))
      return c.find(n => n.endsWith('-latest')) ?? c.sort().reverse()[0] ?? null
    }
    return pick(/flash-lite/) ?? pick(/flash/) ?? gen[0] ?? null
  } catch { return null }
}

async function persistModel(model: string) {
  const cur = await getCfg()
  if (!cur) return
  await supabase.from('SystemSetting').upsert({
    key: VISION_KEY,
    value: { ...cur, model },
    updated_by: 'auto (model cũ nghỉ hưu)',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })
  _cfgCache = null
}

// Gọi Gemini; model 404 (nghỉ hưu/sai tên) → tự dò model sống, thử lại 1 lần, lưu nếu ăn.
async function callGeminiHealing(cfg: VisionCfg, key: string, parts: unknown[], timeoutMs: number): Promise<{ text: string; model: string } | { err: string }> {
  const r1 = await callGemini(cfg, key, parts, timeoutMs)
  if (!('err' in r1)) return { ...r1, model: cfg.model }
  if (!r1.retired) return r1
  const m2 = await discoverModel(key)
  if (!m2 || m2 === cfg.model) return r1
  const r2 = await callGemini({ ...cfg, model: m2 }, key, parts, timeoutMs)
  if ('err' in r2) return r1   // model dò cũng hỏng → trả lỗi gốc cho dễ hiểu
  await persistModel(m2).catch(() => {})
  return { ...r2, model: m2 }
}

async function callGemini(cfg: VisionCfg, key: string, parts: unknown[], timeoutMs: number): Promise<{ text: string } | { err: string; retired?: boolean }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${encodeURIComponent(key)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      let msg = `Gemini trả ${r.status}`
      try {
        const j = JSON.parse(body) as { error?: { message?: string; status?: string } }
        if (j.error?.status === 'RESOURCE_EXHAUSTED' || r.status === 429) msg = 'Hết quota AI miễn phí (thử lại sau / mai) hoặc gọi quá nhanh'
        else if (r.status === 400 || r.status === 401 || r.status === 403) msg = `API key bị Google từ chối (${j.error?.status ?? r.status}) — kiểm tra key ở trang Kết nối ERP`
        else if (j.error?.message) msg = `Gemini ${r.status}: ${j.error.message.slice(0, 160)}`
      } catch { /* body không phải JSON */ }
      // 404 = model nghỉ hưu / sai tên → cho tầng healing tự dò model sống
      return { err: msg, retired: r.status === 404 }
    }
    const j = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
    if (!text) return { err: 'Gemini không trả nội dung (ảnh có thể bị chặn safety)' }
    return { text }
  } catch (e) {
    return { err: (e as Error).name === 'AbortError' ? 'AI Vision quá thời gian chờ' : `Không gọi được AI Vision: ${(e as Error).message}` }
  } finally { clearTimeout(timer) }
}

// dd/mm/yy(yy) → ISO yyyy-mm-dd (null nếu không hợp lệ)
function dmyToIso(s: string | null | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec((s ?? '').trim())
  if (!m) return null
  const d = +m[1], mo = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// POST /wms/vision-config/test — ping key (text-only, ~0 token ảnh) để Admin bấm "Kiểm tra"
export async function testVisionConfig(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 'Chỉ Admin', 403)
  _cfgCache = null
  const cfg = await getCfg()
  const key = cfg ? decryptSecret(cfg.key_enc) : null
  if (!cfg || !key) return fail(res, 422, 'VISION_NOT_CONFIGURED', 'Chưa cấu hình API key AI Vision')
  const t0 = Date.now()
  const r = await callGeminiHealing(cfg, key, [{ text: 'Trả về đúng JSON: {"ok": true}' }], 15_000)
  if ('err' in r) return fail(res, 422, 'VISION_FAILED', r.err)
  return ok(res, { ok: true, model: r.model, healed: r.model !== cfg.model, latency_ms: Date.now() - t0 })
}

// POST /wms/packing/vision-ocr — { photo_data: dataURL } → { time, nsx_date, hsd_date, raw }.
// MỌI lỗi (chưa cấu hình / key hỏng / hết quota / timeout) = 422 → FE tự rơi về Tesseract.
export async function visionOcr(req: Request, res: Response) {
  const { photo_data } = req.body as { photo_data?: string }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(photo_data ?? '')
  if (!m) return fail(res, 400, 'BAD_IMAGE', 'photo_data phải là dataURL ảnh jpeg/png/webp')
  if (m[2].length > 6_000_000) return fail(res, 400, 'BAD_IMAGE', 'Ảnh quá lớn (>4.5MB) — nén trước khi gửi')

  const cfg = await getCfg()
  const key = cfg ? decryptSecret(cfg.key_enc) : null
  if (!cfg || !key) return fail(res, 422, 'VISION_NOT_CONFIGURED', 'Chưa cấu hình AI Vision (trang Kết nối ERP)')

  const r = await callGeminiHealing(cfg, key, [
    { inlineData: { mimeType: m[1], data: m[2] } },
    { text: OCR_PROMPT },
  ], 25_000)
  if ('err' in r) return fail(res, 422, 'VISION_FAILED', r.err)

  let parsed: GeminiResult
  try { parsed = JSON.parse(r.text) as GeminiResult } catch {
    return fail(res, 422, 'VISION_FAILED', 'AI trả về không đúng định dạng JSON')
  }
  const tm = /^(\d{1,2}):(\d{2})/.exec((parsed.time ?? '').trim())
  const time = tm ? `${String(Math.min(23, +tm[1])).padStart(2, '0')}:${String(Math.min(59, +tm[2])).padStart(2, '0')}` : null
  return ok(res, {
    time,
    nsx_date: dmyToIso(parsed.nsx),
    hsd_date: dmyToIso(parsed.hsd),
    raw: typeof parsed.raw === 'string' ? parsed.raw.slice(0, 500) : null,
    engine: 'gemini', model: r.model,
  })
}
