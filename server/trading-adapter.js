export function buildOrderIntent({ side, chain, native, token, pair, address, tokenAmount, nativeAmount, usdAmount, reason, sourceUrl }) {
  return {
    mode: process.env.EXECUTION_MODE || "paper",
    side,
    chain,
    native,
    token,
    pair,
    address,
    tokenAmount,
    nativeAmount,
    usdAmount,
    reason,
    sourceUrl,
    createdAt: new Date().toISOString()
  };
}

export async function executeOrderIntent(intent) {
  if (intent.mode !== "paper") {
    throw new Error(`EXECUTION_MODE=${intent.mode} is not implemented. Add exchange/wallet API integration here.`);
  }
  return {
    ...intent,
    status: "simulated",
    executedAt: new Date().toISOString()
  };
}
