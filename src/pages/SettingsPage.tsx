import { useState, useEffect } from "react"
import { Settings, Save, Smartphone, MonitorDot, Link2, CheckCircle2, Search, Trash2, RefreshCw, Radio, PencilLine, Zap, Info, Play, Pause } from "../components/ui/icons"
import { getDb } from "../db"
import { telegramChannels } from "../db/schema"
import { eq } from "drizzle-orm"
import { useTelegramStore } from "../store/telegram"
import { useMT5Store } from "../store/mt5"
import { useSettingsStore, type SavedMt5Account } from "../store/settings"
import { getSecret, setSecret, mt5PasswordKey } from "../core/secrets"
import { logger } from "../core/logger"
import { DEFAULT_MAX_SIGNAL_AGE_SECONDS } from "../core/constants"
import type { TelegramChannelInfo } from "../core/telegram/types"

const ChannelAvatar = ({ channelId = "", title = "?", size = 'sm', isActive = true }: { channelId?: string, title?: string, size?: 'sm' | 'lg', isActive?: boolean }) => {
  const { client } = useTelegramStore();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !channelId) return;
    let mounted = true;
    client.getChannelPhoto(channelId).then((url) => {
      if (mounted && url) {
        setPhotoUrl(url);
      }
    });
    return () => { mounted = false; };
  }, [client, channelId]);

  const hue = (channelId.length * 37) % 360;
  const sizeClasses = size === 'sm' ? "w-10 h-10 text-sm" : "w-12 h-12 text-lg";
  
  if (photoUrl) {
    return (
      <img 
        src={photoUrl} 
        alt={title} 
        className={`${sizeClasses} rounded-full object-cover shrink-0 shadow-inner ${isActive ? '' : 'opacity-60 grayscale'}`} 
      />
    );
  }
  
  return (
    <div 
      className={`${sizeClasses} rounded-full flex items-center justify-center shrink-0 shadow-inner text-white font-bold`}
      style={{ 
        background: isActive 
          ? `linear-gradient(135deg, hsl(${hue}, 70%, 60%), hsl(${(hue + 40) % 360}, 80%, 40%))` 
          : 'var(--color-elevated)'
      }}
    >
      {title.charAt(0).toUpperCase()}
    </div>
  );
};

