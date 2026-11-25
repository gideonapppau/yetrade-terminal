import { useState, useEffect, useRef } from "react"
import { useTelegramStore } from "../store/telegram"
import { useMT5Store } from "../store/mt5"
import { useSettingsStore } from "../store/settings"
import { useSignalStore } from "../store/signals"
import { Bell, Sun, Moon } from "../components/ui/icons"

interface DashboardLayoutProps {
  children: React.ReactNode
  activePage: string
  onPageChange: (page: string) => void
}

function formatTimeAgo(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function DashboardLayout({ children, activePage, onPageChange }: DashboardLayoutProps) {
  const { connectionState, profile, logout, client } = useTelegramStore();
  const mt5Connected = useMT5Store((s) => s.isConnected);
  const tradingPaused = useSettingsStore((s) => s.tradingPaused);
  const allSignals = useSignalStore((s) => s.signals);
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('yettrade_theme')
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isNotifOpen, setIsNotifOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isProfileOpen && !isNotifOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setIsProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setIsNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isProfileOpen, isNotifOpen]);

  const newSignalCount = allSignals.filter((s) => s.decision === 'APPROVED' && !s.outcome).length;
  const recentSignals = [...allSignals]
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .slice(0, 6);

  const statusLabel = (s: typeof allSignals[number]) => s.outcome ?? s.decision;
  const statusColor = (label: string) =>
    label === 'EXECUTED' ? 'text-success'
    : label === 'MISSED' ? 'text-destructive'
    : label === 'APPROVED' ? 'text-warning'
    : 'text-secondary';

  const handleLogout = async () => {
    if (client) {
      await client.disconnect();
    }
    logout();
  };

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('yettrade_theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('yettrade_theme', 'light')
    }
  }, [isDark])

  return (
    <div className="flex flex-col min-h-screen bg-background text-primary">
      {/* Top Navigation Bar */}
      <header className="h-[80px] bg-surface flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-12">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="text-accent flex gap-0.5">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 12.5l3-4h3.5l-3 4H4.5zm5.5 0l3-4h3.5l-3 4H10zm5.5 0l3-4h3.5l-3 4h-3.5z" /></svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-primary">YetTrade</h1>
          </div>

          {/* Navigation Pills */}
          <nav className="flex items-center gap-2">
            {['Dashboard', 'Signals', 'Risk', 'Settings'].map((page) => (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={`px-5 py-2.5 rounded-full font-medium text-sm transition-colors ${activePage === page
                    ? 'bg-primary text-primary-foreground'
                    : 'text-secondary hover:text-primary'
                  }`}
              >
                {page}
              </button>
            ))}
          </nav>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-6">
          {tradingPaused && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-destructive/15 border border-destructive/30 text-destructive text-[10px] font-bold tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive"></span>
              TRADING PAUSED
            </span>
          )}
          <div className="flex items-center gap-4 text-secondary">
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setIsNotifOpen(!isNotifOpen)}
                title="Notifications"
                className="p-2 hover:bg-elevated rounded-full transition-colors relative"
              >
                <Bell size={18} />
                {newSignalCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-surface">
                    {newSignalCount > 9 ? '9+' : newSignalCount}
                  </span>
                )}
              </button>
              {isNotifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-surface border border-border rounded-lg shadow-lg overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-border flex justify-between items-center">
                    <h4 className="text-sm font-bold">Notifications</h4>
                    {recentSignals.length > 0 && (
                      <button
                        onClick={() => { onPageChange('Signals'); setIsNotifOpen(false); }}
                        className="text-xs text-accent hover:text-accent/80 font-medium"
                      >
                        View all signals
                      </button>
                    )}
                  </div>
                  {recentSignals.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-secondary">
                      No signals yet. New signals from your channels will appear here.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y divide-border">
                      {recentSignals.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => { onPageChange('Signals'); setIsNotifOpen(false); }}
                          className="w-full text-left px-4 py-3 hover:bg-elevated transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-sm font-medium truncate">{s.symbol}</span>
                            <span className={`text-[10px] font-bold shrink-0 ${statusColor(statusLabel(s))}`}>
                              {statusLabel(s)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-secondary">
                            <span>{s.direction}</span>
                            <span>·</span>
                            <span>{s.source}</span>
                            <span>·</span>
                            <span>{formatTimeAgo(Date.parse(s.time))}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => setIsDark(!isDark)} title={isDark ? "Switch to light theme" : "Switch to dark theme"} className="p-2 hover:bg-elevated rounded-full transition-colors">
              {isDark ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>

          <div className="relative" ref={profileRef}>
            <div onClick={() => setIsProfileOpen(!isProfileOpen)} className="flex items-center gap-2 pl-2 cursor-pointer border-l border-border hover:bg-elevated p-1 rounded-full pr-3 transition-colors">
              {profile?.photoUrl ? (
                <img src={profile.photoUrl} alt="Profile" className="w-8 h-8 rounded-full border border-border object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full border border-border bg-accent/10 flex items-center justify-center text-accent font-bold text-xs">
                  {profile?.firstName?.[0] || 'T'}
                </div>
              )}
              <div className="flex items-center gap-1 font-medium text-sm">
                {profile?.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : 'Trader'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${isProfileOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
              </div>
            </div>
            
            {isProfileOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-surface border border-border rounded-lg shadow-lg overflow-hidden z-50">
                <button 
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-3 text-sm text-destructive hover:bg-elevated transition-colors font-medium flex items-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>

      {/* Global Status Bar */}
      <footer className="h-8 bg-elevated border-t border-border flex items-center justify-between px-6 text-[10px] font-medium tracking-widest uppercase shrink-0">
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <span className="text-secondary font-bold">MT5 Bridge</span>
            {mt5Connected ? (
              <span className="flex items-center gap-1.5 text-success font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                Connected
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-destructive font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-destructive"></span>
                Disconnected
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-secondary font-bold">Telegram API</span>
            {connectionState === 'CONNECTED' ? (
              <span className="flex items-center gap-1.5 text-success font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                Connected
              </span>
            ) : connectionState === 'CONNECTING' ? (
              <span className="flex items-center gap-1.5 text-warning font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-warning"></span>
                Connecting
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-destructive font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-destructive"></span>
                Offline
              </span>
            )}
          </div>
        </div>
        
        <div className="text-secondary/50 font-bold">
          YetTrade v1.0.0-beta
        </div>
      </footer>
    </div>
  )
}
