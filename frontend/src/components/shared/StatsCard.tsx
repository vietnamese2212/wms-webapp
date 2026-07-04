import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface StatsCardProps {
  title: string
  value: string | number
  unit?: string
  change?: number
  changeLabel?: string
  trend?: 'up' | 'down' | 'neutral'
  icon?: LucideIcon
  iconColor?: string
  progress?: number
  progressColor?: string
  target?: string
  className?: string
}

export function StatsCard({
  title, value, unit, change, changeLabel, trend = 'neutral',
  icon: Icon, iconColor = 'text-primary', progress, progressColor,
  target, className,
}: StatsCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{title}</p>
            <div className="flex items-baseline gap-1 min-w-0">
              <span className="text-2xl font-bold text-foreground tabular-nums truncate">{value}</span>
              {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
            </div>
            {(change !== undefined || changeLabel) && (
              <div className="flex items-center gap-1">
                {trend === 'up' && <TrendingUp className="h-3.5 w-3.5 text-green-600" />}
                {trend === 'down' && <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
                {trend === 'neutral' && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                {change !== undefined && (
                  <span className={cn(
                    'text-xs font-medium',
                    trend === 'up' && 'text-green-600',
                    trend === 'down' && 'text-red-500',
                    trend === 'neutral' && 'text-muted-foreground',
                  )}>
                    {change > 0 ? '+' : ''}{change}%
                  </span>
                )}
                {changeLabel && <span className="text-xs text-muted-foreground">{changeLabel}</span>}
              </div>
            )}
          </div>
          {Icon && (
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10', iconColor.replace('text-', 'bg-').replace('600', '100').replace('500', '100'))}>
              <Icon className={cn('h-5 w-5', iconColor)} />
            </div>
          )}
        </div>
        {progress !== undefined && (
          <div className="mt-4 space-y-1">
            <Progress
              value={progress}
              className="h-1.5"
              indicatorClassName={progressColor}
            />
            {target && <p className="text-[10px] text-muted-foreground">Mục tiêu: {target}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
