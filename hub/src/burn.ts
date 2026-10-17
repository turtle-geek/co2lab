// Burn-o-meter estimates. These are simple published-figure constants, not measurements.
//
// Cost: USD per 1M tokens (input / output) by model tier, close to Google's list prices for the
//   Gemini Flash-Lite / Flash / Pro class models. Override with GEMINI_PRICE_<TIER>=in,out in .env.
// Energy: Google reported (Aug 2025) the median Gemini Apps text prompt uses about 0.24 Wh and
//   emits about 0.03 gCO2e. We treat a "median prompt" as ~1,000 tokens and scale by tier
//   (lite 0.4x, flash 1x, pro 4x). Emissions use the same ratio: 0.03 g / 0.24 Wh = 0.125 gCO2e per Wh.
//   Device-side energy (phone, laptop) is not included.

import type { Burn, ModelTier } from "@co2lab/shared";

function price(tier: ModelTier, fallback: [number, number]): [number, number] {
  const raw = process.env[`GEMINI_PRICE_${tier.toUpperCase()}`];
  if (!raw) return fallback;
  const [a, b] = raw.split(",").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a!, b!] : fallback;
}

export const PRICE_PER_MTOK: Record<ModelTier, [number, number]> = {
  lite: price("lite", [0.1, 0.4]),
  flash: price("flash", [0.3, 2.5]),
  pro: price("pro", [1.25, 10]),
};

export const WH_PER_1K_TOKENS: Record<ModelTier, number> = { lite: 0.096, flash: 0.24, pro: 0.96 };
export const G_CO2_PER_WH = 0.125;

export const emptyBurn = (): Burn => ({ tokensIn: 0, tokensOut: 0, costUsd: 0, energyWh: 0, gCo2: 0 });

export function burnFor(tier: ModelTier, tokensIn: number, tokensOut: number): Burn {
  const [pin, pout] = PRICE_PER_MTOK[tier];
  const energyWh = ((tokensIn + tokensOut) / 1000) * WH_PER_1K_TOKENS[tier];
  return {
    tokensIn,
    tokensOut,
    costUsd: (tokensIn * pin + tokensOut * pout) / 1_000_000,
    energyWh,
    gCo2: energyWh * G_CO2_PER_WH,
  };
}

export function addBurn(a: Burn, b: Burn): Burn {
  return {
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    costUsd: round(a.costUsd + b.costUsd, 6),
    energyWh: round(a.energyWh + b.energyWh, 4),
    gCo2: round(a.gCo2 + b.gCo2, 4),
  };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
