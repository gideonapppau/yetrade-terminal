import * as tg from 'telegram';
import * as sessions from 'telegram/sessions';
import { logger } from '../logger';
import type { TelegramConfig, ConnectionState, RawTelegramMessage, TelegramChannelInfo } from './types';
import * as events from 'telegram/events';
import { TELEGRAM_CONNECTION_RETRIES, TELEGRAM_DIALOGS_LIMIT } from '../constants';

const { TelegramClient } = tg;
const { StringSession } = sessions;
const { NewMessage } = events;

export class TelegramAdapter {
  private client: InstanceType<typeof TelegramClient> | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private config: TelegramConfig;
  private messageHandler: ((event: any) => void) | null = null;

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
        onError: (err: Error) => logger.error({ err }, 'Telegram auth error'),
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

  subscribeToChannels(channelIds: string[], onMessage: (msg: RawTelegramMessage) => void) {
    if (!this.client || this.state !== 'CONNECTED') {
      throw new Error('Telegram client is not connected');
    }

    // Remove any previous handler so repeated calls don't stack duplicates
    if (this.messageHandler) {
      try {
        this.client.removeEventHandler(this.messageHandler, new NewMessage({ incoming: true }));
      } catch (e) {
        logger.warn({ e }, 'Failed to remove previous Telegram handler');
      }
      this.messageHandler = null;
    }

    const handler = (event: any) => {
      const message = event.message;
      if (!message.peerId) return;

      // Extract channel ID, keeping it simple for now
      // GramJS handles peer ID differently depending on Chat/Channel/User
      let channelId = '';
      if (message.peerId.className === 'PeerChannel') {
        channelId = message.peerId.channelId?.toString() || '';
      } else if (message.peerId.className === 'PeerChat') {
        channelId = message.peerId.chatId?.toString() || '';
      }

      if (channelIds.includes(channelId)) {
        const rawMessage: RawTelegramMessage = {
          channelId,
          messageId: message.id.toString(),
          timestamp: new Date(message.date * 1000),
          text: message.message || '',
          edited: false,
        };

        logger.info({ channelId, messageId: rawMessage.messageId }, 'Received Telegram message');
        onMessage(rawMessage);
      }
    };

    this.messageHandler = handler;
    this.client.addEventHandler(handler, new NewMessage({ incoming: true }));

    logger.info({ channels: channelIds.length }, 'Subscribed to Telegram channels');
  }

  private photoCache: Map<string, string | null> = new Map();

  async getChannelPhoto(peer: string): Promise<string | null> {
    if (!this.client || this.state !== 'CONNECTED') return null;
    
    if (this.photoCache.has(peer)) {
      return this.photoCache.get(peer)!;
    }
    
    try {
      // Use isBigInt to safely parse channel IDs if they start with -100
      let peerId: any = peer;
      if (peer.startsWith('-100')) {
        try {
          peerId = tg.helpers.returnBigInt(peer);
        } catch {
          // Not a valid -100 prefixed big int; fall back to raw string peer
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
