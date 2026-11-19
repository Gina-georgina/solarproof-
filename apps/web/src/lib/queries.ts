import { useMutation } from '@tanstack/react-query'

export interface ChainOfCustody {
  certificate: {
    id: string
    kwh: number
    issued_at: string
    retired: boolean
    retired_at: string | null
    retired_by: string | null
  }
  on_chain: {
    anchor_tx: string
    anchor_explorer: string
    mint_tx: string
    mint_explorer: string
  }
  meter_proof:
    | {
        meter_id: string
        reading_hash: string
        signature_hex: string
        kwh: number
        timestamp: string
        verified: boolean
      }
    | null
}

export async function verifyCertificate(id: string): Promise<ChainOfCustody> {
  const response = await fetch(`/api/verify?id=${encodeURIComponent(id)}`)
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error((body as { error?: string })?.error ?? 'Verification failed')
  }

  return body as ChainOfCustody
}

export function useVerifyCertificate() {
  return useMutation<ChainOfCustody, Error, string>({
    mutationFn: verifyCertificate,
    retry: false,
  })
}

/**
 * Public, non-PII aggregate profile for a cooperative.
 *
 * Intentionally excludes sensitive fields such as `admin_address` and
 * operator contact details (e.g. email). Only aggregate/transparency data
 * is exposed here for the public /cooperatives/[id] page.
 */
export interface PublicCooperativeProfile {
  id: string
  name: string
  location: string | null
  total_kwh_produced: number
  active_meters: number
  certificates_issued: number
}

/**
 * Fetch the public aggregate profile for a cooperative.
 *
 * The API endpoint is expected to return only non-PII fields; this helper
 * additionally strips any unexpected sensitive fields defensively so that
 * PII can never leak into the public page.
 */
export async function getPublicCooperativeProfile(
  id: string,
): Promise<PublicCooperativeProfile> {
  const response = await fetch(
    `/api/cooperatives/${encodeURIComponent(id)}/public`,
  )
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      (body as { error?: string })?.error ?? 'Failed to load cooperative profile',
    )
  }

  const raw = (body ?? {}) as Record<string, unknown>

  return {
    id: typeof raw.id === 'string' ? raw.id : id,
    name: typeof raw.name === 'string' ? raw.name : '',
    location: typeof raw.location === 'string' ? raw.location : null,
    total_kwh_produced:
      typeof raw.total_kwh_produced === 'number' ? raw.total_kwh_produced : 0,
    active_meters:
      typeof raw.active_meters === 'number' ? raw.active_meters : 0,
    certificates_issued:
      typeof raw.certificates_issued === 'number'
        ? raw.certificates_issued
        : 0,
  }
}