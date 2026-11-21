# Runbook: Soroban TTL Auto-Extension Job

## Purpose

Soroban persistent ledger entries (audit_registry, energy_token) expire if their TTL is not extended. This job bumps TTLs before they reach the 7-day warning threshold, ensuring anchored proofs and energy certificates remain accessible.

## Schedule

The job runs daily via **Supabase pg_cron** (or Vercel Cron as an alternative):

```sql
-- Supabase pg_cron (run in SQL editor or migration)
select cron.schedule(
  'ttl-extend-daily',
  '0 4 * * *',  -- 04:00 UTC daily
  $$
    select net.http_post(
      url := 'https://<your-api>/api/jobs/ttl-extend',
      headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);
```

Alternative — **Vercel Cron** (add to `vercel.json`):

```json
{
  "crons": [
    {
      "path": "/api/jobs/ttl-extend",
      "schedule": "0 4 * * *"
    }
  ]
}
```

> The endpoint requires the `x-cron-secret` header to match `CRON_SECRET` env var. Set this secret in Vercel and in the cron caller.

## Threshold Logic

| Constant | Value | Meaning |
|---|---|---|
| `WARNING_LEDGERS` | 120,960 | ~7 days at 5 s/ledger |
| `EXTEND_TO_LEDGERS` | 518,400 | ~30 days — bump target |

Any contract instance whose `liveUntilLedgerSeq` is within 120,960 ledgers of the current sequence will be extended.

## Contracts Monitored

- `NEXT_PUBLIC_AUDIT_REGISTRY_ID` (`audit_registry`)
- `NEXT_PUBLIC_ENERGY_TOKEN_ID` (`energy_token`)

## Failure Handling

- Each contract is processed independently; a failure on one does not block the other.
- Errors are logged via the structured logger and captured in **Sentry** with tag `job: ttl-extend`.
- The response body includes per-contract status; HTTP 207 indicates partial failure.

## Recovery Runbook: TTL Extension Failures

If the `ttl-extend` cron job fails, contract storage entries will eventually expire and become unreadable. Follow the steps below in order: **detect → recover manually → verify**.

### Step 1 — Detect Expiry

**1a. Check structured logs** for `ttl-extend.error` entries:

```bash
# Vercel
vercel logs <deployment-url> --json | grep 'ttl-extend.error'

# Supabase / self-hosted (if logs are shipped to a log store)
grep 'ttl-extend.error' /var/log/api/ttl-extend.log | tail -n 50
```

**1b. Check Sentry** for issues tagged `job: ttl-extend`:

- Open the project → Issues → filter `job: ttl-extend`.
- Look for events in the last 24 h; check the `contract` tag to see which contract failed.
- An unresolved alert means at least one contract was not extended.

**1c. Check the cron endpoint response** — HTTP `207` means partial failure. The body lists per-contract status:

```bash
curl -s -X POST https://<your-api>/api/jobs/ttl-extend \
  -H "x-cron-secret: <CRON_SECRET>" | jq .
```

Example partial-failure body:

```json
{
  "results": [
    { "contract": "audit_registry", "status": "extended", "liveUntilLedgerSeq": 1234567 },
    { "contract": "energy_token", "status": "error", "error": "tx failed: host error" }
  ]
}
```

**1d. Query `liveUntilLedgerSeq` directly via RPC** to confirm how close an entry is to expiry:

```bash
# Current ledger sequence
stellar ledger latest --network testnet \
  --rpc-url https://soroban-testnet.stellar.org

# Contract instance TTL (audit_registry example)
stellar contract info \
  --id CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org
```

The output includes `liveUntilLedgerSeq`. Compare it to the current ledger sequence:

- **> 120,960 ledgers remaining** → healthy, no action needed.
- **≤ 120,960 ledgers remaining** → warning threshold reached; extend now.
- **≤ current ledger sequence** → entry has **expired**; data may be unreadable. Escalate immediately and follow Step 2.

### Step 2 — Manual Recovery

Extend the footprint TTL manually with the Stellar CLI. Use the contract IDs from your environment (`NEXT_PUBLIC_AUDIT_REGISTRY_ID`, `NEXT_PUBLIC_ENERGY_TOKEN_ID`).

**Testnet — audit_registry:**

```bash
stellar contract extend-footprint-ttl \
  --id CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K \
  --ledgers-to-extend 518400 \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org
```

**Testnet — energy_token:**

```bash
stellar contract extend-footprint-ttl \
  --id CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --ledgers-to-extend 518400 \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org
```

**Mainnet variants** (replace IDs with the mainnet values from your production env):

```bash
# audit_registry (mainnet)
stellar contract extend-footprint-ttl \
  --id <MAINNET_AUDIT_REGISTRY_ID> \
  --ledgers-to-extend 518400 \
  --network mainnet \
  --rpc-url https://soroban-mainnet.stellar.org

# energy_token (mainnet)
stellar contract extend-footprint-ttl \
  --id <MAINNET_ENERGY_TOKEN_ID> \
  --ledgers-to-extend 518400 \
  --network mainnet \
  --rpc-url https://soroban-mainnet.stellar.org
```

> `--ledgers-to-extend 518400` matches `EXTEND_TO_LEDGERS` (~30 days). The signing identity must be the contract admin; ensure the CLI is configured with the correct key (`stellar keys use <identity>`).

### Step 3 — Verify Recovery

**3a. Re-query `liveUntilLedgerSeq`** and confirm it is now well above the warning threshold:

```bash
stellar contract info \
  --id CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org
```

Expected: `liveUntilLedgerSeq` ≈ current ledger + 518,400.

**3b. Re-run the cron endpoint** and confirm HTTP `200` with all contracts `extended`:

```bash
curl -i -X POST https://<your-api>/api/jobs/ttl-extend \
  -H "x-cron-secret: <CRON_SECRET>"
```

**3c. Confirm the Sentry alert clears** — resolve the `job: ttl-extend` issue once no new events arrive after the next scheduled run (04:00 UTC). If events persist, repeat Step 1 to identify the failing contract.

## Manually Triggering

```bash
curl -X POST https://<your-api>/api/jobs/ttl-extend \
  -H "x-cron-secret: <CRON_SECRET>"
```

Or via the Stellar CLI directly:

```bash
stellar contract extend-footprint-ttl \
  --id <CONTRACT_ID> \
  --ledgers-to-extend 518400 \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org
```

## Alerting

Sentry will fire an alert when the job fails for a contract. Ensure the `ttl-extend` alert rule is configured in your Sentry project with a notification channel (Slack / PagerDuty).
