import { motion } from "framer-motion"
import { toast } from "sonner"
import { RefreshCw, Wallet, Pause, Play } from "../ui/icons"
import { useMT5Store } from "../../store/mt5"
import { useSettingsStore } from "../../store/settings"
import { formatMoney } from "../../lib/utils"

export function TotalBalanceCard() {
  const { balance, currency, server, company, syncAccountInfo, isConnecting, isConnected, tradeMode } = useMT5Store()
  const tradingPaused = useSettingsStore((s) => s.tradingPaused)
  const setTradingPaused = useSettingsStore((s) => s.setTradingPaused)

  const modeText = tradeMode === 2 ? 'REAL' : tradeMode === 1 ? 'CONTEST' : 'DEMO';
  const modeColor = tradeMode === 2 ? 'bg-success/15 text-success border-success/30' : 'bg-warning/15 text-warning border-warning/30';

  const toggleTrading = () => {
    const next = !tradingPaused
    setTradingPaused(next)
    if (next) {
      toast.warning("Trading paused", { description: "New signals will be recorded but not executed." })
    } else {
      toast.success("Trading resumed", { description: "Approved signals will be executed again." })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.5 }}
      className="col-span-12 lg:col-span-4 card card-hover p-6 flex flex-col"
    >
      <div className="flex justify-between items-center mb-6">
        <div className="w-8 h-8 rounded bg-elevated flex items-center justify-center">
          <Wallet size={16} />
        </div>
        <span
          className="flex items-center gap-1 text-xs font-medium bg-elevated px-2 py-1 rounded-full border border-border"
          title={server || undefined}
        >
          <span className={isConnecting ? "text-warning" : isConnected ? "text-success" : "text-destructive"}>●</span> {currency}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <div className="text-sm text-secondary font-medium">Total Balance</div>
        {tradeMode !== null && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${modeColor}`}>
            {modeText}
          </span>
        )}
      </div>
      <div className="flex items-end gap-3 mb-6">
        <div className="text-4xl font-medium tabular-nums">
          {formatMoney(balance, currency)}
        </div>
        <button
          onClick={() => syncAccountInfo()}
          disabled={isConnecting}
          className="text-xs text-secondary flex items-center gap-1 hover:text-primary mb-1 disabled:opacity-50"
        >
          <RefreshCw size={12} className={isConnecting ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <dl className="text-sm space-y-2 mb-6">
        <div className="flex justify-between gap-4">
          <dt className="text-secondary">Broker</dt>
          <dd className="font-medium truncate">{company || '—'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-secondary">Server</dt>
          <dd className="font-medium truncate">{server || '—'}</dd>
        </div>
      </dl>

      {/* Global kill-switch: the header banner shows when it is engaged */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={toggleTrading}
        className={`mt-auto font-medium py-3 rounded-full flex items-center justify-center gap-2 transition-colors ${
          tradingPaused
            ? 'bg-accent hover:bg-accent/90 text-white'
            : 'bg-elevated hover:bg-background border border-border text-primary'
        }`}
      >
        {tradingPaused ? <><Play size={16} /> Resume Trading</> : <><Pause size={16} /> Pause Trading</>}
      </motion.button>
    </motion.div>
  )
}
