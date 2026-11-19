'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Thin top-of-page progress bar that fires on every pathname change.
 * Works with both server and client navigations in the Next.js App Router.
 *
 * Implementation: races a CSS transition from 0 → 80% immediately on route
 * change, then completes to 100% and fades out once the new pathname is
 * committed (i.e. the component re-renders with the updated pathname).
 */
export function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const routeKey = `${pathname}?${searchParams?.toString() ?? ''}`
  const prevRouteKey = useRef(routeKey)
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track the user's reduced-motion preference
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (routeKey === prevRouteKey.current) return
    prevRouteKey.current = routeKey

    // Clear any in-flight timers from a previous navigation
    if (completeTimer.current) clearTimeout(completeTimer.current)
    if (hideTimer.current) clearTimeout(hideTimer.current)

    // Start: snap to 0, show bar, animate to 80%
    setProgress(0)
    setVisible(true)
    // rAF ensures the 0% paint happens before we kick off the transition
    requestAnimationFrame(() => setProgress(80))

    // Complete: advance to 100% then fade out
    completeTimer.current = setTimeout(() => {
      setProgress(100)
      hideTimer.current = setTimeout(() => setVisible(false), 300)
    }, 200)

    return () => {
      if (completeTimer.current) clearTimeout(completeTimer.current)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [routeKey])

  if (!visible) return null

  return (
    <div
      role="progressbar"
      aria-label="Page loading"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-0.5"
    >
      <div
        className={
          reducedMotion
            ? 'h-full bg-yellow-400'
            : 'h-full bg-yellow-400 transition-all duration-200 ease-out'
        }
        style={{ width: `${reducedMotion ? 100 : progress}%` }}
      />
    </div>
  )
}
