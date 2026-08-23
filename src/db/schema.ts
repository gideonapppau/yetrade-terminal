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
  maxTradesPerDay: integer("max_trades_per_day"),
  /** Fast-entry channels: trade direction-only posts instantly with provisional levels. */
  instantEntry: integer("instant_entry")
});

export const signals = sqliteTable("signals", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => telegramChannels.id),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  entry: real("entry"),
  stopLoss: real("stop_loss"),
  status: text("status").notNull(), // 'RECEIVED' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'MISSED' | 'PENDING' | 'EXPIRED'
  receivedAt: integer("received_at").notNull(),
  /**
   * Instant-entry lifecycle:
   *  null/0 = normal signal; 1 = executed on provisional levels, awaiting the
   *  provider's edit; the first valid amendment clears this back to 0.
   */
  isProvisional: integer("is_provisional"),
});

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  signalId: text("signal_id").references(() => signals.id),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  volume: real("volume").notNull(),
  entryPrice: real("entry_price"),
  status: text("status").notNull(), // 'OPEN' | 'CLOSED_WIN' | 'CLOSED_LOSS'
  /** Realized profit/loss in account currency; null when unknown. */
  pnl: real("pnl"),
  /** Epoch ms when the position was detected closed; null while open. */
  closedAt: integer("closed_at"),
});

/** Every raw message received from monitored channels, before any parsing. */
export const telegramMessages = sqliteTable("telegram_messages", {
  /** `${channelId}:${messageId}` - stable across edits. */
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull(),
  text: text("text").notNull(),
  receivedAt: integer("received_at").notNull(),
  /** Null until Telegram delivers an edit for this message. */
  editedAt: integer("edited_at"),
});
