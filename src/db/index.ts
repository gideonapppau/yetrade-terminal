// This will connect to SQLite via Tauri IPC using tauri-plugin-sql
// Drizzle supports a custom driver for Tauri, or we can use the community tauri-sql package.

import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import Database from '@tauri-apps/plugin-sql';
import * as schema from './schema';
import { SQLITE_DB_HANDLE } from '../core/constants';
import { logger } from '../core/logger';

let dbInstance: SqliteRemoteDatabase<typeof schema> | null = null;

export async function getDb() {
  if (dbInstance) return dbInstance;
  
  const inTauri = '__TAURI_INTERNALS__' in window || '__TAURI_IPC__' in window;

  // Inside the real app a SQLite failure must surface - silently trading on
  // the string-matched localStorage mock would corrupt risk accounting. The
  // mock exists only for browser dev mode. dbInstance stays null on failure,
  // so the next call retries the connection.
  if (inTauri) {
    // Connect to the local SQLite database via Tauri SQL plugin
    const sqlite = await Database.load(SQLITE_DB_HANDLE);
    
    // Explicitly ensure the table exists to bypass any migration bugs
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS telegram_channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        risk_per_trade REAL,
        max_trades_per_day INTEGER
      );
    `);

    // Upgrade legacy databases that pre-date the risk-override columns
    for (const alter of [
      `ALTER TABLE telegram_channels ADD COLUMN risk_per_trade REAL;`,
      `ALTER TABLE telegram_channels ADD COLUMN max_trades_per_day INTEGER;`,
      `ALTER TABLE telegram_channels ADD COLUMN instant_entry INTEGER;`,
      `ALTER TABLE signals ADD COLUMN is_provisional INTEGER;`,
    ]) {
      try {
        await sqlite.execute(alter);
      } catch {
        // Column already exists - safe to ignore
      }
    }
    
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES telegram_channels(id),
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        entry REAL,
        stop_loss REAL,
        status TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
    `);
    
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        signal_id TEXT REFERENCES signals(id),
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        volume REAL NOT NULL,
        entry_price REAL,
        status TEXT NOT NULL,
        pnl REAL,
        closed_at INTEGER
      );
    `);

    // Upgrade legacy databases that pre-date the pnl column
    try {
      await sqlite.execute(`ALTER TABLE trades ADD COLUMN pnl REAL;`);
    } catch {
      // Column already exists - safe to ignore
    }

    // Upgrade legacy databases that pre-date the closed_at column
    try {
      await sqlite.execute(`ALTER TABLE trades ADD COLUMN closed_at INTEGER;`);
    } catch {
      // Column already exists - safe to ignore
    }

    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS telegram_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        text TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        edited_at INTEGER
      );
    `);
    
    dbInstance = drizzle(
      async (sql, params, method) => {
        // Map Drizzle methods to Tauri SQL methods
        if (method === 'run') {
          try {
            await sqlite.execute(sql, params);
          } catch(e) {
            logger.error({ err: e, sql }, '[DB] run failed');
            throw e;
          }
          return { rows: [] };
        } else if (method === 'all' || method === 'values' || method === 'get') {
          try {
            const results = await sqlite.select<any[]>(sql, params);
            if (results.length === 0) return { rows: [] };

            // Extract requested column order from SELECT statement to avoid JSON key sorting issues
            const selectMatch = sql.match(/select\s+(.*?)\s+from/i);
            if (selectMatch) {
              const cols = selectMatch[1].split(',').map(part => {
                const match = part.trim().match(/"([^"]+)"$/) || part.trim().match(/"([^"]+)"/);
                return match ? match[1] : part.trim();
              });
              const mapRow = (row: any) => cols.map(c => row[c] ?? row[`telegram_channels.${c}`] ?? row[Object.keys(row).find(k => k.endsWith(`.${c}`)) || c]);
              
              const mapped = method === 'get' ? mapRow(results[0]) : results.map(mapRow);

              return { rows: mapped };
            }

            const mapped = method === 'get' ? Object.values(results[0]) : results.map(Object.values);

            return { rows: mapped };
          } catch (e) {
            logger.error({ err: e, sql }, '[DB] select failed');
            throw e;
          }
        }
        return { rows: [] };
      },
      { schema }
    );
  } else {
    logger.warn("Not running in Tauri - using mock localStorage database");
    // Provide a safe fallback mock so the UI works in browser mode
    dbInstance = drizzle(
      async (sql, params, method) => {
        let channels = JSON.parse(localStorage.getItem('mock_telegram_channels') || '[]');
        let mockSignals = JSON.parse(localStorage.getItem('mock_signals') || '[]');
        let mockTrades = JSON.parse(localStorage.getItem('mock_trades') || '[]');
        let mockMessages = JSON.parse(localStorage.getItem('mock_telegram_messages') || '[]');

        const lowerSql = sql.toLowerCase();
        
        // ------------------ CHANNELS ------------------
        if (lowerSql.includes('insert into "telegram_channels"')) {
          const exists = channels.find((c: any) => c.id === params[0]);
          if (exists) throw new Error("UNIQUE constraint failed");
          channels.push({
            id: params[0],
            name: params[1],
            channel_id: params[2],
            is_active: params[3],
            risk_per_trade: params[4] ?? null,
            max_trades_per_day: params[5] ?? null,
            instant_entry: params[6] ?? null
          });
          localStorage.setItem('mock_telegram_channels', JSON.stringify(channels));
          return { rows: [] };
        }
        
        if (lowerSql.includes('update "telegram_channels"')) {
          if (lowerSql.includes('set "is_active" = ?') && lowerSql.includes('"name" = ?')) {
            channels = channels.map((c: any) => c.id === params[2] ? { ...c, is_active: params[0], name: params[1] } : c);
          } else if (lowerSql.includes('set "instant_entry" = ?')) {
            channels = channels.map((c: any) => c.id === params[1] ? { ...c, instant_entry: params[0] } : c);
          } else if (lowerSql.includes('set "is_active" = ?')) {
            channels = channels.map((c: any) => c.id === params[1] ? { ...c, is_active: params[0] } : c);
          } else if (lowerSql.includes('set "risk_per_trade" = ?, "max_trades_per_day" = ?')) {
            channels = channels.map((c: any) => c.id === params[2] ? { ...c, risk_per_trade: params[0], max_trades_per_day: params[1] } : c);
          }
          localStorage.setItem('mock_telegram_channels', JSON.stringify(channels));
          return { rows: [] };
        }
        
        if (lowerSql.includes('delete from "telegram_channels"')) {
          channels = channels.filter((c: any) => c.id !== params[0]);
          localStorage.setItem('mock_telegram_channels', JSON.stringify(channels));
          return { rows: [] };
        }
        
        // ------------------ SIGNALS ------------------
        if (lowerSql.includes('insert into "signals"')) {
          mockSignals.push({
            id: params[0],
            channel_id: params[1],
            symbol: params[2],
            direction: params[3],
            entry: params[4],
            stop_loss: params[5],
            status: params[6],
            received_at: params[7],
            is_provisional: params[8] ?? null,
          });
          localStorage.setItem('mock_signals', JSON.stringify(mockSignals));
          return { rows: [] };
        }

        if (lowerSql.includes('update "signals"')) {
          if (lowerSql.includes('set "status" = ?, "is_provisional" = ?')) {
            mockSignals = mockSignals.map((s: any) =>
              s.id === params[2] ? { ...s, status: params[0], is_provisional: params[1] } : s
            );
          } else if (lowerSql.includes('set "is_provisional" = ?')) {
            mockSignals = mockSignals.map((s: any) => s.id === params[1] ? { ...s, is_provisional: params[0] } : s);
          } else if (lowerSql.includes('set "entry" = ?, "stop_loss" = ?')) {
            mockSignals = mockSignals.map((s: any) => s.id === params[2] ? { ...s, entry: params[0], stop_loss: params[1] } : s);
          } else if (lowerSql.includes('set "status" = ?')) {
            mockSignals = mockSignals.map((s: any) => s.id === params[1] ? { ...s, status: params[0] } : s);
          }
          localStorage.setItem('mock_signals', JSON.stringify(mockSignals));
          return { rows: [] };
        }

        // ------------------ TRADES ------------------
        if (lowerSql.includes('insert into "trades"')) {
          mockTrades.push({
            id: params[0],
            signal_id: params[1],
            symbol: params[2],
            direction: params[3],
            volume: params[4],
            entry_price: params[5],
            status: params[6],
            pnl: params[7] ?? null,
            closed_at: params[8] ?? null
          });
          localStorage.setItem('mock_trades', JSON.stringify(mockTrades));
          return { rows: [] };
        }

        if (lowerSql.includes('update "trades"')) {
          if (lowerSql.includes('set "status" = ?, "pnl" = ?, "closed_at" = ?')) {
            mockTrades = mockTrades.map((t: any) => t.id === params[3] ? { ...t, status: params[0], pnl: params[1], closed_at: params[2] } : t);
            localStorage.setItem('mock_trades', JSON.stringify(mockTrades));
          } else if (lowerSql.includes('set "status" = ?, "pnl" = ?')) {
            mockTrades = mockTrades.map((t: any) => t.id === params[2] ? { ...t, status: params[0], pnl: params[1] } : t);
            localStorage.setItem('mock_trades', JSON.stringify(mockTrades));
          } else if (lowerSql.includes('set "status" = ?')) {
            mockTrades = mockTrades.map((t: any) => t.id === params[1] ? { ...t, status: params[0] } : t);
            localStorage.setItem('mock_trades', JSON.stringify(mockTrades));
          }
          return { rows: [] };
        }

        // ------------------ RAW TELEGRAM MESSAGES ------------------
        if (lowerSql.includes('insert into "telegram_messages"')) {
          const exists = mockMessages.find((m: any) => m.id === params[0]);
          if (!exists) {
            mockMessages.push({
              id: params[0],
              channel_id: params[1],
              message_id: params[2],
              text: params[3],
              received_at: params[4],
              edited_at: params[5] ?? null
            });
            localStorage.setItem('mock_telegram_messages', JSON.stringify(mockMessages));
          }
          return { rows: [] };
        }

        if (lowerSql.includes('update "telegram_messages"')) {
          if (lowerSql.includes('"text" = ?') && lowerSql.includes('"edited_at" = ?')) {
            mockMessages = mockMessages.map((m: any) =>
              m.id === params[2] ? { ...m, text: params[0], edited_at: params[1] } : m
            );
            localStorage.setItem('mock_telegram_messages', JSON.stringify(mockMessages));
          }
          return { rows: [] };
        }

        if (lowerSql.includes('from "telegram_messages"')) {
          let results: any[] = mockMessages;
          if (lowerSql.includes('where "telegram_messages"."id" = ?')) {
            results = results.filter((m: any) => m.id === params[0]);
          }
          if (results.length > 0 && method === 'get') {
            return { rows: Object.values(results[0]) };
          }
          return { rows: method === 'get' ? [] : results.map(Object.values) };
        }

        // ------------------ SELECTS ------------------
        if (lowerSql.includes('select')) {
          let results: any[] = [];
          
          if (lowerSql.includes('from "telegram_channels"')) {
            results = channels;
            if (lowerSql.includes('where "telegram_channels"."is_active" = ?')) {
              results = channels.filter((c: any) => c.is_active === params[0]);
            } else if (lowerSql.includes('where "telegram_channels"."id" = ?')) {
              results = channels.filter((c: any) => c.id === params[0]);
            } else if (lowerSql.includes('where "telegram_channels"."channel_id" = ?')) {
              results = channels.filter((c: any) => c.channel_id === params[0]);
            }
          } else if (lowerSql.includes('from "signals"')) {
            results = mockSignals;
            if (lowerSql.includes('where ("signals"."status" = ? and "signals"."received_at" >= ?)')) {
              results = mockSignals.filter((s: any) => s.status === params[0] && s.received_at >= params[1]);
            } else if (lowerSql.includes('where ("signals"."is_provisional" = ? and "signals"."status" = ?)')) {
              results = mockSignals.filter((s: any) => s.is_provisional === params[0] && s.status === params[1]);
            } else if (lowerSql.includes('where "signals"."id" = ?')) {
              results = mockSignals.filter((s: any) => s.id === params[0]);
            } else if (lowerSql.includes('where "signals"."channel_id" = ?')) {
              results = mockSignals.filter((s: any) => s.channel_id === params[0]);
            } else if (lowerSql.includes('where "signals"."status" = ?')) {
              results = mockSignals.filter((s: any) => s.status === params[0]);
            }
          } else if (lowerSql.includes('from "trades"')) {
            results = mockTrades;
            if (lowerSql.includes('where ("trades"."signal_id" = ? and "trades"."status" = ?)')) {
              results = mockTrades.filter((t: any) => t.signal_id === params[0] && t.status === params[1]);
            } else if (lowerSql.includes('where "trades"."status" = ?')) {
              results = mockTrades.filter((t: any) => t.status === params[0]);
            } else if (lowerSql.includes('where ("trades"."status" = ? or "trades"."status" = ?)')) {
              results = mockTrades.filter((t: any) => t.status === params[0] || t.status === params[1]);
            }
          }
          
          // Order columns correctly if requested
          if (results.length > 0) {
            const selectMatch = lowerSql.match(/select\s+(.*?)\s+from/);
            if (selectMatch && !selectMatch[1].includes('*')) {
              const cols = selectMatch[1].split(',').map((part: string) => {
                const match = part.trim().match(/"([^"]+)"$/) || part.trim().match(/"([^"]+)"/);
                return match ? match[1] : part.trim();
              });
              
              if (method === 'all' || method === 'values') {
                return { rows: results.map((r: any) => cols.map((c: string) => r[c])) };
              } else if (method === 'get') {
                return { rows: cols.map((c: string) => results[0][c]) };
              }
            }
          }
          
          if (method === 'all' || method === 'values') {
            return { rows: results.map(Object.values) };
          } else if (method === 'get') {
            return { rows: results.length > 0 ? Object.values(results[0]) : [] };
          }
        }
        
        return { rows: [] };
      },
      { schema }
    );
  }
  
  return dbInstance;
}
