import * as Sentry from '@sentry/nextjs'
import { scrubPii } from './sentry.scrub'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  beforeSend(event) {
    return scrubPii(event)
  },
})