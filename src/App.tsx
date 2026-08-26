import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useTelegramStore } from "./store/telegram"
import { useMT5Store } from "./store/mt5"
import { TelegramAuth } from "./components/telegram/TelegramAuth"
import { TelegramAdapter } from "./core/telegram/client"
import { TelegramService } from "./core/telegram/service"
import { DashboardLayout } from "./layouts/DashboardLayout"
import { Toaster, toast } from "sonner"
import { Search } from "lucide-react"
import { getDb } from "./db"
import { trades, signals as signalsSchema } from "./db/schema"
import { eq, and, or } from "drizzle-orm"
import { logger } from "./core/logger"
import type { OpenPosition } from "./core/execution-engine/types"
import { pipsToPoints } from "./lib/utils"

type TradeRecord = typeof trades.$inferSelect

import { WelcomeHeader } from "./components/dashboard/WelcomeHeader"
import { TotalBalanceCard } from "./components/dashboard/TotalBalanceCard"
import { YourAssetsCard } from "./components/dashboard/YourAssetsCard"
import { MarketLeadersCard } from "./components/dashboard/MarketLeadersCard"
import { EquityChartCard } from "./components/dashboard/EquityChartCard"
import { SignalsPage } from "./pages/SignalsPage"
import { RiskPage } from "./pages/RiskPage"
import { SettingsPage } from "./pages/SettingsPage"
import { useSettingsStore } from "./store/settings"

type HistoryFilter = 'ALL' | 'CLOSED_WIN' | 'CLOSED_LOSS'

