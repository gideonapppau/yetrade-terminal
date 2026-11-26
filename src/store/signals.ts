import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UiSignal {
  id: string;
  time: string;
  source: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entry?: number;
  sl: number;
  tp: number;
  rr: number;
  decision: 'APPROVED' | 'REJECTED';
  outcome?: 'EXECUTED' | 'MISSED';
  reason?: string;
  raw: string;
  /** Instant-entry lifecycle badge: armed = awaiting provider levels. */
  provisional?: 'ARMED' | 'ADJUSTED';
  /** Lots actually sent to the broker (after rounding to the broker's step). */
  lots?: number;
  /** Money actually at risk for those lots at the posted stop. */
  riskAmount?: number;
  validation: { text: string; status: boolean }[];
}

interface SignalState {
  signals: UiSignal[];
  addSignal: (signal: UiSignal) => void;
  updateSignal: (id: string, updates: Partial<UiSignal>) => void;
  clearSignals: () => void;
}

/** Upper bound on persisted signals so localStorage cannot grow forever. */
const MAX_PERSISTED_SIGNALS = 200;

export const useSignalStore = create<SignalState>()(
  persist(
    (set) => ({
      signals: [],
      addSignal: (signal) =>
        set((state) =>
          state.signals.some((s) => s.id === signal.id)
            ? state
            : { signals: [signal, ...state.signals].slice(0, MAX_PERSISTED_SIGNALS) }
        ),
      updateSignal: (id, updates) => 
        set((state) => ({
          signals: state.signals.map((s) => s.id === id ? { ...s, ...updates } : s)
        })),
      clearSignals: () => set({ signals: [] }),
    }),
    {
      name: 'yettrade-signals-storage',
    }
  )
);
