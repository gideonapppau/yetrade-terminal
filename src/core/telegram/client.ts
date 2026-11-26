import * as tg from 'telegram';
import * as sessions from 'telegram/sessions';
import { logger } from '../logger';
import type { TelegramConfig, ConnectionState, RawTelegramMessage, TelegramChannelInfo } from './types';
import * as events from 'telegram/events';
import { TELEGRAM_CONNECTION_RETRIES, TELEGRAM_DIALOGS_LIMIT } from '../constants';

const { TelegramClient } = tg;
const { StringSession } = sessions;
const { NewMessage, Raw } = events;

export class TelegramAdapter {
  private client: InstanceType<typeof TelegramClient> | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private config: TelegramConfig;
  private messageHandler: ((event: any) => void) | null = null;
  private rawHandler: ((update: any) => void) | null = null;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  async connect(phoneNumberProvider: () => Promise<string>, codeProvider: () => Promise<string>, passwordProvider: () => Promise<string>): Promise<string> {
    try {
      this.state = 'CONNECTING';
      logger.info('Connecting to Telegram MTProto...');

      const session = new StringSession(this.config.sessionString || '');
      this.client = new TelegramClient(session, this.config.apiId, this.config.apiHash, {
        connectionRetries: TELEGRAM_CONNECTION_RETRIES,
        useWSS: true,
      });

      // 1. Connect to Telegram WebSockets
      await this.client.connect();

      await this.client.start({
        phoneNumber: phoneNumberProvider,
        password: passwordProvider,
        phoneCode: codeProvider,
        onError: (err: Error) => {
          logger.error({ err }, 'Telegram auth error');
          throw err;
        },
      });

      this.state = 'CONNECTED';
      logger.info('Successfully connected to Telegram');
      
      // Save session string for future connections without auth
      const savedSession = this.client.session.save() as unknown as string;
      return savedSession;
    } catch (error) {
      this.state = 'ERROR';
      logger.error({ error }, 'Failed to connect to Telegram');
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (e) {
        logger.error({ e }, 'Error during disconnect');
      }
      this.client = null;
    }
    this.state = 'DISCONNECTED';
    logger.info('Disconnected from Telegram');
  }

  async getMe() {
    if (!this.client || this.state !== 'CONNECTED') {
      throw new Error('Telegram client is not connected');
    }
    return await this.client.getMe();
  }

  async listChannels(): Promise<TelegramChannelInfo[]> {
    if (!this.client || this.state !== 'CONNECTED') {
      throw new Error('Telegram client is not connected');
    }

    logger.info('Fetching Telegram dialogs...');
    const dialogs = await this.client.getDialogs({ limit: TELEGRAM_DIALOGS_LIMIT });

    const channels: TelegramChannelInfo[] = [];
    for (const dialog of dialogs) {
      const entity: any = dialog.entity;
      if (!entity) continue;

      if (entity.className === 'Channel' || entity.className === 'Chat') {
        channels.push({
          id: entity.id?.toString() || '',
          title: entity.title || 'Unknown',
          username: entity.username || undefined,
          type: entity.className === 'Channel' && entity.broadcast ? 'channel' : 'group',
        });
      }
    }

    logger.info({ count: channels.length }, 'Fetched Telegram channels and groups');
    return channels;
  }

