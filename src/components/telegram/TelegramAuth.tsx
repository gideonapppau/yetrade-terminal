import { useState } from 'react';
import { useTelegramStore } from '../../store/telegram';
import { TelegramAdapter } from '../../core/telegram/client';
import type { TelegramConfig } from '../../core/telegram/types';
import { Activity } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
export function TelegramAuth() {
  const { connectionState, setConnectionState, setConfig } = useTelegramStore();
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'ID_HASH' | 'PHONE' | 'CODE_PASSWORD'>('ID_HASH');
  const [error, setError] = useState<string | null>(null);

  const [codeResolver, setCodeResolver] = useState<(code: string) => void>();
  const [passwordResolver, setPasswordResolver] = useState<(pass: string) => void>();

  const startAuth = async () => {
    try {
      if (!apiId || isNaN(parseInt(apiId))) {
        throw new Error("Please enter a valid numeric API ID");
      }
      if (!apiHash.trim()) {
        throw new Error("Please enter your API Hash");
      }
      if (!phoneNumber.trim()) {
        throw new Error("Please enter your Phone Number");
      }

      setError(null);
      const conf: TelegramConfig = { apiId: parseInt(apiId), apiHash: apiHash.trim() };
      setConfig(conf);
      const newAdapter = new TelegramAdapter(conf);
      setConnectionState('CONNECTING');

      const sessionString = await newAdapter.connect(
        async () => {
          setStep('PHONE');
          return new Promise<string>((resolve) => resolve(phoneNumber));
        },
        async () => {
          setStep('CODE_PASSWORD');
          return new Promise<string>((resolve) => setCodeResolver(() => resolve));
        },
        async () => {
          return new Promise<string>((resolve) => setPasswordResolver(() => resolve));
        }
      );

      const me = await newAdapter.getMe() as any;
      useTelegramStore.getState().setProfile({
        firstName: me.firstName,
        lastName: me.lastName,
        username: me.username
      });
      useTelegramStore.getState().setClient(newAdapter);

      setConfig({ ...conf, sessionString });
      setConnectionState('CONNECTED');
    } catch (err: any) {
      setConnectionState('DISCONNECTED');
      setError(err.message || 'Connection failed. Please check your API ID and Hash.');
    }
  };

  const submitPhone = () => {
    startAuth();
  };

  const submitCode = () => {
    if (codeResolver) codeResolver(code);
    if (passwordResolver) passwordResolver(password);
  };

  if (connectionState === 'CONNECTED') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="card p-8 text-center max-w-sm w-full">
          <div className="w-12 h-12 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto mb-4">
            <Activity size={24} />
          </div>
          <h2 className="text-lg font-medium mb-2">Session Active</h2>
          <p className="text-secondary text-sm mb-6">Successfully connected to Telegram.</p>
          <button onClick={() => window.location.reload()} className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Continue to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-8 shadow-xl">
        
        <div className="mb-8">
          <h1 className="text-xl font-bold mb-1">Connect Telegram</h1>
          <p className="text-secondary text-sm">Enter your credentials to link your account.</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-destructive/10 text-destructive text-sm rounded border border-destructive/20">
            {error}
          </div>
        )}

        {step === 'ID_HASH' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">API ID</label>
              <input 
                type="text" 
                className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                value={apiId}
                onChange={e => setApiId(e.target.value)}
                placeholder="1234567"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1 flex justify-between items-center">
                API Hash
                <div className="relative group flex items-center">
                  <span className="text-accent text-xs font-normal hover:underline cursor-help">Get from Telegram</span>
                  <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-elevated border border-border rounded-lg shadow-xl text-xs text-secondary z-50 normal-case">
                    Log in to <span className="text-primary font-medium">https://my.telegram.org</span>, go to <span className="text-primary font-medium">'API development tools'</span>, and copy your App api_hash.
                  </div>
                </div>
              </label>
              <input 
                type="password" 
                className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                value={apiHash}
                onChange={e => setApiHash(e.target.value)}
                placeholder="0123456789abcdef"
              />
            </div>
            
            <div className="pt-2">
              <label className="block text-sm font-medium mb-1">Phone Number</label>
              <PhoneInput 
                international
                defaultCountry="US"
                value={phoneNumber}
                onChange={(value) => setPhoneNumber(value || '')}
                className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus-within:border-accent custom-phone-input"
              />
            </div>
            
            <button 
              className="w-full mt-4 bg-primary text-primary-foreground py-2 rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={submitPhone}
              disabled={connectionState === 'CONNECTING'}
            >
              {connectionState === 'CONNECTING' ? 'Connecting...' : 'Continue'}
            </button>
          </div>
        )}

        {step === 'CODE_PASSWORD' && (
          <div className="space-y-4">
            <p className="text-sm text-secondary mb-4">
              A code was sent to {phoneNumber}.
            </p>
            
            <div>
              <label className="block text-sm font-medium mb-1">Verification Code</label>
              <input 
                type="text" 
                className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent tracking-widest text-center"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="12345"
                autoFocus
              />
            </div>
            
            <div className="pt-2">
              <label className="block text-sm font-medium mb-1">2FA Password (Optional)</label>
              <input 
                type="password" 
                className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Leave blank if disabled"
              />
            </div>
            
            <button 
              className="w-full mt-4 bg-primary text-primary-foreground py-2 rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors"
              onClick={submitCode}
            >
              Verify
            </button>
          </div>
        )}
        
      </div>
    </div>
  );
}
