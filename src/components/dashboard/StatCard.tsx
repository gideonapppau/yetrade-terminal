import { type ReactNode } from "react"
import { cn } from "../../lib/utils"

interface StatCardProps {
  title: string
  value: string | number
  icon: ReactNode
  trend?: {
    value: number
    isPositive: boolean
  }
  className?: string
}

export function StatCard({ title, value, icon, trend, className }: StatCardProps) {
  return (
    <div className={cn("glass rounded-2xl p-6 relative overflow-hidden group hover:border-primary/50 transition-colors", className)}>
      <div className="absolute -right-6 -top-6 text-primary/5 group-hover:text-primary/10 transition-colors transform group-hover:scale-110 duration-500">
        <div className="w-32 h-32">{icon}</div>
      </div>
      
      <div className="flex items-center justify-between mb-4 relative z-10">
        <h3 className="text-sm font-medium text-gray-400">{title}</h3>
        <div className="p-2 bg-primary/10 text-primary rounded-xl">
          {icon}
        </div>
      </div>
      
      <div className="relative z-10">
        <span className="text-3xl font-bold tracking-tight text-white">{value}</span>
        
        {trend && (
          <div className="flex items-center gap-2 mt-2">
            <span className={cn(
              "text-sm font-medium px-2 py-0.5 rounded-full",
              trend.isPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            )}>
              {trend.isPositive ? "+" : ""}{trend.value}%
            </span>
            <span className="text-xs text-gray-500">vs last month</span>
          </div>
        )}
      </div>
    </div>
  )
}
