import { motion } from "framer-motion"
import { RefreshCw, TrendingUp, TrendingDown, Wallet } from "lucide-react"

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.4 }
  }
}

const item = {
  hidden: { opacity: 0, scale: 0.95 },
  show: { opacity: 1, scale: 1 }
}

const mockAssets = [
  { id: 'btc', name: 'Bitcoin', symbol: 'BTC', amount: '0.45', value: '$29,345.50', change: '+2.4%', isPositive: true, color: 'bg-orange-500/10 text-orange-500' },
  { id: 'eth', name: 'Ethereum', symbol: 'ETH', amount: '4.2', value: '$8,450.20', change: '+1.2%', isPositive: true, color: 'bg-blue-500/10 text-blue-500' },
  { id: 'sol', name: 'Solana', symbol: 'SOL', amount: '145.5', value: '$4,125.80', change: '-0.5%', isPositive: false, color: 'bg-purple-500/10 text-purple-500' },
  { id: 'usdc', name: 'USD Coin', symbol: 'USDC', amount: '12,500', value: '$12,500.00', change: '0.0%', isPositive: true, color: 'bg-green-500/10 text-green-500' },
]

export function YourAssetsCard() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
      className="col-span-12 lg:col-span-4 card card-hover p-6"
    >
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="font-medium text-lg">Your assets</h3>
          <p className="text-xs text-secondary">Live tracking your assets</p>
        </div>
        <div className="text-xs text-secondary flex items-center gap-2">
          Updated 10 sec <button className="p-1.5 bg-elevated rounded-full hover:bg-border transition-colors"><RefreshCw size={12} /></button>
        </div>
      </div>
      
      <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-3">
        {mockAssets.map((asset) => (
          <motion.div key={asset.id} variants={item} className="flex items-center justify-between p-3 rounded-xl hover:bg-surface/80 transition-colors border border-transparent hover:border-border cursor-pointer">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${asset.color}`}>
                <Wallet size={18} />
              </div>
              <div>
                <div className="font-medium text-sm flex items-center gap-1">
                  {asset.name} <span className="text-xs text-secondary bg-surface px-1.5 py-0.5 rounded-md">{asset.symbol}</span>
                </div>
                <div className="text-xs text-secondary">{asset.amount} {asset.symbol}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium text-sm">{asset.value}</div>
              <div className={`text-xs flex items-center justify-end gap-1 ${asset.isPositive ? 'text-green-500' : 'text-red-500'}`}>
                {asset.isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {asset.change}
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}
