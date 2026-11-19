import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'

const MAX_PAGE_SIZE = 100

// Allowlist for free-text search input. Supabase's `.or()` builds a raw
// PostgREST filter string, so any interpolated value must be strictly
// constrained to characters that cannot alter the filter grammar
// (no commas, dots, parentheses, quotes, wildcards, etc.).
const SAFE_SEARCH_PATTERN = /^[A-Za-z0-9_-]+$/

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  cursor: z.string().optional(),
  // Backward-compatible offset pagination (deprecated — prefer cursor)
  page: z.coerce.number().int().min(1).optional(),
  q: z
    .string()
    .trim()
    .default('')
    .refine((value) => value === '' || SAFE_SEARCH_PATTERN.test(value), {
      message: 'q may only contain letters, numbers, hyphens and underscores',
    }),
  status: z.enum(['active', 'retired']).nullable().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
})

/**
 * GET /api/v1/certificates
 *
 * Cursor-based pagination via `cursor` (opaque ISO timestamp of `issued_at`)
 * and `limit` (max 100). Returns `{ data, next_cursor, has_more, total }`.
 *
 * Backward-compatible: `page` + `limit` offset pagination is still accepted
 * but `cursor` takes precedence when both are present.
 *
 * Filter params:
 *   q          — prefix search on certificate id or meter_id (via readings join)
 *   status     — "active" | "retired"
 *   date_from  — ISO date string (inclusive lower bound on issued_at)
 *   date_to    — ISO date string (inclusive upper bound on issued_at)
 *
 * Cursor design:
 *   - The cursor encodes the `issued_at` timestamp of the last-seen row.
 *   - The DB query uses `.lt('issued_at', cursor)` which hits the indexed
 *     column directly — no sequential scan or OFFSET needed.
 *   - `next_cursor` in the response is the `issued_at` of the last row
 *     returned; pass it as `cursor` in the next request.
 *   - When `has_more` is false, `next_cursor` is null.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const queryParams = Object.fromEntries(searchParams.entries())
  const parsedQuery = QuerySchema.safeParse(queryParams)

  if (!parsedQuery.success) {
    return NextResponse.json({ error: parsedQuery.error.flatten() }, { status: 400 })
  }

  const { limit, cursor, page, q, status, date_from: dateFrom, date_to: dateTo } = parsedQuery.data

  const db = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (db as any)
    .from('certificates')
    .select(
      'id, kwh, issued_at, retired, retired_at, retired_by, mint_tx_hash, readings!inner(meter_id)',
      { count: 'exact' }
    )
    .order('issued_at', { ascending: false })
    .limit(limit + 1) // fetch one extra to detect whether there is a next page

  // Cursor-based pagination (preferred): filter by indexed issued_at column
  if (cursor) {
    query = query.lt('issued_at', cursor)
  } else if (page && page > 1) {
    // Fallback: offset pagination for backward compat (deprecated)
    query = query.range((page - 1) * limit, page * limit)
  }

  if (status === 'active') query = query.eq('retired', false)
  if (status === 'retired') query = query.eq('retired', true)
  if (dateFrom) query = query.gte('issued_at', dateFrom)
  if (dateTo) query = query.lte('issued_at', dateTo + 'T23:59:59.999Z')

  // Text search: match cert id prefix OR meter_id prefix via the joined reading.
  // `q` has already been validated against SAFE_SEARCH_PATTERN by QuerySchema,
  // so it cannot break out of the PostgREST filter expression. The `%` wildcard
  // is appended outside the interpolated value.
  if (q) {
    query = query.or(`id.ilike.${q}%,readings.meter_id.ilike.${q}%`)
  }

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<{
    id: string
    kwh: number
    issued_at: string
    retired: boolean
    retired_at: string | null
    retired_by: string | null
    mint_tx_hash: string | null
    readings: { meter_id: string } | { meter_id: string }[]
  }>

  const hasMore = rows.length > limit
  const page_data = hasMore ? rows.slice(0, limit) : rows
  const next_cursor = hasMore ? page_data[page_data.length - 1].issued_at : null

  // Flatten the joined meter_id onto each row
  const normalized = page_data.map(({ readings, ...cert }) => ({
    ...cert,
    meter_id: Array.isArray(readings) ? readings[0]?.meter_id : readings?.meter_id ?? null,
  }))

  return NextResponse.json({
    data: normalized,
    next_cursor,
    has_more: hasMore,
    total: count ?? 0,
  })
}
