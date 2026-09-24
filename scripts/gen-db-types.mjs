// SINH KIỂU DB cho supabase-js từ information_schema (11/09/2026) → backend/src/types/database.ts
//
// VÌ SAO TỰ VIẾT: `supabase gen types --db-url` bản CLI v2 đòi Docker (không có trên máy dev / CI),
// còn `--project-id` đòi access token cá nhân. Script này chỉ cần `pg` (devDependency backend) + DIRECT_URL
// trong backend/.env (STAGING). Kết quả cùng hình dạng `Database` mà `createClient<Database>()` hiểu:
// tên bảng/cột/hàm RPC sai → lỗi tsc; INSERT thiếu cột NOT NULL không default (id, updated_at) → lỗi tsc
// thay vì 23502 lúc chạy; trạng thái enum ('DONE' vs 'COMPLETED') → lỗi tsc khi cột là enum thật.
//
// CHẠY LẠI SAU MỖI MIGRATION ĐÃ APPLY STAGING: `node scripts/gen-db-types.mjs` rồi commit file sinh ra.
// Gói QA 09 có luật `db_types_stale` so tên bảng trong file sinh với bảng mà code đang gọi (`.from('X')`).
// usage: node scripts/gen-db-types.mjs [--out backend/src/types/database.ts]
import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'backend', 'package.json'))
const { Client } = require('pg')

const outArg = process.argv.indexOf('--out')
const OUT = join(ROOT, outArg > 0 ? process.argv[outArg + 1] : 'backend/src/types/database.ts')

function readEnv(name) {
  if (process.env[name]) return process.env[name]
  try {
    const line = readFileSync(join(ROOT, 'backend/.env'), 'utf8').split(/\r?\n/).find(l => l.startsWith(name + '='))
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : ''
  } catch { return '' }
}
const url = readEnv('DIRECT_URL') || readEnv('DATABASE_URL')
if (!url) { console.error('Thiếu DIRECT_URL/DATABASE_URL (backend/.env hoặc env)'); process.exit(1) }
if (/svicyfquresxaigfxsdb/.test(url)) { console.error('⛔ URL trỏ PRODUCTION — chỉ sinh kiểu từ STAGING'); process.exit(1) }

