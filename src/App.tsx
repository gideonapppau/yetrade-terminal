import { useState, useEffect, useRef, useCallback } from "react"
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
import { eq, or } from "drizzle-orm"

import { WelcomeHeader } from "./components/dashboard/WelcomeHeader"
import { TotalBalanceCard } from "./components/dashboard/TotalBalanceCard"
import { YourAssetsCard } from "./components/dashboard/YourAssetsCard"
import { MarketLeadersCard } from "./components/dashboard/MarketLeadersCard"
import { EquityChartCard } from "./components/dashboard/EquityChartCard"
import { SignalsPage } from "./pages/SignalsPage"
import { RiskPage } from "./pages/RiskPage"
import { SettingsPage } from "./pages/SettingsPage"

type HistoryFilter = 'ALL' | 'CLOSED_WIN' | 'CLOSED_LOSS'

function App() {
  const { connectionState, config, client, service, setClient, setService, setConnectionState, setProfile, logout } = useTelegramStore()
  const [activePage, setActivePage] = useState("Dashboard")
  const isConnecting = useRef(false)

  // Dashboard trade data
  const [openTrades, setOpenTrades] = useState<any[]>([])
  const [closedTrades, setClosedTrades] = useState<any[]>([])
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
      console.error("Failed to load dashboard trades", e);
    }
  }, []);

  useEffect(() => {
    loadDashboardTrades();
    window.addEventListener('mock_trade_closed', loadDashboardTrades);
    return () => window.removeEventListener('mock_trade_closed', loadDashboardTrades);
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
          setSignalTimes(new Map(allSignals.map((s: any) => [s.id, s.receivedAt])));
        }
      } catch {
        // Timestamps stay unavailable - dates simply render blank
      }
    })();
    return () => { cancelled = true };
  }, [closedTrades]);

  const filteredHistory = closedTrades
    .filter((t: any) => historyFilter === 'ALL' || t.status === historyFilter)
    .filter((t: any) => {
      const q = tradeSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        String(t.symbol).toLowerCase().includes(q) ||
        String(t.id).toLowerCase().includes(q) ||
        String(t.direction).toLowerCase().includes(q)
      );
    });

  const formatTradeDate = (signalId: string) => {
    const ts = signalTimes.get(signalId);
    if (!ts) return '';
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const handleExportTrades = () => {
    if (filteredHistory.length === 0) {
      toast.info("Nothing to export", { description: "No trades match the current filters." });
      return;
    }
    const header = '"Trade ID","Symbol","Direction","Volume","Entry Price","Result"';
    const rows = filteredHistory.map((t: any) =>
      [
        t.id,
        t.symbol,
        t.direction,
        t.volume,
        t.entryPrice ?? '',
        t.status === 'CLOSED_WIN' ? 'Win' : 'Loss',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
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

          const me = await adapter.getMe() as any;
          setProfile({
            firstName: me.firstName,
            lastName: me.lastName,
            username: me.username
          });

          setClient(adapter);
          setConnectionState('CONNECTED');
        } catch (e: any) {
          console.error("Auto-reconnect failed", e);
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

  // MT5 Auto-Connect on boot
  useEffect(() => {
    useMT5Store.getState().init();
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
        <p className="font-medium text-lg text-secondary animate-pulse">Connecting to Telegram...</p>
      </div>
    );
  }

  if (connectionState === 'OFFLINE') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-primary">
        <div className="bg-elevated p-8 rounded-2xl max-w-md w-full border border-border text-center">
          <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
              <path d="M2 2l20 20M8.5 8.5a5 5 0 017 0M5 5a10 10 0 0114 0M12 12a1 1 0 010 0M12 20v.01"/>
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
              <EquityChartCard />
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
                      {openTrades.map((t: any) => (
                        <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-surface/50">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{t.symbol}</div>
                            <div className="text-[10px] text-secondary font-mono">{t.id}</div>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${t.direction === 'BUY' ? 'bg-success-bg text-success' : 'bg-destructive-bg text-destructive'}`}>
                              {t.direction}
                            </span>
                            <div className="text-[10px] text-secondary mt-0.5 tabular-nums">{t.volume} lots</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setActivePage("Analytics")} className="w-full mt-6 py-2 text-sm font-medium text-accent hover:text-accent/80 transition-colors">View All Trades</button>
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
                      <th className="font-medium pb-4 text-center font-sans">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredHistory.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12">
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
                      </tr>
                    ) : (
                      filteredHistory.map((t: any) => (
                        <tr key={t.id} className="group hover:bg-elevated/40 transition-colors">
                          <td className="py-3 font-mono text-xs text-secondary max-w-[140px] truncate">{t.id}</td>
                          <td className="py-3 font-medium">{t.symbol}</td>
                          <td className="py-3">
                            <span className={`px-2 py-1 rounded text-[10px] font-bold ${t.direction === 'BUY' ? 'bg-success-bg text-success' : 'bg-destructive-bg text-destructive'}`}>
                              {t.direction}
                            </span>
                          </td>
                          <td className="py-3 text-secondary">{formatTradeDate(t.signalId)}</td>
                          <td className="py-3 text-right tabular-nums">{t.volume} lots</td>
                          <td className="py-3 text-center">
                            <span className={`px-2 py-1 rounded text-xs font-medium border ${t.status === 'CLOSED_WIN' ? 'bg-success-bg border-success/20 text-success' : 'bg-destructive-bg border-destructive/20 text-destructive'}`}>
                              {t.status === 'CLOSED_WIN' ? 'Win' : 'Loss'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
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
      <Toaster position="bottom-right" theme="dark" richColors />
    </>
  )
}

export default App
