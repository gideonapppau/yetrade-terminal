import { ArrowDownRight, ArrowUpRight, Clock, Target, ShieldAlert } from "lucide-react"
import { useSignalStore } from "../../store/signals"

export function SignalFeed() {
  const signals = useSignalStore(state => state.signals).slice(0, 10)

  return (
    <div className="glass rounded-2xl flex flex-col h-full border border-border">
      <div className="p-6 border-b border-border flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Live Signal Feed</h2>
        <span className="flex h-2 w-2 rounded-full bg-success animate-pulse"></span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2">
          {signals.map((signal) => (
            <div key={signal.id} className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-transparent hover:border-white/5 transition-all flex items-center justify-between group">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${signal.direction === 'BUY' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                  {signal.direction === 'BUY' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                </div>
                <div>
                  <h4 className="font-bold text-white tracking-wide">{signal.symbol}</h4>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1"><Target size={12}/> {signal.entry}</span>
                    <span className="flex items-center gap-1"><ShieldAlert size={12}/> {signal.sl}</span>
                  </div>
                </div>
              </div>
              
              <div className="text-right">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  signal.decision === 'APPROVED' ? 'bg-success/20 text-success' : 
                  signal.decision === 'REJECTED' ? 'bg-destructive/20 text-destructive' : 
                  'bg-gray-800 text-gray-400'
                }`}>
                  {signal.decision}
                </span>
                <div className="flex items-center justify-end gap-1 text-xs text-gray-600 mt-2">
                  <Clock size={10} /> {signal.time}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
