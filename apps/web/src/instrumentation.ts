/**
 * OpenTelemetry instrumentation for SolarProof Next.js API.
 *
 * Next.js loads this file automatically when `experimental.instrumentationHook`
 * is enabled (Next.js 13.4+) or unconditionally in Next.js 15+.
 *
 * Traces are exported to an OTLP-compatible collector (Grafana Cloud,
 * Honeycomb, etc.) via OTEL_EXPORTER_OTLP_ENDPOINT.
 *
 * Key spans instrumented:
 *   - HTTP request lifecycle (via @opentelemetry/instrumentation-http)
 *   - Signature verification  → span: "ed25519.verify"
 *   - Stellar submission      → span: "stellar.anchor" / "stellar.mint"
 *   - Database queries        → span: "db.query" (via fetch instrumentation)
 *
 * Required env vars:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — e.g. https://otlp-gateway-prod-us-east-0.grafana.net/otlp
 *   OTEL_EXPORTER_OTLP_HEADERS   — e.g. Authorization=Basic <base64>
 *
 * Optional:
 *   OTEL_SERVICE_NAME            — defaults to "solarproof-api"
 *   OTEL_SERVICE_VERSION         — defaults to npm package version
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { NodeSDK } = await import('@opentelemetry/sdk-node')
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
  const { resourceFromAttributes } = await import('@opentelemetry/resources')
  const { BatchSpanProcessor, TraceIdRatioBasedSampler } = await import('@opentelemetry/sdk-trace-node')
  const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http')
  const { FetchInstrumentation } = await import('@opentelemetry/instrumentation-fetch')
  const { PgInstrumentation } = await import('@opentelemetry/instrumentation-pg')
  const { IORedisInstrumentation } = await import('@opentelemetry/instrumentation-ioredis')
  const { UndiciInstrumentation } = await import('@opentelemetry/instrumentation-undici')

  // Sampling: 100% in staging/development, 10% in production.
  const sampleRatio =
    process.env.NODE_ENV === 'production'
      ? Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? 0.1)
      : 1.0

  // OTLP endpoint/headers are read from OTEL_EXPORTER_OTLP_ENDPOINT and
  // OTEL_EXPORTER_OTLP_HEADERS by the exporter's default config. Passing them
  // explicitly keeps behaviour predictable across Grafana Tempo and Honeycomb.
  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
      ? Object.fromEntries(
          process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',')
            .map((pair) => pair.split('='))
            .filter((entry): entry is [string, string] => entry.length === 2)
            .map(([k, v]) => [k.trim(), v.trim()]),
        )
      : undefined,
  })

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'solarproof-api',
      'service.version': process.env.npm_package_version ?? '1.0.0',
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    sampler: new TraceIdRatioBasedSampler(sampleRatio),
    spanProcessor: new BatchSpanProcessor(exporter as never),
    instrumentations: [
      new HttpInstrumentation(),
      new FetchInstrumentation(),
      new UndiciInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
    ],
  })

  sdk.start()

  // Start the BullMQ worker for async Stellar transaction processing
  const { startWorker } = await import(/* webpackIgnore: true */ '@/lib/queue')
  startWorker()

  // --- Metrics (export to OTLP if configured) ---------------------------------
  try {
    const { MeterProvider } = await import('@opentelemetry/sdk-metrics')
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http')
    const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics')

    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    if (otlpEndpoint) {
      const exporter = new OTLPMetricExporter({ url: otlpEndpoint })
      const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 10_000 })
      const meterProvider = new MeterProvider({ readers: [reader] })
      // Attach meter provider globally
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const api = await import('@opentelemetry/api')
      api.metrics.setGlobalMeterProvider(meterProvider)
    }
  } catch (err) {
    // Non-fatal — don't block startup if metrics packages are missing
    // eslint-disable-next-line no-console
    console.warn('Failed to initialize metrics exporter:', err)
  }
}
