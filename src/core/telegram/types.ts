export type RawTelegramMessage = {
  channelId: string;
  messageId: string;
  timestamp: Date;
  text: string;
  edited: boolean;
};

export interface TelegramConfig {
  apiId: number;
  apiHash: string;
  sessionString?: string;
}

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR' | 'OFFLINE';

export interface TelegramChannelInfo {
  id: string;
  title: string;
  username?: string;
  type: 'channel' | 'group';
}
