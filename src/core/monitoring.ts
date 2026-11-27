import { and, eq, gte, or } from 'drizzle-orm';
import { getDb } from '../db';
import { signals, trades, telegramChannels } from '../db/schema';
import { useMT5Store } from '../store/mt5';
import { useTelegramStore } from '../store/telegram';
import { logger } from './logger';
import { sendTradeReport, formatDailySummary, tradeResultLabel, type DailySummary } from './telegram/reports';

/**
 * Operational messages for unattended running (e.g. on a VPS), sent to the
 * user's Telegram "Saved Messages":
 *  - a startup message, so restarts are visible,
 *  - alerts when MT5 stays disconnected or AutoTrading turns off,
 *  - a daily summary of signals, trades and why signals were not traded.
 * Short glitches are ignored so the user is not spammed.
 */

/** A problem must persist this long before it is reported. */
const ALERT_AFTER_MS = 2 * 60 * 1000;
/** Local hour at which the daily summary is sent. */
const DAILY_SUMMARY_HOUR = 21;
const SUMMARY_SENT_KEY = 'yetrade_last_daily_summary';
/** Give MT5 auto-connect time to finish before describing the startup state. */
const STARTUP_REPORT_DELAY_MS = 30_000;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function buildDailySummary(): Promise<DailySummary> {
  const db = await getDb();
  const since = startOfToday();
  const todaySignals = await db.select().from(signals).where(gte(signals.receivedAt, since));
  const signalsByStatus: Record<string, number> = {};
  const reasons = new Map<string, number>();
  for (const s of todaySignals) {
    signalsByStatus[s.status] = (signalsByStatus[s.status] ?? 0) + 1;
    if ((s.status === 'REJECTED' || s.status === 'MISSED') && s.rejectReason) {
      reasons.set(s.rejectReason, (reasons.get(s.rejectReason) ?? 0) + 1);
    }
  }
  const closedToday = await db
    .select()
    .from(trades)
    .where(and(or(eq(trades.status, 'CLOSED_WIN'), eq(trades.status, 'CLOSED_LOSS')), gte(trades.closedAt, since)));
  const open = await db.select().from(trades).where(eq(trades.status, 'OPEN'));
  const labels = closedToday.map((t) => tradeResultLabel(t));
  const mt5 = useMT5Store.getState();
  return {
    date: localDate(),
    signalsByStatus,
    notTradedReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    closed: {
      count: closedToday.length,
      wins: labels.filter((l) => l === 'Win').length,
      losses: labels.filter((l) => l === 'Loss').length,
      breakeven: labels.filter((l) => l === 'Breakeven').length,
      pnl: closedToday.reduce((sum, t) => sum + (t.pnl ?? 0), 0),
    },
    openTrades: new Set(open.map((t) => t.signalId ?? t.id)).size,
    balance: mt5.isConnected ? mt5.balance : null,
    equity: mt5.isConnected ? mt5.equity : null,
    currency: mt5.currency || 'USD',
  };
}

async function sendStartupReport() {
  const mt5 = useMT5Store.getState();
  let channelCount = 0;
  try {
    const db = await getDb();
    channelCount = (await db.select().from(telegramChannels).where(eq(telegramChannels.isActive, 1))).length;
  } catch (err) {
    logger.warn({ err }, 'Startup report: could not count channels');
  }
  const mt5Line = mt5.isConnected
    ? `MT5: connected${mt5.server ? ` (${mt5.server})` : ''} · AutoTrading ${mt5.autoTradingEnabled === false ? 'OFF ⚠️' : 'on'}`
    : 'MT5: NOT connected ⚠️';
  sendTradeReport(`🟢 YeTrade started\n${mt5Line}\nWatching ${channelCount} channel(s)`);
}

/** Starts all operational reporting; returns a stop function. */
export function startOperationalReports(): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];

  // 1. Startup message, once Telegram is connected
  let startupSent = false;
  const unsubTelegram = useTelegramStore.subscribe((state) => {
    if (!startupSent && state.client) {
      startupSent = true;
      timers.push(setTimeout(() => void sendStartupReport(), STARTUP_REPORT_DELAY_MS));
    }
  });
  if (useTelegramStore.getState().client) {
    startupSent = true;
    timers.push(setTimeout(() => void sendStartupReport(), STARTUP_REPORT_DELAY_MS));
  }

  // 2. MT5 / AutoTrading alerts - only after the problem persists
  let mt5DownTimer: ReturnType<typeof setTimeout> | null = null;
  let mt5Alerted = false;
  let autoTradingTimer: ReturnType<typeof setTimeout> | null = null;
  let autoTradingAlerted = false;
  const unsubMt5 = useMT5Store.subscribe((state, prev) => {
    if (state.isConnected !== prev.isConnected) {
      if (!state.isConnected && !mt5DownTimer) {
        mt5DownTimer = setTimeout(() => {
          mt5DownTimer = null;
          if (!useMT5Store.getState().isConnected) {
            mt5Alerted = true;
            sendTradeReport('🔴 MT5 disconnected for over 2 minutes - no trades can be placed until it reconnects.');
          }
        }, ALERT_AFTER_MS);
      } else if (state.isConnected) {
        if (mt5DownTimer) clearTimeout(mt5DownTimer);
        mt5DownTimer = null;
        if (mt5Alerted) {
          mt5Alerted = false;
          sendTradeReport('🟢 MT5 reconnected.');
        }
      }
    }
    if (state.autoTradingEnabled !== prev.autoTradingEnabled) {
      if (state.autoTradingEnabled === false && !autoTradingTimer) {
        autoTradingTimer = setTimeout(() => {
          autoTradingTimer = null;
          if (useMT5Store.getState().autoTradingEnabled === false) {
            autoTradingAlerted = true;
            sendTradeReport("⚠️ AutoTrading is OFF in MetaTrader 5 - every signal will be missed. Turn on the 'Algo Trading' button.");
          }
        }, ALERT_AFTER_MS);
      } else if (state.autoTradingEnabled === true) {
        if (autoTradingTimer) clearTimeout(autoTradingTimer);
        autoTradingTimer = null;
        if (autoTradingAlerted) {
          autoTradingAlerted = false;
          sendTradeReport('🟢 AutoTrading is back on in MetaTrader 5.');
        }
      }
    }
  });

  // 3. Daily summary at DAILY_SUMMARY_HOUR local time, once per day
  const summaryTimer = setInterval(() => {
    const now = new Date();
    if (now.getHours() < DAILY_SUMMARY_HOUR) return;
    const today = localDate(now);
    if (localStorage.getItem(SUMMARY_SENT_KEY) === today) return;
    if (!useTelegramStore.getState().client) return; // retry next minute
    localStorage.setItem(SUMMARY_SENT_KEY, today);
    buildDailySummary()
      .then((summary) => sendTradeReport(formatDailySummary(summary)))
      .catch((err) => logger.error({ err }, 'Failed to build daily summary'));
  }, 60_000);

  return () => {
    unsubTelegram();
    unsubMt5();
    clearInterval(summaryTimer);
    for (const t of timers) clearTimeout(t);
    if (mt5DownTimer) clearTimeout(mt5DownTimer);
    if (autoTradingTimer) clearTimeout(autoTradingTimer);
  };
}