function App() {
  const { connectionState, config, client, service, setClient, setService, setConnectionState, setProfile, logout } = useTelegramStore()
  const liveProfits = useMT5Store(state => state.liveProfits)
  const accountBalance = useMT5Store(state => state.balance)
  const [activePage, setActivePage] = useState("Dashboard")
  const isConnecting = useRef(false)

  // Dashboard trade data
  const [openTrades, setOpenTrades] = useState<TradeRecord[]>([])
  const [closedTrades, setClosedTrades] = useState<TradeRecord[]>([])
  const [tradeSearch, setTradeSearch] = useState("")
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('ALL')

  const loadDashboardTrades = useCallback(async () => {
    try {
      const db = await getDb();
      const closed = await db.select().from(trades).where(or(eq(trades.status, 'CLOSED_WIN'), eq(trades.status, 'CLOSED_LOSS')));
      setClosedTrades(closed);
      const open = await db.select().from(trades).where(eq(trades.status, 'OPEN'));
      setOpenTrades(open);
    } catch (e) {
      logger.error({ err: e }, "Failed to load dashboard trades");
    }
  }, []);

  useEffect(() => {
    // Syncs React with external systems (SQLite + broker events); the state
    // update lands after awaits, never synchronously during render.
    // eslint-disable-next-line react/set-state-in-effect
    loadDashboardTrades();
    window.addEventListener('mock_trade_closed', loadDashboardTrades);
    return () => window.removeEventListener('mock_trade_closed', loadDashboardTrades);
  }, [loadDashboardTrades]);

  // Monitor trades and automate management (Breakeven/Trailing)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const mt5 = useMT5Store.getState();
        if (!mt5.isConnected || !mt5.adapter || typeof mt5.adapter.getOpenPositions !== 'function') return;

        await mt5.syncBalance(); // Sync live balance and equity

        const db = await getDb();
        const openTradesInDb = await db.select().from(trades).where(eq(trades.status, 'OPEN'));

        // Expire provisional instant-entry trades whose levels never arrived:
        // CLOSE -> close at the broker (reconciliation records the P&L),
        // KEEP  -> stop tracking so late edits are refused from now on.
        // Re-filter in JS: some DB backends (mock mode) may over-return rows,
        // and processing a stale row twice means toast spam.
        const provisionalRows = await db
          .select()
          .from(signalsSchema)
          .where(and(eq(signalsSchema.isProvisional, 1), eq(signalsSchema.status, 'EXECUTED')));
        const provisional = provisionalRows.filter(
          (s) => s.isProvisional === 1 && s.status === 'EXECUTED'
        );
        for (const sig of provisional) {
          const windowMs = Math.max(5, useSettingsStore.getState().executionSettings.instantEditWindowSeconds) * 1000;
          if (Date.now() - sig.receivedAt <= windowMs) continue;
          const keep = useSettingsStore.getState().executionSettings.instantExpiryAction === 'KEEP';
          if (!keep) {
            const legs = openTradesInDb.filter((t) => t.signalId === sig.id);
            for (const leg of legs) {
              if (typeof mt5.adapter.closeTrade === 'function') {
                await mt5.adapter.closeTrade(leg.id).catch(() => undefined);
              }
            }
          }
          await db.update(signalsSchema).set({ isProvisional: 0 }).where(eq(signalsSchema.id, sig.id));
          logger.info({ signalId: sig.id, action: keep ? 'KEEP' : 'CLOSE' }, 'Provisional instant entry expired');
          toast[keep ? 'warning' : 'info'](`Instant entry ${sig.symbol} expired`, {
            id: `instant-expired-${sig.id}`,
            description: keep
              ? 'No levels arrived - your provisional stop/target stays in charge.'
              : 'No levels arrived in time - the position was closed automatically.',
          });
        }

        if (openTradesInDb.length === 0) return;

        const openPositions: OpenPosition[] = await mt5.adapter.getOpenPositions();
        const openTickets = new Set(openPositions.map((p) => String(p.ticket)));

        const newProfits: Record<string, number> = {};
        for (const p of openPositions) {
          newProfits[String(p.ticket)] = p.profit ?? 0;
        }
        mt5.setLiveProfits(newProfits);

        let changed = false;

        // Handle Trade Automation (Breakeven / Trailing)
        const settings = useSettingsStore.getState().executionSettings;
        const autoBreakeven = settings.autoBreakEvenEnabled;
        const trailingStop = settings.trailingStopEnabled;
        const beTriggerPips = settings.autoBreakEvenTriggerPips || 0;
        const tsTriggerPips = settings.trailingStopTriggerPips || 0;
        const tsDistancePips = settings.trailingStopDistancePips || 0;

        for (const t of openTradesInDb) {
          if (t.id.startsWith('paper-')) {
            // Simulated trades are managed entirely by the paper adapter's own
            // lifecycle - the MT5 position poll must not close them.
            continue;
          }
          if (!openTickets.has(t.id)) {
            // Missing from MT5 open positions -> it closed on the broker side.
            // Prefer the broker's own deal history for realized P&L; fall back
            // to the last known floating value only if history is unavailable.
            let pnl: number | null = null;
            if (typeof mt5.adapter.getDeals === 'function') {
              const deals = await mt5.adapter.getDeals(t.id);
              if (deals && deals.length > 0) {
                pnl = deals.reduce(
                  (sum, d) => sum + (d.profit ?? 0) + (d.commission ?? 0) + (d.swap ?? 0),
                  0
                );
              }
            }
            if (pnl === null && typeof mt5.liveProfits[t.id] === 'number') {
              pnl = mt5.liveProfits[t.id];
            }
            await db.update(trades)
              .set({ status: pnl !== null && pnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS', pnl, closedAt: Date.now() })
              .where(eq(trades.id, t.id));
            changed = true;
            logger.info({ tradeId: t.id, pnl }, 'Position closed on broker');
          } else if (autoBreakeven || trailingStop) {
            // Look up the live position
            const pos = openPositions.find((p) => String(p.ticket) === t.id);
            if (pos && typeof mt5.adapter.modifyTrade === 'function' && t.entryPrice) {
              const symbolInfo = await mt5.adapter.getSymbolInfo?.(pos.symbol);
              if (symbolInfo && symbolInfo.point && pos.price_current != null) {
                const point = symbolInfo.point;
                const isBuy = pos.type === 'BUY';
                const currentPrice = pos.price_current;
                const entryPrice = t.entryPrice;
                const currentSl = pos.sl ?? 0;

                // Settings are in pips; the engine works in points
                const beTrigger = pipsToPoints(beTriggerPips, point);
                const tsTrigger = pipsToPoints(tsTriggerPips, point);
                const tsDistance = pipsToPoints(tsDistancePips, point);

                // Distance in points
                const profitPoints = isBuy ? (currentPrice - entryPrice) / point : (entryPrice - currentPrice) / point;
                let newSl = currentSl;

                // 1. Trailing Stop
                if (trailingStop && tsTrigger > 0 && tsDistance > 0 && profitPoints >= tsTrigger) {
                  const candidateSl = isBuy ? currentPrice - tsDistance * point : currentPrice + tsDistance * point;
                  // Move SL only if it's better than current SL
                  if (isBuy && candidateSl > currentSl) newSl = candidateSl;
                  if (!isBuy && (currentSl === 0 || candidateSl < currentSl)) newSl = candidateSl;
                }
                // 2. Breakeven
                else if (autoBreakeven && beTrigger > 0 && profitPoints >= beTrigger) {
                  // Move SL to entry once the trigger is reached
                  if (isBuy && currentSl < entryPrice) newSl = entryPrice;
                  if (!isBuy && (currentSl === 0 || currentSl > entryPrice)) newSl = entryPrice;
                }

                // Apply modification
                if (newSl !== currentSl && Math.abs(newSl - currentSl) > point) {
                  await mt5.adapter.modifyTrade(pos.ticket, newSl, pos.tp);
                }
              }
            }
          }
        }
        if (changed) {
          loadDashboardTrades();
        }
      } catch (err) {
        logger.error({ err }, "Trade monitor error");
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [loadDashboardTrades]);

  // Map signal IDs to receive timestamps so the history has real dates
  const [signalTimes, setSignalTimes] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await getDb();
        const allSignals = await db.select().from(signalsSchema);
        if (!cancelled) {
          setSignalTimes(new Map(allSignals.map((s) => [s.id, s.receivedAt])));
        }
      } catch {
        // Timestamps stay unavailable - dates simply render blank
      }
    })();
    return () => { cancelled = true };
  }, [closedTrades]);

  const filteredHistory = closedTrades
    .filter((t) => historyFilter === 'ALL' || t.status === historyFilter)
    .filter((t) => {
      const q = tradeSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        String(t.symbol).toLowerCase().includes(q) ||
        String(t.id).toLowerCase().includes(q) ||
        String(t.direction).toLowerCase().includes(q)
      );
    });

  // Realized-P&L curve built from closed trades (cumulative, % of balance)
  const equityCurve = useMemo(() => {
    const points = closedTrades
      .filter((t) => t.pnl != null && t.signalId)
      .map((t) => ({ time: signalTimes.get(t.signalId as string) ?? null, pnl: t.pnl as number }))
      .filter((p): p is { time: number; pnl: number } => p.time != null)
      .sort((a, b) => a.time - b.time);
    const withCum = points.reduce<{ time: string; equity: number; cum: number }[]>((acc, p) => {
      const cum = (acc.length > 0 ? acc[acc.length - 1].cum : 0) + p.pnl;
      return [
        ...acc,
        {
          time: new Date(p.time).toISOString(),
          equity: accountBalance > 0 ? Number(((cum / accountBalance) * 100).toFixed(2)) : 0,
          cum,
        },
      ];
    }, []);
    return withCum.map(({ time, equity }) => ({ time, equity }));
  }, [closedTrades, signalTimes, accountBalance]);

  const formatTradeDate = (signalId: string | null) => {
    if (!signalId) return '';
    const ts = signalTimes.get(signalId);
    if (!ts) return '';
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  /**
   * Neutralizes spreadsheet formula injection: cells beginning with =, +, -,
   * or @ can execute as formulas in Excel/LibreOffice. Genuine numbers are
   * exempt (a negative P/L is data, not a formula).
   */
  const sanitizeCsvCell = (v: unknown): string => {
    const s = String(v);
    const isNumeric = s.trim() !== '' && !Number.isNaN(Number(s));
    if (!isNumeric && /^[=+\-@]/.test(s)) return `'${s}`;
    return s;
  };

  const handleExportTrades = () => {
    if (filteredHistory.length === 0) {
      toast.info("Nothing to export", { description: "No trades match the current filters." });
      return;
    }
    const header = '"Trade ID","Symbol","Direction","Volume","Entry Price","P/L","Result"';
    const rows = filteredHistory.map((t) =>
      [
        t.id,
        t.symbol,
        t.direction,
        t.volume,
        t.entryPrice ?? '',
        t.pnl ?? '',
        t.status === 'CLOSED_WIN' ? 'Win' : 'Loss',
      ]
        .map((v) => `"${sanitizeCsvCell(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trade-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredHistory.length} trade${filteredHistory.length === 1 ? '' : 's'}`);
  };

  const handleCloseTrade = async (ticket: string) => {
    const mt5 = useMT5Store.getState();
    if (!mt5.isConnected || !mt5.adapter) {
      toast.error("MT5 is not connected");
      return;
    }
    // closeTrade is an optional adapter capability - e.g. simulated paper
    // trades resolve on their own and have no broker position to close.
    if (typeof mt5.adapter.closeTrade !== 'function') {
      toast.info("Cannot close this trade", {
        description: `${mt5.adapter.name} does not support manual closing.`,
      });
      return;
    }

    toast.promise(
      mt5.adapter.closeTrade(ticket).then(async (res) => {
        if (!res.success) throw new Error(res.message);
        // Force refresh
        setTimeout(() => loadDashboardTrades(), 1000);
        return res;
      }),
      {
        loading: 'Closing position...',
        success: 'Position closed successfully',
        error: (err) => `Failed to close: ${err.message || 'Unknown error'}`
      }
    );
  };

  // Initialize service when client is ready
  useEffect(() => {
    if (client && !service) {
      const ts = new TelegramService(client);
      setService(ts);
      ts.startListening();
    }
  }, [client, service, setService]);

  // Auto-reconnect on boot
  useEffect(() => {
    // If we have a session string but no active client, we must reconnect.
    if (config?.sessionString && !client && connectionState !== 'CONNECTING' && connectionState !== 'OFFLINE' && connectionState !== 'ERROR') {
      if (isConnecting.current) return;
      isConnecting.current = true;

      const initClient = async () => {
        try {
          if (!navigator.onLine) {
            setConnectionState('OFFLINE');
            return;
          }

          setConnectionState('CONNECTING');
          const adapter = new TelegramAdapter(config);
          await adapter.connect(
            async () => "",
            async () => "",
            async () => ""
          );

          const me = await adapter.getMe() as { firstName?: string; lastName?: string; username?: string };
          setProfile({
            firstName: me.firstName,
            lastName: me.lastName,
            username: me.username
          });

          setClient(adapter);
          setConnectionState('CONNECTED');
        } catch (e: any) {
          logger.error({ err: e }, "Auto-reconnect failed");
          const errorMsg = e?.message || String(e) || '';
          if (errorMsg.includes('AUTH_KEY_UNREGISTERED') || errorMsg.includes('SESSION_REVOKED') || errorMsg.includes('401')) {
            logout();
          } else if (!navigator.onLine || errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('ECONNREFUSED')) {
            setConnectionState('OFFLINE');
          } else {
            setConnectionState('ERROR');
          }
        } finally {
          isConnecting.current = false;
        }
      }
      initClient();
    }
  }, [config, client, connectionState, setClient, setConnectionState, setProfile, logout]);

  // MT5 Auto-Connect on boot + continuous bridge health monitoring
  useEffect(() => {
    const mt5 = useMT5Store.getState();
    mt5.init();
    mt5.startHealthMonitor();
    return () => mt5.stopHealthMonitor();
  }, [])

  useEffect(() => {
    const handleOnline = () => {
      if (connectionState === 'OFFLINE' || connectionState === 'ERROR') {
        setConnectionState('DISCONNECTED');
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [connectionState, setConnectionState]);

  // Refresh listener
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Refresh App (F5 or Cmd+R or Ctrl+R)
      if (e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault()
        window.location.reload()
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  // Authentication Check
  if (connectionState === 'CONNECTING' && config?.sessionString) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-primary">
        <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-medium text-lg text-secondary">Connecting to Telegram...</p>
      </div>
    );
  }

  if (connectionState === 'OFFLINE') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-primary">
        <div className="bg-elevated p-8 rounded-2xl max-w-md w-full border border-border text-center">
          <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
              <path d="M2 2l20 20M8.5 8.5a5 5 0 017 0M5 5a10 10 0 0114 0M12 12a1 1 0 010 0M12 20v.01" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2">You are offline</h2>
          <p className="text-secondary mb-6">Please check your internet connection to continue using YetTrade.</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors">
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (connectionState !== 'CONNECTED') {
    return <TelegramAuth />
  }

  const renderPage = () => {
    switch (activePage) {
      case "Dashboard":
        return (
          <div className="p-8 max-w-7xl mx-auto overflow-x-hidden">
            <WelcomeHeader />
            <div className="grid grid-cols-12 gap-6 mb-6">
              <TotalBalanceCard />
              <YourAssetsCard />
              <MarketLeadersCard />
            </div>
            <div className="grid grid-cols-12 gap-6 mb-6">
              <EquityChartCard data={equityCurve} />
            </div>
            <div className="grid grid-cols-12 gap-6">
              {/* Active Trades */}
              <div className="col-span-12 lg:col-span-3 card card-hover p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-medium">Active Trades</h3>
                  {openTrades.length > 0 && (
                    <span className="text-[10px] font-bold bg-accent/15 text-accent px-2 py-0.5 rounded-full">
                      {openTrades.length}
                    </span>
                  )}
                </div>

                {openTrades.length === 0 ? (
                  <>
                    <div className="flex flex-col items-center justify-center py-8 text-center bg-surface/50 rounded-xl border border-dashed border-border">
                      <div className="w-10 h-10 bg-elevated rounded-full flex items-center justify-center text-secondary mb-3 shadow-sm">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                      </div>
                      <h4 className="text-sm font-medium mb-1">No active trades</h4>
                      <p className="text-[10px] text-secondary max-w-[150px]">Open a position to track it here.</p>
                    </div>
                    <button onClick={() => setActivePage("Signals")} className="w-full mt-6 py-2 text-sm font-medium text-accent hover:text-accent/80 transition-colors">View All Trades</button>
                  </>
                ) : (
                  <>
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      <AnimatePresence mode="popLayout">
                        {openTrades.map((t) => {
                          const profit = liveProfits[t.id];
                          return (
                            <motion.div
                              layout
                              initial={{ opacity: 0, x: -20, scale: 0.95 }}
                              animate={{ opacity: 1, x: 0, scale: 1 }}
                              exit={{ opacity: 0, x: 20, scale: 0.95 }}
                              transition={{ duration: 0.2 }}
                              key={t.id}
                              className="group relative flex items-center justify-between p-2.5 rounded-lg border border-border bg-surface/50 overflow-hidden"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{t.symbol}</div>
                                <div className="text-[10px] text-secondary font-mono">{t.id}</div>
                              </div>
                              <div className="text-right shrink-0 ml-2 group-hover:opacity-0 transition-opacity duration-200">
                                {profit !== undefined ? (
                                  <motion.div
                                    key={profit}
                                    initial={{ scale: 1.15, y: -2 }}
                                    animate={{ scale: 1, y: 0 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 10 }}
                                    className={`text-sm font-bold ${profit >= 0 ? 'text-success' : 'text-destructive'}`}
                                  >
                                    {profit >= 0 ? '+' : ''}{profit.toFixed(2)}
                                  </motion.div>
                                ) : (
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${t.direction === 'BUY' ? 'bg-success-bg text-success' : 'bg-destructive-bg text-destructive'}`}>
                                    {t.direction}
                                  </span>
                                )}
                                <div className="text-[10px] text-secondary mt-0.5 tabular-nums">{t.volume} lots</div>
                              </div>

                              <div className="absolute inset-y-0 right-0 flex items-center pr-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                <button
                                  onClick={() => handleCloseTrade(t.id)}
                                  className="bg-destructive text-destructive-foreground px-3 py-1.5 rounded-md text-xs font-bold shadow-sm hover:bg-destructive/90 transition-colors"
                                >
                                  Close
                                </button>
                              </div>
                            </motion.div>
                          )
                        })}
                      </AnimatePresence>
                    </div>
                    <button onClick={() => setActivePage("Signals")} className="w-full mt-6 py-2 text-sm font-medium text-accent hover:text-accent/80 transition-colors">View All Trades</button>
                  </>
                )}
              </div>

              {/* Trade History */}
              <div className="col-span-12 lg:col-span-9 card card-hover p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-medium text-lg">Trade History</h3>
                  <div className="flex gap-4">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                      <input type="text" placeholder="Search trades..." value={tradeSearch} onChange={(e) => setTradeSearch(e.target.value)} className="pl-9 pr-4 py-1.5 bg-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-accent transition-colors w-48" />
                    </div>
                    <select
                      value={historyFilter}
                      onChange={(e) => setHistoryFilter(e.target.value as HistoryFilter)}
                      className="bg-elevated border border-border rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                    >
                      <option value="ALL">All results</option>
                      <option value="CLOSED_WIN">Wins only</option>
                      <option value="CLOSED_LOSS">Losses only</option>
                    </select>
                    <button onClick={handleExportTrades} className="flex items-center gap-2 text-sm font-medium px-4 py-1.5 border border-border rounded-lg hover:bg-elevated transition-colors">
                      Export
                    </button>
                  </div>
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-secondary border-b border-border">
                      <th className="font-medium pb-4 text-left font-sans">Trade ID</th>
                      <th className="font-medium pb-4 text-left font-sans">Symbol</th>
                      <th className="font-medium pb-4 text-left font-sans">Type</th>
                      <th className="font-medium pb-4 text-left font-sans">Opened</th>
                      <th className="font-medium pb-4 text-right font-sans">Volume</th>
                      <th className="font-medium pb-4 text-right font-sans">P/L</th>
                      <th className="font-medium pb-4 text-center font-sans">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <AnimatePresence mode="popLayout">
                      {filteredHistory.length === 0 ? (
                        <motion.tr
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          key="empty-history"
                        >
                          <td colSpan={7} className="py-12">
                            <div className="flex flex-col items-center justify-center text-center">
                              <div className="w-12 h-12 bg-elevated rounded-full flex items-center justify-center text-secondary mb-3 shadow-sm">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                              </div>
                              <h4 className="text-sm font-medium mb-1">
                                {closedTrades.length === 0 ? "No trade history" : "No trades match your filters"}
                              </h4>
                              <p className="text-xs text-secondary">
                                {closedTrades.length === 0
                                  ? "Your past trades will appear here once they are closed."
                                  : "Adjust the search or result filter to see more trades."}
                              </p>
                            </div>
                          </td>
                        </motion.tr>
                      ) : (
                        filteredHistory.map((t) => (
                          <motion.tr
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            key={t.id}
                            className="group hover:bg-elevated/40 transition-colors"
                          >
                            <td className="py-3 font-mono text-xs text-secondary max-w-[140px] truncate">{t.id}</td>
                            <td className="py-3 font-medium">{t.symbol}</td>
                            <td className="py-3">
                              <span className={`px-2 py-1 rounded text-[10px] font-bold ${t.direction === 'BUY' ? 'bg-success-bg text-success' : 'bg-destructive-bg text-destructive'}`}>
                                {t.direction}
                              </span>
                            </td>
                            <td className="py-3 text-secondary">{formatTradeDate(t.signalId)}</td>
                            <td className="py-3 text-right tabular-nums">{t.volume} lots</td>
                            <td className={`py-3 text-right tabular-nums font-medium ${t.pnl == null ? 'text-secondary' : t.pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                              {t.pnl == null ? '—' : `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}`}
                            </td>
                            <td className="py-3 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-medium border ${t.status === 'CLOSED_WIN' ? 'bg-success-bg border-success/20 text-success' : 'bg-destructive-bg border-destructive/20 text-destructive'}`}>
                                {t.status === 'CLOSED_WIN' ? 'Win' : 'Loss'}
                              </span>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>

            </div>
          </div>
        )
      case "Signals":
        return <SignalsPage />
      case "Risk":
        return <RiskPage />
      case "Settings":
        return <SettingsPage />
      default:
        return <div>Page not found</div>
    }
  }

  return (
    <>
      <DashboardLayout activePage={activePage} onPageChange={setActivePage}>
        {renderPage()}
      </DashboardLayout>
      <Toaster position="bottom-right" theme="dark" richColors visibleToasts={4} />
    </>
  )
}

export default App
