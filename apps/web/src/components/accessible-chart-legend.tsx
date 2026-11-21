import type { LegendProps } from 'recharts'

interface LegendItem {
  value?: string
  color?: string
  description: string
  pattern?: string
}

const PATTERN_IDS: Record<string, string> = {
  solid: 'cb-solid',
  diagonal: 'cb-diagonal',
  dots: 'cb-dots',
  crosshatch: 'cb-crosshatch',
  horizontal: 'cb-horizontal',
  vertical: 'cb-vertical',
}

const PATTERN_LABELS: Record<string, string> = {
  solid: 'solid fill',
  diagonal: 'diagonal stripes',
  dots: 'dotted fill',
  crosshatch: 'crosshatch fill',
  horizontal: 'horizontal stripes',
  vertical: 'vertical stripes',
}

function PatternSwatch({ color, pattern }: { color?: string; pattern?: string }) {
  const patternKey = pattern && PATTERN_IDS[pattern] ? pattern : 'solid'
  const patternId = PATTERN_IDS[patternKey]
  const fill = color ?? 'currentColor'

  return (
    <svg
      className="inline-block h-2.5 w-2.5 rounded-sm"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id={patternId} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill={fill} fillOpacity={0.35} />
          {patternKey === 'diagonal' && (
            <path d="M-1 1 L1 -1 M0 4 L4 0 M3 5 L5 3" stroke={fill} strokeWidth="1" />
          )}
          {patternKey === 'dots' && <circle cx="2" cy="2" r="0.9" fill={fill} />}
          {patternKey === 'crosshatch' && (
            <path d="M-1 1 L1 -1 M0 4 L4 0 M3 5 L5 3 M-1 3 L1 5 M0 0 L4 4 M3 -1 L5 1" stroke={fill} strokeWidth="0.75" />
          )}
          {patternKey === 'horizontal' && (
            <path d="M0 1 H4 M0 3 H4" stroke={fill} strokeWidth="0.9" />
          )}
          {patternKey === 'vertical' && (
            <path d="M1 0 V4 M3 0 V4" stroke={fill} strokeWidth="0.9" />
          )}
        </pattern>
      </defs>
      <rect width="10" height="10" rx="1.5" fill={`url(#${patternId})`} stroke={fill} strokeWidth="0.75" />
    </svg>
  )
}

export function AccessibleLegend({
  payload,
  items,
  className = 'flex justify-center gap-4 pt-2.5 text-[11px] text-gray-600 dark:text-gray-400',
}: Omit<LegendProps, 'width'> & { width?: number; items: LegendItem[]; className?: string }) {
  if (!payload?.length) return null

  const meta = new Map(items.map((item) => [item.value, item]))

  return (
    <ul className={className} aria-label="Chart legend">
      {payload.map((entry) => {
        const label = String(entry.value ?? '')
        const item = meta.get(label)
        const description = item?.description ?? label
        const pattern = item?.pattern ?? 'solid'
        const patternLabel = PATTERN_LABELS[pattern] ?? PATTERN_LABELS.solid
        const color = item?.color ?? entry.color
        const accessibleLabel = `${description} (${patternLabel})`

        return (
          <li key={label} className="flex items-center gap-1.5">
            <PatternSwatch color={color} pattern={pattern} />
            <span aria-label={accessibleLabel}>{label}</span>
          </li>
        )
      })}
    </ul>
  )
}