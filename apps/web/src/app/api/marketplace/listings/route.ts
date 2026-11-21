import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface ListingBody {
  certificateId?: string;
  askingPrice?: number | string;
  currency?: string;
  notes?: string;
}

function parsePrice(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

async function getCallerContext() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const user = session.user as {
    id?: string;
    cooperativeId?: string;
    role?: string;
  };

  if (!user.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!user.cooperativeId) {
    return {
      error: NextResponse.json(
        { error: 'User is not associated with a cooperative' },
        { status: 403 },
      ),
    };
  }

  return { user: { id: user.id, cooperativeId: user.cooperativeId, role: user.role } };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') ?? 'ACTIVE';
    const cooperativeId = searchParams.get('cooperativeId') ?? undefined;
    const limitParam = Number(searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    const where: Record<string, unknown> = {};
    if (status !== 'ALL') {
      where.status = status;
    }
    if (cooperativeId) {
      where.sellerCooperativeId = cooperativeId;
    }

    const listings = await prisma.marketplaceListing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        certificate: {
          select: {
            id: true,
            serialNumber: true,
            energyType: true,
            quantity: true,
            unit: true,
            status: true,
            issuedAt: true,
            cooperativeId: true,
          },
        },
      },
    });

    return NextResponse.json({ listings }, { status: 200 });
  } catch (error) {
    console.error('GET /api/marketplace/listings failed', error);
    return NextResponse.json({ error: 'Failed to fetch listings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getCallerContext();
    if ('error' in ctx) return ctx.error;
    const { user } = ctx;

    let body: ListingBody;
    try {
      body = (await request.json()) as ListingBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { certificateId } = body;
    if (!certificateId || typeof certificateId !== 'string') {
      return NextResponse.json({ error: 'certificateId is required' }, { status: 400 });
    }

    const askingPrice = parsePrice(body.askingPrice);
    if (askingPrice === null) {
      return NextResponse.json(
        { error: 'askingPrice must be a non-negative number' },
        { status: 400 },
      );
    }

    const currency = (body.currency ?? 'USD').toUpperCase();
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;

    const certificate = await prisma.certificate.findUnique({
      where: { id: certificateId },
      select: {
        id: true,
        cooperativeId: true,
        status: true,
        quantity: true,
      },
    });

    if (!certificate) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });
    }

    if (certificate.cooperativeId !== user.cooperativeId) {
      return NextResponse.json(
        { error: 'Certificate does not belong to your cooperative' },
        { status: 403 },
      );
    }

    if (certificate.status !== 'ACTIVE' && certificate.status !== 'ISSUED') {
      return NextResponse.json(
        { error: `Certificate is not available for listing (status: ${certificate.status})` },
        { status: 409 },
      );
    }

    const existingActive = await prisma.marketplaceListing.findFirst({
      where: {
        certificateId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    if (existingActive) {
      return NextResponse.json(
        { error: 'Certificate already has an active listing', listingId: existingActive.id },
        { status: 409 },
      );
    }

    const listing = await prisma.marketplaceListing.create({
      data: {
        certificateId,
        sellerCooperativeId: user.cooperativeId,
        sellerUserId: user.id,
        askingPrice,
        currency,
        notes,
        status: 'ACTIVE',
      },
      include: {
        certificate: {
          select: {
            id: true,
            serialNumber: true,
            energyType: true,
            quantity: true,
            unit: true,
            status: true,
          },
        },
      },
    });

    return NextResponse.json({ listing }, { status: 201 });
  } catch (error) {
    console.error('POST /api/marketplace/listings failed', error);
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getCallerContext();
    if ('error' in ctx) return ctx.error;
    const { user } = ctx;

    let body: { listingId?: string; askingPrice?: number | string; notes?: string; status?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { listingId } = body;
    if (!listingId || typeof listingId !== 'string') {
      return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
    }

    const listing = await prisma.marketplaceListing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerCooperativeId: true, status: true },
    });

    if (!listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }

    if (listing.sellerCooperativeId !== user.cooperativeId) {
      return NextResponse.json(
        { error: 'Listing does not belong to your cooperative' },
        { status: 403 },
      );
    }

    const data: Record<string, unknown> = {};

    if (body.askingPrice !== undefined) {
      const askingPrice = parsePrice(body.askingPrice);
      if (askingPrice === null) {
        return NextResponse.json(
          { error: 'askingPrice must be a non-negative number' },
          { status: 400 },
        );
      }
      data.askingPrice = askingPrice;
    }

    if (body.notes !== undefined) {
      data.notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;
    }

    if (body.status !== undefined) {
      const allowed = ['ACTIVE', 'CLOSED', 'CANCELLED'];
      if (!allowed.includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      data.status = body.status;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const updated = await prisma.marketplaceListing.update({
      where: { id: listingId },
      data,
      include: {
        certificate: {
          select: {
            id: true,
            serialNumber: true,
            energyType: true,
            quantity: true,
            unit: true,
            status: true,
          },
        },
      },
    });

    return NextResponse.json({ listing: updated }, { status: 200 });
  } catch (error) {
    console.error('PATCH /api/marketplace/listings failed', error);
    return NextResponse.json({ error: 'Failed to update listing' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getCallerContext();
    if ('error' in ctx) return ctx.error;
    const { user } = ctx;

    const { searchParams } = new URL(request.url);
    let listingId = searchParams.get('listingId') ?? undefined;

    if (!listingId) {
      try {
        const body = (await request.json()) as { listingId?: string };
        listingId = body.listingId;
      } catch {
        // no body, fall through
      }
    }

    if (!listingId) {
      return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
    }

    const listing = await prisma.marketplaceListing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerCooperativeId: true, status: true },
    });

    if (!listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }

    if (listing.sellerCooperativeId !== user.cooperativeId) {
      return NextResponse.json(
        { error: 'Listing does not belong to your cooperative' },
        { status: 403 },
      );
    }

    if (listing.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: `Listing is not active (status: ${listing.status})` },
        { status: 409 },
      );
    }

    const closed = await prisma.marketplaceListing.update({
      where: { id: listingId },
      data: { status: 'CANCELLED', closedAt: new Date() },
      select: { id: true, status: true, closedAt: true },
    });

    return NextResponse.json({ listing: closed }, { status: 200 });
  } catch (error) {
    console.error('DELETE /api/marketplace/listings failed', error);
    return NextResponse.json({ error: 'Failed to close listing' }, { status: 500 });
  }
}