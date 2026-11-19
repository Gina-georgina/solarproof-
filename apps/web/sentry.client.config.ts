import * as Sentry from '@sentry/nextjs'
import { scrubPii } from './sentry.server.config'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
  beforeSend(event) {
    return scrubPii(event)
  },
})