import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { encryptSecret, decryptSecret } from '../../utils/secretBox'

// AI VISION đọc chữ in phun trên thùng (Sổ đóng gói) — user chốt 12/08: "AI Vision trước,
// API hết hạn/lỗi thì chuyển OCR; key nằm ở kết nối ERP để thay thế".
// - Key lưu MÃ HÓA (secretBox — cùng cơ chế API key ERP) trong SystemSetting key 'vision_api';
//   listSettings đã LỌC key này khỏi GET /wms/settings (route hở đọc) — KHÔNG lộ cho user thường.
// - PUT /wms/settings/vision_api cũng bị chặn sẵn (không nằm trong KNOWN_SETTINGS → UNKNOWN_SETTING).
// - NHÀ CUNG CẤP chọn được (14/08, user hỏi "dùng API của GPT được không"): `gemini` (Google
//   AI Studio — có bậc MIỄN PHÍ ~1.000 ảnh/ngày, không cần thẻ) hoặc `openai` (GPT — trả tiền theo
//   dùng). Cùng một prompt, cùng một shape JSON trả về, nên đổi nhà cung cấp KHÔNG đụng luồng quét.
// - Endpoint đọc trả 422 (KHÔNG 5xx) khi lỗi/hết quota → FE rơi về Tesseract, không đổ error_logs.

const isSuper = (req: Request) => req.user?.is_superadmin === true

const VISION_KEY = 'vision_api'

export const VISION_PROVIDERS = ['gemini', 'openai'] as const
export type VisionProvider = typeof VISION_PROVIDERS[number]
const isProvider = (v: unknown): v is VisionProvider =>
  typeof v === 'string' && (VISION_PROVIDERS as readonly string[]).includes(v)

// Model mặc định mỗi nhà cung cấp. Gemini: alias '-latest' TỰ TRỎ bản flash-lite mới nhất — model
// tên cụ thể sẽ nghỉ hưu (đo thật 12/08: 'gemini-2.5-flash-lite' trả 404 "no longer available to
// new users"). OpenAI: bản mini có vision, rẻ nhất trong nhóm đọc ảnh.
const DEFAULT_MODEL: Record<VisionProvider, string> = {
  gemini: 'gemini-flash-lite-latest',
  openai: 'gpt-4o-mini',
}

interface VisionCfg { provider: VisionProvider; model: string; key_enc: string }

let _cfgCache: { cfg: VisionCfg | null; at: number } | null = null
async function getCfg(): Promise<VisionCfg | null> {
  if (_cfgCache && Date.now() - _cfgCache.at < 30_000) return _cfgCache.cfg
  const { data } = await supabase.from('SystemSetting').select('value').eq('key', VISION_KEY).maybeSingle()
  const v = data?.value as Partial<VisionCfg> | null
  const prov: VisionProvider = isProvider(v?.provider) ? v.provider : 'gemini'
  const cfg = v && typeof v.key_enc === 'string' && v.key_enc
    ? { provider: prov, model: v.model ?? DEFAULT_MODEL[prov], key_enc: v.key_enc }
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
    model: cfg?.model ?? DEFAULT_MODEL.gemini,
    key_tail: key ? `••••${key.slice(-4)}` : null,
    providers: VISION_PROVIDERS,
    default_models: DEFAULT_MODEL,
  })
}

// PUT /wms/vision-config — { api_key?: string | null, model?: string, provider?: 'gemini'|'openai' }.
// api_key = null → GỠ cấu hình (app quay về thuần OCR). Bỏ trống api_key → chỉ đổi model/nhà cung cấp.
export async function saveVisionConfig(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 'Chỉ Admin', 403)
  const { api_key, model, provider } = req.body as { api_key?: string | null; model?: string; provider?: string }
  if (provider !== undefined && !isProvider(provider))
    return fail(res, `Nhà cung cấp AI không hợp lệ (chỉ nhận: ${VISION_PROVIDERS.join(', ')})`, 400)
  const now = new Date().toISOString()

  if (api_key === null) {
    const { error } = await supabase.from('SystemSetting').delete().eq('key', VISION_KEY)
    if (error) return fail(res, error.message, 500)
    _cfgCache = null
    return ok(res, { configured: false })
  }

  const cur = await getCfg()
  const prov: VisionProvider = isProvider(provider) ? provider : (cur?.provider ?? 'gemini')
  // Đổi nhà cung cấp mà không khai model → lấy model mặc định của nhà cung cấp MỚI
  // (giữ model cũ là chắc chắn 404: tên model Gemini không tồn tại bên OpenAI và ngược lại).
  const fallbackModel = prov === cur?.provider ? (cur?.model ?? DEFAULT_MODEL[prov]) : DEFAULT_MODEL[prov]
  const m = (model?.trim() || fallbackModel).trim()
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
    value: { provider: prov, model: m, key_enc: keyEnc },
    updated_by: req.user?.name ?? null,
    updated_at: now,
  }, { onConflict: 'key' })
  if (error) return fail(res, error.message, 500)
  _cfgCache = null
  return ok(res, { configured: true, provider: prov, model: m })
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

