import * as Sentry from '@sentry/nextjs'

/**
 * PII scrubbing for Sentry events (issue #768).
 *
 * Sentry error reports can inadvertently capture personal data — JWT payloads,
 * email addresses, public keys, and signatures — via stack traces, breadcrumbs,
 * request bodies, or manually attached `extra`/`contexts`. To prevent leaks we
 * recursively walk the event and redact both known-sensitive keys and any
 * string values that match the documented patterns below.
 *
 * Documented regex patterns:
 *
 *   JWT_PATTERN
 *     /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
 *     Matches a JSON Web Token: three base64url segments separated by dots.
 *     JWTs always begin with the base64url encoding of `{"` which is `eyJ`,
 *     so this prefix anchors the match. Covers access tokens, refresh tokens,
 *     and any other JWT embedded in a string (e.g. an Authorization header).
 *
 *   EMAIL_PATTERN
 *     /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
 *     Matches a standard email address: local part, `@`, domain, and a TLD of
 *     at least two letters. Catches emails in messages, URLs, and free text.
 *
 * All matches are replaced with the literal string `[REDACTED]`.
 */

/** Matches a JSON Web Token (header.payload.signature). See file header. */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

/** Matches a standard email address. See file header. */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** Keys whose values must always be redacted, regardless of content. */
const SENSITIVE_KEYS = new Set([
  'email',
  'access_token',
  'refresh_token',
  'pubkey_hex',
  'signature_hex',
])

const REDACTED = '[REDACTED]'

/** Replace JWT and email patterns within a string. */
function scrubString(value: string): string {
  return value.replace(JWT_PATTERN, REDACTED).replace(EMAIL_PATTERN, REDACTED)
}

/**
 * Recursively walk an arbitrary value and return a scrubbed copy.
 * - Objects: sensitive keys are replaced with `[REDACTED]`; other values recurse.
 * - Arrays: each element is recursed.
 * - Strings: JWT/email patterns are replaced.
 * - Primitives: returned unchanged.
 *
 * A `WeakSet` guards against circular references.
 */
function scrubValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') {
    return scrubString(value)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (seen.has(value as object)) {
    return value
  }
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = REDACTED
    } else {
      result[key] = scrubValue(val, seen)
    }
  }
  return result
}

/**
 * Scrub PII from a Sentry event in place.
 *
 * Walks the fields most likely to carry personal data: `extra`, `contexts`,
 * `breadcrumbs`, `request` (data, headers, query string, cookies, URL),
 * `tags`, and exception values. Returns the same event for convenience.
 */
export function scrubPii<E extends Sentry.Event>(event: E): E {
  if (event.extra) {
    event.extra = scrubValue(event.extra) as typeof event.extra
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as typeof event.contexts
  }

  if (event.tags) {
    event.tags = scrubValue(event.tags) as typeof event.tags
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      const scrubbed = scrubValue(breadcrumb) as typeof breadcrumb
      return scrubbed
    })
  }

  if (event.request) {
    event.request = scrubValue(event.request) as typeof event.request
  }

  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((exception) => {
      const scrubbed = scrubValue(exception) as typeof exception
      return scrubbed
    })
  }

  if (event.message) {
    event.message = scrubString(event.message)
  }

  return event
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
  /**
   * Attach the X-Correlation-ID header to every Sentry event so that
   * Sentry errors can be cross-referenced with structured log entries
   * (issue #33), and scrub PII before the event leaves the process
   * (issue #768).
   */
  beforeSend(event, hint) {
    // Pull the correlation ID off the active scope tags if set by
    // createRequestLogger(), and surface it as a top-level extra field
    // so it's easily searchable in the Sentry UI.
    const correlationId = event.tags?.correlationId
    if (correlationId) {
      event.extra = {
        ...event.extra,
        correlationId,
      }
    }
    // Suppress noisy non-errors in production
    if (process.env.NODE_ENV === 'production' && hint?.originalException === null) {
      return null
    }
    // Scrub PII (emails, JWTs, keys, signatures) before sending to Sentry.
    return scrubPii(event)
  },
})