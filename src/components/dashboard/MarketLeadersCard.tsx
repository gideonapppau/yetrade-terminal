import { motion } from "framer-motion"

export function MarketLeadersCard() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.5 }}
      className="col-span-12 lg:col-span-4 card card-hover p-6"
    >
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-medium text-lg">Market Leaders</h3>
        <div className="flex bg-elevated p-1 rounded-lg">
          <button className="px-3 py-1 text-xs text-secondary rounded-md hover:text-primary transition-colors">Week</button>
          <motion.button layoutId="activePill" className="px-3 py-1 text-xs font-medium bg-surface shadow-sm rounded-md">Month</motion.button>
        </div>
      </div>
      
      {/* Empty State */}
      <div className="flex flex-col items-center justify-center h-[280px] text-center border border-dashed border-border rounded-xl bg-surface/50 mt-4">
        <div className="w-12 h-12 bg-elevated rounded-full flex items-center justify-center text-secondary mb-4 shadow-sm">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
        </div>
        <h4 className="text-sm font-medium mb-1">Market data unavailable</h4>
        <p className="text-xs text-secondary max-w-[200px]">Waiting for live feed from your connected exchange.</p>
      </div>
    </motion.div>
  )
}