// Kiểu Postgres → TypeScript (theo đúng bảng của supabase CLI)
function tsType(udt, dataType, enums) {
  if (dataType === 'ARRAY') {
    const inner = udt.startsWith('_') ? udt.slice(1) : udt
    return `${tsType(inner, inner, enums)}[]`
  }
  if (enums.has(udt)) return `Database['public']['Enums']['${udt}']`
  switch (udt) {
    case 'bool': return 'boolean'
    case 'int2': case 'int4': case 'int8': case 'float4': case 'float8': case 'numeric': case 'oid': return 'number'
    case 'json': case 'jsonb': return 'Json'
    case 'text': case 'varchar': case 'bpchar': case 'char': case 'name': case 'uuid': case 'citext':
    case 'date': case 'time': case 'timetz': case 'timestamp': case 'timestamptz': case 'interval':
    case 'bytea': case 'inet': case 'cidr': case 'macaddr': case 'tsvector': return 'string'
    case 'record': return 'Record<string, unknown>'
    case 'void': return 'undefined'
    default: return 'unknown'
  }
}
const q = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : JSON.stringify(s)

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
try {
  const enums = new Map()
  for (const r of (await c.query(`
    select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' order by t.typname, e.enumsortorder`)).rows)
    (enums.get(r.typname) ?? enums.set(r.typname, []).get(r.typname)).push(r.enumlabel)

  const tables = (await c.query(`
    select table_name, table_type from information_schema.tables
    where table_schema = 'public' order by table_name`)).rows
  const cols = (await c.query(`
    select table_name, column_name, udt_name, data_type, is_nullable, column_default, is_generated, identity_generation
    from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`)).rows
  const byTable = new Map()
  for (const r of cols) (byTable.get(r.table_name) ?? byTable.set(r.table_name, []).get(r.table_name)).push(r)

  // Hàm RPC: tên + tham số (tên, kiểu, có default) + kiểu trả về. Bỏ hàm trigger/nội bộ.
  const fns = (await c.query(`
    select p.proname, pg_get_function_result(p.oid) as result, p.proretset,
           t.typname as rettype, p.proargnames, p.pronargdefaults, p.pronargs,
           array(select typname from unnest(p.proargtypes) with ordinality u(oid, ord) join pg_type on pg_type.oid = u.oid order by ord) as argtypes,
           array(select m from unnest(coalesce(p.proargmodes, array_fill('i'::"char", array[p.pronargs]))) m) as argmodes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and p.prokind = 'f' and t.typname <> 'trigger' and t.typname <> 'event_trigger'
    order by p.proname`)).rows

  const lines = []
  lines.push('// FILE SINH TỰ ĐỘNG — `node scripts/gen-db-types.mjs` (từ information_schema STAGING). KHÔNG sửa tay.')
  lines.push(`// Sinh lúc ${new Date().toISOString()} · ${tables.length} bảng/view · ${fns.length} hàm · ${enums.size} enum`)
  lines.push('export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]')
  lines.push('')
  lines.push('export type Database = {')
  lines.push('  public: {')
  lines.push('    Tables: {')
  for (const t of tables.filter(t => t.table_type === 'BASE TABLE')) {
    const cs = byTable.get(t.table_name) ?? []
    lines.push(`      ${q(t.table_name)}: {`)
    lines.push('        Row: {')
    for (const col of cs) lines.push(`          ${q(col.column_name)}: ${tsType(col.udt_name, col.data_type, enums)}${col.is_nullable === 'YES' ? ' | null' : ''}`)
    lines.push('        }')
    lines.push('        Insert: {')
    for (const col of cs) {
      const optional = col.is_nullable === 'YES' || col.column_default != null || col.is_generated === 'ALWAYS' || col.identity_generation
      lines.push(`          ${q(col.column_name)}${optional ? '?' : ''}: ${tsType(col.udt_name, col.data_type, enums)}${col.is_nullable === 'YES' ? ' | null' : ''}`)
    }
    lines.push('        }')
    lines.push('        Update: {')
    for (const col of cs) lines.push(`          ${q(col.column_name)}?: ${tsType(col.udt_name, col.data_type, enums)}${col.is_nullable === 'YES' ? ' | null' : ''}`)
    lines.push('        }')
    lines.push('        Relationships: []')
    lines.push('      }')
  }
  lines.push('    }')
  lines.push('    Views: {')
  for (const t of tables.filter(t => t.table_type !== 'BASE TABLE')) {
    const cs = byTable.get(t.table_name) ?? []
    lines.push(`      ${q(t.table_name)}: {`)
    lines.push('        Row: {')
    for (const col of cs) lines.push(`          ${q(col.column_name)}: ${tsType(col.udt_name, col.data_type, enums)} | null`)
    lines.push('        }')
    lines.push('        Relationships: []')
    lines.push('      }')
  }
  lines.push('    }')
  lines.push('    Functions: {')
  // Hàm trùng tên (overload) → gộp Args thành union
  const fnByName = new Map()
  for (const f of fns) (fnByName.get(f.proname) ?? fnByName.set(f.proname, []).get(f.proname)).push(f)
  for (const [name, overloads] of fnByName) {
    const argsVariants = overloads.map(f => {
      const names = f.proargnames ?? []
      const parts = []
      let inIdx = 0
      for (let i = 0; i < f.argtypes.length; i++) {
        const mode = f.argmodes[i] ?? 'i'
        if (mode !== 'i' && mode !== 'b' && mode !== 'v') continue   // bỏ OUT/TABLE args
        const nm = names[i] || `arg${i + 1}`
        const hasDefault = inIdx >= f.pronargs - f.pronargdefaults
        parts.push(`${q(nm)}${hasDefault ? '?' : ''}: ${tsType(f.argtypes[i], f.argtypes[i], enums)}`)
        inIdx++
      }
      return parts.length ? `{ ${parts.join('; ')} }` : 'Record<PropertyKey, never>'
    })
    const f0 = overloads[0]
    let ret
    if (/^TABLE\(/.test(f0.result) || f0.rettype === 'record') ret = 'Record<string, unknown>[]'
    else ret = tsType(f0.rettype, f0.rettype, enums) + (f0.proretset ? '[]' : '')
    lines.push(`      ${q(name)}: {`)
    lines.push(`        Args: ${[...new Set(argsVariants)].join(' | ')}`)
    lines.push(`        Returns: ${ret}`)
    lines.push('      }')
  }
  lines.push('    }')
  lines.push('    Enums: {')
  for (const [name, labels] of enums) lines.push(`      ${q(name)}: ${labels.map(l => JSON.stringify(l)).join(' | ')}`)
  lines.push('    }')
  lines.push('    CompositeTypes: Record<string, never>')
  lines.push('  }')
  lines.push('}')
  lines.push('')
  lines.push("export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']")
  lines.push("export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']")
  lines.push("export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']")
  lines.push("export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]")
  writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(`✅ ${OUT.slice(ROOT.length + 1)}: ${tables.length} bảng/view · ${fnByName.size} hàm · ${enums.size} enum · ${lines.length} dòng`)
} finally {
  await c.end()
}
