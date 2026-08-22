import type { BrokerAdapter, ExecutionRequest, ExecutionResult } from './types';
import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db';
import { trades } from '../../db/schema';
import { eq } from 'drizzle-orm';
export class PaperBrokerAdapter implements BrokerAdapter {
  name = 'Paper Broker';

  async executeTrade(request: ExecutionRequest): Promise<ExecutionResult> {
    logger.info({ request }, `[${this.name}] Executing mock trade...`);
    
    // Simulate network delay to broker API
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // If an entry price is provided in the signal, we assume a limit order that just got filled,
    // otherwise we would fetch the current market price. For Paper trading, we use the signal entry
    // or a mocked price if entry is missing.
    const entryPrice = request.signal.entry || 100.00; // Mocked market price

    const tradeId = `paper-${uuidv4().substring(0, 8)}`;
    
    logger.info({ tradeId, entryPrice, size: request.positionSize }, `[${this.name}] Trade successfully executed`);

    this.simulateTradeOutcome(tradeId);

    return {
      success: true,
      tradeId,
      entryPrice,
      executedAt: new Date(),
    };
  }

  // Hook to simulate trade outcome after execution
  private simulateTradeOutcome(tradeId: string) {
    setTimeout(async () => {
      try {
        const db = await getDb();
        
        // 60% chance to win, 40% chance to lose in mock
        const isWin = Math.random() > 0.4;
        const newStatus = isWin ? 'CLOSED_WIN' : 'CLOSED_LOSS';
        
        await db.update(trades)
          .set({ status: newStatus })
          .where(eq(trades.id, tradeId));
          
        logger.info({ tradeId, newStatus }, `[${this.name}] Mock trade automatically closed`);
        
        // Dispatch event for UI to update
        window.dispatchEvent(new Event('mock_trade_closed'));
      } catch (e) {
        logger.error({ e }, "Failed to simulate trade closing");
      }
    }, 10000); // Close after 10 seconds
  }
}
