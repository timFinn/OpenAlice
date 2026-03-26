/**
 * Fear & Greed Gauge — semicircle SVG visualization.
 * Score 0 (extreme fear) to 100 (extreme greed).
 */

interface FearGreedGaugeProps {
  score: number | null
  label: string | null
}

const LABEL_COLORS: Record<string, string> = {
  EXTREME_FEAR: 'text-red',
  FEAR: 'text-red/70',
  NEUTRAL: 'text-text-muted',
  GREED: 'text-green/70',
  EXTREME_GREED: 'text-green',
}

export function FearGreedGauge({ score, label }: FearGreedGaugeProps) {
  if (score == null) {
    return (
      <div className="flex items-center justify-center h-[160px] text-text-muted text-[13px]">
        No data
      </div>
    )
  }

  // SVG arc math
  const cx = 100
  const cy = 100
  const r = 75
  const startAngle = Math.PI // left (180°)
  const endAngle = 0 // right (0°)
  const needleAngle = startAngle - (score / 100) * Math.PI

  // Arc path for background
  const arcPath = describeArc(cx, cy, r, startAngle, endAngle)

  // Needle endpoint
  const nx = cx + (r - 10) * Math.cos(needleAngle)
  const ny = cy - (r - 10) * Math.sin(needleAngle)

  // Color stops for the gradient
  const gradientId = 'fg-gradient'

  const labelColor = LABEL_COLORS[label ?? ''] ?? 'text-text'
  const displayLabel = (label ?? '').replace(/_/g, ' ')

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 20 200 100" width="200" height="100">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-red)" />
            <stop offset="25%" stopColor="#d29922" />
            <stop offset="50%" stopColor="var(--color-text-muted)" />
            <stop offset="75%" stopColor="#d29922" />
            <stop offset="100%" stopColor="var(--color-green)" />
          </linearGradient>
        </defs>

        {/* Background arc */}
        <path
          d={arcPath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="8"
          strokeLinecap="round"
        />

        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke="var(--color-text)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="4" fill="var(--color-text)" />
      </svg>

      <div className="text-center -mt-2">
        <p className="text-[28px] font-bold tabular-nums text-text">{score}</p>
        <p className={`text-[12px] font-semibold uppercase tracking-wide ${labelColor}`}>
          {displayLabel}
        </p>
      </div>
    </div>
  )
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy - r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy - r * Math.sin(endAngle)
  return `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`
}
