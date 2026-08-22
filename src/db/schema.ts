import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const telegramChannels = sqliteTable("telegram_channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  channelId: text("channel_id").notNull(),
  isActive: integer("is_active").notNull().default(1),
  riskPerTrade: real("risk_per_trade"),
  maxTradesPerDay: integer("max_trades_per_day")
});

export const signals = sqliteTable("signals", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => telegramChannels.id),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // 'BUY' | 'SELL'
  entry: real("entry"),
  stopLoss: real("stop_loss"),
  status: text("status").notNull(), // 'RECEIVED' | 'APPROVED' | 'REJECTED' | 'EXECUTED'
  receivedAt: integer("received_at").notNull(),
});

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  signalId: text("signal_id").references(() => signals.id),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  volume: real("volume").notNull(),
  entryPrice: real("entry_price"),
  status: text("status").notNull(), // 'OPEN' | 'CLOSED'
});
