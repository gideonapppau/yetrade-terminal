import { TelegramAdapter } from './client';
import { getDb } from '../../db';
import { signals, telegramChannels, telegramMessages, trades } from '../../db/schema';
import { RegexParser } from '../signal-engine/parser';
import { logger } from '../logger';
import type { RawTelegramMessage } from './types';
import { eq, and, gte, or } from 'drizzle-orm';
import { useSignalStore, type UiSignal } from '../../store/signals';
import { useSettingsStore } from '../../store/settings';
import { useMT5Store } from '../../store/mt5';

import { RiskEngine } from '../risk-engine';
import {
  computeDailyLossPercent,
  computeFloatingDrawdownPercent,
  planProvisionalAmendment,
} from '../risk-engine/accounting';
import { ExecutionEngine } from '../execution-engine';
import type { ParsedSignal } from '../signal-engine/types';
import type { OpenPosition } from '../execution-engine/types';
import type { AccountState } from '../risk-engine/types';
import { pipsToPoints, floorToStep } from '../../lib/utils';
import { DEFAULT_MAX_SIGNAL_AGE_SECONDS, TELEGRAM_POLL_INTERVAL_MS, TELEGRAM_POLL_BATCH } from '../constants';
import { toast } from 'sonner';
import { playPop, playSuccess, playError } from '../../lib/sounds';
import { sendTradeReport, formatTradeOpened, formatSignalNotTraded } from './reports';

/** Shape of a telegram_channels row the pipeline needs. */
export interface ChannelSignalRow {
  name: string;
  riskPerTrade: number | null;
  maxTradesPerDay: number | null;
  instantEntry: number | null;
}

interface ExecuteOptions {
  /** Label shown in toasts/logs ("Instant Entry"). */
  sourceLabel?: string;
  /** Marks the resulting trade as provisional when it fills. */
  provisional?: boolean;
}

type SignalRow = typeof signals.$inferSelect;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Live risk context: open groups and risk, floating drawdown, today's
 * realized loss and (with a channel) that channel's executed count today.
 * Shared by the automated pipeline and manual executions so neither can
 * bypass the account limits.
 */
export async function buildAccountState(
  db: Db,
  opts: { channelId: string | null; riskPercent: number; maxTradesPerDay?: number }
): Promise<AccountState> {
  const settings = useSettingsStore.getState();
  const mt5 = useMT5Store.getState();

  // Open positions count toward the group cap and the open-risk budget
  const openTrades = await db.select().from(trades).where(eq(trades.status, 'OPEN'));
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Executed signals from THIS channel today (for per-channel daily caps)
  const channelTodaySignals = opts.channelId
    ? await db
        .select()
        .from(signals)
        .where(
          and(
            eq(signals.channelId, opts.channelId),
            eq(signals.status, 'EXECUTED'),
            gte(signals.receivedAt, startOfDay.getTime())
          )
        )
    : [];

  // Prefer live broker balance when available; fall back to configured balance
  const effectiveBalance =
    mt5.isConnected && mt5.balance > 0 ? mt5.balance : settings.accountBalance;
  const effectiveEquity =
    mt5.isConnected && mt5.equity > 0 ? mt5.equity : effectiveBalance;

  // Daily loss budget consumption = NET realized P&L of trades closed
  // today (winners offset losers), as % of the balance. Counting every
  // executed signal as a full risk-unit loss would burn the whole day's
  // budget after a few attempts regardless of actual results.
  const closedTrades = await db
    .select()
    .from(trades)
    .where(or(eq(trades.status, 'CLOSED_WIN'), eq(trades.status, 'CLOSED_LOSS')));

  // A signal split across TP legs is ONE group - count signals, not legs
  const openGroupsCount = countOpenGroups(openTrades);

  return {
    balance: effectiveBalance,
    equity: effectiveEquity,
    freeMargin: effectiveBalance,
    openGroupsCount,
    // Each open group commits roughly one unit of configured risk
    openRiskPercent: openGroupsCount * opts.riskPercent,
    // Floating drawdown from live equity so the max-drawdown rule
    // actually fires instead of being permanently hardcoded to zero.
    currentDrawdown: computeFloatingDrawdownPercent(effectiveBalance, effectiveEquity),
    dailyLoss: computeDailyLossPercent(closedTrades, startOfDay.getTime(), effectiveBalance),
    maxTradesPerDay: opts.maxTradesPerDay,
    tradesExecutedToday: channelTodaySignals.length,
  };
}

/** Open trade groups: legs sharing a signal count once; orphans count alone. */
export function countOpenGroups(openTrades: Array<{ id: string; signalId: string | null }>): number {
  return new Set(openTrades.map((t) => t.signalId ?? `trade:${t.id}`)).size;
}

/**
 * Effective risk % for a channel: a positive override wins, otherwise the
 * global setting applies unchanged (no minimum floor).
 */
export function resolveRiskPercent(override: number | null | undefined, globalPercent: number): number {
  return override != null && override > 0 ? override : globalPercent;
}

