import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Award } from "lucide-react"
import { getDb } from "../../db"
import { telegramChannels } from "../../db/schema"

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
  const [channels, setChannels] = useState<any[]>([])

  useEffect(() => {
    let mounted = true
    const fetchChannels = async () => {
      try {
        const db = await getDb()
        const data = await db.select().from(telegramChannels)
        if (mounted) {
          setChannels(data)
        }
      } catch (err) {
        console.error("Failed to fetch channels:", err)
      }
    }
    
    fetchChannels()
    const interval = setInterval(fetchChannels, 10000)
    
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.5 }}
      className="col-span-12 lg:col-span-4 card card-hover p-6 flex flex-col"
    >
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-medium text-lg flex items-center gap-2">
          <Award size={18} className="text-accent" /> Active Channels
        </h3>
      </div>
      
      <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-4 flex-1">
        {channels.length === 0 ? (
           <div className="text-sm text-secondary text-center py-8">No channels connected yet.</div>
        ) : channels.map((channel, i) => (
          <motion.div key={channel.id} variants={item} className="flex items-center justify-between group cursor-pointer p-2 -mx-2 rounded-xl hover:bg-surface/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-elevated flex items-center justify-center text-primary font-bold text-xs shadow-sm border border-border group-hover:border-primary/50 transition-colors">
                {i + 1}
              </div>
              <div>
                <div className="font-medium text-sm truncate">{channel.name}</div>
                <div className="text-xs text-secondary">{channel.isActive ? "Monitoring" : "Paused"}</div>
              </div>
            </div>
            
            <div className="text-right flex-shrink-0">
              <div className="font-medium text-sm">Risk: {channel.riskPerTrade ? `${channel.riskPerTrade}%` : 'Default'}</div>
              <div className="text-xs text-secondary">
                Max {channel.maxTradesPerDay || '∞'} trades/day
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}
