import { motion } from "framer-motion"
import { useMT5Store } from "../../store/mt5"
import { useSettingsStore } from "../../store/settings"
import { formatMoney } from "../../lib/utils"

function StatBlock({ label, delay, value, badge, valueClass = "" }: {
  label: string
  delay: number
  value: string
  badge: string
  valueClass?: string
}) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay }}>
      <div className="text-sm font-medium text-secondary mb-1">{label}</div>
      <div className="flex items-center gap-3">
        <span className={`text-2xl font-medium tabular-nums ${valueClass}`}>{value}</span>
        <span className="text-xs font-medium text-secondary bg-elevated px-1.5 py-0.5 rounded">{badge}</span>
      </div>
    </motion.div>
  )
}

export function WelcomeHeader() {
  const { balance, equity, isConnected } = useMT5Store()
  const maxDrawdownPercent = useSettingsStore(state => state.riskConfig.maxDrawdownPercent)

  const floatingPnl = equity - balance
  const pnlPercent = balance > 0 ? (floatingPnl / balance) * 100 : 0
  const drawdownPercent = balance > 0 ? Math.max(0, ((balance - equity) / balance) * 100) : 0
  const drawdownSafe = drawdownPercent < maxDrawdownPercent

  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="flex items-center justify-between mb-8"
    >
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        <h1 className="text-3xl font-medium text-primary mb-2">Welcome, Trader</h1>
        <p className="text-secondary text-sm">Track user activity, trading trends, and crypto revenue with real time analytics.</p>
      </motion.div>
      
      <div className="flex gap-12">
        <StatBlock
          label="Balance"
          delay={0.3}
          value={formatMoney(balance)}
          badge={`${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}%`}
        />
        <StatBlock
          label="Equity"
          delay={0.4}
          value={isConnected ? formatMoney(equity) : formatMoney(balance)}
          badge={`${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}%`}
        />
        <StatBlock
          label="Floating P&L"
          delay={0.5}
          value={`${floatingPnl >= 0 ? "+" : ""}${formatMoney(floatingPnl).replace(/^[^\d.,-]+/, "")}`}
          badge={`${pnlPercent.toFixed(1)}%`}
          valueClass={floatingPnl < 0 ? "text-destructive" : floatingPnl > 0 ? "text-success" : "text-secondary"}
        />
        <StatBlock
          label="Drawdown"
          delay={0.6}
          value={`${drawdownPercent.toFixed(1)}%`}
          badge={drawdownSafe ? `Safe (< ${maxDrawdownPercent}%)` : `Breach (> ${maxDrawdownPercent}%)`}
          valueClass={!drawdownSafe ? "text-destructive" : ""}
        />
      </div>
    </motion.div>
  )
}
