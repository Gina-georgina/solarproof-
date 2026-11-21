/**
 * Unit tests for webhook signature verification (issue #29).
 *
 * Covers:
 *  - Valid HMAC-SHA256 signature → 201 Created
 *  - Missing signature header  → 401 Unauthorized
 *  - Invalid signature header  → 401 Unauthorized
 *  - No WEBHOOK_SECRET set     → verification skipped, 201 Created
 */
import { createHmac } from 'crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── DNS mock ────────────────────────────────────────────────────────────────
// Controls what dns.promises.lookup resolves to, so we can simulate SSRF
// targets (private IPs, loopback, link-local) without real network access.
const mockDnsLookup = vi.fn()

vi.mock('dns', () => ({
  promises: {
    lookup: (...args: unknown[]) => mockDnsLookup(...args),
  },
}))

// ── Env mock ────────────────────────────────────────────────────────────────
// We control the WEBHOOK_SECRET via the module mock below.
let mockWebhookSecret: string | undefined = 'super-secret-value-xyz'

vi.mock('@/env', () => ({
  env: new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === 'WEBHOOK_SECRET') return mockWebhookSecret
      // Provide minimal values for the rest of the env
      return 'mock-value'
    },
  }),
}))

// ── Supabase mock ────────────────────────────────────────────────────────────
const mockInsertResult = {
  id: 'wh-id-1',
  cooperative_id: '00000000-0000-0000-0000-000000000001',
  url: 'https://example.com/hook',
  events: ['anchor'],
  active: true,
  created_at: new Date().toISOString(),
}

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: mockInsertResult, error: null }),
        }),
      }),
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  }),
}))

// ── Helper ───────────────────────────────────────────────────────────────────

function makeBody() {
  return JSON.stringify({
    cooperative_id: '00000000-0000-0000-0000-000000000001',
    url: 'https://example.com/hook',
    secret: 'a-secret-longer-than-sixteen-chars',
    events: ['anchor'],
  })
}

function buildRequest(bodyStr: string, sigHeader?: string): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (sigHeader !== undefined) {
    headers['x-solarproof-signature'] = sigHeader
  }
  return new NextRequest('http://localhost/api/webhooks', {
    method: 'POST',
    headers,
    body: bodyStr,
  })
}

function computeSig(secret: string, body: string): string {
  return createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')
}

function makeBodyWithUrl(url: string) {
  return JSON.stringify({
    cooperative_id: '00000000-0000-0000-0000-000000000001',
    url,
    secret: 'a-secret-longer-than-sixteen-chars',
    events: ['anchor'],
  })
}

function mockLookupTo(address: string) {
  mockDnsLookup.mockResolvedValue({ address, family: address.includes(':') ? 6 : 4 })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks — signature verification (issue #29)', () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeEach(async () => {
    mockDnsLookup.mockReset()
    mockLookupTo('93.184.216.34') // public IP by default
    // Re-import so the mock env is used each test
    const mod = await import('./route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('accepts a request with a valid HMAC-SHA256 signature', async () => {
    mockWebhookSecret = 'super-secret-value-xyz'
    const body = makeBody()
    const sig = computeSig('super-secret-value-xyz', body)
    const req = buildRequest(body, sig)
    const res = await POST(req)
    expect(res.status).toBe(201)
  })

  it('returns 401 when the signature header is missing', async () => {
    mockWebhookSecret = 'super-secret-value-xyz'
    const req = buildRequest(makeBody()) // no sig header
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/signature/i)
  })

  it('returns 401 when the signature is wrong', async () => {
    mockWebhookSecret = 'super-secret-value-xyz'
    const req = buildRequest(makeBody(), 'deadbeef'.repeat(8)) // wrong sig
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/signature/i)
  })

  it('skips verification when WEBHOOK_SECRET is not set', async () => {
    mockWebhookSecret = undefined
    const req = buildRequest(makeBody()) // no sig header — should be fine
    const res = await POST(req)
    expect(res.status).toBe(201)
  })
})

// ── SSRF protection tests (issue #767) ───────────────────────────────────────

describe('validateWebhookUrl — SSRF protection (issue #767)', () => {
  let validateWebhookUrl: (url: string) => Promise<void>

  beforeEach(async () => {
    mockDnsLookup.mockReset()
    const mod = await import('@/lib/webhook-url')
    validateWebhookUrl = mod.validateWebhookUrl
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('rejects a private (RFC 1918) IP URL', async () => {
    mockLookupTo('10.0.0.1')
    await expect(validateWebhookUrl('https://10.0.0.1/hook')).rejects.toThrow(
      /private|blocked|not allowed/i
    )
  })

  it('rejects a loopback IP URL', async () => {
    mockLookupTo('127.0.0.1')
    await expect(validateWebhookUrl('https://127.0.0.1/hook')).rejects.toThrow(
      /loopback|private|blocked|not allowed/i
    )
  })

  it('rejects a link-local IP URL (cloud metadata endpoint)', async () => {
    mockLookupTo('169.254.169.254')
    await expect(
      validateWebhookUrl('https://169.254.169.254/latest/meta-data')
    ).rejects.toThrow(/link-local|private|blocked|not allowed/i)
  })

  it('rejects a hostname that resolves to a private IP (DNS rebinding)', async () => {
    mockLookupTo('192.168.1.10')
    await expect(validateWebhookUrl('https://evil.example.com/hook')).rejects.toThrow(
      /private|blocked|not allowed/i
    )
  })

  it('accepts a valid public URL', async () => {
    mockLookupTo('93.184.216.34')
    await expect(validateWebhookUrl('https://example.com/hook')).resolves.toBeUndefined()
  })
})

describe('POST /api/webhooks — SSRF protection (issue #767)', () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeEach(async () => {
    mockDnsLookup.mockReset()
    mockWebhookSecret = 'super-secret-value-xyz'
    const mod = await import('./route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns 400 with a descriptive error for a blocked URL', async () => {
    mockLookupTo('169.254.169.254')
    const body = makeBodyWithUrl('https://169.254.169.254/latest/meta-data')
    const sig = computeSig('super-secret-value-xyz', body)
    const req = buildRequest(body, sig)
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/url|blocked|private|not allowed/i)
  })
})
