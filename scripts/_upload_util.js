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

/** Đọc template: dòng 1 = nhãn, dòng 2 = key, dòng 3+ = data. Trả mảng object theo key. */
function readRows(file) {
  const wb = XLSX.readFile(path.resolve(file))
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 })
  if (raw.length < 2) return []
  const keys = raw[1].map(k => String(k || '').trim())
  return raw.slice(2)
    .map(r => Object.fromEntries(keys.map((k, i) => [k, r[i]])))
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
