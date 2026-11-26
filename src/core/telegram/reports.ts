import { logger } from '../logger';
import { useSettingsStore } from '../../store/settings';
import { useTelegramStore } from '../../store/telegram';

/**
 * Trade reports sent to the user's own Telegram "Saved Messages", so they
 * can follow what the terminal did from their phone. Only signals produce
 * reports - channel chatter never does.
 */

interface SignalSummary {
  symbol: string;
  direction: string;
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  source?: string;
}

const levels = (s: SignalSummary) =>
  [
    s.entry != null ? `Entry ${s.entry}` : 'Entry: market',
    s.stopLoss != null ? `SL ${s.stopLoss}` : null,
    s.takeProfit != null ? `TP ${s.takeProfit}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

export function formatTradeOpened(s: SignalSummary & { volume: number }): string {
  return [
    `✅ Trade opened: ${s.direction} ${s.symbol}`,
    `${s.volume} lots · ${levels(s)}`,
    s.source ? `From: ${s.source}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatSignalNotTraded(s: SignalSummary & { status: string; reason?: string }): string {
  return [
    `⚠️ Signal not traded (${s.status}): ${s.direction} ${s.symbol}`,
    levels(s),
    `Reason: ${s.reason || 'unknown'}`,
    s.source ? `From: ${s.source}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** "Win" / "Loss" / "Breakeven" - a close at exactly 0.00 (e.g. stop moved to entry) is neither. */
export function tradeResultLabel(t: { status: string; pnl: number | null }): 'Win' | 'Loss' | 'Breakeven' {
  if (t.pnl != null && Math.abs(t.pnl) < 0.005) return 'Breakeven';
  return t.status === 'CLOSED_WIN' ? 'Win' : 'Loss';
}

export function formatTradeClosed(t: { symbol: string; direction: string; volume: number; pnl: number | null; ticket: string }): string {
  const outcome = t.pnl == null ? '' : Math.abs(t.pnl) < 0.005 ? 'breakeven' : t.pnl > 0 ? 'win' : 'loss';
  const result =
    t.pnl == null ? 'P/L unknown' : `P/L ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} (${outcome})`;
  return `${t.pnl != null && t.pnl < 0 ? '🔻' : '🏁'} Trade closed: ${t.direction} ${t.symbol} · ${t.volume} lots\n${result} · #${t.ticket}`;
}

/** Fire-and-forget: a failed report must never disturb trading. */
export function sendTradeReport(text: string): void {
  if (useSettingsStore.getState().generalSettings.telegramTradeReports === false) return;
  const client = useTelegramStore.getState().client;
  if (!client) return;
  client.sendToSavedMessages(text).catch((err) => {
    logger.warn({ err }, 'Failed to send Telegram trade report');
  });
}
