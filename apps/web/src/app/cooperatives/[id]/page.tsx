import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CooperativePublicProfile {
  id: string;
  name: string;
  location: string | null;
  total_kwh_produced: number;
  active_meters: number;
  certificates_issued: number;
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------
// The public profile is served from a dedicated, RLS-safe view
// (`cooperative_public_profiles`) that only exposes aggregate, non-PII
// columns. `admin_address` and operator email are intentionally absent from
// the view so they can never leak through this page.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function fetchCooperativeProfile(
  id: string,
): Promise<CooperativePublicProfile | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/cooperative_public_profiles`);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set(
    'select',
    'id,name,location,total_kwh_produced,active_meters,certificates_issued',
  );
  url.searchParams.set('limit', '1');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
      // Revalidate periodically so stats stay reasonably fresh without
      // hammering the database on every request.
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return null;
    }

    const rows = (await res.json()) as CooperativePublicProfile[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    return rows[0];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '0';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function formatKwh(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '0 kWh';
  }
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value)} kWh`;
}

// ---------------------------------------------------------------------------
// SEO metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const profile = await fetchCooperativeProfile(params.id);

  if (!profile) {
    return {
      title: 'Cooperative not found',
      description:
        'The requested cooperative profile could not be found.',
    };
  }

  const locationPart = profile.location ? ` in ${profile.location}` : '';
  const title = `${profile.name} — Cooperative Profile`;
  const description = `${profile.name}${locationPart} has produced ${formatKwh(
    profile.total_kwh_produced,
  )} of renewable energy and issued ${formatNumber(
    profile.certificates_issued,
  )} certificates.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'profile',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CooperativeProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const profile = await fetchCooperativeProfile(params.id);

  if (!profile) {
    notFound();
  }

  const stats: { label: string; value: string }[] = [
    { label: 'Total kWh produced', value: formatKwh(profile.total_kwh_produced) },
    { label: 'Active meters', value: formatNumber(profile.active_meters) },
    {
      label: 'Certificates issued',
      value: formatNumber(profile.certificates_issued),
    },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">Cooperatives</span>
      </nav>

      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          {profile.name}
        </h1>
        {profile.location && (
          <p className="mt-2 text-lg text-gray-600">{profile.location}</p>
        )}
      </header>

      <section aria-labelledby="stats-heading">
        <h2
          id="stats-heading"
          className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500"
        >
          Production &amp; impact
        </h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            >
              <dt className="text-sm text-gray-500">{stat.label}</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="mt-12 border-t border-gray-200 pt-6 text-sm text-gray-500">
        <p>
          This public profile shows aggregate production data only. No personal
          or operator contact information is displayed.
        </p>
        <p className="mt-2">
          <Link href="/verify" className="text-blue-600 hover:underline">
            Verify a certificate
          </Link>
        </p>
      </footer>
    </main>
  );
}