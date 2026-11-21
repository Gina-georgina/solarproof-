import { createHmac } from 'crypto'
import { promises as dns } from 'dns'
import { isIP } from 'net'
import { createServiceClient } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'

export type WebhookEvent =
  | 'anchor'
  | 'mint'
  | 'retire'
  | 'mint_failed'
  | 'certificate.minted'
  | 'certificate.transferred'
  | 'certificate.retired'
  | 'certificate.verified'
  | 'certificate.failed'

export interface WebhookPayload {
  event: WebhookEvent
  cooperative_id: string
  data: Record<string, unknown>
  timestamp: string
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * Returns true if the given IP address is in a blocked range:
 * RFC1918 private, loopback, link-local, unique-local, or cloud metadata.
 */
function isBlockedIp(ip: string): boolean {
  const family = isIP(ip)

  if (family === 4) {
    const parts = ip.split('.').map((p) => Number(p))
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true
    const [a, b] = parts

    // Loopback 127.0.0.0/8
    if (a === 127) return true
    // Link-local 169.254.0.0/16 (includes cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true
    // RFC1918 private ranges
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    // "This" network 0.0.0.0/8
    if (a === 0) return true
    // Carrier-grade NAT 100.64.0.0/10
    if (a === 100 && b >= 64 && b <= 127) return true
    // Broadcast / reserved
    if (a >= 224) return true

    return false
  }

  if (family === 6) {
    const normalized = ip.toLowerCase()
    // Loopback ::1
    if (normalized === '::1') return true
    // Unspecified ::
    if (normalized === '::') return true
    // Link-local fe80::/10
    if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true
    // Unique-local fc00::/7
    if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true
    // IPv4-mapped addresses (::ffff:a.b.c.d) — re-check the embedded IPv4
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedIp(mapped[1])
    return false
  }

  // Not a valid IP — treat as blocked to fail safe
  return true
}

/**
 * Validate a webhook URL against SSRF attacks.
 *
 * - Requires http/https scheme
 * - Resolves the hostname (all addresses) and rejects any resolved IP that is
 *   private, loopback, link-local, unique-local, or a cloud metadata address.
 *
 * Throws a descriptive error when the URL is blocked.
 */
export async function validateWebhookUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid webhook URL: ${url}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Webhook URL must use http or https (got ${parsed.protocol})`)
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (!hostname) {
    throw new Error('Webhook URL is missing a hostname')
  }

  // If the hostname is already an IP literal, check it directly.
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`Webhook URL resolves to a blocked IP address: ${hostname}`)
    }
    return
  }

  let addresses: { address: string; family: number }[]
  try {
    addresses = await dns.lookup(hostname, { all: true })
  } catch {
    throw new Error(`Unable to resolve webhook hostname: ${hostname}`)
  }

  if (!addresses.length) {
    throw new Error(`Unable to resolve webhook hostname: ${hostname}`)
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new Error(`Webhook URL resolves to a blocked IP address: ${address}`)
    }
  }
}

const MAX_ATTEMPTS = 5

async function deliver(url: string, secret: string, payload: WebhookPayload): Promise<{ status: number; attempts: number }> {
  const body = JSON.stringify(payload)
  const sig = sign(secret, body)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Re-validate on every attempt to mitigate DNS rebinding attacks.
      await validateWebhookUrl(url)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SolarProof-Signature': sig },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { status: res.status, attempts: attempt }
      if (attempt === MAX_ATTEMPTS) return { status: res.status, attempts: attempt }
    } catch {
      if (attempt === MAX_ATTEMPTS) throw new Error(`Webhook delivery failed after ${MAX_ATTEMPTS} attempts`)
    }
    // Exponential backoff: 1s, 2s, 4s, 8s between retries
    await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000))
  }
  return { status: 0, attempts: MAX_ATTEMPTS }
}

/**
 * Fire a webhook event to all active endpoints subscribed to it.
 * Logs each delivery attempt. Never throws — failures are logged only.
 */
export async function fireWebhook(
  cooperative_id: string,
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  const db = createServiceClient()

  const { data: endpoints } = await db
    .from('webhook_endpoints')
    .select('id, url, secret')
    .eq('cooperative_id', cooperative_id)
    .eq('active', true)
    .contains('events', [event])

  if (!endpoints?.length) return

  const payload: WebhookPayload = { event, cooperative_id, data, timestamp: new Date().toISOString() }

  await Promise.allSettled(
    endpoints.map(async (ep) => {
      let status = 'failed'
      let responseStatus: number | null = null
      let attempts = 0
      try {
        const result = await deliver(ep.url, ep.secret, payload)
        responseStatus = result.status
        attempts = result.attempts
        status = responseStatus >= 200 && responseStatus < 300 ? 'delivered' : 'failed'
      } catch (err) {
        attempts = MAX_ATTEMPTS
        console.error(`Webhook delivery blocked or failed for endpoint ${ep.id}:`, err)
      }
      await db.from('webhook_logs').insert({
        endpoint_id: ep.id,
        event,
        payload: payload as unknown as Json,
        status,
        attempts,
        response_status: responseStatus,
      })
    })
  )
}
