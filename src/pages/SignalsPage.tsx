import React, { useState } from "react"
import { Search, CheckCircle2, XCircle, MessageSquare, Activity, AlertTriangle } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import { useSignalStore, type UiSignal } from "../store/signals"
import { useMT5Store } from "../store/mt5"
import { useSettingsStore } from "../store/settings"
import { useTelegramStore } from "../store/telegram"
import { formatMoney } from "../lib/utils"
import type { ParsedSignal } from "../core/signal-engine/types"
import { RiskEngine } from "../core/risk-engine"
import { ExecutionEngine } from "../core/execution-engine"

const STATUS_FILTERS = ["All", "Approved", "Rejected", "Missed"] as const
type StatusFilter = typeof STATUS_FILTERS[number]

export function SignalsPage() {
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")
  const [searchQuery, setSearchQuery] = useState("")
  const [executingIds, setExecutingIds] = useState<string[]>([])
  const [simulating, setSimulating] = useState(false)
  const signals = useSignalStore(state => state.signals);
  const { isConnected: mt5Connected, balance: mt5Balance, currency: mt5Currency } = useMT5Store();
  const riskPerTrade = useSettingsStore(state => state.riskConfig.riskPerTradePercent);

  const matchesStatus = (s: UiSignal) => {
    if (statusFilter === 'Approved') return s.decision === 'APPROVED' && s.outcome !== 'MISSED';
    if (statusFilter === 'Rejected') return s.decision === 'REJECTED';
    if (statusFilter === 'Missed') return s.outcome === 'MISSED';
    return true;
  };

  const matchesSearch = (s: UiSignal) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      s.symbol.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q) ||
      s.raw.toLowerCase().includes(q)
    );
  };

  const filteredSignals = signals.filter((s) => matchesStatus(s) && matchesSearch(s));

  const handleManualExecute = async (signal: UiSignal, override: boolean) => {
    const mt5 = useMT5Store.getState();

    if (!mt5.isConnected) {
      toast.error("MT5 not connected", {
        description: "Connect your broker in Settings before executing trades.",
      });
      return;
    }
    if (!signal.entry) {
      toast.error("Cannot execute", { description: "This signal has no entry price." });
      return;
    }

    const parsed: ParsedSignal = {
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entry,
      stopLoss: signal.sl,
      takeProfits: signal.tp > 0 ? [{ price: signal.tp }] : [],
    };

    let positionSize: number | null = null;
    if (!override) {
      // Re-run the risk engine so manual executions respect current limits
      const settings = useSettingsStore.getState();
      const effectiveBalance =
        mt5.balance > 0 ? mt5.balance : settings.accountBalance;
      const evaluation = new RiskEngine().evaluate(parsed, {
        balance: effectiveBalance,
        equity: effectiveBalance,
        freeMargin: effectiveBalance,
        openGroupsCount: 0,
        currentDrawdown: 0,
        dailyLoss: 0,
      }, settings.riskConfig);

      if (evaluation.decision !== 'APPROVED' || evaluation.positionSize === null) {
        const reason = evaluation.ruleResults.find((r) => !r.passed)?.message || 'Unknown reason';
        toast.error("Risk Check Failed", { description: reason });
        return;
      }
      positionSize = evaluation.positionSize;
    }

    setExecutingIds((prev) => [...prev, signal.id]);
    try {
      // positionSize of 0 lets the broker adapter fall back to its minimum lot size
      const engine = new ExecutionEngine(mt5.adapter);
      const executed = await engine.executeApprovedSignal({
        signalId: signal.id,
        signal: parsed,
        positionSize: positionSize ?? 0,
      });

      if (executed) {
        toast.success(`Trade Executed: ${parsed.symbol}`, {
          description: `Size: ${positionSize ?? 'minimum'} lots`,
        });
      } else {
        toast.error(`Execution Failed: ${parsed.symbol}`, {
          description: "The broker could not fill the order.",
        });
      }
    } finally {
      setExecutingIds((prev) => prev.filter((id) => id !== signal.id));
    }
  };

  return (
    <div className="p-8 max-w-[1400px] mx-auto w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-1">Signals Inbox</h2>
          <p className="text-secondary text-sm">Real-time parsed signals from all connected channels.</p>
        </div>
        
        <div className="flex gap-4">
          <div className="flex bg-elevated p-1 rounded-lg border border-border">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${f === statusFilter ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
              >
                {f}
              </button>
            ))}
          </div>
          
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input type="text" placeholder="Search signals..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 pr-4 py-1.5 h-full bg-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-accent transition-colors w-64" />
          </div>
          
          <button
            onClick={async () => {
              if (simulating) return;
              setSimulating(true);
              try {
                const service = useTelegramStore.getState().service;
                const mt5 = useMT5Store.getState();

                if (!service) {
                  toast.error("Telegram service not connected.", { id: 'simulate' });
                  return;
                }

                if (!mt5.isConnected || !mt5.adapter.getSymbolPrice) {
                  toast.error("MT5 not connected. Please connect broker to simulate live trades.", { id: 'simulate' });
                  return;
                }

                const toastId = "simulate-price";
                toast.loading("Fetching live market price...", { id: toastId });
                const symbol = "BTCUSDm";
                const price = await mt5.adapter.getSymbolPrice(symbol);
                toast.dismiss(toastId);

                if (!price) {
                  toast.error(`Failed to fetch live price for ${symbol}.`, { id: 'simulate' });
                  return;
                }

                const entry = price.ask;
                const sl = entry - 1000;
                const tp = entry + 2000; // Ensures an RR of 2.0 to pass Risk Engine checks

                await service.handleNewMessage({
                  messageId: Date.now().toString(),
                  channelId: "12345",
                  text: `${symbol} BUY\nENTRY: ${entry.toFixed(2)}\nSL: ${sl.toFixed(2)}\nTP: ${tp.toFixed(2)}`,
                  timestamp: new Date(),
                  edited: false
                });
              } finally {
                setSimulating(false);
              }
            }}
            disabled={simulating}
            className="px-4 py-1.5 bg-accent/10 text-accent border border-accent/20 rounded-lg text-sm font-bold hover:bg-accent hover:text-white transition-all flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
          >
            <Activity size={14} /> {simulating ? "Simulating..." : "Simulate BTC"}
          </button>
        </div>
      </div>

      <div className="card card-hover overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-secondary border-b border-border bg-elevated/50">
              <th className="font-medium py-3 px-6 text-left">Time</th>
              <th className="font-medium py-3 px-6 text-left">Source</th>
              <th className="font-medium py-3 px-6 text-left">Symbol</th>
              <th className="font-medium py-3 px-6 text-left">Dir</th>
              <th className="font-medium py-3 px-6 text-right">Entry</th>
              <th className="font-medium py-3 px-6 text-right">SL</th>
              <th className="font-medium py-3 px-6 text-right">TP</th>
              <th className="font-medium py-3 px-6 text-right">RR</th>
              <th className="font-medium py-3 px-6 text-center">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredSignals.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-24">
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-elevated rounded-full flex items-center justify-center text-secondary mb-4 shadow-sm relative">
                      <Activity size={24} />
                    </div>
                    <h4 className="text-lg font-medium mb-2">
                      {signals.length === 0 ? "Waiting for incoming signals..." : "No signals match your filters"}
                    </h4>
                    <p className="text-sm text-secondary max-w-sm">
                      {signals.length === 0
                        ? "Connect your Telegram channels in Settings to start parsing signals in real-time."
                        : "Try a different status filter or clear the search box."}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredSignals.map((signal) => (
                <React.Fragment key={signal.id}>
                  <tr 
                    onClick={() => setExpandedRow(expandedRow === signal.id ? null : signal.id)}
                    className={`group transition-colors cursor-pointer ${expandedRow === signal.id ? 'bg-elevated/50' : 'hover:bg-elevated/30'}`}
                  >
                    <td className="py-4 px-6 text-secondary">{signal.time}</td>
                    <td className="py-4 px-6 font-medium group-hover:text-accent transition-colors">{signal.source}</td>
                    <td className="py-4 px-6 font-medium">{signal.symbol}</td>
                    <td className="py-4 px-6">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold ${signal.direction === 'BUY' ? 'bg-success-bg text-success' : 'bg-destructive-bg text-destructive'}`}>
                        {signal.direction}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right tabular-nums">{signal.entry}</td>
                    <td className="py-4 px-6 text-right tabular-nums text-destructive">{signal.sl}</td>
                    <td className="py-4 px-6 text-right tabular-nums text-success">{signal.tp}</td>
                    <td className="py-4 px-6 text-right tabular-nums font-medium">{signal.rr}R</td>
                    <td className="py-4 px-6 text-center">
                      {signal.outcome === 'MISSED' ? (
                        <span className="px-2 py-1 rounded text-xs font-medium border bg-warning/10 border-warning/20 text-warning">
                          MISSED
                        </span>
                      ) : (
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${signal.decision === 'APPROVED' ? 'bg-success-bg border-success/20 text-success' : 'bg-destructive-bg border-destructive/20 text-destructive'}`}>
                          {signal.decision}
                        </span>
                      )}
                    </td>
                  </tr>
                  
                  {/* Expandable Drawer Content */}
                  <AnimatePresence>
                    {expandedRow === signal.id && (
                      <tr>
                        <td colSpan={9} className="p-0">
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden border-b border-border bg-surface/50"
                          >
                            <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
                              {/* Raw Message Column */}
                              <div className="bg-elevated/50 p-6 rounded-xl border border-border">
                                <h4 className="text-[11px] font-bold text-secondary uppercase tracking-widest mb-4 flex items-center gap-2">
                                  <MessageSquare size={14} /> Raw Intercept
                                </h4>
                                <pre className="text-[12px] font-mono text-primary leading-relaxed whitespace-pre-wrap bg-surface p-4 rounded-lg border border-border/50 shadow-inner max-h-[300px] overflow-y-auto">
                                  {signal.raw}
                                </pre>
                              </div>

                              {/* Validation Checklist Column */}
                              <div className="bg-elevated/50 p-6 rounded-xl border border-border">
                                <h4 className="text-[11px] font-bold text-secondary uppercase tracking-widest mb-4 flex items-center gap-2">
                                  <CheckCircle2 size={14} /> Parsing & Validation
                                </h4>
                                <div className="space-y-3 text-[13px] bg-surface p-4 rounded-lg border border-border/50">
                                  {signal.validation.map((v: any, i: number) => (
                                    <div key={i} className="flex items-center gap-3 p-1.5 rounded-md hover:bg-elevated/50 transition-colors">
                                      {v.status ? (
                                        <CheckCircle2 size={16} className="text-success shrink-0" />
                                      ) : (
                                        <XCircle size={16} className="text-destructive shrink-0" />
                                      )}
                                      <span className={v.status ? 'text-primary' : 'text-destructive font-bold'}>{v.text}</span>
                                    </div>
                                  ))}
                                </div>
                                
                                {signal.reason && (
                                  <div className="mt-4 p-4 rounded-lg border border-destructive/30 bg-destructive/10">
                                    <span className="text-[11px] font-bold text-destructive uppercase tracking-widest flex items-center gap-1.5 mb-1.5">
                                      <AlertTriangle size={14} /> Execution Rejected
                                    </span>
                                    <span className="text-[13px] text-destructive/90 leading-relaxed font-medium block">{signal.reason}</span>
                                  </div>
                                )}
                              </div>

                              {/* Theoretical Trade Receipt */}
                              <div className="bg-elevated p-6 rounded-xl border border-border relative overflow-hidden shadow-lg">
                                {/* Decorative receipt edge */}
                                <div className="absolute top-0 left-0 w-full h-2 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIxMCI+PHBvbHlnb24gcG9pbnRzPSIwLDAgMTAsMTAgMjAsMCIgZmlsbD0iIzFBMUEyNCIvPjwvc3ZnPg==')] bg-repeat-x opacity-30"></div>
                                
                                <h4 className="text-[11px] font-bold text-secondary uppercase tracking-widest mb-6 mt-2 flex items-center gap-2">
                                  <Activity size={14} /> Trade Simulation Receipt
                                </h4>
                                
                                <div className="space-y-4">
                                  <div className="flex justify-between items-end border-b border-border/50 pb-3">
                                    <span className="text-sm text-secondary">Theoretical Risk ({riskPerTrade}%)</span>
                                    {mt5Connected ? (
                                      <span className="text-lg font-mono font-bold text-destructive">
                                        {formatMoney(mt5Balance * (riskPerTrade / 100), mt5Currency)}
                                      </span>
                                    ) : (
                                      <span className="text-sm font-mono text-secondary/50 flex items-center gap-1"><AlertTriangle size={12}/> MT5 Disconnected</span>
                                    )}
                                  </div>

                                  <div className="flex justify-between items-end border-b border-border/50 pb-3">
                                    <span className="text-sm text-secondary">Potential Reward</span>
                                    {mt5Connected && signal.rr > 0 ? (
                                      <span className="text-lg font-mono font-bold text-success">
                                        {formatMoney(mt5Balance * (riskPerTrade / 100) * signal.rr, mt5Currency)}
                                      </span>
                                    ) : (
                                      <span className="text-sm font-mono text-secondary/50">N/A</span>
                                    )}
                                  </div>

                                  <div className="flex justify-between items-end border-b border-border/50 pb-3">
                                    <span className="text-sm text-secondary">Action</span>
                                    <span className={`text-lg font-bold uppercase ${signal.direction === 'BUY' ? 'text-success' : 'text-destructive'}`}>
                                      {signal.direction} {signal.symbol}
                                    </span>
                                  </div>
                                </div>
                                
                                <div className="mt-8 pt-4 flex gap-4">
                                  {signal.decision === 'APPROVED' ? (
                                    <button
                                      onClick={() => handleManualExecute(signal, false)}
                                      disabled={executingIds.includes(signal.id)}
                                      className="flex-1 bg-success text-success-foreground font-bold py-2.5 rounded-lg text-sm hover:bg-success/90 transition-colors shadow-lg shadow-success/20 disabled:opacity-50"
                                    >
                                      {executingIds.includes(signal.id) ? "Executing..." : "Execute Trade"}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleManualExecute(signal, true)}
                                      disabled={executingIds.includes(signal.id)}
                                      className="flex-1 border border-destructive text-destructive font-bold py-2.5 rounded-lg text-sm hover:bg-destructive hover:text-destructive-foreground transition-all disabled:opacity-50"
                                      title="Bypass the risk engine and send this signal to your broker anyway"
                                    >
                                      {executingIds.includes(signal.id) ? "Executing..." : "Force Override"}
                                    </button>
                                  )}
                                </div>
                              </div>

                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
