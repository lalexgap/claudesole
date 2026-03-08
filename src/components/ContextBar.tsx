const MAX_TOKENS = 200_000 // All current Claude models

interface Props {
  tokensUsed?: number
  compact?: boolean // smaller layout for sidebar
}

export function ContextBar({ tokensUsed, compact }: Props) {
  if (tokensUsed === undefined) return null

  const pct = Math.min(100, (tokensUsed / MAX_TOKENS) * 100)
  const remaining = MAX_TOKENS - tokensUsed
  const color = pct > 80 ? '#f87171' : pct > 50 ? '#fbbf24' : '#4ade80'

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '2px' : '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          fontSize: compact ? '9px' : '10px',
          color: '#555', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          Context
        </span>
        <span style={{ fontSize: compact ? '9px' : '10px', color: '#555' }}>
          {fmt(remaining)} left · {fmt(tokensUsed)} / 200K
        </span>
      </div>
      <div style={{
        height: compact ? '2px' : '3px',
        background: 'rgba(255,255,255,0.07)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: color,
          borderRadius: '2px',
          transition: 'width 0.3s',
        }} />
      </div>
    </div>
  )
}
