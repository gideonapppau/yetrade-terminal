import type { BrokerAdapter, ExecutionRequest, ExecutionResult } from './types';
import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db';
import { trades } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { useSettingsStore } from '../../store/settings';

/**
 * Simulated broker used for demo/testing. Fills instantly at the signal's
 * entry price (never invents one) and resolves each position after a short
 * delay by walking its own SL/TP levels - outcomes are clearly synthetic and
 * only ever touch trades created by this adapter.
 */
export class PaperBrokerAdapter implements BrokerAdapter {
  name = 'Paper Broker';

  async isConnected(): Promise<boolean> {
    return true;
  }

  async loginBroker(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Paper broker requires no login.' };
  }

  async getAccountInfo(): Promise<{ balance: number; equity: number; currency: string }> {
    const settings = useSettingsStore.getState();
    return {
      balance: settings.accountBalance,
      equity: settings.accountBalance,
      currency: 'USD',
    };
  }

  async executeTrade(request: ExecutionRequest): Promise<ExecutionResult> {
    logger.info({ request }, `[${this.name}] Executing simulated trade...`);

    // Simulate network delay to broker API
    await new Promise(resolve => setTimeout(resolve, 500));

    const tradeId = `paper-${uuidv4().substring(0, 8)}`;

    logger.info(
      { tradeId, entryPrice: request.signal.entry ?? null, size: request.positionSize },
      `[${this.name}] Trade successfully executed`
    );

    if (request.signal.entry != null) {
      this.simulateTradeOutcome(tradeId, request);
    } else {
      logger.warn({ tradeId }, `[${this.name}] No entry price on signal; skipping outcome simulation`);
    }

    return {
      success: true,
      tradeId,
      entryPrice: request.signal.entry,
      executedAt: new Date(),
    };
  }

  /**
   * Resolves the simulated position after a delay. A random walk decides
   * whether TP or SL is "hit" first (50/50), and the resulting P&L is stored
   * alongside the status so the dashboard reflects it honestly.
   */
  private simulateTradeOutcome(tradeId: string, request: ExecutionRequest) {
    const { entry, stopLoss, takeProfits, direction } = request.signal;
    const tpPrice = takeProfits[0]?.price;
    setTimeout(async () => {
      try {
        const db = await getDb();

        let newStatus: 'CLOSED_WIN' | 'CLOSED_LOSS';
        let pnl: number;

        if (tpPrice != null) {
          const isWin = Math.random() > 0.5;
          const exitPrice = isWin ? tpPrice : stopLoss;
          pnl = direction === 'BUY'
            ? (exitPrice - entry!) * request.positionSize
            : (entry! - exitPrice) * request.positionSize;
          newStatus = isWin ? 'CLOSED_WIN' : 'CLOSED_LOSS';
        } else {
          // No TP on the signal - resolve against SL only (a scratch trade)
          pnl = 0;
          newStatus = Math.random() > 0.5 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
        }

        await db.update(trades)
          .set({ status: newStatus, pnl, closedAt: Date.now() })
          .where(eq(trades.id, tradeId));

        logger.info({ tradeId, newStatus, pnl }, `[${this.name}] Mock trade automatically closed`);

        // Dispatch event for UI to update
        window.dispatchEvent(new Event('mock_trade_closed'));
      } catch (e) {
        logger.error({ e }, "Failed to simulate trade closing");
      }
    }, 10000); // Close after 10 seconds
  }
}
