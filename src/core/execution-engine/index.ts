import type { BrokerAdapter, ExecutionRequest, ExecutionResult } from './types';
import { logger } from '../logger';
import { getDb } from '../../db';
import { trades, signals } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { useSettingsStore } from '../../store/settings';
import { floorToStep } from '../../lib/utils';

/**
 * Persistence seam for the engine. The production implementation writes to
 * SQLite through Drizzle; tests inject an in-memory fake instead.
 */
export interface ExecutionPersistence {
  insertTrade(trade: {
    id: string;
    signalId: string;
    symbol: string;
    direction: string;
    volume: number;
    entryPrice: number | null;
    status: 'OPEN';
  }): Promise<void>;
  markSignalStatus(signalId: string, status: 'EXECUTED' | 'MISSED'): Promise<void>;
}

/** SQLite-backed persistence used when none is injected. */
function createDrizzlePersistence(): ExecutionPersistence {
  return {
    async insertTrade(trade) {
      const db = await getDb();
      await db.insert(trades).values(trade);
    },
    async markSignalStatus(signalId, status) {
      const db = await getDb();
      await db.update(signals).set({ status }).where(eq(signals.id, signalId));
    },
  };
}

export class ExecutionEngine {
  private adapter: BrokerAdapter;
  private persistence: ExecutionPersistence;
  /** Notified when filled positions could not be recorded (user must act). */
  onUntrackedPositions?: (tickets: string[], request: ExecutionRequest) => void;

  constructor(adapter: BrokerAdapter, persistence: ExecutionPersistence = createDrizzlePersistence()) {
    this.adapter = adapter;
    this.persistence = persistence;
  }

  async executeApprovedSignal(request: ExecutionRequest): Promise<boolean> {
    try {
      logger.info({ signalId: request.signalId }, 'Routing approved signal to broker adapter...');

      if (!(request.positionSize > 0) || !Number.isFinite(request.positionSize)) {
        logger.error({ signalId: request.signalId, positionSize: request.positionSize }, 'Refusing to execute an invalid position size');
        await this.persistence.markSignalStatus(request.signalId, 'MISSED');
        return false;
      }

      const settings = useSettingsStore.getState().executionSettings;
      const rejectBelowMinVolume = useSettingsStore.getState().riskConfig.rejectBelowMinVolume === true;

      let numSplits = 1;
      let tpsToUse = request.signal.takeProfits.map(tp => tp.price);

      if (settings.twinTradingEnabled && tpsToUse.length > 1) {
         const maxSplits = parseInt(settings.maxTpsToSplit) || 2;
         numSplits = Math.min(maxSplits, tpsToUse.length);
      } else if (tpsToUse.length > 0) {
         tpsToUse = [tpsToUse[0]];
      }

      let volMin = 0.01;
      let volStep = 0.01;

      if (this.adapter.getSymbolInfo) {
         const symbolInfo = await this.adapter.getSymbolInfo(request.signal.symbol);
         if (symbolInfo) {
           volMin = symbolInfo.volume_min || 0.01;
           volStep = symbolInfo.volume_step || 0.01;
         }
      }

      // Strict policy backstop: the risk engine already rejects sub-minimum
      // sizes, but never place an oversize order if a stale approval arrives.
      if (rejectBelowMinVolume && request.positionSize < volMin) {
        logger.warn(
          { signalId: request.signalId, positionSize: request.positionSize, volMin },
          'Size below broker minimum with strict policy - refusing to oversize'
        );
        await this.persistence.markSignalStatus(request.signalId, 'MISSED');
        return false;
      }

      // Never split into sizes the broker cannot fill: each leg must be able
      // to carry at least volume_min, otherwise the total exposure would
      // silently exceed the configured risk.
      const maxAffordableSplits = Math.floor(request.positionSize / volMin);
      if (maxAffordableSplits < 1) {
        logger.warn(
          { signalId: request.signalId, positionSize: request.positionSize, volMin },
          'Computed size is below the broker minimum - forcing a single minimum-lot trade'
        );
        numSplits = 1;
      } else if (numSplits > maxAffordableSplits) {
        numSplits = maxAffordableSplits;
      }

      // Round DOWN to the broker's own step (some instruments quote 0.001-lot
      // increments) so realized risk never exceeds the configured risk.
      const rawSplitSize = request.positionSize / numSplits;
      const splitSize = Math.max(volMin, floorToStep(rawSplitSize, volStep));

      let allFilled = true;
      let executedAtLeastOne = false;
      const untrackedTickets: string[] = [];

      for (let i = 0; i < numSplits; i++) {
        const tpPrice = tpsToUse[i] || tpsToUse[tpsToUse.length - 1];

        const splitRequest = {
           ...request,
           positionSize: splitSize,
           splitIndex: i,
           signal: {
             ...request.signal,
             takeProfits: tpPrice ? [{ price: tpPrice }] : []
           }
        };

        const result: ExecutionResult = await this.adapter.executeTrade(splitRequest);

        if (result.success && result.tradeId) {
          // The position is live at the broker from here on, whatever happens
          // to the bookkeeping - a DB failure must not abandon it as MISSED.
          executedAtLeastOne = true;
          try {
            await this.persistence.insertTrade({
              id: result.tradeId,
              signalId: request.signalId,
              symbol: request.signal.symbol,
              direction: request.signal.direction,
              volume: splitSize,
              entryPrice: result.entryPrice ?? request.signal.entry ?? null,
              status: 'OPEN'
            });
          } catch (persistErr) {
            untrackedTickets.push(result.tradeId);
            logger.error(
              { err: persistErr, ticket: result.tradeId, signalId: request.signalId },
              'Position opened at the broker but could not be recorded - it is NOT managed by the terminal'
            );
          }
        } else {
          allFilled = false;
          logger.error({ result, splitIndex: i }, 'Broker failed to execute split trade');
        }
      }

      if (executedAtLeastOne) {
        if (!allFilled) {
          logger.warn({ signalId: request.signalId }, 'Only some TP splits filled - marking EXECUTED');
        }
        if (untrackedTickets.length > 0) {
          this.onUntrackedPositions?.(untrackedTickets, request);
        }
        await this.persistence.markSignalStatus(request.signalId, 'EXECUTED');
        return true;
      } else {
        await this.persistence.markSignalStatus(request.signalId, 'MISSED');
        return false;
      }

    } catch (err) {
      logger.error({ err, request }, 'ExecutionEngine encountered a critical error');
      try {
        await this.persistence.markSignalStatus(request.signalId, 'MISSED');
      } catch (persistErr) {
        logger.error({ err: persistErr }, 'Failed to record MISSED status after execution error');
      }
      return false;
    }
  }
}
