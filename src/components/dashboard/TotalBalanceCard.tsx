import { motion } from "framer-motion"
import { RefreshCw, Plus, Minus, Repeat, Shuffle } from "lucide-react"
import { toast } from "sonner"

function WalletIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
}

import { useMT5Store } from "../../store/mt5"
import { formatMoney } from "../../lib/utils"

export function TotalBalanceCard() {
  const { balance, currency, server, syncAccountInfo, isConnecting, tradeMode } = useMT5Store()

  const modeText = tradeMode === 2 ? 'REAL' : tradeMode === 1 ? 'CONTEST' : 'DEMO';
  const modeColor = tradeMode === 2 ? 'bg-success/15 text-success border-success/30' : 'bg-warning/15 text-warning border-warning/30';

  const handleWalletAction = (action: string) => {
    toast.info(`${action} via your broker`, {
      description: "Funding is managed through your MetaTrader 5 terminal or broker portal.",
    });
  };
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.5 }}
      className="col-span-12 lg:col-span-4 card card-hover p-6"
    >
      <div className="flex justify-between items-center mb-6">
        <div className="w-8 h-8 rounded bg-elevated flex items-center justify-center">
          <WalletIcon />
        </div>
        <span
          className="flex items-center gap-1 text-xs font-medium bg-elevated px-2 py-1 rounded-full border border-border"
          title={server || undefined}
        >
          <span className={isConnecting ? "text-success animate-pulse" : "text-secondary"}>●</span> {currency}
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
      <div className="flex items-end gap-3 mb-8">
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
      
      <div className="grid grid-cols-2 gap-3 mb-3">
        <motion.button 
          whileHover={{ scale: 1.02 }} 
          whileTap={{ scale: 0.98 }}
          onClick={() => handleWalletAction("Deposit")}
          className="bg-accent hover:bg-accent/90 text-white font-medium py-3 rounded-full flex items-center justify-center gap-2 transition-colors"
        >
          <Plus size={16} /> Deposit
        </motion.button>
        <motion.button 
          whileHover={{ scale: 1.02 }} 
          whileTap={{ scale: 0.98 }}
          onClick={() => handleWalletAction("Withdraw")}
          className="bg-elevated hover:bg-background border border-border text-primary font-medium py-3 rounded-full flex items-center justify-center gap-2 transition-colors"
        >
          <Minus size={16} /> Withdraw
        </motion.button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <motion.button 
          whileHover={{ scale: 1.02 }} 
          whileTap={{ scale: 0.98 }}
          onClick={() => handleWalletAction("Transfers are")}
          className="bg-elevated hover:bg-background border border-border text-primary font-medium py-3 rounded-full flex items-center justify-center gap-2 transition-colors"
        >
          <Repeat size={16} /> Transfer
        </motion.button>
        <motion.button 
          whileHover={{ scale: 1.02 }} 
          whileTap={{ scale: 0.98 }}
          onClick={() => handleWalletAction("Currency swaps are")}
          className="bg-elevated hover:bg-background border border-border text-primary font-medium py-3 rounded-full flex items-center justify-center gap-2 transition-colors"
        >
          <Shuffle size={16} /> Swap
        </motion.button>
      </div>
    </motion.div>
  )
}
