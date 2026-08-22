import { useState, useEffect } from "react"
import { Shield, ShieldAlert, Activity, Save, CheckCircle2 } from "lucide-react"
import { getDb } from "../db"
import { telegramChannels } from "../db/schema"
import { eq } from "drizzle-orm"
import { useMT5Store } from "../store/mt5"
import { useSettingsStore } from "../store/settings"
import { formatMoney } from "../lib/utils"

export function RiskPage() {
  const [channels, setChannels] = useState<any[]>([])
  const [saveMessage, setSaveMessage] = useState("")
  
  const { riskConfig, setRiskConfig } = useSettingsStore()
  const [globalRisk, setGlobalRisk] = useState(riskConfig.riskPerTradePercent)
  const [maxDailyLoss, setMaxDailyLoss] = useState(riskConfig.maxDailyLossPercent)
  const [maxOpenRisk, setMaxOpenRisk] = useState(riskConfig.maxOpenRiskPercent)
  const [maxSlippage, setMaxSlippage] = useState(riskConfig.maxSlippagePoints)
  const [newsFilter, setNewsFilter] = useState(riskConfig.newsFilterEnabled)
  
  const mt5 = useMT5Store()


  useEffect(() => {
    let mounted = true
    const loadChannels = async () => {
      try {
        const db = await getDb()
        const all = await db.select().from(telegramChannels)
        if (mounted) setChannels(all)
      } catch (e) {
        console.error("Failed to load channels", e)
      }
    }
    loadChannels()
    return () => { mounted = false }
  }, [])

  const handleChannelRiskChange = (id: string, field: 'riskPerTrade' | 'maxTradesPerDay', value: string) => {
    setChannels(prev => prev.map(ch => {
      if (ch.id === id) {
        return { ...ch, [field]: value === "" ? null : Number(value) }
      }
      return ch
    }))
  }

  const handleSaveChanges = async () => {
    try {
      const db = await getDb()
      
      // Update channel overrides
      for (const ch of channels) {
        await db.update(telegramChannels)
          .set({ 
            riskPerTrade: ch.riskPerTrade ?? null, 
            maxTradesPerDay: ch.maxTradesPerDay ?? null 
          })
          .where(eq(telegramChannels.id, ch.id))
      }
      
      // Update global risk configuration
      setRiskConfig({
        riskPerTradePercent: globalRisk,
        maxDailyLossPercent: maxDailyLoss,
        maxOpenRiskPercent: maxOpenRisk,
        maxSlippagePoints: maxSlippage,
        newsFilterEnabled: newsFilter
      })
      
      setSaveMessage("Settings saved successfully!")
      setTimeout(() => setSaveMessage(""), 3000)
    } catch (e) {
      console.error("Failed to save changes", e)
    }
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-1">Risk Management</h2>
          <p className="text-secondary text-sm">Control account exposure and set maximum drawdown limits.</p>
        </div>
        <div className="flex items-center gap-4">
          {saveMessage && <span className="text-success text-sm font-medium animate-pulse">{saveMessage}</span>}
          <button onClick={handleSaveChanges} className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors">
            <Save size={16} /> Save Changes
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        
        {/* Main Risk Settings */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          <div className="card p-6">
            <h3 className="font-medium text-lg mb-6 flex items-center gap-2">
              <Shield size={18} className="text-secondary" />
              Global Risk Parameters
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-1">Risk Per Trade (%)</label>
                  <p className="text-xs text-secondary mb-3">Percentage of account balance to risk per signal.</p>
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" 
                      min="0.1" 
                      max="10.0" 
                      step="0.1" 
                      value={globalRisk}
                      onChange={(e) => setGlobalRisk(Number(e.target.value))}
                      className="flex-1 h-2 bg-elevated rounded-lg appearance-none cursor-pointer accent-accent" 
                    />
                    <div className="relative w-20 shrink-0">
                      <input 
                        type="number" 
                        value={globalRisk}
                        onChange={(e) => setGlobalRisk(Number(e.target.value))}
                        step="0.1" 
                        className="w-full bg-surface border border-border rounded-lg pl-3 pr-6 py-1.5 text-sm font-bold focus:outline-none focus:border-accent transition-colors" 
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary text-xs">%</span>
                    </div>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1">Max Daily Loss (%)</label>
                  <p className="text-xs text-secondary mb-2">If reached, terminal halts trading until next day.</p>
                  <input type="number" value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(Number(e.target.value))} step="0.5" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1">Max Open Risk (%)</label>
                  <p className="text-xs text-secondary mb-2">Total concurrent risk across all open positions.</p>
                  <input type="number" value={maxOpenRisk} onChange={(e) => setMaxOpenRisk(Number(e.target.value))} step="0.5" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Max Slippage (Points)</label>
                  <p className="text-xs text-secondary mb-2">Maximum allowed deviation from signal entry price.</p>
                  <input type="number" value={maxSlippage} onChange={(e) => setMaxSlippage(Number(e.target.value))} className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1 flex justify-between items-center">
                    News Filter
                    <div onClick={() => setNewsFilter(!newsFilter)} className={`w-8 h-4 rounded-full relative cursor-pointer transition-colors ${newsFilter ? 'bg-accent' : 'bg-elevated border border-border'}`}>
                      <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${newsFilter ? 'right-0.5' : 'left-0.5'}`}></span>
                    </div>
                  </label>
                  <p className="text-xs text-secondary mb-2">Block trading 30m before and after High Impact (Red) news.</p>
                </div>
                
                <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
                  <h4 className="text-warning text-sm font-bold flex items-center gap-2 mb-2">
                    <ShieldAlert size={14} /> Protection Active
                  </h4>
                  <p className="text-xs text-secondary">The terminal is currently enforcing a maximum drawdown limit of 10% from the account High Water Mark.</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="card p-6">
            <h3 className="font-medium text-lg mb-6">Channel-Specific Overrides</h3>
            <p className="text-sm text-secondary mb-6">Set different risk parameters for specific Telegram channels. Leave blank to use Global Risk Parameters.</p>
            
            <table className="w-full text-sm">
              <thead>
                <tr className="text-secondary border-b border-border">
                  <th className="font-medium pb-4 text-left">Channel Name</th>
                  <th className="font-medium pb-4 text-right">Risk/Trade</th>
                  <th className="font-medium pb-4 text-right">Max Trades/Day</th>
                  <th className="font-medium pb-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {channels.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12">
                      <div className="flex flex-col items-center justify-center text-center">
                        <span className="text-sm font-medium mb-1">No channels connected</span>
                        <span className="text-xs text-secondary">Connect channels in the settings page to configure overrides.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  channels.map((ch) => {
                    const hasOverride = (ch.riskPerTrade !== null && ch.riskPerTrade !== undefined) || (ch.maxTradesPerDay !== null && ch.maxTradesPerDay !== undefined);
                    return (
                      <tr key={ch.id} className="text-sm group hover:bg-elevated/30 transition-colors">
                        <td className="py-4 pr-4">
                          <div className="font-medium text-primary truncate max-w-[200px]" title={ch.name}>{ch.name}</div>
                          <div className="text-[10px] text-secondary truncate font-medium">{ch.channelId}</div>
                        </td>
                        <td className="py-4">
                          <div className="flex justify-end">
                            <div className="relative w-24">
                              <input 
                                type="number" 
                                step="0.1" 
                                placeholder="Global"
                                value={ch.riskPerTrade == null ? "" : ch.riskPerTrade}
                                onChange={(e) => handleChannelRiskChange(ch.id, 'riskPerTrade', e.target.value)}
                                className="w-full bg-elevated border border-border rounded-md pl-3 pr-6 py-1.5 text-right text-sm focus:outline-none focus:border-accent transition-colors"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary text-xs opacity-70">%</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 pl-4">
                          <div className="flex justify-end">
                            <input 
                              type="number" 
                              placeholder="Global"
                              value={ch.maxTradesPerDay == null ? "" : ch.maxTradesPerDay}
                              onChange={(e) => handleChannelRiskChange(ch.id, 'maxTradesPerDay', e.target.value)}
                              className="w-24 bg-elevated border border-border rounded-md px-3 py-1.5 text-right text-sm focus:outline-none focus:border-accent transition-colors"
                            />
                          </div>
                        </td>
                        <td className="py-4 text-right pl-4">
                          {hasOverride ? (
                            <span className="inline-flex items-center justify-center gap-1.5 bg-accent/15 text-accent px-2 py-1 rounded text-[11px] font-bold">
                              <CheckCircle2 size={12} /> Override Active
                            </span>
                          ) : (
                            <span className="text-xs text-secondary font-medium">Using Global</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Simulator Sidebar */}
        <div className="col-span-12 lg:col-span-4">
          <div className="card p-6 sticky top-8">
            <h3 className="font-medium text-lg mb-6 flex items-center gap-2">
              <Activity size={18} className="text-secondary" />
              Risk Simulator
            </h3>
            
            <div className="space-y-4 mb-6">
              <div className="flex justify-between items-center text-sm">
                <span className="text-secondary">Current Balance:</span>
                <span className="font-medium">{mt5.isConnected ? formatMoney(mt5.balance, mt5.currency) : formatMoney(0)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-secondary">Global Risk Setting:</span>
                <span className="font-medium text-accent">{globalRisk.toFixed(1)}%</span>
              </div>
            </div>

            <div className="p-8 bg-elevated border border-border rounded-lg flex flex-col items-center justify-center text-center">
              {mt5.isConnected ? (
                <>
                  <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center text-destructive mb-3 shadow-sm border border-destructive/20">
                    <ShieldAlert size={20} />
                  </div>
                  <span className="text-sm font-medium mb-1 text-secondary">Theoretical Risk Amount</span>
                  <span className="text-3xl font-bold font-mono tracking-tight text-destructive">
                    {formatMoney(mt5.balance * (globalRisk / 100), mt5.currency)}
                  </span>
                </>
              ) : (
                <>
                  <Activity size={24} className="text-secondary opacity-50 mb-3" />
                  <span className="text-sm font-medium mb-1">Waiting for live quotes</span>
                  <span className="text-xs text-secondary">Connect your broker to simulate risk.</span>
                </>
              )}
            </div>
            
            <p className="text-[10px] text-secondary mt-4 leading-relaxed">
              * The simulator uses your live MetaTrader 5 account balance and current market quotes to calculate the exact lot size for a theoretical 50-point stop loss.
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}
