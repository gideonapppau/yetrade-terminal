import type { BrokerAdapter, ExecutionRequest, ExecutionResult } from './types';
import { logger } from '../logger';
import { getDb } from '../../db';
import { trades, signals } from '../../db/schema';
import { eq } from 'drizzle-orm';

export class ExecutionEngine {
  private adapter: BrokerAdapter;

  constructor(adapter: BrokerAdapter) {
    this.adapter = adapter;
  }

  async executeApprovedSignal(request: ExecutionRequest): Promise<boolean> {
    try {
      logger.info({ signalId: request.signalId }, 'Routing approved signal to broker adapter...');
      
      const db = await getDb();
      
      // Execute trade via Broker (Paper or MT5)
      const result: ExecutionResult = await this.adapter.executeTrade(request);

      if (result.success && result.tradeId) {
        // Record Trade in DB
        await db.insert(trades).values({
          id: result.tradeId,
          signalId: request.signalId,
          symbol: request.signal.symbol,
          direction: request.signal.direction,
          volume: request.positionSize,
          entryPrice: result.entryPrice || request.signal.entry || 0,
          status: 'OPEN'
        });

        // Update Signal status
        await db.update(signals)
          .set({ status: 'EXECUTED' })
          .where(eq(signals.id, request.signalId));
          
        logger.info({ tradeId: result.tradeId }, 'Trade successfully executed and recorded');
        return true;
      } else {
        // Approved by risk, but the broker could not fill it -> missed opportunity
        logger.error({ result }, 'Broker failed to execute trade');
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
