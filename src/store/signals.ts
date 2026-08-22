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
  validation: { text: string; status: boolean }[];
}

interface SignalState {
  signals: UiSignal[];
  addSignal: (signal: UiSignal) => void;
  clearSignals: () => void;
}

export const useSignalStore = create<SignalState>()(
  persist(
    (set) => ({
      signals: [],
      addSignal: (signal) =>
        set((state) =>
          state.signals.some((s) => s.id === signal.id)
            ? state
            : { signals: [signal, ...state.signals] }
        ),
      clearSignals: () => set({ signals: [] }),
    }),
    {
      name: 'yettrade-signals-storage',
    }
  )
);