// Đầu vào CHUNG cho mọi nhà cung cấp — mỗi hàm call tự dựng payload theo định dạng của mình.
interface VisionInput { prompt: string; image?: { mime: string; b64: string } }

// TỰ CHỮA MODEL NGHỈ HƯU (đo thật 12/08 — Google 404 model cũ với user mới, tài liệu ngoài lỗi thời
// rất nhanh): gặp 404 → hỏi ListModels bằng CHÍNH key đó → chọn flash-lite/flash còn sống → thử lại
// + LƯU model mới vào config. Model sau này nghỉ hưu tiếp cũng tự chữa, không cần ai sửa tay.
async function discoverModel(provider: VisionProvider, key: string): Promise<string | null> {
  return provider === 'openai' ? discoverOpenAIModel(key) : discoverGeminiModel(key)
}

// Model NHỎ/RẺ hay mang các chữ này trong tên — dùng để gợi ý "rẻ" trên danh sách chọn.
const CHEAP_RE = /(mini|nano|lite|flash|small)/i

/**
 * Liệt kê model ĐỌC ĐƯỢC ẢNH của chính key đang dùng (không phải danh sách viết cứng trong code —
 * tên model hai bên đổi/nghỉ hưu liên tục). Lọc theo TÊN vì cả hai API đều không khai "có vision":
 * bỏ nhánh chỉ-âm-thanh / nhúng / sinh ảnh. Model lọt lưới mà không đọc được ảnh thì bấm
 * "Kiểm tra" sẽ báo lỗi ngay — không âm thầm hỏng luồng quét.
 */
async function listOpenAIModels(key: string): Promise<string[]> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!r.ok) return []
    const j = await r.json() as { data?: Array<{ id?: string }> }
    return (j.data ?? []).map(m => m.id ?? '')
      // các dòng CÓ đọc ảnh: gpt-4o / gpt-4.1 / gpt-5… và nhóm suy luận o3/o4 trở lên
      .filter(id => /^(gpt-4o|gpt-4\.1|gpt-[5-9]|o[3-9])/.test(id))
      .filter(id => !/audio|realtime|transcribe|tts|embed|moderation|search|image|dall|instruct/.test(id))
      .sort()
  } catch { return [] }
}

