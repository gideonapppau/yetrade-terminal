import type { BrokerAdapter, ExecutionRequest, ExecutionResult } from './types';
import { logger } from '../logger';
import { getDb } from '../../db';
import { trades, signals } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { useSettingsStore } from '../../store/settings';

export class ExecutionEngine {
  private adapter: BrokerAdapter;

  constructor(adapter: BrokerAdapter) {
    this.adapter = adapter;
  }

  async executeApprovedSignal(request: ExecutionRequest): Promise<boolean> {
    try {
      logger.info({ signalId: request.signalId }, 'Routing approved signal to broker adapter...');
      
      const db = await getDb();
      const settings = useSettingsStore.getState().executionSettings;
      
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
      
      let rawSplitSize = request.positionSize / numSplits;
      let splitSize = Math.max(volMin, Math.round(rawSplitSize / volStep) * volStep);
      // Format to 2 decimal places to avoid floating point precision issues
      splitSize = Number(splitSize.toFixed(2));
      
      let allFilled = true;
      let executedAtLeastOne = false;
      
      for (let i = 0; i < numSplits; i++) {
        const tpPrice = tpsToUse[i] || tpsToUse[tpsToUse.length - 1];
        
        const splitRequest = {
           ...request,
           positionSize: splitSize,
           signal: {
             ...request.signal,
             takeProfits: tpPrice ? [{ price: tpPrice }] : []
           }
        };
        
        const result: ExecutionResult = await this.adapter.executeTrade(splitRequest);
        
        if (result.success && result.tradeId) {
          await db.insert(trades).values({
            id: result.tradeId,
            signalId: request.signalId,
            symbol: request.signal.symbol,
            direction: request.signal.direction,
            volume: splitSize,
            entryPrice: result.entryPrice ?? request.signal.entry ?? null,
            status: 'OPEN'
          });
          executedAtLeastOne = true;
        } else {
          allFilled = false;
          logger.error({ result, splitIndex: i }, 'Broker failed to execute split trade');
        }
      }

      if (executedAtLeastOne) {
        if (!allFilled) {
          logger.warn({ signalId: request.signalId }, 'Only some TP splits filled - marking EXECUTED');
        }
        await db.update(signals)
          .set({ status: 'EXECUTED' })
          .where(eq(signals.id, request.signalId));
        return true;
      } else {
        await db.update(signals)
          .set({ status: 'MISSED' })
          .where(eq(signals.id, request.signalId));
        return false;
      }

    } catch (err) {
      logger.error({ err, request }, 'ExecutionEngine encountered a critical error');
      
      const db = await getDb();
      await db.update(signals)
        .set({ status: 'MISSED' })
        .where(eq(signals.id, request.signalId));
      return false;
    }
  }
}
