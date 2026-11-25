import { describe, it, expect, vi, afterEach } from 'vitest';
import { MT5Adapter } from './mt5-adapter';

/** Stubs the bridge's /symbols endpoint with the given broker names. */
function stubSymbols(names: string[]) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ success: true, symbols: names }), { status: 200 })
  ));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MT5Adapter.resolveSymbol', () => {
  it('maps a case/suffix variant to the broker name', async () => {
    stubSymbols(['XAUUSDm', 'XAUUSDm.pro']);
    expect(await new MT5Adapter().resolveSymbol('XAUUSD')).toBe('XAUUSDm');
  });

  it('refuses to guess between equally close instruments', async () => {
    stubSymbols(['BTCUSD', 'BTCEUR', 'BTCUSDT']);
    expect(await new MT5Adapter().resolveSymbol('BTC')).toBe('BTC');
  });

  it('prefers an exact match over suffixed variants', async () => {
    stubSymbols(['BTCUSD', 'BTCEUR']);
    expect(await new MT5Adapter().resolveSymbol('btcusd')).toBe('BTCUSD');
  });
});
