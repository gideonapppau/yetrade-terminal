import { Activity } from "lucide-react"
import { useState, useEffect } from "react"
import { getDb } from "../../db"
import { trades } from "../../db/schema"
import { eq } from "drizzle-orm"

export function ActiveTrades() {
  const [activeTrades, setActiveTrades] = useState<any[]>([])

  useEffect(() => {
    let mounted = true
    const fetchTrades = async () => {
      try {
        const db = await getDb()
        const data = await db.select().from(trades).where(eq(trades.status, 'OPEN'))
        if (mounted) {
          setActiveTrades(data)
        }
      } catch (err) {
        console.error("Failed to fetch open trades:", err)
      }
    }
    
    fetchTrades()
    // Optional: add interval or event listener here if we want live updates
    const interval = setInterval(fetchTrades, 5000)
    
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="glass rounded-2xl flex flex-col h-full border border-border">
      <div className="p-6 border-b border-border">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Activity size={18} className="text-accent" /> Active Positions
        </h2>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-400 uppercase bg-black/20">
            <tr>
              <th className="px-6 py-4 font-medium tracking-wider">Symbol</th>
              <th className="px-6 py-4 font-medium tracking-wider">Type</th>
              <th className="px-6 py-4 font-medium tracking-wider text-right">Vol</th>
              <th className="px-6 py-4 font-medium tracking-wider text-right">Entry</th>
              <th className="px-6 py-4 font-medium tracking-wider text-right">Current</th>
              <th className="px-6 py-4 font-medium tracking-wider text-right">P/L ($)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {activeTrades.map((trade) => (
              <tr key={trade.id} className="hover:bg-white/[0.02] transition-colors group">
                <td className="px-6 py-4 font-bold text-white">{trade.symbol}</td>
                <td className="px-6 py-4">
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${trade.direction === 'BUY' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                    {trade.direction}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-mono text-gray-300">{trade.volume.toFixed(2)}</td>
                <td className="px-6 py-4 text-right font-mono text-gray-400">{trade.entryPrice?.toFixed(2) || 'N/A'}</td>
                <td className="px-6 py-4 text-right font-mono text-white">N/A</td>
                <td className={`px-6 py-4 text-right font-mono font-bold text-gray-400`}>
                  --
                </td>
              </tr>
            ))}
            {activeTrades.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  No active positions
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
