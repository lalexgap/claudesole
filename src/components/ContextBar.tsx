import clsx from 'clsx'

const MAX_TOKENS = 200_000 // All current Claude models

interface Props {
  tokensUsed?: number
  compact?: boolean // smaller layout for sidebar
}

export function ContextBar({ tokensUsed, compact }: Props) {
  if (tokensUsed === undefined) return null

  const pct = Math.min(100, (tokensUsed / MAX_TOKENS) * 100)
  const remaining = MAX_TOKENS - tokensUsed

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
          {fmt(remaining)} left · {fmt(tokensUsed)} / 200K
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
