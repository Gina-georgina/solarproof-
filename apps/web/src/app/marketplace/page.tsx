'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

interface Certificate {
  id: string;
  owner: string;
  energyType: string;
  amount: number;
  unit: string;
  vintage: string;
  location?: string;
  status?: string;
}

interface Listing {
  id: string;
  certificateId: string;
  seller: string;
  askingPrice: number;
  currency: string;
  note?: string;
  createdAt: string;
  certificate?: Certificate;
}

interface TransferRecord {
  id: string;
  certificateId: string;
  from: string;
  to: string;
  timestamp: string;
  status?: string;
  note?: string;
}

interface TimelineEntry {
  id: string;
  title: string;
  description?: string;
  timestamp: string;
  status?: string;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">No transfer history yet.</p>;
  }
  return (
    <ol className="relative border-l border-gray-200 ml-3">
      {entries.map((entry) => (
        <li key={entry.id} className="mb-6 ml-6">
          <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-emerald-500" />
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900">{entry.title}</h4>
            <time className="text-xs text-gray-500">{formatDate(entry.timestamp)}</time>
          </div>
          {entry.description && (
            <p className="mt-1 text-sm text-gray-600">{entry.description}</p>
          )}
          {entry.status && (
            <span className="mt-1 inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {entry.status}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [sellerCertificateId, setSellerCertificateId] = useState('');
  const [sellerPrice, setSellerPrice] = useState('');
  const [sellerCurrency, setSellerCurrency] = useState('USD');
  const [sellerNote, setSellerNote] = useState('');
  const [sellerSubmitting, setSellerSubmitting] = useState(false);

  const [buyerName, setBuyerName] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listingsRes, certificatesRes, transfersRes] = await Promise.all([
        fetch('/api/marketplace/listings', { cache: 'no-store' }),
        fetch('/api/certificates', { cache: 'no-store' }),
        fetch('/api/certificates/transfers', { cache: 'no-store' }),
      ]);

      if (listingsRes.ok) {
        const data = await listingsRes.json();
        setListings(Array.isArray(data) ? data : data.listings ?? []);
      } else if (listingsRes.status !== 404) {
        throw new Error(`Failed to load listings (${listingsRes.status})`);
      }

      if (certificatesRes.ok) {
        const data = await certificatesRes.json();
        setCertificates(Array.isArray(data) ? data : data.certificates ?? []);
      }

      if (transfersRes.ok) {
        const data = await transfersRes.json();
        setTransfers(Array.isArray(data) ? data : data.transfers ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplace data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const certificateById = useMemo(() => {
    const map = new Map<string, Certificate>();
    certificates.forEach((cert) => map.set(cert.id, cert));
    return map;
  }, [certificates]);

  const availableListings = useMemo(
    () =>
      listings.filter((listing) => {
        const cert = listing.certificate ?? certificateById.get(listing.certificateId);
        return !cert?.status || cert.status === 'available' || cert.status === 'active';
      }),
    [listings, certificateById],
  );

  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    return transfers
      .map((transfer) => ({
        id: transfer.id,
        title: `Transfer of certificate ${transfer.certificateId}`,
        description: `${transfer.from} → ${transfer.to}${
          transfer.note ? ` — ${transfer.note}` : ''
        }`,
        timestamp: transfer.timestamp,
        status: transfer.status,
      }))
      .sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
  }, [transfers]);

  const handleCreateListing = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionMessage(null);
    setActionError(null);

    if (!sellerCertificateId) {
      setActionError('Please select a certificate to list.');
      return;
    }
    const price = Number(sellerPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setActionError('Please enter a valid asking price greater than zero.');
      return;
    }

    setSellerSubmitting(true);
    try {
      const res = await fetch('/api/marketplace/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificateId: sellerCertificateId,
          askingPrice: price,
          currency: sellerCurrency,
          note: sellerNote || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to create listing (${res.status})`);
      }

      setActionMessage('Listing created successfully.');
      setSellerCertificateId('');
      setSellerPrice('');
      setSellerNote('');
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create listing');
    } finally {
      setSellerSubmitting(false);
    }
  };

  const handleBuy = async (listing: Listing) => {
    setActionMessage(null);
    setActionError(null);

    const buyer = buyerName.trim();
    if (!buyer) {
      setActionError('Please enter your cooperative name before initiating a transfer.');
      return;
    }

    setBusyId(listing.id);
    try {
      const res = await fetch(
        `/api/certificates/${encodeURIComponent(listing.certificateId)}/transfer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: buyer,
            note: `Marketplace purchase at ${formatPrice(
              listing.askingPrice,
              listing.currency,
            )} (manual settlement)`,
          }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Transfer failed (${res.status})`);
      }

      setActionMessage(
        `Transfer of certificate ${listing.certificateId} initiated. Please settle payment manually with the seller.`,
      );
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to initiate transfer');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Certificate Marketplace</h1>
        <p className="mt-2 text-sm text-gray-600">
          Peer-to-peer transfer of energy certificates between cooperatives. Sellers list
          certificates at an asking price; buyers initiate a transfer through the existing
          certificate transfer API.
        </p>
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <strong>Note:</strong> Escrow and payment processing are out of scope for v1.
          Settlement between buyer and seller is manual and off-chain.
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {actionMessage && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Available certificates for transfer
        </h2>

        <div className="mb-4">
          <label
            htmlFor="buyer-name"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Your cooperative (buyer)
          </label>
          <input
            id="buyer-name"
            type="text"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="e.g. Solar Coop North"
            className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading listings…</p>
        ) : availableListings.length === 0 ? (
          <p className="text-sm text-gray-500">
            No certificates are currently listed for transfer.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    Certificate
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Seller</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Energy</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Vintage</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    Asking price
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {availableListings.map((listing) => {
                  const cert =
                    listing.certificate ?? certificateById.get(listing.certificateId);
                  return (
                    <tr key={listing.id}>
                      <td className="px-4 py-2">
                        <Link
                          href={`/certificates/${encodeURIComponent(
                            listing.certificateId,
                          )}`}
                          className="font-medium text-emerald-700 hover:underline"
                        >
                          {listing.certificateId}
                        </Link>
                        {listing.note && (
                          <p className="text-xs text-gray-500">{listing.note}</p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-700">{listing.seller}</td>
                      <td className="px-4 py-2 text-gray-700">
                        {cert ? `${cert.amount} ${cert.unit} (${cert.energyType})` : '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-700">{cert?.vintage ?? '—'}</td>
                      <td className="px-4 py-2 font-medium text-gray-900">
                        {formatPrice(listing.askingPrice, listing.currency)}
                      </td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => void handleBuy(listing)}
                          disabled={busyId === listing.id}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyId === listing.id ? 'Initiating…' : 'Buy / Transfer'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          List a certificate for transfer
        </h2>
        <form
          onSubmit={handleCreateListing}
          className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <label
              htmlFor="seller-certificate"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Certificate
            </label>
            <select
              id="seller-certificate"
              value={sellerCertificateId}
              onChange={(e) => setSellerCertificateId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">Select a certificate…</option>
              {certificates.map((cert) => (
                <option key={cert.id} value={cert.id}>
                  {cert.id} — {cert.amount} {cert.unit} {cert.energyType} ({cert.vintage})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="seller-price"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Asking price
            </label>
            <input
              id="seller-price"
              type="number"
              min="0"
              step="0.01"
              value={sellerPrice}
              onChange={(e) => setSellerPrice(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label
              htmlFor="seller-currency"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Currency
            </label>
            <input
              id="seller-currency"
              type="text"
              value={sellerCurrency}
              onChange={(e) => setSellerCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="seller-note"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Note (optional)
            </label>
            <textarea
              id="seller-note"
              value={sellerNote}
              onChange={(e) => setSellerNote(e.target.value)}
              rows={2}
              placeholder="Terms, contact details, or other information for buyers"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={sellerSubmitting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sellerSubmitting ? 'Creating listing…' : 'Create listing'}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Transfer history</h2>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <Timeline entries={timelineEntries} />
        </div>
      </section>
    </div>
  );
}