  subscribeToChannels(
    channelIds: string[],
    onMessage: (msg: RawTelegramMessage) => void,
    onEdit?: (msg: RawTelegramMessage) => void
  ) {
    if (!this.client || this.state !== 'CONNECTED') {
      throw new Error('Telegram client is not connected');
    }

    // Remove any previous handlers so repeated calls don't stack duplicates
    if (this.messageHandler) {
      try {
        this.client.removeEventHandler(this.messageHandler, new NewMessage({}));
      } catch (e) {
        logger.warn({ e }, 'Failed to remove previous Telegram message handler');
      }
      this.messageHandler = null;
    }
    if (this.rawHandler) {
      try {
        this.client.removeEventHandler(this.rawHandler, new Raw({}));
      } catch (e) {
        logger.warn({ e }, 'Failed to remove previous Telegram raw handler');
      }
      this.rawHandler = null;
    }

    const extractChannelIds = (message: any): string[] => {
      const ids: string[] = [];
      const extract = (peer: any) => {
        if (!peer) return;
        if (peer.className === 'PeerChannel') ids.push(peer.channelId?.toString() || '');
        if (peer.className === 'PeerChat') ids.push(peer.chatId?.toString() || '');
        if (peer.className === 'PeerUser') ids.push(peer.userId?.toString() || '');
      };

      // Only the chat the message was actually posted in counts. Matching a
      // forward's original source would let anyone re-trigger a monitored
      // channel's (possibly stale) signals by forwarding them into any chat.
      extract(message.peerId);
      return ids.filter(Boolean);
    };

    const matchChannel = (ids: string[]): string | undefined => {
      for (const channelId of ids) {
        const found = channelIds.find(id => {
          const cleanId = id.toString().replace(/^-100/, '');
          const cleanEventId = channelId.replace(/^-100/, '');
          return cleanId === cleanEventId;
        });
        if (found) return found;
      }
      return undefined;
    };

    const messageHandler = (event: any) => {
      const message = event.message;
      if (!message?.peerId) return;

      const ids = extractChannelIds(message);
      const matchedChannelId = matchChannel(ids);
      if (!matchedChannelId) return;

      const rawMessage: RawTelegramMessage = {
        channelId: matchedChannelId,
        messageId: message.id.toString(),
        timestamp: new Date(message.date * 1000),
        text: message.message || '',
        edited: false,
      };

      logger.info({ channelId: matchedChannelId, messageId: rawMessage.messageId }, 'Received Telegram message');
      onMessage(rawMessage);
    };

    // NewMessage never fires for edits - GramJS delivers those as raw
    // UpdateEditMessage / UpdateEditChannelMessage updates.
    const rawHandler = (update: any) => {
      if (!onEdit) return;
      if (update?.className !== 'UpdateEditMessage' && update?.className !== 'UpdateEditChannelMessage') return;
      const message = update.message;
      if (!message?.peerId) return;

      const ids = extractChannelIds(message);
      const matchedChannelId = matchChannel(ids);
      if (!matchedChannelId) return;

      const editTimestamp = message.editDate ?? message.date;
      if (!editTimestamp) return;
      const rawEdit: RawTelegramMessage = {
        channelId: matchedChannelId,
        messageId: message.id.toString(),
        timestamp: new Date(editTimestamp * 1000),
        text: message.message || '',
        edited: true,
      };

      logger.info({ channelId: matchedChannelId, messageId: rawEdit.messageId }, 'Received Telegram message edit');
      onEdit(rawEdit);
    };

    this.messageHandler = messageHandler;
    this.rawHandler = rawHandler;
    this.client.addEventHandler(messageHandler, new NewMessage({}));
    this.client.addEventHandler(rawHandler, new Raw({}));

    logger.info({ channels: channelIds.length }, 'Subscribed to Telegram channels');
  }

  /** Posts a message to the user's own "Saved Messages" chat. */
  async sendToSavedMessages(text: string): Promise<void> {
    if (!this.client || this.state !== 'CONNECTED') {
      throw new Error('Telegram client is not connected');
    }
    await this.client.sendMessage('me', { message: text });
  }

  /** Dialog entities keyed by bare channel/chat id, for history polling. */
  private entityById = new Map<string, any>();

  private async refreshEntities() {
    if (!this.client) return;
    const dialogs = await this.client.getDialogs({ limit: TELEGRAM_DIALOGS_LIMIT });
    for (const dialog of dialogs) {
      const entity: any = dialog.entity;
      if (entity?.id != null) this.entityById.set(entity.id.toString(), entity);
    }
  }

  /**
   * Latest messages of one monitored chat, newest first. Backs the polling
   * fallback so posts are picked up even when push updates stop arriving.
   */
  async getRecentMessages(channelId: string, limit: number): Promise<RawTelegramMessage[]> {
    if (!this.client || this.state !== 'CONNECTED') return [];
    const key = channelId.replace(/^-100/, '');
    let entity = this.entityById.get(key);
    if (!entity) {
      await this.refreshEntities();
      entity = this.entityById.get(key);
    }
    if (!entity) return [];

    const messages: any[] = await this.client.getMessages(entity, { limit });
    return messages
      .filter((m) => m && m.id != null && m.date)
      .map((m) => ({
        channelId,
        messageId: m.id.toString(),
        timestamp: new Date(m.date * 1000),
        text: m.message || '',
        edited: false,
      }));
  }

  private photoCache: Map<string, string | null> = new Map();

  async getChannelPhoto(peer: string): Promise<string | null> {
    if (!this.client || this.state !== 'CONNECTED') return null;
    
    if (this.photoCache.has(peer)) {
      return this.photoCache.get(peer)!;
    }
    
    try {
      // Use isBigInt to safely parse channel IDs (GramJS expects BigInt for IDs)
      let peerId: any = peer;
      if (/^-?\d+$/.test(peer)) {
        try {
          peerId = tg.helpers.returnBigInt(peer);
        } catch {
          // Not a valid big int; fall back to raw string peer
        }
      }
      
      const buffer = await this.client.downloadProfilePhoto(peerId);
      if (buffer && buffer.length > 0) {
        // Convert Buffer/string to base64
        const bytes =
          typeof buffer === 'string'
            ? new TextEncoder().encode(buffer)
            : new Uint8Array(buffer as Uint8Array);
        const base64 = btoa(
          bytes.reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        );
        const dataUrl = `data:image/jpeg;base64,${base64}`;
        this.photoCache.set(peer, dataUrl);
        return dataUrl;
      }
      this.photoCache.set(peer, null);
      return null;
    } catch (e: any) {
      if (e?.message?.includes("Could not find the input entity")) {
        // Silently fail for unknown entities so we fallback to initials avatar without spamming console
        this.photoCache.set(peer, null);
        return null;
      }
      logger.error({ e, peer }, 'Failed to download channel photo');
      this.photoCache.set(peer, null);
      return null;
    }
  }

  getState(): ConnectionState {
    return this.state;
  }
}