const COMMON_BROKERS: Record<string, string[]> = {
  "Exness": [
    "Exness-MT5Trial", "Exness-MT5Trial2", "Exness-MT5Trial3", "Exness-MT5Trial4", "Exness-MT5Trial5", "Exness-MT5Trial6", "Exness-MT5Trial7", "Exness-MT5Trial8", "Exness-MT5Trial9", "Exness-MT5Trial10", "Exness-MT5Trial11",
    "Exness-MT5Real", "Exness-MT5Real2", "Exness-MT5Real3", "Exness-MT5Real4", "Exness-MT5Real5", "Exness-MT5Real6", "Exness-MT5Real7", "Exness-MT5Real8", "Exness-MT5Real9", "Exness-MT5Real10", "Exness-MT5Real11", "Exness-MT5Real12", "Exness-MT5Real13", "Exness-MT5Real14", "Exness-MT5Real15"
  ],
  "Deriv": [
    "Deriv-Demo", "Deriv-Server", "Deriv-Server-02", "Deriv-Server-03"
  ]
};

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState("telegram")
  const { service, client, config, setConfig, setConnectionState, clearClient, logout } = useTelegramStore()
  const connectionState = useTelegramStore((s) => s.connectionState)
  const { generalSettings, executionSettings, setGeneralSettings, setExecutionSettings } = useSettingsStore()
  const [apiId, setApiId] = useState(config?.apiId?.toString() || "")
  const [apiHash, setApiHash] = useState(config?.apiHash || "")
  const [saveMessage, setSaveMessage] = useState("")
  const [channels, setChannels] = useState<any[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [availableChannels, setAvailableChannels] = useState<TelegramChannelInfo[]>([])
  const [isLoadingChannels, setIsLoadingChannels] = useState(false)
  const [channelSearch, setChannelSearch] = useState("")
  const [monitoredChannelQuery, setMonitoredChannelQuery] = useState("")
  const [selectedChannel, setSelectedChannel] = useState<TelegramChannelInfo | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [newChannelId, setNewChannelId] = useState("")
  const [newChannelName, setNewChannelName] = useState("")

  const mt5 = useMT5Store()
  const initialBrokerServer = executionSettings.mt5Server || COMMON_BROKERS["Exness"][0];
  let initialSelectedBroker = "Custom";
  for (const [broker, servers] of Object.entries(COMMON_BROKERS)) {
    if (servers.includes(initialBrokerServer)) {
      initialSelectedBroker = broker;
      break;
    }
  }

  const [brokerLogin, setBrokerLogin] = useState(executionSettings.mt5Login || "")
  const [brokerPassword, setBrokerPassword] = useState(executionSettings.mt5Password || "")
  const [selectedBroker, setSelectedBroker] = useState(initialSelectedBroker)
  const [brokerServer, setBrokerServer] = useState(initialBrokerServer)
  const [mt5Path, setMt5Path] = useState(executionSettings.mt5Path || "")
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState("")
  const [bridgeUrlInput, setBridgeUrlInput] = useState(executionSettings.bridgeUrl)

  const savedMt5Accounts = useSettingsStore((s) => s.savedMt5Accounts)
  const upsertSavedMt5Account = useSettingsStore((s) => s.upsertSavedMt5Account)
  const removeSavedMt5Account = useSettingsStore((s) => s.removeSavedMt5Account)
  const [rememberPassword, setRememberPassword] = useState(true)
  const [nickname, setNickname] = useState("")
  /** Login of the saved account being edited; null when adding/connecting normally. */
  const [editingLogin, setEditingLogin] = useState<string | null>(null)
  /** First click on delete arms it; a second click within a few seconds confirms. */
  const [confirmDeleteLogin, setConfirmDeleteLogin] = useState<string | null>(null)
  const isSavedLogin = (login: string) => savedMt5Accounts.some((a) => a.login === login.trim())

  /**
   * Connects one account. An empty password falls back to the one saved in
   * the OS credential store, so saved accounts never need retyping.
   */
  const connectAccount = async (
    account: { login: string; server: string; path?: string; nickname?: string },
    typedPassword: string,
    replacesLogin?: string
  ) => {
    const login = account.login.trim()
    setIsLoggingIn(true)
    setLoginError("")
    try {
      const password =
        typedPassword ||
        (await getSecret(mt5PasswordKey(login))) ||
        (replacesLogin ? await getSecret(mt5PasswordKey(replacesLogin)) : null) ||
        ""
      if (!password) {
        setLoginError("Enter the password for this account (no saved password found).")
        return false
      }
      const res = await mt5.loginBroker({ login, password, server: account.server, path: account.path || undefined })
      if (!res.success) {
        setLoginError(res.message)
        return false
      }
      setExecutionSettings({ mt5Login: login, mt5Password: password, mt5Server: account.server, mt5Path: account.path || "" })
      // Only an account that just connected successfully is ever saved.
      if (rememberPassword || !typedPassword) await setSecret(mt5PasswordKey(login), password)
      if (replacesLogin && replacesLogin !== login) {
        // Edited to a different account number: drop the old entry and its password
        await setSecret(mt5PasswordKey(replacesLogin), null)
        removeSavedMt5Account(replacesLogin)
      }
      upsertSavedMt5Account({
        login,
        server: account.server,
        path: account.path || undefined,
        label: useMT5Store.getState().company || undefined,
        nickname: account.nickname?.trim() || undefined,
      })
      setBrokerPassword("")
      setEditingLogin(null)
      return true
    } finally {
      setIsLoggingIn(false)
    }
  }

  const handleBrokerLogin = () =>
    connectAccount(
      { login: brokerLogin, server: brokerServer, path: mt5Path, nickname },
      brokerPassword,
      editingLogin ?? undefined
    )

  /** Puts a saved account's details into the form. */
  const loadAccountIntoForm = (account: SavedMt5Account) => {
    setBrokerLogin(account.login)
    setBrokerServer(account.server)
    setMt5Path(account.path || "")
    setNickname(account.nickname || "")
    setBrokerPassword("")
    setLoginError("")
    const broker = Object.entries(COMMON_BROKERS).find(([, servers]) => servers.includes(account.server))?.[0] ?? "Custom"
    setSelectedBroker(broker)
  }

  const handleSwitchAccount = async (account: SavedMt5Account) => {
    setEditingLogin(null)
    loadAccountIntoForm(account)
    await connectAccount(account, "")
  }

  const handleEditAccount = (account: SavedMt5Account) => {
    loadAccountIntoForm(account)
    setEditingLogin(account.login)
  }

  const handleCancelEdit = () => {
    setEditingLogin(null)
    setNickname("")
    setBrokerPassword("")
    setLoginError("")
  }

  const handleDeleteAccount = async (login: string) => {
    if (confirmDeleteLogin !== login) {
      setConfirmDeleteLogin(login)
      setTimeout(() => setConfirmDeleteLogin((current) => (current === login ? null : current)), 4000)
      return
    }
    setConfirmDeleteLogin(null)
    await setSecret(mt5PasswordKey(login), null)
    removeSavedMt5Account(login)
    if (editingLogin === login) handleCancelEdit()
  }

  const handleSaveConfig = async () => {
    const parsedApiId = apiId.trim() ? parseInt(apiId.trim(), 10) : NaN;
    const trimmedHash = apiHash.trim();

    if (!Number.isNaN(parsedApiId) && parsedApiId > 0 && trimmedHash) {
      const credsChanged =
        !config || config.apiId !== parsedApiId || config.apiHash !== trimmedHash;

      setConfig({
        apiId: parsedApiId,
        apiHash: trimmedHash,
        sessionString: config?.sessionString,
      });

      // If credentials changed while a client exists, drop the live client so
      // the auto-reconnect flow rebuilds it against the new credentials.
      if (credsChanged && client) {
        try {
          await client.disconnect();
        } catch {
          // Ignore disconnect failures - we are discarding this client anyway
        }
        clearClient();
        setConnectionState("DISCONNECTED");
        setSaveMessage("Credentials saved - reconnecting...");
      } else {
        setSaveMessage("Settings saved successfully!");
      }
    } else {
      setSaveMessage("Enter both API ID and API Hash to save.");
    }
    setTimeout(() => setSaveMessage(""), 3000);
  };

  const handleRevokeSession = async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore - the local session is discarded regardless
      }
    }
    logout();
    setSaveMessage("Session revoked. Please sign in again.");
    setTimeout(() => setSaveMessage(""), 3000);
  };

  const applyBridgeUrl = () => mt5.updateBridgeUrl(bridgeUrlInput);

  const loadChannels = async () => {
    try {
      const db = await getDb()
      const all = await db.select().from(telegramChannels)
      setChannels(all)
    } catch (e) {
      logger.error({ err: e }, "Failed to load channels")
    }
  }

  useEffect(() => {
    if (activeTab === "channels") {
      // eslint-disable-next-line react/set-state-in-effect
      loadChannels()
    }
  }, [activeTab])

  const fetchAvailableChannels = async () => {
    if (!client) return
    setIsLoadingChannels(true)
    setAddError(null)
    try {
      const list = await client.listChannels()
      setAvailableChannels(list)
    } catch (e) {
      logger.error({ err: e }, "Failed to fetch Telegram chats")
      setAddError("Could not load your Telegram chats. Try again or enter an ID manually.")
    } finally {
      setIsLoadingChannels(false)
    }
  }

  const openAddPanel = () => {
    if (isAdding) {
      setIsAdding(false)
      setSelectedChannel(null)
      setChannelSearch("")
      setManualMode(false)
      setNewChannelId("")
      setNewChannelName("")
      return
    }
    setIsAdding(true)
    fetchAvailableChannels()
  }

  const handleAddChannel = async () => {
    if (manualMode) {
      if (!newChannelId.trim()) return
      try {
        const db = await getDb()
        const id = String(newChannelId.trim());
        const name = String(newChannelName.trim() || id);
        
        const existing = await db.select().from(telegramChannels).where(eq(telegramChannels.id, id));
        if (existing.length > 0) {
          await db.update(telegramChannels).set({ isActive: 1, name }).where(eq(telegramChannels.id, id));
        } else {
          await db.insert(telegramChannels).values({
            id,
            channelId: id,
            name,
            isActive: 1
          });
        }
        
        resetAddPanel()
        await loadChannels()
        if (service) service.startListening()
      } catch (e: any) {
        logger.error({ err: e }, "Failed to add channel (manual)")
        setAddError("DB Error: " + (e.message || String(e)))
      }
      return
    }

    if (!selectedChannel) return
    try {
      const db = await getDb()
      const id = String(selectedChannel.id);
      const name = String(selectedChannel.title);
      
      const existing = await db.select().from(telegramChannels).where(eq(telegramChannels.id, id));
      
      if (existing.length > 0) {
        await db.update(telegramChannels).set({ isActive: 1, name }).where(eq(telegramChannels.id, id));
      } else {
        await db.insert(telegramChannels).values({
          id,
          channelId: id,
          name,
          isActive: 1
        });
      }
      
      resetAddPanel()
      await loadChannels()
      if (service) service.startListening()
    } catch (e: any) {
      logger.error({ err: e }, "Failed to add channel")
      setAddError("DB Error: " + (e.message || String(e)))
    }
  }

  const resetAddPanel = () => {
    setIsAdding(false)
    setSelectedChannel(null)
    setChannelSearch("")
    setManualMode(false)
    setNewChannelId("")
    setNewChannelName("")
  }

  const isAlreadyAdded = (id: string) => channels.some((c) => c.channelId === id)

  const filteredChannels = availableChannels.filter((c) => {
    const q = channelSearch.toLowerCase()
    return !q || c.title.toLowerCase().includes(q) || (c.username || "").toLowerCase().includes(q)
  })

  const visibleChannels = channels.filter((c: any) => {
    const q = monitoredChannelQuery.trim().toLowerCase()
    if (!q) return true
    const name = String(c.name || '?').toLowerCase()
    const id = String(c.channelId || c.channel_id || '').toLowerCase()
    return name.includes(q) || id.includes(q)
  })

  const handleToggleChannel = async (id: string, currentStatus: number) => {
    try {
      const db = await getDb()
      await db.update(telegramChannels).set({ isActive: currentStatus ? 0 : 1 }).where(eq(telegramChannels.id, id))
      await loadChannels()
      if (service) service.startListening()
    } catch (e) {
      logger.error({ err: e }, "Failed to toggle channel")
    }
  }

  /** Instant Entry: direction-only posts trade immediately with provisional levels. */
  const handleToggleInstantEntry = async (id: string, currentValue: unknown) => {
    try {
      const db = await getDb()
      await db.update(telegramChannels).set({ instantEntry: currentValue === 1 ? 0 : 1 }).where(eq(telegramChannels.id, id))
      await loadChannels()
    } catch (e) {
      logger.error({ err: e }, "Failed to toggle instant entry")
    }
  }

  const handleDeleteChannel = async (id: string) => {
    try {
      const db = await getDb()
      await db.delete(telegramChannels).where(eq(telegramChannels.id, id))
      await loadChannels()
      if (service) service.startListening()
    } catch (e) {
      logger.error({ err: e }, "Failed to delete channel")
    }
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-1">Terminal Settings</h2>
          <p className="text-secondary text-sm">Configure connections, API keys, and application preferences.</p>
        </div>
        <div className="flex items-center gap-4">
          {saveMessage && <span className="text-success text-sm font-medium">{saveMessage}</span>}
          <button onClick={handleSaveConfig} className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors">
            <Save size={16} /> Save Config
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        
        {/* Settings Sidebar */}
        <div className="col-span-12 lg:col-span-3">
          <div className="card p-2 flex flex-col gap-1">
            <button 
              onClick={() => setActiveTab("general")}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'general' ? 'bg-elevated text-primary' : 'text-secondary hover:text-primary hover:bg-elevated/50'}`}
            >
              <Settings size={16} /> General
            </button>
            <button 
              onClick={() => setActiveTab("telegram")}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'telegram' ? 'bg-elevated text-primary' : 'text-secondary hover:text-primary hover:bg-elevated/50'}`}
            >
              <Smartphone size={16} /> Telegram Connection
            </button>
            <button 
              onClick={() => setActiveTab("mt5")}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'mt5' ? 'bg-elevated text-primary' : 'text-secondary hover:text-primary hover:bg-elevated/50'}`}
            >
              <MonitorDot size={16} /> MetaTrader 5
            </button>

            <button 
              onClick={() => setActiveTab("channels")}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'channels' ? 'bg-elevated text-primary' : 'text-secondary hover:text-primary hover:bg-elevated/50'}`}
            >
              <Link2 size={16} /> Monitored Channels
            </button>
          </div>
        </div>

        {/* Settings Content */}
        <div className="col-span-12 lg:col-span-9">
          <div className="card p-8">
            
            {activeTab === "telegram" && (
              <div className="space-y-8 animate-in fade-in duration-300">
                <div>
                  <h3 className="font-medium text-lg mb-2">Telegram API Credentials</h3>
                  <p className="text-secondary text-sm mb-6">Required to listen to private channels and parse signals locally.</p>
                  
                  <div className="space-y-4 max-w-xl">
                    <div>
                      <label className="block text-sm font-medium mb-1 flex justify-between items-center">
                        API ID
                        <div className="relative group flex items-center">
                          <span className="text-accent text-xs font-normal hover:underline cursor-help">Get from Telegram</span>
                          <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-elevated border border-border rounded-lg shadow-xl text-xs text-secondary z-50 normal-case">
                            Log in to <span className="text-primary font-medium">https://my.telegram.org</span>, go to <span className="text-primary font-medium">'API development tools'</span>, and copy your App api_id.
                          </div>
                        </div>
                      </label>
                      <input type="text" value={apiId} onChange={e => setApiId(e.target.value)} placeholder="e.g. 1234567" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 flex justify-between items-center">
                        API Hash
                        <div className="relative group flex items-center">
                          <span className="text-accent text-xs font-normal hover:underline cursor-help">Get from Telegram</span>
                          <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-elevated border border-border rounded-lg shadow-xl text-xs text-secondary z-50 normal-case">
                            Log in to <span className="text-primary font-medium">https://my.telegram.org</span>, go to <span className="text-primary font-medium">'API development tools'</span>, and copy your App api_hash.
                          </div>
                        </div>
                      </label>
                      <input type="password" value={apiHash} onChange={e => setApiHash(e.target.value)} placeholder="Enter your API Hash" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                    </div>
                  </div>
                </div>

                <div className="pt-8 border-t border-border">
                  <h3 className="font-medium text-lg mb-2 flex items-center gap-2">
                    Session Status
                    {connectionState === 'CONNECTED' ? (
                      <span className="text-xs font-medium text-success bg-success-bg px-2 py-1 rounded flex items-center gap-1">
                        <CheckCircle2 size={12} /> Connected
                      </span>
                    ) : connectionState === 'CONNECTING' ? (
                      <span className="text-xs font-medium text-warning bg-warning/10 px-2 py-1 rounded flex items-center gap-1">
                        Connecting...
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-destructive bg-destructive-bg px-2 py-1 rounded flex items-center gap-1">
                        Not Connected
                      </span>
                    )}
                  </h3>
                  <p className="text-secondary text-sm mb-4">
                    {connectionState === 'CONNECTED'
                      ? "Your Telegram session is active and listening for messages."
                      : "Sign in from the launch screen to activate signal monitoring."}
                  </p>
                  <button
                    onClick={handleRevokeSession}
                    disabled={!config?.sessionString}
                    className="text-destructive text-sm font-medium px-4 py-2 border border-destructive/20 bg-destructive-bg rounded-lg hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Revoke Session
                  </button>
                </div>
              </div>
            )}

            {activeTab === "mt5" && (
              <div className="space-y-8 animate-in fade-in duration-300">
                <div>
                  <h3 className="font-medium text-lg mb-2">MetaTrader 5 Integration</h3>
                  <p className="text-secondary text-sm mb-6">Connect your Exness (or other broker) account directly through the MT5 Bridge.</p>
                  
                  <div className="space-y-5 max-w-xl">
                    {loginError && (
                      <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg border border-destructive/20 font-medium">
                        {loginError}
                      </div>
                    )}
                    
                    {mt5.isConnected && !loginError && (
                      <div className="p-3 bg-success/10 text-success text-sm rounded-lg border border-success/20 font-medium flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={16} /> MT5 Terminal Connected
                        </div>
                        {mt5.tradeMode !== null && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-black/20 px-2 py-0.5 rounded hidden sm:inline-block truncate max-w-[150px]" title={mt5.server || ''}>
                              {mt5.server}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${mt5.tradeMode === 2 ? 'bg-success text-white' : 'bg-warning text-black'}`}>
                              {mt5.tradeMode === 2 ? 'REAL' : mt5.tradeMode === 1 ? 'CONTEST' : 'DEMO'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {savedMt5Accounts.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium mb-2 text-secondary">Saved Accounts</label>
                        <div className="space-y-2">
                          {savedMt5Accounts.map((account) => {
                            const active = mt5.isConnected && executionSettings.mt5Login === account.login
                            return (
                              <div key={account.login} className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${active ? 'border-success/40 bg-success/5' : 'border-border bg-elevated/40'}`}>
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">
                                    {account.nickname || account.login}
                                    {(account.nickname ? account.login : account.label) && (
                                      <span className="text-secondary font-normal"> · {account.nickname ? account.login : account.label}</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-secondary truncate">
                                    {account.server}{account.nickname && account.label ? ` · ${account.label}` : ''}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {active ? (
                                    <span className="text-xs font-medium text-success px-3 py-1.5">Connected</span>
                                  ) : (
                                    <button
                                      onClick={() => handleSwitchAccount(account)}
                                      disabled={isLoggingIn}
                                      className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                                    >
                                      Switch
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleEditAccount(account)}
                                    disabled={isLoggingIn}
                                    title="Edit this account"
                                    className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${editingLogin === account.login ? 'text-accent bg-accent/10' : 'text-secondary hover:text-primary hover:bg-elevated'}`}
                                  >
                                    <PencilLine size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteAccount(account.login)}
                                    disabled={isLoggingIn}
                                    title={confirmDeleteLogin === account.login ? "Click again to delete" : "Delete this account and its saved password"}
                                    className={`rounded-md transition-colors disabled:opacity-50 ${confirmDeleteLogin === account.login ? 'px-2 py-1 text-xs font-medium bg-destructive text-destructive-foreground' : 'p-1.5 text-secondary hover:text-destructive hover:bg-destructive/10'}`}
                                  >
                                    {confirmDeleteLogin === account.login ? 'Delete?' : <Trash2 size={14} />}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <p className="text-xs text-secondary mt-2">Passwords are kept in Windows Credential Manager, not in the app files.</p>
                      </div>
                    )}

                    {editingLogin && (
                      <div className="p-3 bg-accent/10 border border-accent/20 rounded-lg text-sm flex items-center justify-between gap-3">
                        <span>
                          Editing <span className="font-medium">{editingLogin}</span>. Changes are saved only after the account connects.
                        </span>
                        <button onClick={handleCancelEdit} className="text-xs font-medium text-secondary hover:text-primary shrink-0">Cancel</button>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium mb-1 text-secondary">Nickname (optional)</label>
                      <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="e.g. Exness demo, Prop account" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 text-secondary flex justify-between items-center gap-2 whitespace-nowrap">
                          Account Number
                          <div className="relative group flex items-center">
                            <span className="text-accent text-xs font-normal hover:underline cursor-help">Where to find it?</span>
                            <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-elevated border border-border rounded-lg shadow-xl text-xs text-secondary z-50 normal-case">
                              Check your broker's personal dashboard (e.g. <span className="text-primary font-medium">Exness</span>, <span className="text-primary font-medium">Deriv</span>, etc.) or your registration email for your MT5 Account Number.
                            </div>
                          </div>
                        </label>
                        <input type="text" value={brokerLogin} onChange={e => setBrokerLogin(e.target.value)} placeholder="e.g. 10045239" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 text-secondary">Broker Password</label>
                        <input type="password" value={brokerPassword} onChange={e => setBrokerPassword(e.target.value)} placeholder={isSavedLogin(brokerLogin) || editingLogin ? "Saved - leave blank to keep" : "••••••••"} className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1 text-secondary">Broker</label>
                        <select 
                          value={selectedBroker} 
                          onChange={e => {
                            const broker = e.target.value;
                            setSelectedBroker(broker);
                            if (broker !== "Custom") {
                              setBrokerServer(COMMON_BROKERS[broker][0]);
                            } else {
                              setBrokerServer("");
                            }
                          }} 
                          className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors appearance-none"
                        >
                          <option value="Exness">Exness</option>
                          <option value="Deriv">Deriv</option>
                          <option value="Custom">Custom / Other</option>
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-1 text-secondary">Broker Server</label>
                        {selectedBroker === "Custom" ? (
                          <input type="text" value={brokerServer} onChange={e => setBrokerServer(e.target.value)} placeholder="e.g. MetaQuotes-Demo" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                        ) : (
                          <select 
                            value={brokerServer} 
                            onChange={e => setBrokerServer(e.target.value)} 
                            className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors appearance-none"
                          >
                            {COMMON_BROKERS[selectedBroker].map(server => (
                              <option key={server} value={server}>{server}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border mt-6">
                      <label className="block text-sm font-medium mb-1 text-secondary">MT5 Bridge URL</label>
                      <p className="text-xs text-secondary/70 mb-2">HTTP endpoint of the local Python bridge process. Applied when you leave the field.</p>
                      <input
                        type="text"
                        value={bridgeUrlInput}
                        onChange={e => setBridgeUrlInput(e.target.value)}
                        onBlur={applyBridgeUrl}
                        placeholder="http://127.0.0.1:8000"
                        className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
                      />
                    </div>

                    <div className="pt-4 border-t border-border mt-6">
                      <label className="block text-sm font-medium mb-1 text-secondary">MT5 Installation Path (Optional)</label>
                      <p className="text-xs text-secondary/70 mb-2">Only provide this if you are getting IPC timeout errors and your MT5 is installed in a custom location.</p>
                      <input type="text" value={mt5Path} onChange={e => setMt5Path(e.target.value)} placeholder="e.g. C:\Program Files\MetaTrader 5\terminal64.exe" className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer pt-2">
                      <input type="checkbox" checked={rememberPassword} onChange={(e) => setRememberPassword(e.target.checked)} className="w-4 h-4 text-accent border-border rounded focus:ring-accent" />
                      <span className="text-sm font-medium">Remember password and reconnect automatically</span>
                    </label>

                    <div className="flex items-center gap-3 pt-4">
                      <button 
                        onClick={handleBrokerLogin}
                        disabled={isLoggingIn || !brokerLogin.trim() || (!brokerPassword.trim() && !isSavedLogin(brokerLogin) && !editingLogin)}
                        className="bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {isLoggingIn ? "Connecting to MT5..." : editingLogin ? "Save & Connect" : "Connect Broker"}
                      </button>
                      <span className="text-sm text-secondary">Make sure the Python bridge is running at {bridgeUrlInput.replace(/^https?:\/\//, "") || "the configured address"}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "general" && (
              <div className="space-y-8 animate-in fade-in duration-300">
                <div>
                  <h3 className="font-medium text-lg mb-2">General Settings</h3>
                  <p className="text-secondary text-sm mb-6">Manage terminal-wide preferences and defaults.</p>
                  
                  <div className="space-y-6 max-w-xl">
                    <div>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={generalSettings.soundAlerts} onChange={(e) => setGeneralSettings({ soundAlerts: e.target.checked })} className="w-4 h-4 text-accent border-border rounded focus:ring-accent" />
                        <span className="text-sm font-medium">Sound Alerts on New Signals</span>
                      </label>
                      <label className="flex items-start gap-3 cursor-pointer mt-4">
                        <input type="checkbox" checked={generalSettings.telegramTradeReports !== false} onChange={(e) => setGeneralSettings({ telegramTradeReports: e.target.checked })} className="w-4 h-4 mt-0.5 text-accent border-border rounded focus:ring-accent" />
                        <span>
                          <span className="block text-sm font-medium">Telegram Trade Reports</span>
                          <span className="block text-xs text-secondary mt-0.5">Send a message to your Telegram "Saved Messages" when a trade opens, when a signal is not traded (with the reason), and when a trade closes.</span>
                        </span>
                      </label>
                    </div>

                    <div className="pt-4 border-t border-border">
                      <label className="block text-sm font-medium mb-1">Max Signal Age (seconds)</label>
                      <input type="number" min="10" step="10" value={executionSettings.maxSignalAgeSeconds ?? DEFAULT_MAX_SIGNAL_AGE_SECONDS} onChange={(e) => setExecutionSettings({ maxSignalAgeSeconds: Math.max(10, Math.round(Number(e.target.value) || DEFAULT_MAX_SIGNAL_AGE_SECONDS)) })} className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                      <p className="text-xs text-secondary mt-1">Signals older than this are rejected instead of executed at today's price (e.g. after a reconnect).</p>
                    </div>

                    <div className="pt-4 border-t border-border">
                      <h4 className="text-sm font-bold mb-1">Instant Entry Defaults</h4>
                      <p className="text-xs text-secondary mb-4">Used for channels with the "Instant" toggle: direction-only posts trade immediately at these levels, then adopt the real ones when the source edits them.</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">Provisional Stop (pips)</label>
                          <input type="number" min="1" step="1" value={executionSettings.instantEntryStopPips} onChange={(e) => setExecutionSettings({ instantEntryStopPips: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                          <p className="text-xs text-secondary mt-1">Blind stop distance - also drives position size. Tune per market.</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Provisional Target</label>
                          <select value={executionSettings.instantTargetRR} onChange={(e) => setExecutionSettings({ instantTargetRR: Number(e.target.value) })} className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors appearance-none">
                            <option value={2}>2 x risk</option>
                            <option value={3}>3 x risk</option>
                          </select>
                          <p className="text-xs text-secondary mt-1">Take-profit distance as a multiple of the stop.</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Edit Window (seconds)</label>
                          <input type="number" min="5" step="5" value={executionSettings.instantEditWindowSeconds} onChange={(e) => setExecutionSettings({ instantEditWindowSeconds: Math.max(5, Math.round(Number(e.target.value) || 60)) })} className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors" />
                          <p className="text-xs text-secondary mt-1">How long an edit may complete or adjust a signal.</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">If No Levels Arrive</label>
                          <select value={executionSettings.instantExpiryAction} onChange={(e) => setExecutionSettings({ instantExpiryAction: e.target.value === 'KEEP' ? 'KEEP' : 'CLOSE' })} className="w-full bg-elevated border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent transition-colors appearance-none">
                            <option value="CLOSE">Close the trade</option>
                            <option value="KEEP">Keep it open</option>
                          </select>
                          <p className="text-xs text-secondary mt-1">Applied when the window expires without an edit.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}


            {activeTab === "channels" && (
              <div className="space-y-8 animate-in fade-in duration-300">
                <div>
                  <h3 className="font-medium text-xl mb-2 tracking-tight">Monitored Channels</h3>
                  <p className="text-secondary text-sm mb-8">Select the Telegram channels or groups you want to listen to for trading signals. We will only parse messages from active channels.</p>
                  
                  <div className="flex justify-between items-center mb-6">
                    <div className="relative w-72">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                      <input type="text" placeholder="Search your active channels..." value={monitoredChannelQuery} onChange={(e) => setMonitoredChannelQuery(e.target.value)} className="pl-10 pr-4 py-2.5 bg-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-accent transition-colors w-full" />
                    </div>
                    <button onClick={openAddPanel} className="text-sm font-medium bg-primary text-primary-foreground px-5 py-2.5 rounded-lg hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">
                      {isAdding ? "Cancel Addition" : "+ Add New Channel"}
                    </button>
                  </div>

                  {isAdding && (
                    <div className="mb-8 p-5 border border-border bg-elevated/40 backdrop-blur-sm rounded-xl space-y-4 animate-in slide-in-from-top-2 max-w-2xl shadow-sm">
                      <div className="flex justify-between items-center mb-1">
                        <h4 className="text-sm font-bold">Add Telegram Channel</h4>
                        <button onClick={() => setManualMode(!manualMode)} className="text-xs font-medium text-secondary hover:text-primary transition-colors flex items-center gap-1.5">
                          <PencilLine size={12} />
                          {manualMode ? "Browse My Chats" : "Enter ID Manually"}
                        </button>
                      </div>

                      {addError && (
                        <div className="p-2.5 bg-destructive/10 text-destructive text-xs rounded-lg border border-destructive/20 font-medium">
                          {addError}
                        </div>
                      )}

                      {manualMode ? (
                        <div className="flex gap-3 items-end">
                          <div className="flex-1">
                            <label className="block text-[10px] font-bold text-secondary uppercase tracking-widest mb-1.5 flex justify-between items-center">
                              Channel ID
                              <div className="relative group flex items-center">
                                <span className="text-accent lowercase font-normal hover:underline cursor-help">How to get ID?</span>
                                <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-elevated border border-border rounded-lg shadow-xl text-xs text-secondary z-50 normal-case tracking-normal">
                                  You can forward a message from the channel to <span className="text-primary font-medium">@getmyid_bot</span> or <span className="text-primary font-medium">@userinfobot</span> on Telegram to get its numeric ID (e.g. -100123456789).
                                </div>
                              </div>
                            </label>
                            <input type="text" value={newChannelId} onChange={e => setNewChannelId(e.target.value)} placeholder="e.g. -100123456789" className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent font-medium" />
                          </div>
                          <div className="flex-1">
                            <label className="block text-[10px] font-bold text-secondary uppercase tracking-widest mb-1.5">Display Name (Optional)</label>
                            <input type="text" value={newChannelName} onChange={e => setNewChannelName(e.target.value)} placeholder="e.g. VIP Gold Signals" className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent" />
                          </div>
                          <button
                            onClick={handleAddChannel}
                            disabled={!newChannelId.trim()}
                            className="bg-primary text-primary-foreground px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 h-[34px]"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex gap-2 items-center">
                            <div className="relative flex-1">
                              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                              <input
                                type="text"
                                value={channelSearch}
                                onChange={e => setChannelSearch(e.target.value)}
                                placeholder={isLoadingChannels ? "Syncing..." : "Search..."}
                                disabled={isLoadingChannels || availableChannels.length === 0}
                                className="pl-8 pr-3 py-1.5 w-full bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
                              />
                            </div>
                            <button
                              onClick={fetchAvailableChannels}
                              disabled={isLoadingChannels || !client}
                              className="p-1.5 bg-surface border border-border rounded-lg text-secondary hover:text-primary hover:border-accent transition-colors disabled:opacity-50"
                            >
                              <RefreshCw size={14} className={isLoadingChannels ? "animate-spin" : ""} />
                            </button>
                          </div>

                          <div className="max-h-[220px] overflow-y-auto border border-border rounded-lg bg-surface">
                            {isLoadingChannels ? (
                              <div className="py-10 flex flex-col items-center justify-center text-secondary">
                                <RefreshCw size={20} className="animate-spin mb-3 text-accent" />
                                <span className="text-xs font-medium">Syncing your chats securely...</span>
                              </div>
                            ) : filteredChannels.length === 0 ? (
                              <div className="py-10 text-center">
                                <span className="text-xs text-secondary font-medium">
                                  {availableChannels.length === 0
                                    ? client
                                      ? "No channels found. Try refreshing."
                                      : "Telegram is not connected."
                                    : "No matches for your search."}
                                </span>
                              </div>
                            ) : (
                              <div className="p-1.5 space-y-0.5">
                                {filteredChannels.map((ch) => {
                                  const added = isAlreadyAdded(ch.id)
                                  const isSelected = selectedChannel?.id === ch.id
                                  
                                  return (
                                    <div
                                      key={`${ch.type}-${ch.id}`}
                                      onClick={() => !added && setSelectedChannel(ch)}
                                      className={`w-full p-2 rounded-md flex items-center gap-3 text-left transition-all ${
                                        added
                                          ? "opacity-50 cursor-not-allowed bg-transparent"
                                          : isSelected
                                            ? "bg-accent/15 border border-accent/30 shadow-sm cursor-pointer"
                                            : "hover:bg-elevated border border-transparent cursor-pointer"
                                      }`}
                                      role="button"
                                      tabIndex={0}
                                    >
                                      <ChannelAvatar channelId={ch.id} title={ch.title} size="sm" />
                                      
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold truncate mb-0.5">{ch.title}</div>
                                        <div className="text-[10px] text-secondary truncate flex items-center gap-2">
                                          <span className="bg-background/50 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">
                                            {ch.type}
                                          </span>
                                          {ch.username ? `@${ch.username}` : `ID: ${ch.id}`}
                                        </div>
                                      </div>
                                      
                                      {added ? (
                                        <span className="text-[10px] font-bold text-success flex items-center gap-1 shrink-0 bg-success/10 px-2 py-1 rounded">
                                          <CheckCircle2 size={12} /> Added
                                        </span>
                                      ) : isSelected ? (
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); handleAddChannel(); }}
                                          className="text-xs font-bold text-primary-foreground flex items-center gap-1 shrink-0 bg-accent px-2.5 py-1 rounded hover:bg-accent/90 transition-colors shadow-sm"
                                        >
                                          Save
                                        </button>
                                      ) : null}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 min-[1320px]:grid-cols-2 gap-4">
                    {channels.length === 0 ? (
                      <div className="col-span-full p-10 border border-dashed border-border rounded-xl bg-elevated/30 flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 bg-elevated rounded-full flex items-center justify-center mb-3">
                          <Radio size={20} className="text-secondary" />
                        </div>
                        <span className="text-sm font-bold mb-1.5">No Active Channels</span>
                        <span className="text-xs text-secondary max-w-sm leading-relaxed">
                          Click "Add New Channel" to connect your VIP groups and start parsing automated signals.
                        </span>
                      </div>
                    ) : visibleChannels.length === 0 ? (
                      <div className="col-span-full p-10 border border-dashed border-border rounded-xl bg-elevated/30 flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 bg-elevated rounded-full flex items-center justify-center mb-3">
                          <Search size={20} className="text-secondary" />
                        </div>
                        <span className="text-sm font-bold mb-1.5">No channels match your search</span>
                        <button onClick={() => setMonitoredChannelQuery("")} className="mt-3 text-xs font-medium text-accent hover:text-accent/80 transition-colors">
                          Clear search
                        </button>
                      </div>
                    ) : (
                      visibleChannels.map((channel: any) => {
                        const isActive = (channel.isActive !== undefined ? channel.isActive : channel.is_active) === 1;
                        const instantOn = ((channel.instantEntry ?? channel.instant_entry) === 1);
                        const channelId = channel.channelId || channel.channel_id || "";
                        const name = channel.name || "?";
                        
                        return (
                          <div 
                            key={channel.id} 
                            className={`group relative p-4 rounded-xl flex items-center justify-between transition-all duration-200 border ${
                              isActive 
                                ? "bg-transparent border-border shadow-none hover:border-border/80" 
                                : "bg-transparent border-transparent opacity-60 grayscale-[20%]"
                            }`}
                          >
                            <div className="flex items-center gap-4 min-w-0 flex-1 mr-3 z-10">
                              <ChannelAvatar channelId={channelId} title={name} size="sm" />
                              <div className="min-w-0">
                                <h4 className="font-semibold text-sm tracking-tight mb-0.5 flex items-center gap-2 min-w-0">
                                  <span className="truncate" title={name}>{name}</span>
                                  {isActive && <span className="shrink-0 bg-success/10 text-success text-[10px] font-medium px-2 py-0.5 rounded-full">Active</span>}
                                </h4>
                                <div className="text-[11px] text-secondary font-medium tracking-wide truncate">
                                  ID: {channelId}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 z-10">
                              <button
                                onClick={() => handleToggleInstantEntry(channel.id, instantOn ? 1 : 0)}
                                className={`group/btn relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors border ${
                                  instantOn 
                                    ? 'bg-accent/10 text-accent border-accent/20 hover:bg-accent/20' 
                                    : 'bg-elevated text-secondary border-border hover:bg-border/50 hover:text-primary'
                                }`}
                              >
                                <Zap size={14} className={instantOn ? "text-accent" : ""} />
                                <span>Instant</span>
                                <div className="relative group/hint flex items-center">
                                  <Info size={12} className="opacity-50 hover:opacity-100 cursor-help" />
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-primary text-primary-foreground text-[10px] rounded shadow-lg opacity-0 invisible group-hover/hint:opacity-100 group-hover/hint:visible transition-all z-50 normal-case font-normal text-center pointer-events-none">
                                    {instantOn
                                      ? "ON: direction-only posts (e.g. \"SELL GOLD\") open immediately with your provisional stop/target, then adopt the real levels when the channel edits the post."
                                      : "OFF: only complete signals (with a stop loss) are traded; direction-only posts are ignored."}
                                  </div>
                                </div>
                              </button>
                              
                              <button
                                onClick={() => handleToggleChannel(channel.id, channel.isActive)}
                                className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors border ${
                                  isActive
                                    ? 'bg-success/10 text-success border-success/20 hover:bg-success/20'
                                    : 'bg-elevated text-secondary border-border hover:bg-border/50 hover:text-primary'
                                }`}
                                title={isActive ? "Pause Monitoring" : "Resume Monitoring"}
                              >
                                {isActive ? <Pause size={14} className="text-success" /> : <Play size={14} className="text-secondary" />}
                              </button>
                              
                              <div className="w-px h-5 bg-border mx-2"></div>
                              
                              <button onClick={() => handleDeleteChannel(channel.id)} className="text-secondary hover:text-destructive hover:bg-destructive/10 p-1.5 rounded-md transition-colors" title="Remove Channel">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  )
}
