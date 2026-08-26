import { useState } from "react"
import { ArrowDownRight, ArrowUpRight, Clock, Target, ShieldAlert, Radio } from "lucide-react"
import { useSignalStore } from "../../store/signals"

function SymbolIcon({ symbol, direction }: { symbol: string, direction: 'BUY' | 'SELL' }) {
  const [imgError, setImgError] = useState(false);
  
  // Try to parse out the base currency (e.g. BTCUSD -> btc)
  const base = symbol.replace(/USD[TM]?$|EUR$|GBP$|JPY$/i, '').toLowerCase();
  
  if (imgError) {
    return (
      <div className={`p-3 rounded-xl ${direction === 'BUY' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
        {direction === 'BUY' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden border border-border/50 bg-elevated shadow-sm">
        <img 
          src={`https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/${base}.svg`}
          alt={base}
          className="w-6 h-6 object-contain"
          onError={() => setImgError(true)}
        />
      </div>
      <div className={`absolute -bottom-1 -right-1 p-1 rounded-full ${direction === 'BUY' ? 'bg-success text-white' : 'bg-destructive text-white'} shadow-md ring-2 ring-surface`}>
        {direction === 'BUY' ? <ArrowUpRight size={10} strokeWidth={3} /> : <ArrowDownRight size={10} strokeWidth={3} />}
      </div>
    </div>
  );
}

export function SignalFeed() {
  const signals = useSignalStore(state => state.signals).slice(0, 10)

  return (
    <div className="glass rounded-2xl flex flex-col h-full border border-border">
      <div className="p-6 border-b border-border flex items-center justify-between">
        <h3 className="font-medium text-lg flex items-center gap-2 text-white">
          <Radio size={18} className="text-accent" /> Live Signal Feed
        </h3>
        <div className="flex items-center gap-2 text-xs font-medium text-success bg-success/10 px-2 py-1 rounded">
          <span className="flex h-2 w-2 rounded-full bg-success"></span>
          Live
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2">
          {signals.length === 0 ? (
            <div className="text-center py-12 px-4 text-secondary text-sm">
              <div className="w-12 h-12 bg-elevated rounded-full flex items-center justify-center mx-auto mb-3 border border-border">
                <Radio size={20} className="text-secondary/50" />
              </div>
              Waiting for incoming Telegram signals...
            </div>
          ) : (
            signals.map((signal) => (
              <div key={signal.id} className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-transparent hover:border-white/5 transition-all flex items-center justify-between group">
                <div className="flex items-center gap-4">
                  <SymbolIcon symbol={signal.symbol} direction={signal.direction as 'BUY' | 'SELL'} />
                  <div>
                    <h4 className="font-bold text-white tracking-wide">{signal.symbol}</h4>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                      <span className="flex items-center gap-1"><Target size={12}/> {signal.entry}</span>
                      <span className="flex items-center gap-1"><ShieldAlert size={12}/> {signal.sl}</span>
                    </div>
                  </div>
                </div>
                
                <div className="text-right">
                  {signal.provisional && (
                    <span className={`block mb-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      signal.provisional === 'ARMED'
                        ? 'bg-warning/15 text-warning animate-pulse'
                        : 'bg-accent/15 text-accent'
                    }`}>
                      {signal.provisional === 'ARMED' ? 'AWAITING LEVELS' : 'ADJUSTED'}
                    </span>
                  )}
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
            ))
          )}
        </div>
      </div>
    </div>
  )
}
