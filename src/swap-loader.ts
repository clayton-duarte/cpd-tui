import { existsSync } from 'node:fs';
import type { SwapModule } from './swap-contract.ts';
import { createFakeSwap } from './swap-fake.ts';

/**
 * Resolve the swap module to use: the real src/swap.ts (T4) when it exists and
 * CPD_FAKE_SWAP is not forced, otherwise the fake.
 */
export async function loadSwap(): Promise<SwapModule> {
  const useFake = process.env.CPD_FAKE_SWAP === '1';
  if (!useFake) {
    const realPath = new URL('./swap.ts', import.meta.url);
    if (existsSync(realPath)) {
      const mod = (await import(realPath.href)) as SwapModule;
      return mod;
    }
  }
  return createFakeSwap();
}