/**
 * Which polled messages still need processing, oldest first.
 * - Later polls: everything newer than the last seen message id.
 * - First poll of a channel (lastSeenId undefined): only messages young
 *   enough to still be tradeable, so startup never replays old signals.
 */
export function selectNewMessages(
  messages: RawTelegramMessage[],
  lastSeenId: number | undefined,
  maxAgeSeconds: number,
  now: number = Date.now()
): RawTelegramMessage[] {
  return messages
    .filter((m) =>
      lastSeenId === undefined
        ? now - m.timestamp.getTime() <= maxAgeSeconds * 1000
        : Number(m.messageId) > lastSeenId
    )
    .sort((a, b) => Number(a.messageId) - Number(b.messageId));
}

/** Window in which an identical re-post of a signal is treated as a duplicate. */
export const REPOST_WINDOW_MS = 10 * 60 * 1000;

/**
 * True when `parsed` repeats a signal this channel already posted recently
 * (same symbol, direction, stop and entry). Providers often post the same
 * alert twice; each copy has its own message id, so the id-based guard alone
 * would open a second position.
 */
export function isRepostOf(
  parsed: Pick<ParsedSignal, 'symbol' | 'direction' | 'entry' | 'stopLoss'>,
  recent: Array<{ symbol: string; direction: string; entry: number | null; stopLoss: number | null; receivedAt: number }>,
  now: number = Date.now()
): boolean {
  return recent.some(
    (s) =>
      now - s.receivedAt <= REPOST_WINDOW_MS &&
      s.symbol === parsed.symbol &&
      s.direction === parsed.direction &&
      s.stopLoss === parsed.stopLoss &&
      (s.entry ?? null) === (parsed.entry ?? null)
  );
}

export class TelegramService {
  private adapter: TelegramAdapter;
  private parser: RegexParser;
  private riskEngine: RiskEngine;
  private executionEngine: ExecutionEngine;
  /** Messages already taken into the pipeline (push and poll can both deliver one). */
  private processedMessages = new Set<string>();
  /** Highest message id seen per channel by the polling fallback. */
  private lastPolledId = new Map<string, number>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollChannelIds: string[] = [];
  private polling = false;

  constructor(adapter: TelegramAdapter) {
    this.adapter = adapter;
    this.parser = new RegexParser();
    this.riskEngine = new RiskEngine();
    // Reuse the shared broker adapter so bridge URL updates apply here too
    this.executionEngine = new ExecutionEngine(useMT5Store.getState().adapter);
    this.executionEngine.onUntrackedPositions = (tickets, request) => {
      toast.error(`${request.signal.symbol}: position not recorded`, {
        description: `Ticket(s) ${tickets.join(', ')} are open at the broker but untracked - manage them in MT5.`,
        duration: Infinity,
      });
    };
  }

  /**
   * Telegram message IDs are only unique per channel, so the signal primary
   * key must be namespaced - a bare messageId collides when two monitored
   * channels each post message #100.
   */
  private signalRowId(channelId: string, messageId: string): string {
    return `${channelId}:${messageId}`;
  }

  async loadActiveChannels(): Promise<string[]> {
    const db = await getDb();
    const active = await db.select().from(telegramChannels).where(eq(telegramChannels.isActive, 1));
    return active.map((c) => c.channelId);
  }

  async startListening() {
    try {
      const channelIds = await this.loadActiveChannels();
      if (channelIds.length === 0) {
        // Must be loud: a silent return here means no signal is ever processed
        logger.warn('No active channels to listen to.');
        toast.warning('Not listening to any channels', {
          description: 'No active channels are saved in this app. Add them under Settings → Channels.',
          duration: Infinity,
        });
        return;
      }

      this.adapter.subscribeToChannels(
        channelIds,
        this.handleNewMessage.bind(this),
        this.handleEditedMessage.bind(this)
      );
      this.startPolling(channelIds);
    } catch (err: any) {
      logger.error({ err }, 'Failed to start Telegram listener');
      toast.error('Telegram listener failed to start', {
        description: err?.message || String(err),
        duration: Infinity,
      });
    }
  }

