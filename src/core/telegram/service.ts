import { TelegramAdapter } from './client';
import { getDb } from '../../db';
import { signals, telegramChannels, trades } from '../../db/schema';
import { RegexParser } from '../signal-engine/parser';
import { logger } from '../logger';
import type { RawTelegramMessage } from './types';
import { eq, and, gte } from 'drizzle-orm';
import { useSignalStore, type UiSignal } from '../../store/signals';
import { useSettingsStore } from '../../store/settings';
import { useMT5Store } from '../../store/mt5';

import { RiskEngine } from '../risk-engine';
import { ExecutionEngine } from '../execution-engine';
import { MT5Adapter } from '../execution-engine/mt5-adapter';
import { toast } from 'sonner';
import { playPop, playSuccess, playError } from '../../lib/sounds';

export class TelegramService {
  private adapter: TelegramAdapter;
  private parser: RegexParser;
  private riskEngine: RiskEngine;
  private executionEngine: ExecutionEngine;

  constructor(adapter: TelegramAdapter) {
    this.adapter = adapter;
    this.parser = new RegexParser();
    this.riskEngine = new RiskEngine();
    this.executionEngine = new ExecutionEngine(new MT5Adapter());
  }

  async loadActiveChannels(): Promise<string[]> {
    const db = await getDb();
    const active = await db.select().from(telegramChannels).where(eq(telegramChannels.isActive, 1));
    return active.map((c: any) => c.channelId);
  }

  async startListening() {
    try {
      const channelIds = await this.loadActiveChannels();
      if (channelIds.length === 0) {
        logger.info('No active channels to listen to.');
        return;
      }

      this.adapter.subscribeToChannels(channelIds, this.handleNewMessage.bind(this));
    } catch (err) {
      logger.error({ err }, 'Failed to start Telegram listener');
    }
  }

