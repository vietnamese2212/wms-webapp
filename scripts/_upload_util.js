/** Helper dùng chung cho các script import (đọc .env backend, Supabase service role, đọc template). */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
require(path.join(BASE, 'node_modules', 'dotenv')).config({ path: path.join(BASE, '.env') })
const { createClient } = require(path.join(BASE, 'node_modules', '@supabase', 'supabase-js'))
const XLSX = require(path.join(BASE, 'node_modules', 'xlsx'))

const supabase = createClient(
  process.env.SUPABASE_URL,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^<|>$/g, ''),
  { auth: { persistSession: false } },
)

const S = v => { const s = String(v ?? '').trim(); return s || null }
const I = v => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isNaN(n) ? null : n }

/**
 * Đọc template. Truyền `keys` (mảng key theo đúng thứ tự cột) để map theo VỊ TRÍ —
 * chịu được cả khi người dùng đã xoá dòng key (chỉ còn nhãn + data).
 *   - Nếu còn dòng key (raw[1] khớp keys): data từ dòng 3.
 *   - Nếu mất dòng key: bỏ dòng nhãn (raw[0]), data từ dòng 2, map theo vị trí.
 * Không truyền keys → giữ hành vi cũ (dòng 2 = key).
 */
function readRows(file, keys) {
  const wb = XLSX.readFile(path.resolve(file))
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', header: 1 })
  if (raw.length < 2) return []
  const norm = a => (a || []).map(x => String(x == null ? '' : x).trim())
  const isKeyRow = r => keys && keys.length && keys.every((k, i) => norm(r)[i] === k)
  let headerKeys, start
  if (isKeyRow(raw[1]))           { headerKeys = keys; start = 2 }
  else if (isKeyRow(raw[0]))      { headerKeys = keys; start = 1 }
  else if (keys && keys.length)   { headerKeys = keys; start = 1 } // mất dòng key → map theo vị trí
  else                            { headerKeys = norm(raw[1]); start = 2 }
  return raw.slice(start)
    .map(r => Object.fromEntries(headerKeys.map((k, i) => [k, r[i]])))
    .filter(r => Object.values(r).some(v => S(v)))
}

/** Map tên(lowercase) → id từ 1 bảng. */
async function nameMap(table, nameCol = 'name', idCol = 'id', extra) {
  let q = supabase.from(table).select(`${idCol}, ${nameCol}`)
  const { data } = await q
  const m = new Map()
  for (const r of data ?? []) m.set(String(r[nameCol] || '').trim().toLowerCase(), r[idCol])
  return m
}

module.exports = { supabase, XLSX, S, I, readRows, nameMap }