  /**
   * Fallback to push updates: fetch each monitored channel's latest messages
   * on an interval and feed unseen ones into the same pipeline.
   */
  private startPolling(channelIds: string[]) {
    this.pollChannelIds = channelIds;
    if (this.pollTimer) return; // already running; the channel list was refreshed
    const tick = () => void this.pollOnce();
    tick();
    this.pollTimer = setInterval(tick, TELEGRAM_POLL_INTERVAL_MS);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async pollOnce() {
    if (this.polling) return; // a slow poll must not overlap the next one
    this.polling = true;
    try {
      const maxAge =
        useSettingsStore.getState().executionSettings.maxSignalAgeSeconds ?? DEFAULT_MAX_SIGNAL_AGE_SECONDS;
      for (const channelId of this.pollChannelIds) {
        try {
          const recent = await this.adapter.getRecentMessages(channelId, TELEGRAM_POLL_BATCH);
          if (recent.length === 0) continue;
          const fresh = selectNewMessages(recent, this.lastPolledId.get(channelId), maxAge);
          const newest = Math.max(...recent.map((m) => Number(m.messageId)));
          this.lastPolledId.set(channelId, Math.max(newest, this.lastPolledId.get(channelId) ?? 0));
          for (const message of fresh) {
            if (!this.processedMessages.has(`${message.channelId}:${message.messageId}`)) {
              logger.info({ channelId, messageId: message.messageId }, 'Picked up message by polling');
            }
            await this.handleNewMessage(message);
          }
        } catch (err) {
          logger.warn({ err, channelId }, 'Polling a Telegram channel failed');
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /** Persists the untouched message text before any parsing happens. */
  private async storeRawMessage(rawMessage: RawTelegramMessage): Promise<void> {
    const db = await getDb();
    const id = `${rawMessage.channelId}:${rawMessage.messageId}`;
    await db
      .insert(telegramMessages)
      .values({
        id,
        channelId: rawMessage.channelId,
        messageId: rawMessage.messageId,
        text: rawMessage.text,
        receivedAt: rawMessage.timestamp.getTime(),
        editedAt: null,
      })
      .onConflictDoNothing();
  }

  /**
   * Edits drive two flows, both strictly time-boxed and one-shot:
   *  - PENDING fast-entry intents become complete signals (then execute),
   *  - provisional instant-entry trades adopt the provider's real levels.
   * Everything else keeps the fail-closed policy: recorded, never executed.
   */
  private async handleEditedMessage(rawMessage: RawTelegramMessage): Promise<void> {
    try {
      await this.storeRawMessage(rawMessage);

      const db = await getDb();
      const id = this.signalRowId(rawMessage.channelId, rawMessage.messageId);
      await db
        .update(telegramMessages)
        .set({ text: rawMessage.text, editedAt: Date.now() })
        .where(eq(telegramMessages.id, id));

      const existingSignals = await db.select().from(signals).where(eq(signals.id, id));
      if (existingSignals.length === 0) return;
      const signal = existingSignals[0];

      const settings = useSettingsStore.getState().executionSettings;
      const withinWindow =
        Date.now() - signal.receivedAt <= Math.max(5, settings.instantEditWindowSeconds) * 1000;

      // --- Provisional instant-entry trade: adopt the provider's real levels
      if (signal.status === 'EXECUTED' && signal.isProvisional === 1) {
        if (!withinWindow) {
          logger.warn(
            { signalId: id, symbol: signal.symbol },
            'Edit arrived after the instant-entry window - ignoring'
          );
          toast.warning(`${signal.symbol}: late edit ignored`, {
            description: `Only edits within ${settings.instantEditWindowSeconds}s are applied.`,
          });
          return;
        }

        const edited = this.parser.parse(rawMessage.text);
        if (!edited || !Number.isFinite(edited.stopLoss)) {
          logger.info(
            { signalId: id },
            'Edited text carries no usable stop loss yet - provisional levels stay'
          );
          return;
        }

        await this.amendProvisionalSignal(signal as SignalRow, edited);
        return;
      }

      // --- Pending fast-entry intent: complete it into a real signal
      if (signal.status === 'PENDING') {
        const edited = this.parser.parse(rawMessage.text);
        if (!edited) {
          logger.info({ signalId: id }, 'Edited intent still incomplete - staying pending');
          return;
        }
        if (!withinWindow) {
          await db.update(signals).set({ status: 'EXPIRED', rejectReason: 'Levels never arrived within the edit window' }).where(eq(signals.id, id));
          toast.info(`${signal.symbol}: signal expired`, {
            description: 'Levels never arrived in time.',
          });
          return;
        }
        await this.evaluateAndExecute(rawMessage, edited, db, signal.channelId, {});
        return;
      }

      // --- Everything else: fail-closed, exactly as before
      if (signal.status === 'EXECUTED') {
        logger.warn(
          { signalId: id, symbol: signal.symbol },
          'Source edited an EXECUTED signal message - ignoring per fail-safe policy'
        );
        toast.warning(`Signal ${signal.symbol} was edited by its source`, {
          description: 'The original trade stays open. Edits never trigger execution.',
        });
      } else {
        logger.info(
          { signalId: id, status: signal.status },
          'Source edited a signal message - ignoring'
        );
      }
    } catch (err) {
      logger.error({ err }, 'Failed to record edited Telegram message');
    }
  }

  async handleNewMessage(rawMessage: RawTelegramMessage) {
    // Claimed synchronously: push and poll may deliver the same message at
    // nearly the same moment, and both passing the DB duplicate check would
    // execute the signal twice.
    const messageKey = `${rawMessage.channelId}:${rawMessage.messageId}`;
    if (this.processedMessages.has(messageKey)) return;
    this.processedMessages.add(messageKey);
    try {
      // 1. Store the raw message exactly as received (before any parsing)
      await this.storeRawMessage(rawMessage);
      const db = await getDb();

      const channelRows = await db
        .select()
        .from(telegramChannels)
        .where(eq(telegramChannels.channelId, rawMessage.channelId));

      // 2. Parse Signal
      if (this.parser.canParse(rawMessage.text)) {
        const parsed = this.parser.parse(rawMessage.text);
        if (parsed) {
          const signalId = this.signalRowId(rawMessage.channelId, rawMessage.messageId);

          // Redelivery guard (e.g. after a reconnect): an already-recorded
          // signal must never run through risk evaluation and execution again.
          const dupe = await db.select().from(signals).where(eq(signals.id, signalId));
          if (dupe.length > 0) {
            logger.info(
              { signalId, status: dupe[0].status },
              'Duplicate Telegram message ignored - signal already processed'
            );
            return;
          }

          const recentFromChannel = await db
            .select()
            .from(signals)
            .where(and(eq(signals.channelId, rawMessage.channelId), gte(signals.receivedAt, Date.now() - REPOST_WINDOW_MS)));
          if (isRepostOf(parsed, recentFromChannel)) {
            logger.info({ signalId, symbol: parsed.symbol }, 'Identical re-post of a recent signal ignored');
            toast.info(`${parsed.symbol}: duplicate post ignored`, {
              description: 'The channel re-posted a signal that was already handled.',
            });
            return;
          }

          logger.info({ parsed }, 'Successfully parsed signal');
          if (useSettingsStore.getState().generalSettings.soundAlerts) playPop();
          toast(`New Signal: ${parsed.direction} ${parsed.symbol}`, {
            description: `Entry: ${parsed.entry} | SL: ${parsed.stopLoss}`,
          });

          // 3. Ensure channel exists in DB (mocked for foreign key integrity)
          if (channelRows.length === 0) {
             await db.insert(telegramChannels).values({
               id: rawMessage.channelId,
               channelId: rawMessage.channelId,
               name: 'Unknown Channel'
             });
          }

          await db.insert(signals).values({
            id: signalId,
            channelId: rawMessage.channelId,
            symbol: parsed.symbol,
            direction: parsed.direction,
            entry: parsed.entry || null,
            stopLoss: parsed.stopLoss,
            status: 'RECEIVED',
            receivedAt: rawMessage.timestamp.getTime(),
          });

          // 4. Shared risk-evaluation + execution pipeline
          await this.evaluateAndExecute(rawMessage, parsed, db, rawMessage.channelId, {});
        } else {
          logger.warn({ rawText: rawMessage.text }, 'RegexParser failed to extract signal data');
          toast.error("Signal Parsing Failed", {
            description: "Could not extract symbol, direction, entry, or stop loss from the message."
          });
        }
      } else {
        // 2b. Not a complete signal - maybe a fast-entry intent ("SELL GOLD")
        await this.tryHandleFastEntryIntent(rawMessage, db, channelRows[0] as ChannelSignalRow | undefined);
      }
    } catch (err: any) {
      logger.error({ err }, 'Error in handleNewMessage');
      toast.error("Error Processing Signal", {
        description: err?.message || String(err)
      });
    }
  }

  /**
   * Shared pipeline: builds the risk context (channel overrides, live
   * balance/drawdown, daily-loss accounting), evaluates the signal and routes
   * approvals to the execution engine. Used by fresh complete signals,
   * staged-intent completions and instant entries alike.
   */
  private async evaluateAndExecute(
    rawMessage: RawTelegramMessage,
    parsed: ParsedSignal,
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    channelId: string,
    options: ExecuteOptions
  ) {
    const signalId = this.signalRowId(rawMessage.channelId, rawMessage.messageId);
    const label = options.sourceLabel;

    // 1. Trigger Risk Engine
    const settings = useSettingsStore.getState();
    const mt5 = useMT5Store.getState();
    const paused = settings.tradingPaused;
    let rejectReason: string | undefined;

    // Hard blocks evaluated before any broker or risk work: the kill-switch,
    // then signal staleness (e.g. redelivery after a reconnect).
    const maxAgeSeconds =
      settings.executionSettings.maxSignalAgeSeconds ?? DEFAULT_MAX_SIGNAL_AGE_SECONDS;
    const ageSeconds = Math.round((Date.now() - rawMessage.timestamp.getTime()) / 1000);
    const blockReason = paused
      ? 'Trading paused via kill-switch'
      : ageSeconds > maxAgeSeconds
        ? `Signal is ${ageSeconds}s old (max ${maxAgeSeconds}s)`
        : undefined;

    // Channel-level overrides fall back to the global risk configuration.
    // Values are honored exactly as configured - never raised to a floor,
    // which would silently risk more than the user chose. Non-positive
    // overrides count as "unset"; a non-positive global value makes the
    // risk engine reject the signal.
    const channelRows = await db.select().from(telegramChannels).where(eq(telegramChannels.channelId, channelId));
    const channelRow = channelRows[0] as ChannelSignalRow | undefined;
    const overrideRisk = channelRow?.riskPerTrade;
    const overrideCap = channelRow?.maxTradesPerDay;
    const safeGlobalRisk = {
      ...settings.riskConfig,
      // MT5 treats a deviation of 0 as "no slippage allowed at all"
      maxSlippagePoints: Math.max(1, Math.round(settings.riskConfig.maxSlippagePoints)),
    };
    const effectiveRiskPercent = resolveRiskPercent(overrideRisk, safeGlobalRisk.riskPerTradePercent);
    const effectiveMaxTradesPerDay =
      overrideCap != null && overrideCap >= 1 ? overrideCap : undefined;
    const effectiveRiskConfig: typeof settings.riskConfig = {
      ...safeGlobalRisk,
      riskPerTradePercent: effectiveRiskPercent,
    };

    // A TP-less signal is only tradeable while a trailing stop is
    // armed to manage its exit; the risk engine enforces this policy.
    effectiveRiskConfig.trailingStopManagedTps = settings.executionSettings.trailingStopEnabled;

    const account = await buildAccountState(db, {
      channelId,
      riskPercent: effectiveRiskPercent,
      maxTradesPerDay: effectiveMaxTradesPerDay,
    });

    let symbolInfo = undefined;
    if (mt5.isConnected && !blockReason) {
      const info = await mt5.adapter.getSymbolInfo(parsed.symbol);
      if (info) {
        symbolInfo = {
          trade_tick_value: info.trade_tick_value,
          trade_tick_size: info.trade_tick_size,
          trade_contract_size: info.trade_contract_size,
          volume_min: info.volume_min,
          volume_step: info.volume_step,
        };
      }
    }

    const riskEvaluation = blockReason ? null : this.riskEngine.evaluate(parsed, account, effectiveRiskConfig, symbolInfo);
    let executed = false;
    // Respect the user's "Sound Alerts" preference for every signal sound
    const playSound = (fn: () => void) => {
      if (settings.generalSettings.soundAlerts) fn();
    };

    if (blockReason) {
      // Kill-switch or stale signal - never route anything to a broker
      rejectReason = blockReason;
      playSound(playError);
      toast.warning(`Trade Skipped: ${parsed.symbol}`, {
        description: rejectReason,
      });
      await db.update(signals).set({ status: 'REJECTED', rejectReason: rejectReason ?? null }).where(eq(signals.id, signalId));
    } else if (riskEvaluation!.decision === 'APPROVED' && riskEvaluation!.positionSize !== null) {
      logger.info({ signalId, size: riskEvaluation!.positionSize }, 'Signal APPROVED by Risk Engine');

      playSound(playSuccess);
      toast.success(`${label ? label + ': ' : 'Trade Executing: '}${parsed.symbol}`, {
        description: `Size: ${riskEvaluation!.positionSize} lots`,
      });

      executed = await this.executionEngine.executeApprovedSignal({
        signalId,
        signal: parsed,
        positionSize: riskEvaluation!.positionSize
      });

      if (executed && options.provisional) {
        // Instant entry filled - remember it awaits the provider's real levels
        await db.update(signals).set({ isProvisional: 1 }).where(eq(signals.id, signalId));
      }

      if (!executed) {
        rejectReason = this.executionEngine.lastFailureReason || 'The broker could not fill the trade.';
        await db.update(signals).set({ rejectReason }).where(eq(signals.id, signalId));
        playSound(playError);
        toast.error(`Execution Missed: ${parsed.symbol}`, {
          description: rejectReason,
          duration: 15000,
        });
      }
    } else {
      rejectReason = riskEvaluation!.ruleResults?.find((r) => !r.passed)?.message || 'Unknown reason';
      logger.warn({ signalId, rules: riskEvaluation!.ruleResults }, 'Signal REJECTED by Risk Engine');

      playSound(playError);
      toast.error(`${label ? label + ' Rejected' : 'Trade Rejected'}: ${parsed.symbol}`, {
        description: rejectReason,
      });

      await db.update(signals).set({ status: 'REJECTED', rejectReason: rejectReason ?? null }).where(eq(signals.id, signalId));
    }

    // 5. Push to UI Store
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const sourceName = channelRow?.name || 'Unknown Channel';

    // Report the outcome to the user's Telegram "Saved Messages"
    const reportSummary = {
      symbol: parsed.symbol,
      direction: parsed.direction,
      entry: parsed.entry ?? null,
      stopLoss: parsed.stopLoss,
      takeProfit: parsed.takeProfits[0]?.price ?? null,
      source: label ? `${sourceName} (${label})` : sourceName,
    };
    if (executed) {
      sendTradeReport(formatTradeOpened({ ...reportSummary, volume: riskEvaluation?.positionSize ?? 0 }));
    } else {
      sendTradeReport(formatSignalNotTraded({
        ...reportSummary,
        status: riskEvaluation?.decision === 'APPROVED' ? 'MISSED' : 'REJECTED',
        reason: rejectReason,
      }));
    }

    // Calculate theoretical RR if we have TPs
    let rr = 0;
    if (parsed.takeProfits.length > 0 && parsed.entry) {
       const risk = Math.abs(parsed.entry - parsed.stopLoss);
       const reward = Math.abs(parsed.takeProfits[0].price - parsed.entry);
       if (risk > 0) rr = Math.round((reward / risk) * 10) / 10;
    }

    const uiSignal: UiSignal = {
      id: signalId,
      time: timeStr,
      source: sourceName as string,
      symbol: parsed.symbol,
      direction: parsed.direction,
      entry: parsed.entry,
      sl: parsed.stopLoss,
      tp: parsed.takeProfits.length > 0 ? parsed.takeProfits[0].price : 0,
      rr: rr,
      decision: riskEvaluation?.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      outcome:
        riskEvaluation?.decision === 'APPROVED' ? (executed ? 'EXECUTED' : 'MISSED') : undefined,
      reason: rejectReason,
      raw: rawMessage.text,
      provisional: options.provisional && executed ? 'ARMED' : undefined,
      validation: [
        { text: "Symbol supported", status: true },
        { text: "Direction valid", status: true },
        { text: "Stop loss valid", status: true },
        { text: "Take profit valid", status: parsed.takeProfits.length > 0 },
        { text: "Entry valid", status: !!parsed.entry }
      ]
    };

    useSignalStore.getState().addSignal(uiSignal);
  }

  /**
   * Direction-only posts ("SELL GOLD") from channels with Instant Entry
   * enabled. Stages a PENDING intent right away, then - when a live price is
   * available - opens the trade immediately with provisional levels built
   * from the user's own rules (default stop pips, target at N times risk).
   * The provider's later edit amends it (see amendProvisionalSignal).
   */
  private async tryHandleFastEntryIntent(
    rawMessage: RawTelegramMessage,
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    channelRow: ChannelSignalRow | undefined
  ) {
    // Instant entry is strictly opt-in per channel - everyone else's chatter
    // containing "buy"/"sell" words is ignored silently.
    if (!channelRow || channelRow.instantEntry !== 1) {
      logger.info('Message ignored: Did not match signal criteria');
      return;
    }

    // Intent messages are short commands; anything long is treated as chat
    // noise even on opted-in channels.
    if (rawMessage.text.trim().length > 80) {
      logger.info('Long message without levels ignored despite instant-entry channel');
      return;
    }

    const intent = this.parser.parseIntent(rawMessage.text);
    if (!intent) {
      logger.info('Message ignored: Did not match signal criteria');
      return;
    }

    const signalId = this.signalRowId(rawMessage.channelId, rawMessage.messageId);

    // Redelivery guard, same as complete signals
    const dupe = await db.select().from(signals).where(eq(signals.id, signalId));
    if (dupe.length > 0) {
      logger.info({ signalId }, 'Duplicate intent message ignored');
      return;
    }

    // Stacking guard: chatter like repeated "buy gold" posts must not open a
    // new provisional trade every message. One live intent per channel+symbol
    // until its window resolves.
    const settings = useSettingsStore.getState().executionSettings;
    const windowMs = Math.max(5, settings.instantEditWindowSeconds) * 1000;
    const channelSignals = await db.select().from(signals).where(eq(signals.channelId, rawMessage.channelId));
    const hasLiveIntent = channelSignals.some(
      (s) =>
        s.symbol === intent.symbol &&
        s.receivedAt > Date.now() - windowMs &&
        (s.status === 'PENDING' || (s.status === 'EXECUTED' && s.isProvisional === 1))
    );
    if (hasLiveIntent) {
      logger.info(
        { symbol: intent.symbol, channelId: rawMessage.channelId },
        'Intent ignored - same symbol already staged or armed within the edit window'
      );
      return;
    }

    // Stage the intent regardless of execution outcome - the audit trail and
    // the edit-completion flow both depend on this row existing.
    await db.insert(signals).values({
      id: signalId,
      channelId: rawMessage.channelId,
      symbol: intent.symbol,
      direction: intent.direction,
      status: 'PENDING',
      receivedAt: rawMessage.timestamp.getTime(),
    });

    logger.info({ intent, signalId }, 'Fast-entry intent detected');
    if (useSettingsStore.getState().generalSettings.soundAlerts) playPop();
    toast(`Instant Signal: ${intent.direction} ${intent.symbol}`, {
      description: 'Building provisional levels...',
    });

    const provisional = await this.buildProvisionalSignal(intent);    if (!provisional) {
      toast.info(`${intent.symbol}: waiting for levels`, {
        description: 'No live price available - the trade opens when the edit completes it.',
      });
      return;
    }

    // Record the provisional levels for the audit trail, then trade
    await db
      .update(signals)
      .set({ entry: provisional.entry ?? null, stopLoss: provisional.stopLoss })
      .where(eq(signals.id, signalId));

    await this.evaluateAndExecute(rawMessage, provisional, db, rawMessage.channelId, {
      sourceLabel: 'Instant Entry',
      provisional: true,
    });
  }

  /**
   * Builds a tradeable stand-in signal from the user's own rules: default
   * stop distance (pips) around the live price, take-profit at N x risk.
   * Returns null when no trustworthy market data is available - never
   * invents prices.
   */
  private async buildProvisionalSignal(intent: {
    symbol: string;
    direction: 'BUY' | 'SELL';
  }): Promise<ParsedSignal | null> {
    const mt5 = useMT5Store.getState();
    const settings = useSettingsStore.getState().executionSettings;
    if (!mt5.isConnected) return null;

    const [info, price] = await Promise.all([
      mt5.adapter.getSymbolInfo?.(intent.symbol) ?? null,
      mt5.adapter.getSymbolPrice?.(intent.symbol) ?? null,
    ]);
    if (!price || !price.ask || !price.bid) return null;

    const point = info?.point ?? 0;
    if (!(point > 0)) return null;

    const stopDistance = pipsToPoints(settings.instantEntryStopPips, point) * point;
    if (!(stopDistance > 0)) return null;

    const isBuy = intent.direction === 'BUY';
    const ref = isBuy ? price.ask : price.bid;
    const rr = settings.instantTargetRR >= 3 ? 3 : 2;

    return {
      symbol: intent.symbol,
      direction: intent.direction,
      entry: ref,
      stopLoss: isBuy ? ref - stopDistance : ref + stopDistance,
      takeProfits: [
        { price: isBuy ? ref + rr * stopDistance : ref - rr * stopDistance },
      ],
    };
  }

  /**
   * Applies the provider's real levels to an open provisional trade without
   * ever exceeding the user's risk budget:
   *  - tighter stop  -> just move levels (risk shrinks),
   *  - wider stop    -> shrink volume so distance x volume risks the same,
   *  - impossible levels -> rejected, provisional setup stays armed.
   */
  private async amendProvisionalSignal(signal: SignalRow, edited: ParsedSignal) {
    const mt5 = useMT5Store.getState();
    if (!mt5.isConnected) {
      logger.warn({ signalId: signal.id }, 'Cannot amend - broker disconnected');
      return;
    }

    const db = await getDb();

    const openLegs = await db
      .select()
      .from(trades)
      .where(and(eq(trades.signalId, signal.id), eq(trades.status, 'OPEN')));
    if (openLegs.length === 0) {
      // Nothing left to amend - clear the flag so late edits stop warning
      await db.update(signals).set({ isProvisional: 0 }).where(eq(signals.id, signal.id));
      return;
    }

    const positions = mt5.adapter.getOpenPositions ? await mt5.adapter.getOpenPositions() : null;
    if (!positions) {
      // Unknown broker state must not be read as "legs are gone" - stay armed
      logger.warn({ signalId: signal.id }, 'Cannot amend - open positions unavailable');
      return;
    }
    const price = mt5.adapter.getSymbolPrice ? await mt5.adapter.getSymbolPrice(signal.symbol) : null;
    const info = mt5.adapter.getSymbolInfo ? await mt5.adapter.getSymbolInfo(signal.symbol) : null;

    const newSl = edited.stopLoss;
    const adoptedTp = edited.takeProfits[0]?.price ?? null;

    // Pair each DB leg with its live broker position and sanity-check sides
    const activeLegs: Array<{
      leg: typeof trades.$inferSelect;
      pos: OpenPosition;
      fillRef: number;
      provisionalDistance: number;
    }> = [];
    for (const leg of openLegs) {
      const pos = positions.find((p) => String(p.ticket) === leg.id);
      if (!pos) continue;
      const isBuy = pos.type === 'BUY';
      const fillRef = pos.price_open ?? leg.entryPrice ?? (isBuy ? price?.ask : price?.bid) ?? 0;
      if (!(fillRef > 0)) continue;

      // Wrong-side stop would be clamped into nonsense by the bridge -
      // reject the edit outright instead.
      if (price && price.bid > 0 && price.ask > 0) {
        const slSideOk = isBuy ? newSl < price.bid : newSl > price.ask;
        if (!slSideOk) {
          logger.warn({ signalId: signal.id, newSl, isBuy }, 'Edited stop on wrong side of market');
          toast.error(`${signal.symbol}: edited stop rejected`, {
            description: 'Stop loss sits on the wrong side of the market.',
          });
          return;
        }
      }

      const currentBrokerSl = pos.sl ?? 0;
      const provisionalDistance =
        currentBrokerSl > 0 ? Math.abs(fillRef - currentBrokerSl) : Math.abs(fillRef - newSl);
      activeLegs.push({ leg, pos, fillRef, provisionalDistance });
    }

    if (activeLegs.length === 0) {
      await db.update(signals).set({ isProvisional: 0 }).where(eq(signals.id, signal.id));
      return;
    }

    // Money one lot loses per 1.0 of adverse price movement
    const tickSize = info?.trade_tick_size ?? 0;
    const tickValue = info?.trade_tick_value ?? 0;
    const riskPerLotPerUnit = tickSize > 0 ? tickValue / tickSize : 0;

    const settings = useSettingsStore.getState();
    const balance = mt5.balance > 0 ? mt5.balance : settings.accountBalance;
    const channelRows = await db
      .select()
      .from(telegramChannels)
      .where(eq(telegramChannels.channelId, signal.channelId));
    const overrideRisk = (channelRows[0] as ChannelSignalRow | undefined)?.riskPerTrade;
    const riskPercent = resolveRiskPercent(overrideRisk, settings.riskConfig.riskPerTradePercent);

    // Conservative aggregate: the widest leg distance drives the resize math
    const currentTotalVolume = activeLegs.reduce((sum, l) => sum + l.pos.volume, 0);
    const provisionalDistance = Math.max(...activeLegs.map((l) => l.provisionalDistance));

    const plan = planProvisionalAmendment({
      currentTotalVolume,
      provisionalStopDistance: provisionalDistance,
      newStopDistance: Math.abs(activeLegs[0].fillRef - newSl),
      allowedRiskAmount: (balance * riskPercent) / 100,
      riskPerLotPerUnit,
    });

    if (plan.action === 'INVALID') {
      logger.warn({ signalId: signal.id, reason: plan.reason }, 'Amendment refused');
      toast.error(`${signal.symbol}: adjustment refused`, { description: plan.reason });
      return; // one-shot slot NOT consumed - a corrected edit may follow
    }

    const volStep = info?.volume_step && info.volume_step > 0 ? info.volume_step : 0.01;
    const volMin = info?.volume_min && info.volume_min > 0 ? info.volume_min : 0.01;
    const stepDecimals = (String(volStep).split('.')[1] || '').length;
    const roundToStep = (v: number) => floorToStep(v, volStep);

    // Every broker call is checked. A leg whose resize failed keeps its
    // tighter provisional stop - widening it at full size would break the
    // risk budget.
    const failures: string[] = [];
    let resized = false;
    for (const { leg, pos } of activeLegs) {
      const tpForLeg = adoptedTp ?? pos.tp ?? undefined;

      if (plan.action === 'RESIZE') {
        const desiredVolume = roundToStep(pos.volume * plan.scale);
        if (desiredVolume < volMin) {
          // Leg too small to survive the resize - close it completely
          const res = mt5.adapter.closeTrade
            ? await mt5.adapter.closeTrade(pos.ticket)
            : { success: false, message: 'Broker cannot close positions' };
          if (res.success) {
            resized = true;
          } else {
            failures.push(`close #${pos.ticket}: ${res.message}`);
          }
          continue;
        }
        if (desiredVolume < pos.volume - volStep / 2) {
          // Partial close restores the original risk budget
          const res = mt5.adapter.closeTrade
            ? await mt5.adapter.closeTrade(pos.ticket, Number((pos.volume - desiredVolume).toFixed(stepDecimals)))
            : { success: false, message: 'Broker cannot close positions' };
          if (!res.success) {
            failures.push(`trim #${pos.ticket}: ${res.message}`);
            continue;
          }
          await db.update(trades).set({ volume: desiredVolume }).where(eq(trades.id, leg.id));
          resized = true;
        }
      }

      const res = mt5.adapter.modifyTrade
        ? await mt5.adapter.modifyTrade(pos.ticket, newSl, tpForLeg)
        : { success: false, message: 'Broker cannot modify positions' };
      if (!res.success) failures.push(`modify #${pos.ticket}: ${res.message}`);
    }

    if (failures.length > 0) {
      // Stay armed: the expiry policy (or a corrected edit) still applies
      logger.error({ signalId: signal.id, failures }, 'Provisional amendment partially failed');
      toast.error(`${signal.symbol}: adjustment incomplete`, {
        description: `Broker refused: ${failures.join('; ')}. Provisional levels stay in charge.`,
      });
      window.dispatchEvent(new Event('mock_trade_closed'));
      return;
    }

    // Amendment consumed - later edits are recorded but never applied
    await db.update(signals).set({ isProvisional: 0 }).where(eq(signals.id, signal.id));

    logger.info(
      { signalId: signal.id, action: plan.action, newSl, adoptedTp },
      'Provisional trade amended to provider levels'
    );
    toast.success(`${signal.symbol}: adjusted to signal levels`, {
      description:
        plan.action === 'RESIZE'
          ? `Stop/target updated${resized ? ', size trimmed' : ''} to keep risk at ${riskPercent}%.`
          : 'Stop/target updated - risk reduced.',
    });
    window.dispatchEvent(new Event('mock_trade_closed'));
  }
}
