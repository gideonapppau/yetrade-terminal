import { motion } from "framer-motion"
import { RefreshCw } from "lucide-react"

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.4 }
  }
}

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
      
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 gap-4">
        {/* Empty State */}
        <div className="flex flex-col items-center justify-center py-12 text-center col-span-2 border border-dashed border-border rounded-xl bg-surface/50">
          <div className="w-12 h-12 bg-elevated rounded-full flex items-center justify-center text-secondary mb-4 shadow-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="9" y1="14" x2="15" y2="14"></line></svg>
          </div>
          <h4 className="text-sm font-medium mb-1">No assets yet</h4>
          <p className="text-xs text-secondary max-w-[200px]">Connect your broker or deposit funds to see your portfolio.</p>
        </div>
      </motion.div>
    </motion.div>
  )
}