async function listGeminiModels(key: string): Promise<string[]> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!r.ok) return []
    const j = await r.json() as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> }
    return (j.models ?? [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => (m.name ?? '').replace(/^models\//, ''))
      .filter(n => !/tts|image|audio|embed|aqa|learnlm/.test(n))
      .sort()
  } catch { return [] }
}

const listModels = (provider: VisionProvider, key: string) =>
  provider === 'openai' ? listOpenAIModels(key) : listGeminiModels(key)

// Chọn model TỰ ĐỘNG khi model đang dùng nghỉ hưu: ưu tiên bản rẻ (mini/lite/flash).
async function discoverOpenAIModel(key: string): Promise<string | null> {
  const ids = await listOpenAIModels(key)
  return ids.filter(id => CHEAP_RE.test(id)).sort().reverse()[0] ?? ids.sort().reverse()[0] ?? null
}

async function discoverGeminiModel(key: string): Promise<string | null> {
  // Bản tự-chọn thì tránh nhánh preview/exp/thinking (không ổn định cho việc chạy hằng ngày);
  // danh sách CHO NGƯỜI CHỌN thì vẫn hiện đủ để ai muốn thử vẫn chọn được.
  const gen = (await listGeminiModels(key)).filter(n => !/preview|exp|thinking/.test(n))
  const pick = (re: RegExp) => {
    const c = gen.filter(n => re.test(n))
    return c.find(n => n.endsWith('-latest')) ?? c.sort().reverse()[0] ?? null
  }
  return pick(/flash-lite/) ?? pick(/flash/) ?? gen[0] ?? null
}

// POST /wms/vision-config/models — { provider?, api_key? } → danh sách model đọc-ảnh của CHÍNH key.
// api_key bỏ trống = dùng key đã lưu (cho phép xem danh sách trước khi lưu key mới).
export async function listVisionModels(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 'Chỉ Admin', 403)
  const { provider, api_key } = req.body as { provider?: string; api_key?: string }
  const cur = await getCfg()
  const prov: VisionProvider = isProvider(provider) ? provider : (cur?.provider ?? 'gemini')
  const raw = typeof api_key === 'string' && api_key.trim() ? api_key.trim() : null
  // Key đã lưu chỉ dùng được khi hỏi ĐÚNG nhà cung cấp của nó (key Google không hỏi được OpenAI)
  const key = raw ?? (cur && cur.provider === prov ? decryptSecret(cur.key_enc) : null)
  if (!key) return fail(res, 422, 'VISION_NOT_CONFIGURED', `Chưa có API key của ${prov} — dán key vào ô rồi thử lại`)

  const models = await listModels(prov, key)
  if (!models.length) return fail(res, 422, 'VISION_FAILED', 'Không lấy được danh sách model (key sai hoặc bị chặn mạng)')
  return ok(res, {
    provider: prov,
    models: models.map(id => ({ id, cheap: CHEAP_RE.test(id) })),
    suggested: await discoverModel(prov, key),
  })
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

// Gọi AI; model 404 (nghỉ hưu/sai tên) → tự dò model sống, thử lại 1 lần, lưu nếu ăn.
async function callAiHealing(cfg: VisionCfg, key: string, input: VisionInput, timeoutMs: number): Promise<{ text: string; model: string } | { err: string }> {
  const call = cfg.provider === 'openai' ? callOpenAI : callGemini
  const r1 = await call(cfg, key, input, timeoutMs)
  if (!('err' in r1)) return { ...r1, model: cfg.model }
  if (!r1.retired) return r1
  const m2 = await discoverModel(cfg.provider, key)
  if (!m2 || m2 === cfg.model) return r1
  const r2 = await call({ ...cfg, model: m2 }, key, input, timeoutMs)
  if ('err' in r2) return r1   // model dò cũng hỏng → trả lỗi gốc cho dễ hiểu
  await persistModel(m2).catch(() => {})
  return { ...r2, model: m2 }
}

// ─── OpenAI (GPT) ─────────────────────────────────────────────────────────────
// Cùng prompt, cùng shape JSON như Gemini nên luồng quét không cần biết đang dùng bên nào.
async function callOpenAI(cfg: VisionCfg, key: string, input: VisionInput, timeoutMs: number): Promise<{ text: string } | { err: string; retired?: boolean }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const content: unknown[] = [{ type: 'text', text: input.prompt }]
    if (input.image) content.push({ type: 'image_url', image_url: { url: `data:${input.image.mime};base64,${input.image.b64}` } })
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_completion_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content }],
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      let msg = `GPT trả ${r.status}`
      let retired = r.status === 404
      try {
        const j = JSON.parse(body) as { error?: { message?: string; code?: string } }
        const code = j.error?.code ?? ''
        if (r.status === 429 || code === 'insufficient_quota')
          msg = 'Hết hạn mức GPT (kiểm tra billing của tài khoản OpenAI) hoặc gọi quá nhanh'
        else if (r.status === 401 || r.status === 403) msg = 'API key bị OpenAI từ chối — kiểm tra key ở trang Kết nối ERP'
        else if (j.error?.message) msg = `GPT ${r.status}: ${j.error.message.slice(0, 160)}`
        if (code === 'model_not_found') retired = true
      } catch { /* body không phải JSON */ }
      return { err: msg, retired }
    }
    const j = await r.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = j.choices?.[0]?.message?.content ?? ''
    if (!text) return { err: 'GPT không trả nội dung' }
    return { text }
  } catch (e) {
    return { err: (e as Error).name === 'AbortError' ? 'AI Vision quá thời gian chờ' : `Không gọi được AI Vision: ${(e as Error).message}` }
  } finally { clearTimeout(timer) }
}

// ─── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(cfg: VisionCfg, key: string, input: VisionInput, timeoutMs: number): Promise<{ text: string } | { err: string; retired?: boolean }> {
  const parts: unknown[] = input.image
    ? [{ inlineData: { mimeType: input.image.mime, data: input.image.b64 } }, { text: input.prompt }]
    : [{ text: input.prompt }]
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
        // maxOutputTokens nhỏ (JSON trả ~60 token) — cắt đuôi sinh chữ thừa, phản hồi nhanh hơn
        generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 300 },
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
  const r = await callAiHealing(cfg, key, { prompt: 'Trả về đúng JSON: {"ok": true}' }, 15_000)
  if ('err' in r) return fail(res, 422, 'VISION_FAILED', r.err)
  return ok(res, { ok: true, provider: cfg.provider, model: r.model, healed: r.model !== cfg.model, latency_ms: Date.now() - t0 })
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

  const r = await callAiHealing(cfg, key, { prompt: OCR_PROMPT, image: { mime: m[1], b64: m[2] } }, 25_000)
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
    engine: cfg.provider, model: r.model,
  })
}
