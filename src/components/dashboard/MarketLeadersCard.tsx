import { motion } from "framer-motion"
import { TrendingUp } from "lucide-react"

const leaders = [
  { id: 'nvda', name: 'NVIDIA Corp', symbol: 'NVDA', price: '$895.34', change: '+15.4%', volume: '45.2M', chart: [30, 40, 35, 50, 49, 60, 70, 90, 85, 100] },
  { id: 'msft', name: 'Microsoft', symbol: 'MSFT', price: '$420.55', change: '+8.2%', volume: '22.1M', chart: [40, 45, 42, 50, 55, 53, 60, 65, 75, 80] },
  { id: 'aapl', name: 'Apple Inc', symbol: 'AAPL', price: '$175.20', change: '+5.1%', volume: '35.8M', chart: [60, 58, 62, 65, 60, 70, 68, 75, 80, 85] },
  { id: 'meta', name: 'Meta Platforms', symbol: 'META', price: '$510.12', change: '+4.8%', volume: '18.4M', chart: [20, 25, 30, 28, 35, 40, 45, 42, 50, 60] },
]

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.5 }
  }
}

const item = {
  hidden: { opacity: 0, x: 20 },
  show: { opacity: 1, x: 0 }
}

export function MarketLeadersCard() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.5 }}
      className="col-span-12 lg:col-span-4 card card-hover p-6 flex flex-col"
    >
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-medium text-lg">Market Leaders</h3>
        <div className="flex bg-elevated p-1 rounded-lg">
          <button className="px-3 py-1 text-xs text-secondary rounded-md hover:text-primary transition-colors">Week</button>
          <motion.button layoutId="activePill" className="px-3 py-1 text-xs font-medium bg-surface shadow-sm rounded-md">Month</motion.button>
        </div>
      </div>
      
      <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-4 flex-1">
        {leaders.map((leader, i) => (
          <motion.div key={leader.id} variants={item} className="flex items-center justify-between group cursor-pointer p-2 -mx-2 rounded-xl hover:bg-surface/50 transition-colors">
            <div className="flex items-center gap-3 w-[120px]">
              <div className="w-8 h-8 rounded-lg bg-elevated flex items-center justify-center text-primary font-bold text-xs shadow-sm border border-border group-hover:border-primary/50 transition-colors">
                {i + 1}
              </div>
              <div>
                <div className="font-medium text-sm">{leader.symbol}</div>
                <div className="text-xs text-secondary truncate max-w-[80px]">{leader.name}</div>
              </div>
            </div>
            
            {/* Mini chart visualizer using svg */}
            <div className="w-16 h-8 opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
                <polyline 
                  points={leader.chart.map((val, idx) => `${idx * 11},${40 - (val / 100) * 30}`).join(' ')} 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  className="text-green-500" 
                />
              </svg>
            </div>
            
            <div className="text-right w-[90px] flex-shrink-0">
              <div className="font-medium text-sm">{leader.price}</div>
              <div className="text-xs text-green-500 flex items-center justify-end gap-1">
                <TrendingUp size={12} />
                {leader.change}
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}