  async handleNewMessage(rawMessage: RawTelegramMessage) {
    try {
      // 1. Store Raw Message (Skipped explicit raw table for now, directly processing)
      // 2. Parse Signal
      if (this.parser.canParse(rawMessage.text)) {
        const parsed = this.parser.parse(rawMessage.text);
        if (parsed) {
          logger.info({ parsed }, 'Successfully parsed signal');
          playPop();
          toast(`New Signal: ${parsed.direction} ${parsed.symbol}`, {
            description: `Entry: ${parsed.entry} | SL: ${parsed.stopLoss}`,
          });
          
          // 3. Save to DB as RECEIVED
          const db = await getDb();
          
          // Ensure channel exists in DB (mocked for foreign key integrity)
          const channelExists = await db.select().from(telegramChannels).where(eq(telegramChannels.channelId, rawMessage.channelId));
          if (channelExists.length === 0) {
             await db.insert(telegramChannels).values({
               id: rawMessage.channelId,
               channelId: rawMessage.channelId,
               name: 'Unknown Channel'
             });
          }

          await db.insert(signals).values({
            id: rawMessage.messageId,
            channelId: rawMessage.channelId,
            symbol: parsed.symbol,
            direction: parsed.direction,
            entry: parsed.entry || null,
            stopLoss: parsed.stopLoss,
            status: 'RECEIVED',
            receivedAt: rawMessage.timestamp.getTime(),
          });
          
          // 4. Trigger Risk Engine
          const settings = useSettingsStore.getState();
          const mt5 = useMT5Store.getState();
          const paused = settings.tradingPaused;
          let rejectReason: string | undefined;

          // Channel-level overrides fall back to the global risk configuration
          const channelRow = channelExists[0] as
            | { name: string; riskPerTrade: number | null; maxTradesPerDay: number | null }
            | undefined;
          const effectiveRiskPercent =
            channelRow?.riskPerTrade ?? settings.riskConfig.riskPerTradePercent;
          const effectiveRiskConfig: typeof settings.riskConfig = {
            ...settings.riskConfig,
            riskPerTradePercent: effectiveRiskPercent,
          };

          const openTrades = await db.select().from(trades).where(eq(trades.status, 'OPEN'));
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);
          const todaySignals = await db
            .select()
            .from(signals)
            .where(and(eq(signals.status, 'EXECUTED'), gte(signals.receivedAt, startOfDay.getTime())));

          // Executed signals from THIS channel today (for per-channel daily caps)
          const channelTodaySignals = await db
            .select()
            .from(signals)
            .where(
              and(
                eq(signals.channelId, rawMessage.channelId),
                eq(signals.status, 'EXECUTED'),
                gte(signals.receivedAt, startOfDay.getTime())
              )
            );

          // Daily loss approximation: signals executed today count against the daily loss budget
          const dailyLossPercent = todaySignals.length * effectiveRiskPercent;

          // Prefer live broker balance when available; fall back to configured balance
          const effectiveBalance =
            mt5.isConnected && mt5.balance > 0 ? mt5.balance : settings.accountBalance;

          const account = {
            balance: effectiveBalance,
            equity: effectiveBalance,
            freeMargin: effectiveBalance,
            openGroupsCount: openTrades.length,
            currentDrawdown: 0,
            dailyLoss: dailyLossPercent,
            maxTradesPerDay: channelRow?.maxTradesPerDay ?? undefined,
            tradesExecutedToday: channelTodaySignals.length,
          };

          let symbolInfo = undefined;
          if (mt5.isConnected && !paused) {
            const info = await mt5.adapter.getSymbolInfo(parsed.symbol);
            if (info) {
              symbolInfo = {
                trade_tick_value: info.trade_tick_value,
                trade_tick_size: info.trade_tick_size,
              };
            }
          }

          const riskEvaluation = paused ? null : this.riskEngine.evaluate(parsed, account, effectiveRiskConfig, symbolInfo);
          let executed = false;

          if (paused) {
            // Global kill-switch is active - never route anything to a broker
            rejectReason = 'Trading paused via kill-switch';
            playError();
            toast.warning(`Trade Skipped: ${parsed.symbol}`, {
              description: rejectReason,
            });
            await db.update(signals).set({ status: 'REJECTED' }).where(eq(signals.id, rawMessage.messageId));
          } else if (riskEvaluation!.decision === 'APPROVED' && riskEvaluation!.positionSize !== null) {
            logger.info({ signalId: rawMessage.messageId, size: riskEvaluation!.positionSize }, 'Signal APPROVED by Risk Engine');
            
            playSuccess();
            toast.success(`Trade Executing: ${parsed.symbol}`, {
              description: `Size: ${riskEvaluation!.positionSize} lots`,
            });
            
            executed = await this.executionEngine.executeApprovedSignal({
              signalId: rawMessage.messageId,
              signal: parsed,
              positionSize: riskEvaluation!.positionSize
            });

            if (!executed) {
              playError();
              toast.error(`Execution Missed: ${parsed.symbol}`, {
                description: 'The broker could not fill the trade.',
              });
            }
          } else {
            rejectReason = riskEvaluation!.ruleResults?.find((r) => !r.passed)?.message || 'Unknown reason';
            logger.warn({ signalId: rawMessage.messageId, rules: riskEvaluation!.ruleResults }, 'Signal REJECTED by Risk Engine');
            
            playError();
            toast.error(`Trade Rejected: ${parsed.symbol}`, {
              description: rejectReason,
            });
            
            await db.update(signals).set({ status: 'REJECTED' }).where(eq(signals.id, rawMessage.messageId));
          }

          // 5. Push to UI Store
          const now = new Date();
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
          const sourceName = channelRow?.name || 'Unknown Channel';
          
          // Calculate theoretical RR if we have TPs
          let rr = 0;
          if (parsed.takeProfits.length > 0 && parsed.entry) {
             const risk = Math.abs(parsed.entry - parsed.stopLoss);
             const reward = Math.abs(parsed.takeProfits[0].price - parsed.entry);
             if (risk > 0) rr = Math.round((reward / risk) * 10) / 10;
          }

          const uiSignal: UiSignal = {
            id: rawMessage.messageId,
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
            validation: [
              { text: "Symbol supported", status: true },
              { text: "Direction valid", status: true },
              { text: "Stop loss valid", status: true },
              { text: "Take profit valid", status: parsed.takeProfits.length > 0 },
              { text: "Entry valid", status: !!parsed.entry }
            ]
          };

          useSignalStore.getState().addSignal(uiSignal);
        } else {
          logger.warn({ rawText: rawMessage.text }, 'RegexParser failed to extract signal data');
          toast.error("Signal Parsing Failed", {
            description: "Could not extract symbol, direction, entry, or stop loss from the message."
          });
        }
      } else {
        logger.info('Message ignored: Did not match signal criteria');
        toast.error("Signal Format Not Recognized", {
          description: "The message does not look like a trading signal."
        });
      }
    } catch (err: any) {
      logger.error({ err }, 'Error in handleNewMessage');
      toast.error("Error Processing Signal", {
        description: err?.message || String(err)
      });
    }
  }
}
