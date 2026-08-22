import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Target, RefreshCw } from "lucide-react"
import { getDb } from "../../db"
import { trades } from "../../db/schema"

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

export function YourAssetsCard() {
  const [pairs, setPairs] = useState<any[]>([])

  useEffect(() => {
    let mounted = true
    const fetchTrades = async () => {
      try {
        const db = await getDb()
        const allTrades = await db.select().from(trades)
        
        // Aggregate by symbol
        const pairStats: Record<string, { count: number; volume: number }> = {}
        allTrades.forEach((trade: any) => {
          if (!pairStats[trade.symbol]) {
            pairStats[trade.symbol] = { count: 0, volume: 0 }
          }
          pairStats[trade.symbol].count += 1
          pairStats[trade.symbol].volume += trade.volume
        })

        const sortedPairs = Object.entries(pairStats)
          .map(([symbol, stats]) => ({ symbol, ...stats }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5) // Top 5

        if (mounted) {
          setPairs(sortedPairs)
        }
      } catch (err) {
        console.error("Failed to fetch trades:", err)
      }
    }
    
    fetchTrades()
    const interval = setInterval(fetchTrades, 5000)
    
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
      className="col-span-12 lg:col-span-4 card card-hover p-6"
    >
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="font-medium text-lg">Top Traded Pairs</h3>
          <p className="text-xs text-secondary">Based on execution history</p>
        </div>
        <div className="text-xs text-secondary flex items-center gap-2">
          Live <button className="p-1.5 bg-elevated rounded-full hover:bg-border transition-colors"><RefreshCw size={12} /></button>
        </div>
      </div>
      
      <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-3">
        {pairs.length === 0 ? (
           <div className="text-sm text-secondary text-center py-8">No trade data available yet.</div>
        ) : pairs.map((pair, i) => (
          <motion.div key={pair.symbol} variants={item} className="flex items-center justify-between p-3 rounded-xl hover:bg-surface/80 transition-colors border border-transparent hover:border-border cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-500/10 text-blue-500">
                <Target size={18} />
              </div>
              <div>
                <div className="font-medium text-sm flex items-center gap-1">
                  {pair.symbol}
                </div>
                <div className="text-xs text-secondary">{pair.count} total trades</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium text-sm">{pair.volume.toFixed(2)} Lots</div>
              <div className="text-xs text-secondary">
                Total Vol
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}
