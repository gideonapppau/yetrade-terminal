import { useState, useEffect } from "react"
import { Shield, ShieldAlert, TrendingDown, Save, CheckCircle2 } from "../components/ui/icons"
import { getDb } from "../db"
import { telegramChannels } from "../db/schema"
import { eq } from "drizzle-orm"
import { useMT5Store } from "../store/mt5"
import { useSettingsStore } from "../store/settings"
import { formatMoney } from "../lib/utils"
import { logger } from "../core/logger"
import { DEFAULT_MAX_POSITION_SIZE_LOTS } from "../core/constants"

export function RiskPage() {
  const [channels, setChannels] = useState<any[]>([])
  const [saveMessage, setSaveMessage] = useState("")
  
  const { riskConfig, setRiskConfig } = useSettingsStore()
  const [globalRisk, setGlobalRisk] = useState(riskConfig.riskPerTradePercent)
  const [maxDailyLoss, setMaxDailyLoss] = useState(riskConfig.maxDailyLossPercent)
  const [maxOpenRisk, setMaxOpenRisk] = useState(riskConfig.maxOpenRiskPercent)
  const [maxSlippage, setMaxSlippage] = useState(riskConfig.maxSlippagePoints)
  const [maxDrawdown, setMaxDrawdown] = useState(riskConfig.maxDrawdownPercent)
  const [minRR, setMinRR] = useState(riskConfig.minRR)
  const [maxOpenGroups, setMaxOpenGroups] = useState(riskConfig.maxOpenTradeGroups)
  const [rejectBelowMinVolume, setRejectBelowMinVolume] = useState(riskConfig.rejectBelowMinVolume === true)
  const [maxLots, setMaxLots] = useState(riskConfig.maxPositionSizeLots ?? DEFAULT_MAX_POSITION_SIZE_LOTS)
  
  const mt5 = useMT5Store()


  useEffect(() => {
    let mounted = true
    const loadChannels = async () => {
      try {
        const db = await getDb()
        const all = await db.select().from(telegramChannels)
        if (mounted) setChannels(all)
      } catch (e) {
        logger.error({ err: e }, "Failed to load channels")
      }
    }
    loadChannels()
    return () => { mounted = false }
  }, [])

  /**
   * Smallest accepted percentage. Zero or negative budgets are never
   * meaningful, but sub-1% risk is a normal, conservative choice.
   */
  const MIN_PERCENT_PARAM = 0.1;
  /** Counts (slippage points, trades per day) are whole numbers >= 1. */
  const MIN_COUNT_PARAM = 1;

  /**
   * An empty channel field clears the override ("use global"); anything
   * else is floored at the smallest meaningful value.
   */
  const sanitizeChannelOverride = (
    value: number | null | undefined,
    round: boolean
  ): number | null => {
    if (value == null || !Number.isFinite(value)) return null;
    const normalized = round ? Math.round(value) : value;
    return Math.max(round ? MIN_COUNT_PARAM : MIN_PERCENT_PARAM, normalized);
  };

  /**
   * Global parameters are floored too - clearing a field must not zero out
   * a safety limit, so it falls back to the most conservative value.
   */
  const sanitizeGlobalParam = (value: number, opts?: { max?: number; round?: boolean }): number => {
    const min = opts?.round ? MIN_COUNT_PARAM : MIN_PERCENT_PARAM;
    if (!Number.isFinite(value)) return min;
    const rounded = opts?.round ? Math.round(value) : value;
    return Math.min(opts?.max ?? Infinity, Math.max(min, rounded));
  };

  // Live typing stays unrestricted (so "0." can be typed); floors apply when
  // a field loses focus and again on save.
  const blurSanitizer = (
    setter: (value: number | ((prev: number) => number)) => void,
    opts?: { max?: number; round?: boolean }
  ) =>
    () => setter((prev: number) => sanitizeGlobalParam(prev, opts));

  /** Final sanitation applied to everything written into the risk config. */
  const sanitizedRiskPatch = () => ({
    riskPerTradePercent: sanitizeGlobalParam(globalRisk, { max: 10 }),
    maxDailyLossPercent: sanitizeGlobalParam(maxDailyLoss),
    maxOpenRiskPercent: sanitizeGlobalParam(maxOpenRisk),
    maxSlippagePoints: sanitizeGlobalParam(maxSlippage, { round: true }),
    maxPositionSizeLots: Number.isFinite(maxLots) && maxLots > 0 ? maxLots : DEFAULT_MAX_POSITION_SIZE_LOTS,
    maxDrawdownPercent: sanitizeGlobalParam(maxDrawdown, { max: 100 }),
    minRR: Number.isFinite(minRR) && minRR >= 0 ? minRR : 1,
    maxOpenTradeGroups: sanitizeGlobalParam(maxOpenGroups, { round: true }),
    // No economic calendar is connected, so an enabled news filter would
    // reject every signal. The switch is gone; saving clears a stale "on".
    newsFilterEnabled: false,
    rejectBelowMinVolume: rejectBelowMinVolume
  });

  const commitChannelOverride = (
    id: string,
    field: 'riskPerTrade' | 'maxTradesPerDay',
    rawValue: string
  ) => {
    const next =
      rawValue.trim() === "" || !Number.isFinite(Number(rawValue))
        ? null
        : sanitizeChannelOverride(Number(rawValue), field === 'maxTradesPerDay');
    setChannels(prev => prev.map(ch => (ch.id === id ? { ...ch, [field]: next } : ch)));
  }

  // Live typing stays unrestricted (so "0." can be typed); the floor applies
  // when the field loses focus.
  const handleChannelRiskBlur = (
    id: string,
    field: 'riskPerTrade' | 'maxTradesPerDay',
    rawValue: string
  ) => {
    commitChannelOverride(id, field, rawValue);
  }

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

      // Update channel overrides (re-sanitized so nothing non-positive persists)
      for (const ch of channels) {
        await db.update(telegramChannels)
          .set({
            riskPerTrade: sanitizeChannelOverride(ch.riskPerTrade, false),
            maxTradesPerDay: sanitizeChannelOverride(ch.maxTradesPerDay, true)
          })
          .where(eq(telegramChannels.id, ch.id))
      }
      
      // Update global risk configuration (sanitized - never non-positive)
      setRiskConfig(sanitizedRiskPatch())
      
      setSaveMessage("Settings saved successfully!")
      setTimeout(() => setSaveMessage(""), 3000)
    } catch (e) {
      logger.error({ err: e }, "Failed to save risk settings")
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
          {saveMessage && <span className="text-success text-sm font-medium">{saveMessage}</span>}
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
                      value={Math.min(10, Math.max(0.1, globalRisk))}
                      onChange={(e) => setGlobalRisk(Number(e.target.value))}
                      className="flex-1 h-2 bg-elevated rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                    <div className="relative w-20 shrink-0">
                      <input
                        type="number"
                        value={globalRisk}
                        onChange={(e) => setGlobalRisk(Number(e.target.value))}
                        onBlur={blurSanitizer(setGlobalRisk, { max: 10 })}
                        min="0.1"
                        max="10"
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
                  <input type="number" value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(Number(e.target.value))} onBlur={blurSanitizer(setMaxDailyLoss)} min="0.1" step="0.5" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1">Max Open Risk (%)</label>
                  <p className="text-xs text-secondary mb-2">Total concurrent risk across all open positions.</p>
                  <input type="number" value={maxOpenRisk} onChange={(e) => setMaxOpenRisk(Number(e.target.value))} onBlur={blurSanitizer(setMaxOpenRisk)} min="0.1" step="0.5" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Minimum Risk:Reward</label>
                  <p className="text-xs text-secondary mb-2">Signals whose furthest target pays less than this multiple of the stop are rejected.</p>
                  <input type="number" value={minRR} onChange={(e) => setMinRR(Number(e.target.value))} min="0" step="0.1" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Max Open Trades</label>
                  <p className="text-xs text-secondary mb-2">Maximum signals open at once (a signal split across TPs counts once).</p>
                  <input type="number" value={maxOpenGroups} onChange={(e) => setMaxOpenGroups(Number(e.target.value))} onBlur={blurSanitizer(setMaxOpenGroups, { round: true })} min="1" step="1" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Max Slippage (Points)</label>
                  <p className="text-xs text-secondary mb-2">How far (in points) MT5 may fill away from the price it was sent.</p>
                  <input type="number" value={maxSlippage} onChange={(e) => setMaxSlippage(Number(e.target.value))} onBlur={blurSanitizer(setMaxSlippage, { round: true })} min="1" step="1" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Max Position Size (Lots)</label>
                  <p className="text-xs text-secondary mb-2">Signals that size above this are rejected - usually a stop that is far too tight.</p>
                  <input type="number" value={maxLots} onChange={(e) => setMaxLots(Number(e.target.value))} min="0.01" step="0.5" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1 flex justify-between items-center">
                    Strict Minimum Lot Size
                    <div onClick={() => setRejectBelowMinVolume(!rejectBelowMinVolume)} className={`w-8 h-4 rounded-full relative cursor-pointer transition-colors ${rejectBelowMinVolume ? 'bg-accent' : 'bg-elevated border border-border'}`}>
                      <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${rejectBelowMinVolume ? 'right-0.5' : 'left-0.5'}`}></span>
                    </div>
                  </label>
                  <p className="text-xs text-secondary mb-2">Skip trades whose computed size is below the broker minimum instead of oversizing them.</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1">Max Drawdown (%)</label>
                  <p className="text-xs text-secondary mb-2">New trades are blocked while open losses (balance minus equity) exceed this share of the balance.</p>
                  <input type="number" value={maxDrawdown} onChange={(e) => setMaxDrawdown(Number(e.target.value))} onBlur={blurSanitizer(setMaxDrawdown, { max: 100 })} min="0.1" step="0.5" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
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
                                min="0.1"
                                placeholder="Global"
                                value={ch.riskPerTrade == null ? "" : ch.riskPerTrade}
                                onChange={(e) => handleChannelRiskChange(ch.id, 'riskPerTrade', e.target.value)}
                                onBlur={(e) => handleChannelRiskBlur(ch.id, 'riskPerTrade', e.target.value)}
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
                              min="1"
                              step="1"
                              placeholder="Global"
                              value={ch.maxTradesPerDay == null ? "" : ch.maxTradesPerDay}
                              onChange={(e) => handleChannelRiskChange(ch.id, 'maxTradesPerDay', e.target.value)}
                              onBlur={(e) => handleChannelRiskBlur(ch.id, 'maxTradesPerDay', e.target.value)}
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
              <TrendingDown size={18} className="text-secondary" />
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
                  <Shield size={24} className="text-secondary opacity-50 mb-3" />
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
