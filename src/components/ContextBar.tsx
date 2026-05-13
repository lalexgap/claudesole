import clsx from 'clsx'

// 1M-context variants advertise it in the model ID (e.g. `claude-sonnet-4-5-1m`,
// `claude-opus-4-7[1m]`). Everything else is still 200K.
function maxTokensFor(model?: string): number {
  if (model && /\b1m\b|\[1m\]/i.test(model)) return 1_000_000
  return 200_000
}

interface Props {
  tokensUsed?: number
  model?: string
  compact?: boolean // smaller layout for sidebar
}

export function ContextBar({ tokensUsed, model, compact }: Props) {
  if (tokensUsed === undefined) return null

  const maxTokens = maxTokensFor(model)
  const pct = Math.min(100, (tokensUsed / maxTokens) * 100)
  const remaining = Math.max(0, maxTokens - tokensUsed)
  const maxLabel = maxTokens >= 1_000_000 ? '1M' : '200K'

  const barColor = pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-amber-400' : 'bg-green-400'

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n)

  return (
    <div className={clsx('flex flex-col', compact ? 'gap-0.5' : 'gap-1')}>
      <div className="flex justify-between items-center">
        <span className={clsx(
          'text-[#555] font-semibold uppercase tracking-[0.08em]',
          compact ? 'text-[9px]' : 'text-[10px]'
        )}>
          Context
        </span>
        <span className={clsx('text-[#555]', compact ? 'text-[9px]' : 'text-[10px]')}>
          {fmt(remaining)} left · {fmt(tokensUsed)} / {maxLabel}
        </span>
      </div>
      <div className={clsx(
        'bg-white/[0.07] rounded-sm overflow-hidden',
        compact ? 'h-px' : 'h-[3px]'
      )}>
        <div
          className={clsx('h-full rounded-sm transition-[width] duration-300', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
