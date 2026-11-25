import React, { useState } from "react"
import { Search, CheckCircle2, XCircle, MessageSquare, Bot, AlertTriangle, Zap, Copy } from "lucide-react"
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
import { MIN_POSITION_SIZE_LOTS } from "../core/constants"
import { buildAccountState } from "../core/telegram/service"
import { getDb } from "../db"

const STATUS_FILTERS = ["All", "Approved", "Rejected", "Missed"] as const
type StatusFilter = typeof STATUS_FILTERS[number]

export function SignalsPage() {
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")
  const [searchQuery, setSearchQuery] = useState("")
  const [executingIds, setExecutingIds] = useState<string[]>([])
  const [simulating, setSimulating] = useState(false)
  const { signals, updateSignal } = useSignalStore();
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

    let positionSize: number;
    if (!override) {
      // Re-run the risk engine against the LIVE account state so manual
      // executions respect open-risk, drawdown and daily-loss limits too
      const settings = useSettingsStore.getState();
      const account = await buildAccountState(await getDb(), {
        channelId: null,
        riskPercent: settings.riskConfig.riskPerTradePercent,
      });
      // Real broker metadata is required for sizing; the engine rejects without it
      const info = await mt5.adapter.getSymbolInfo(parsed.symbol);
      const evaluation = new RiskEngine().evaluate(parsed, account, settings.riskConfig, info ?? undefined);

      if (evaluation.decision !== 'APPROVED' || evaluation.positionSize === null) {
        const reason = evaluation.ruleResults.find((r) => !r.passed)?.message || 'Unknown reason';
        toast.error("Risk Check Failed", { description: reason });
        return;
      }
      positionSize = evaluation.positionSize;
    } else {
      // Override skips the risk checks but still trades the smallest size
      // the broker accepts - stated explicitly, never implied by a 0.
      const info = await mt5.adapter.getSymbolInfo(parsed.symbol);
      positionSize = info?.volume_min && info.volume_min > 0 ? info.volume_min : MIN_POSITION_SIZE_LOTS;
    }

    setExecutingIds((prev) => [...prev, signal.id]);
    try {
      const engine = new ExecutionEngine(mt5.adapter);
      const executed = await engine.executeApprovedSignal({
        signalId: signal.id,
        signal: parsed,
        positionSize,
      });

      if (executed) {
        updateSignal(signal.id, { outcome: 'EXECUTED' });
        toast.success(`Trade Executed: ${parsed.symbol}`, {
          description: `Size: ${positionSize} lots`,
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
            <Bot size={14} /> {simulating ? "Simulating..." : "Simulate BTC"}
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
                      <Bot size={24} />
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
                            <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-border bg-elevated/20">
                              {/* Raw Message Column */}
                              <div className="p-6 lg:p-8">
                                <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-4 flex items-center gap-2">
                                  <MessageSquare size={14} className="text-accent" /> Raw Intercept
                                </h4>
                                <div className="relative group/code">
                                  <pre className="text-[13px] font-mono text-primary/80 leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto mt-2">
                                    {signal.raw}
                                  </pre>
                                  <button 
                                    onClick={() => {
                                      navigator.clipboard.writeText(signal.raw);
                                      toast.success("Copied to clipboard");
                                    }}
                                    className="absolute top-2 right-2 p-1.5 bg-elevated border border-border rounded text-secondary hover:text-primary hover:bg-border transition-colors opacity-0 group-hover/code:opacity-100"
                                    title="Copy raw signal"
                                  >
                                    <Copy size={14} />
                                  </button>
                                </div>
                              </div>

                              {/* Validation Checklist Column */}
                              <div className="p-6 lg:p-8">
                                <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-4 flex items-center gap-2">
                                  <CheckCircle2 size={14} className="text-success" /> Parsing & Validation
                                </h4>
                                <div className="space-y-3 mt-2">
                                  {signal.validation.map((v: any, i: number) => (
                                    <div key={i} className="flex items-start gap-3">
                                      {v.status ? (
                                        <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />
                                      ) : (
                                        <XCircle size={16} className="text-destructive shrink-0 mt-0.5" />
                                      )}
                                      <span className={`text-sm leading-snug ${v.status ? 'text-primary/90' : 'text-destructive font-medium'}`}>{v.text}</span>
                                    </div>
                                  ))}
                                </div>
                                
                                {signal.reason && (
                                  <div className="mt-4 p-4 rounded-lg border border-destructive/20 bg-destructive/10">
                                    <span className="text-xs font-bold text-destructive uppercase tracking-wider flex items-center gap-1.5 mb-2">
                                      <AlertTriangle size={14} /> Execution Rejected
                                    </span>
                                    <span className="text-[13px] text-destructive/90 leading-relaxed block">{signal.reason}</span>
                                  </div>
                                )}
                              </div>

                              {/* Execution Summary */}
                              <div className="p-6 lg:p-8">
                                <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-6 flex items-center gap-2">
                                  <Zap size={14} className={signal.decision === 'APPROVED' ? 'text-success' : 'text-warning'} /> 
                                  Execution Summary
                                </h4>
                                
                                <div className="space-y-1 mt-2">
                                  <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                                    <span className="text-sm text-secondary">Risk ({riskPerTrade}%)</span>
                                    {mt5Connected ? (
                                      <span className="text-base font-mono font-medium text-destructive">
                                        {formatMoney(mt5Balance * (riskPerTrade / 100), mt5Currency)}
                                      </span>
                                    ) : (
                                      <span className="text-xs font-mono text-secondary/50 flex items-center gap-1"><AlertTriangle size={12}/> Disconnected</span>
                                    )}
                                  </div>

                                  <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                                    <span className="text-sm text-secondary">Potential Reward</span>
                                    {mt5Connected && signal.rr > 0 ? (
                                      <span className="text-base font-mono font-medium text-success">
                                        {formatMoney(mt5Balance * (riskPerTrade / 100) * signal.rr, mt5Currency)}
                                      </span>
                                    ) : (
                                      <span className="text-xs font-mono text-secondary/50">N/A</span>
                                    )}
                                  </div>

                                  <div className="flex justify-between items-center py-2.5">
                                    <span className="text-sm text-secondary">Action</span>
                                    <span className={`text-base font-bold uppercase tracking-wide ${signal.direction === 'BUY' ? 'text-success' : 'text-destructive'}`}>
                                      {signal.direction} {signal.symbol}
                                    </span>
                                  </div>
                                </div>

                                {mt5Connected && signal.rr > 0 && signal.decision === 'APPROVED' && (
                                  <div className="mt-4 pt-4 border-t border-border/50">
                                    <div className="flex justify-between text-xs font-medium text-secondary mb-2">
                                      <span>Risk (1.0)</span>
                                      <span>Reward ({signal.rr.toFixed(1)})</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-elevated rounded-full overflow-hidden flex">
                                      <div className="bg-destructive h-full transition-all" style={{ width: `${(1 / (1 + signal.rr)) * 100}%` }}></div>
                                      <div className="bg-success h-full transition-all" style={{ width: `${(signal.rr / (1 + signal.rr)) * 100}%` }}></div>
                                    </div>
                                  </div>
                                )}
                                
                                <div className="mt-6 flex">
                                  {signal.outcome === 'EXECUTED' ? (
                                    <button
                                      disabled
                                      className="flex-1 bg-elevated text-secondary border border-border font-bold py-3.5 rounded-lg text-sm cursor-not-allowed flex items-center justify-center gap-2 opacity-60"
                                    >
                                      <CheckCircle2 size={16} /> Already Executed
                                    </button>
                                  ) : signal.decision === 'APPROVED' ? (
                                    <button
                                      onClick={() => handleManualExecute(signal, false)}
                                      disabled={executingIds.includes(signal.id)}
                                      className="flex-1 bg-accent/10 text-accent border border-accent/20 font-bold py-3.5 rounded-lg text-sm hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
                                    >
                                      {executingIds.includes(signal.id) ? "Executing..." : "Execute Trade"}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleManualExecute(signal, true)}
                                      disabled={executingIds.includes(signal.id)}
                                      className="flex-1 bg-destructive/10 border border-destructive/30 text-destructive font-bold py-3.5 rounded-lg text-sm hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-50"
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
