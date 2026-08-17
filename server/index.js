import fs from "fs/promises";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { buildOrderIntent } from "./trading-adapter.js";

const server = http.createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");

  try {
    if (req.url === "/api/paper-trades.csv") {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", "attachment; filename=paper-trades.csv");
      res.end(paperTradesCsv());
      return;
    }

    if (req.url === "/api/executions.csv") {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", "attachment; filename=executions.csv");
      res.end(executionsCsv());
      return;
    }

    res.setHeader("content-type", "application/json; charset=utf-8");

    if (req.url === "/api/health") {
      res.end(JSON.stringify({ ok: Boolean(lastSnapshot), mode: "真实数据", source: lastSnapshot?.source, error: lastError, paperTrades: paperTradeSummary() }));
      return;
    }

    if (req.url === "/api/snapshot") {
      res.end(JSON.stringify(await refreshSnapshot()));
      return;
    }

    if (req.url === "/api/paper-trades") {
      res.end(JSON.stringify(paperTradeSummary()));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message }));
  }
});
const wss = new WebSocketServer({ server, path: "/ws" });
const port = process.env.PORT || 8787;
const REFRESH_MS = 90_000;
const CACHE_TTL_MS = 60_000;
const ZERO_AFTER_MISSED_UPDATES = 12;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || __dirname;
const tradeLogPath = path.join(dataDir, "sol-bsc-strategy-v2.json");

const CHAIN_CONFIG = {
  bsc: { native: "BNB", startingBalance: 100, buySize: 0.1 },
  solana: { native: "SOL", startingBalance: 100, buySize: 0.1 }
};
const TAKE_PROFIT_TIERS = [
  { multiple: 3, sellPct: 0.5, type: "SELL_3X_50", reason: "盈利 3x 卖出 50%" },
  { multiple: 100, sellPct: 0.25, type: "SELL_100X_25", reason: "盈利 100x 卖出 25%" },
  { multiple: 1000, sellPct: 0.25, type: "SELL_1000X_25", reason: "盈利 1000x 卖出 25%" }
];

let lastSnapshot = null;
let lastError = null;
let refreshPromise = null;
let strategyBook = createStrategyBook();
let lastFetchAt = 0;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ageMinutes(dateValue) {
  const timestamp = new Date(dateValue).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function multiplier(entry, current) {
  if (entry <= 0) return 1;
  if (current <= 0) return 0;
  return current / entry;
}

function formatMultiplier(value) {
  return `${Number(value || 1).toFixed(2)}x`;
}

async function loadPaperTrades() {
  try {
    strategyBook = normalizeStrategyBook(JSON.parse(await fs.readFile(tradeLogPath, "utf8")));
  } catch {
    strategyBook = createStrategyBook();
  }
}

async function savePaperTrades() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(tradeLogPath, JSON.stringify(strategyBook, null, 2));
}

function createStrategyBook() {
  return {
    version: 2,
    strategy: {
      name: "SOL+BSC 0.1 native / 3x sell half / -50% stop",
      chains: {
        bsc: { native: "BNB", startingBalance: 100, buySize: 0.1 },
        solana: { native: "SOL", startingBalance: 100, buySize: 0.1 }
      },
      takeProfitTiers: TAKE_PROFIT_TIERS.map(({ multiple, sellPct }) => ({ multiple, sellPct })),
      stopLossMultiple: 0.5
    },
    balances: {
      bsc: { native: "BNB", starting: 100, available: 100, realized: 0 },
      solana: { native: "SOL", starting: 100, available: 100, realized: 0 }
    },
    positions: [],
    executions: []
  };
}

function normalizeStrategyBook(book) {
  const base = createStrategyBook();
  const positions = Array.isArray(book.positions)
    ? book.positions.map((position) => ({
        soldTiers: position.soldTiers ?? (position.takeProfitSold ? { "3": true } : {}),
        missedUpdates: position.missedUpdates ?? 0,
        zeroDetected: position.zeroDetected ?? false,
        ...position
      }))
    : [];
  return {
    ...base,
    ...book,
    strategy: { ...base.strategy, ...(book.strategy ?? {}), takeProfitTiers: book.strategy?.takeProfitTiers ?? base.strategy.takeProfitTiers },
    balances: {
      bsc: { ...base.balances.bsc, ...(book.balances?.bsc ?? {}) },
      solana: { ...base.balances.solana, ...(book.balances?.solana ?? {}) }
    },
    positions,
    executions: Array.isArray(book.executions) ? book.executions : []
  };
}

function qualifiesForPaperBuy(token) {
  return (
    (token.chain === "bsc" || token.chain === "solana") &&
    token.priceUsd > 0 &&
    token.alphaScore >= 60 &&
    token.riskScore <= 55 &&
    token.volumeAcceleration >= 0.8 &&
    token.buyPressure >= 45 &&
    token.liquidity >= 2_000
  );
}

function paperBuyReason(token) {
  const parts = [`${token.chain === "bsc" ? "BSC" : "SOL"}`, `Alpha ${token.alphaScore}`, `风险 ${token.riskScore}`, `成交加速 ${token.volumeAcceleration}x`, `买压 ${token.buyPressure}%`];
  if (token.mc > 0) parts.push(`市值 $${Math.round(token.mc).toLocaleString("en-US")}`);
  return parts.join(" · ");
}

async function updatePaperTrades(tokens, nativePrices = {}) {
  const now = new Date().toISOString();
  const openPrices = await fetchOpenPositionPrices();
  const tokenMap = new Map([...tokens, ...openPrices.tokens].map((token) => [token.address, token]));
  const missingMap = openPrices.missing;
  let changed = false;

  for (const trade of strategyBook.positions) {
    if (trade.status !== "持仓中") continue;
    const token = tokenMap.get(trade.address);
    const nativeUsd = nativePrices[trade.chain] || trade.nativePriceUsd;
    if (!nativeUsd) continue;
    if (!token?.priceUsd || token.priceUsd <= 0 || token.liquidity <= 0 || missingMap.has(trade.address)) {
      trade.missedUpdates = (trade.missedUpdates || 0) + 1;
      if (missingMap.has(trade.address) || token?.priceUsd <= 0 || token?.liquidity <= 0 || trade.missedUpdates >= ZERO_AFTER_MISSED_UPDATES) {
        closePositionAtZero(trade, now, nativeUsd, missingMap.has(trade.address) ? "交易对消失，按归零清仓" : "价格/流动性归零，清仓");
        changed = true;
      }
      continue;
    }
    trade.missedUpdates = 0;
    const currentMultiple = multiplier(trade.entryPriceUsd, token.priceUsd);
    const remainingValueUsd = trade.remainingTokenAmount * token.priceUsd;
    trade.currentPriceUsd = token.priceUsd;
    trade.nativePriceUsd = nativeUsd;
    trade.currentMc = token.mc;
    trade.currentMultiple = Number(currentMultiple.toFixed(4));
    trade.remainingValueNative = Number((remainingValueUsd / nativeUsd).toFixed(8));
    trade.remainingValueUsd = Number(remainingValueUsd.toFixed(6));
    if (currentMultiple > trade.maxMultiple) {
      trade.maxMultiple = Number(currentMultiple.toFixed(4));
      trade.maxPriceUsd = token.priceUsd;
      trade.maxAt = now;
    }
    trade.lastSeenAt = now;
    trade.lastAlphaScore = token.alphaScore;
    trade.lastRiskScore = token.riskScore;
    trade.soldTiers = trade.soldTiers ?? {};
    for (const tier of TAKE_PROFIT_TIERS) {
      if (currentMultiple >= tier.multiple && !trade.soldTiers[String(tier.multiple)] && trade.remainingTokenAmount > 0) {
        sellPositionPortion(trade, token, now, nativeUsd, tier);
      }
    }
    if (trade.remainingTokenAmount <= 0 && trade.status === "持仓中") {
      trade.status = "已止盈完成";
      trade.exitAt = now;
      trade.exitReason = "3x/100x/1000x 分批止盈完成";
    }

    if (currentMultiple <= 0.5 && trade.remainingTokenAmount > 0) {
      closePositionAtMarket(trade, token, now, nativeUsd, "亏损 50% 清仓");
    }
    changed = true;
  }

  const knownAddresses = new Set(strategyBook.positions.map((trade) => trade.address));
  const candidates = tokens
    .filter((token) => qualifiesForPaperBuy(token) && !knownAddresses.has(token.address))
    .filter((token) => strategyBook.balances[token.chain]?.available >= CHAIN_CONFIG[token.chain].buySize)
    .slice(0, 6);

  for (const token of candidates) {
    const cfg = CHAIN_CONFIG[token.chain];
    const nativeUsd = nativePrices[token.chain];
    if (!nativeUsd) continue;
    const spendNative = cfg.buySize;
    const spendUsd = spendNative * nativeUsd;
    const tokenAmount = spendUsd / token.priceUsd;
    const position = {
      id: `${token.address}-${Date.now()}`,
      chain: token.chain,
      native: cfg.native,
      token: token.token,
      pair: token.pair,
      address: token.address,
      dex: token.dex,
      sourceUrl: token.sourceUrl,
      status: "持仓中",
      entryAt: now,
      lastSeenAt: now,
      entryNativeSpent: spendNative,
      entryUsdSpent: Number(spendUsd.toFixed(6)),
      nativePriceUsd: nativeUsd,
      initialTokenAmount: Number(tokenAmount.toFixed(12)),
      remainingTokenAmount: Number(tokenAmount.toFixed(12)),
      entryPriceUsd: token.priceUsd,
      currentPriceUsd: token.priceUsd,
      maxPriceUsd: token.priceUsd,
      entryMc: token.mc,
      currentMc: token.mc,
      entryAlphaScore: token.alphaScore,
      entryRiskScore: token.riskScore,
      lastAlphaScore: token.alphaScore,
      lastRiskScore: token.riskScore,
      volumeAcceleration: token.volumeAcceleration,
      buyPressure: token.buyPressure,
      currentMultiple: 1,
      maxMultiple: 1,
      takeProfitSold: false,
      realizedNative: 0,
      realizedUsd: 0,
      remainingValueNative: spendNative,
      remainingValueUsd: Number(spendUsd.toFixed(6)),
      maxAt: now,
      reason: paperBuyReason(token)
    };
    strategyBook.positions.unshift(position);
    strategyBook.balances[token.chain].available = Number((strategyBook.balances[token.chain].available - spendNative).toFixed(8));
    strategyBook.executions.unshift(buildExecution("BUY", position, token, now, position.initialTokenAmount, spendNative, spendUsd, nativeUsd, "发现机会买入 0.1 " + cfg.native));
    changed = true;
  }

  if (changed) await savePaperTrades();
}

function buildExecution(type, position, token, timestamp, tokenAmount, nativeAmount, usdAmount, nativePriceUsd, reason) {
  const side = type === "BUY" ? "buy" : "sell";
  const orderIntent = buildOrderIntent({
    side,
    chain: position.chain,
    native: position.native,
    token: position.token,
    pair: position.pair,
    address: position.address,
    tokenAmount: Number(tokenAmount.toFixed(12)),
    nativeAmount: Number(nativeAmount.toFixed(8)),
    usdAmount: Number(usdAmount.toFixed(6)),
    reason,
    sourceUrl: position.sourceUrl
  });
  return {
    id: `${type}-${position.address}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    positionId: position.id,
    type,
    chain: position.chain,
    native: position.native,
    token: position.token,
    pair: position.pair,
    address: position.address,
    dex: position.dex,
    timestamp,
    tokenPriceUsd: token.priceUsd,
    nativePriceUsd,
    tokenAmount: Number(tokenAmount.toFixed(12)),
    nativeAmount: Number(nativeAmount.toFixed(8)),
    usdAmount: Number(usdAmount.toFixed(6)),
    multipleAtExecution: Number(multiplier(position.entryPriceUsd, token.priceUsd).toFixed(4)),
    reason,
    sourceUrl: position.sourceUrl,
    executionMode: orderIntent.mode,
    orderIntent
  };
}

function sellPositionPortion(trade, token, now, nativeUsd, tier) {
  const targetTokenAmount = trade.initialTokenAmount * tier.sellPct;
  const sellTokenAmount = Math.min(trade.remainingTokenAmount, targetTokenAmount);
  if (sellTokenAmount <= 0) return;
  const proceedsUsd = sellTokenAmount * token.priceUsd;
  const proceedsNative = proceedsUsd / nativeUsd;
  trade.remainingTokenAmount = Number((trade.remainingTokenAmount - sellTokenAmount).toFixed(12));
  trade.realizedNative = Number((trade.realizedNative + proceedsNative).toFixed(8));
  trade.realizedUsd = Number((trade.realizedUsd + proceedsUsd).toFixed(6));
  trade.remainingValueUsd = Number((trade.remainingTokenAmount * token.priceUsd).toFixed(6));
  trade.remainingValueNative = Number((trade.remainingValueUsd / nativeUsd).toFixed(8));
  trade.soldTiers[String(tier.multiple)] = true;
  strategyBook.balances[trade.chain].available = Number((strategyBook.balances[trade.chain].available + proceedsNative).toFixed(8));
  strategyBook.balances[trade.chain].realized = Number((strategyBook.balances[trade.chain].realized + proceedsNative).toFixed(8));
  strategyBook.executions.unshift(buildExecution(tier.type, trade, token, now, sellTokenAmount, proceedsNative, proceedsUsd, nativeUsd, tier.reason));
}

function closePositionAtMarket(trade, token, now, nativeUsd, reason) {
  const sellTokenAmount = trade.remainingTokenAmount;
  const proceedsUsd = sellTokenAmount * token.priceUsd;
  const proceedsNative = nativeUsd > 0 ? proceedsUsd / nativeUsd : 0;
  trade.remainingTokenAmount = 0;
  trade.remainingValueUsd = 0;
  trade.remainingValueNative = 0;
  trade.status = "已止损";
  trade.exitAt = now;
  trade.exitReason = reason;
  trade.realizedNative = Number((trade.realizedNative + proceedsNative).toFixed(8));
  trade.realizedUsd = Number((trade.realizedUsd + proceedsUsd).toFixed(6));
  strategyBook.balances[trade.chain].available = Number((strategyBook.balances[trade.chain].available + proceedsNative).toFixed(8));
  strategyBook.balances[trade.chain].realized = Number((strategyBook.balances[trade.chain].realized + proceedsNative).toFixed(8));
  strategyBook.executions.unshift(buildExecution("SELL_STOP_LOSS", trade, token, now, sellTokenAmount, proceedsNative, proceedsUsd, nativeUsd, reason));
}

function closePositionAtZero(trade, now, nativeUsd, reason) {
  const zeroToken = { ...trade, priceUsd: 0 };
  trade.currentPriceUsd = 0;
  trade.currentMultiple = 0;
  trade.remainingValueUsd = 0;
  trade.remainingValueNative = 0;
  trade.zeroDetected = true;
  trade.status = "已归零";
  trade.exitAt = now;
  trade.exitReason = reason;
  strategyBook.executions.unshift(buildExecution("SELL_ZERO", trade, zeroToken, now, trade.remainingTokenAmount, 0, 0, nativeUsd, reason));
  trade.remainingTokenAmount = 0;
}

function paperTradeSummary() {
  const stats = paperTradeStats();
  const open = strategyBook.positions.filter((trade) => trade.status === "持仓中");
  const best = strategyBook.positions.reduce((winner, trade) => (trade.maxMultiple > (winner?.maxMultiple ?? 0) ? trade : winner), null);
  return {
    strategy: strategyBook.strategy,
    portfolio: portfolioSummary(),
    total: strategyBook.positions.length,
    open: open.length,
    bestMultiple: Number((best?.maxMultiple ?? 1).toFixed(4)),
    bestToken: best?.token ?? "-",
    bestTradeId: best?.id ?? null,
    stats,
    trades: strategyBook.positions.map((trade) => ({
      ...trade,
      currentMultipleText: formatMultiplier(trade.currentMultiple),
      maxMultipleText: formatMultiplier(trade.maxMultiple)
    })),
    executions: strategyBook.executions
  };
}

function paperTradeStats() {
  const positions = strategyBook.positions;
  const total = positions.length;
  const open = positions.filter((trade) => trade.status === "持仓中");
  const closed = positions.filter((trade) => trade.status !== "持仓中");
  const currentPnls = positions.map((trade) => positionReturnNative(trade));
  const maxPnls = positions.map((trade) => number(trade.maxMultiple, 1) - 1);
  const winners = positions.filter((trade) => positionReturnNative(trade) > 0);
  const winners3x = positions.filter((trade) => number(trade.maxMultiple, 1) >= 3);
  const winners100x = positions.filter((trade) => number(trade.maxMultiple, 1) >= 100);
  const winners1000x = positions.filter((trade) => number(trade.maxMultiple, 1) >= 1000);
  const losers = positions.filter((trade) => positionReturnNative(trade) < 0);
  const sum = (values) => values.reduce((acc, value) => acc + number(value), 0);
  const avg = (values, fallback = 0) => (values.length ? sum(values) / values.length : fallback);
  const best = positions.reduce((winner, trade) => (number(trade.maxMultiple, 1) > number(winner?.maxMultiple, 0) ? trade : winner), null);
  const worst = positions.reduce((loser, trade) => (positionReturnNative(trade) < positionReturnNative(loser ?? { entryNativeSpent: 1, realizedNative: Infinity, remainingValueNative: 0 }) ? trade : loser), null);
  const exitReasons = closed.reduce((acc, trade) => {
    const reason = trade.exitReason || "未知";
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const maxDrawdowns = positions.map((trade) => {
    const maxMultiple = number(trade.maxMultiple, 1);
    const currentMultiple = number(trade.currentMultiple, 1);
    return maxMultiple > 0 ? (maxMultiple - currentMultiple) / maxMultiple : 0;
  });

  return {
    total,
    open: open.length,
    closed: closed.length,
    winRate: total ? Number(((winners.length / total) * 100).toFixed(2)) : 0,
    lossRate: total ? Number(((losers.length / total) * 100).toFixed(2)) : 0,
    bigWinnerRate: total ? Number(((winners3x.length / total) * 100).toFixed(2)) : 0,
    winner3xCount: winners3x.length,
    winner100xCount: winners100x.length,
    winner1000xCount: winners1000x.length,
    winner3xRate: total ? Number(((winners3x.length / total) * 100).toFixed(2)) : 0,
    winner100xRate: total ? Number(((winners100x.length / total) * 100).toFixed(2)) : 0,
    winner1000xRate: total ? Number(((winners1000x.length / total) * 100).toFixed(2)) : 0,
    averageCurrentMultiple: Number(avg(positions.map((trade) => number(trade.currentMultiple, 1)), 1).toFixed(4)),
    averageMaxMultiple: Number(avg(positions.map((trade) => number(trade.maxMultiple, 1)), 1).toFixed(4)),
    totalUnrealizedReturnPct: Number((sum(currentPnls) * 100).toFixed(2)),
    averageUnrealizedReturnPct: Number((avg(currentPnls) * 100).toFixed(2)),
    averagePotentialReturnPct: Number((avg(maxPnls) * 100).toFixed(2)),
    maxDrawdownPct: Number((Math.max(0, ...maxDrawdowns) * 100).toFixed(2)),
    bestToken: best?.token ?? "-",
    bestMultiple: Number(number(best?.maxMultiple, 1).toFixed(4)),
    worstToken: worst?.token ?? "-",
    worstMultiple: Number(number(worst?.currentMultiple, 1).toFixed(4)),
    profitableNow: sum(currentPnls) > 0,
    exitReasons
  };
}

function positionReturnNative(trade) {
  const value = number(trade.realizedNative) + number(trade.remainingValueNative);
  return trade.entryNativeSpent > 0 ? value / trade.entryNativeSpent - 1 : 0;
}

function portfolioSummary() {
  const chains = Object.fromEntries(
    Object.entries(strategyBook.balances).map(([chain, balance]) => {
      const openValue = strategyBook.positions
        .filter((position) => position.chain === chain && position.status === "持仓中")
        .reduce((sum, position) => sum + number(position.remainingValueNative), 0);
      const totalNative = number(balance.available) + openValue;
      const pnlNative = totalNative - number(balance.starting);
      return [
        chain,
        {
          ...balance,
          openValueNative: Number(openValue.toFixed(8)),
          totalNative: Number(totalNative.toFixed(8)),
          pnlNative: Number(pnlNative.toFixed(8)),
          pnlPct: Number(((pnlNative / number(balance.starting, 1)) * 100).toFixed(2))
        }
      ];
    })
  );
  return { chains };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function paperTradesCsv() {
  const headers = [
    "id",
    "chain",
    "native",
    "token",
    "pair",
    "address",
    "dex",
    "status",
    "entryAt",
    "lastSeenAt",
    "exitAt",
    "entryPriceUsd",
    "currentPriceUsd",
    "maxPriceUsd",
    "entryMc",
    "currentMc",
    "entryAlphaScore",
    "entryRiskScore",
    "lastAlphaScore",
    "lastRiskScore",
    "volumeAcceleration",
    "buyPressure",
    "currentMultiple",
    "maxMultiple",
    "maxAt",
    "exitReason",
    "reason",
    "sourceUrl",
    "entryNativeSpent",
    "realizedNative",
    "remainingValueNative",
    "soldTiers",
    "missedUpdates",
    "zeroDetected",
    "isProfitable",
    "unrealizedReturnPct",
    "maxReturnPct",
    "drawdownFromPeakPct"
  ];
  const enriched = strategyBook.positions.map((trade) => {
    const currentMultiple = number(trade.currentMultiple, 1);
    const maxMultiple = number(trade.maxMultiple, 1);
    const ret = positionReturnNative(trade);
    return {
      ...trade,
      soldTiers: Object.keys(trade.soldTiers ?? {}).join("|"),
      isProfitable: ret > 0,
      unrealizedReturnPct: Number((ret * 100).toFixed(2)),
      maxReturnPct: Number(((maxMultiple - 1) * 100).toFixed(2)),
      drawdownFromPeakPct: Number((maxMultiple > 0 ? ((maxMultiple - currentMultiple) / maxMultiple) * 100 : 0).toFixed(2))
    };
  });
  const rows = enriched.map((trade) => headers.map((key) => csvEscape(trade[key])).join(","));
  return [headers.join(","), ...rows].join("\n");
}

function executionsCsv() {
  const headers = [
    "id",
    "positionId",
    "type",
    "chain",
    "native",
    "token",
    "pair",
    "address",
    "dex",
    "timestamp",
    "tokenPriceUsd",
    "nativePriceUsd",
    "tokenAmount",
    "nativeAmount",
    "usdAmount",
    "multipleAtExecution",
    "executionMode",
    "reason",
    "sourceUrl"
  ];
  const rows = strategyBook.executions.map((execution) => headers.map((key) => csvEscape(execution[key])).join(","));
  return [headers.join(","), ...rows].join("\n");
}

async function fetchJson(url, retries = 2) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "BSC-Early-Alpha-Radar/0.1"
        }
      });
      if (res.status === 429) throw new Error("429 Too Many Requests");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (error) {
      last = error;
      if (String(error.message).includes("429")) break;
      await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
    }
  }
  throw last;
}

function buildIncludedMap(included = []) {
  return new Map(included.map((item) => [item.id, item]));
}

function tokenFromRelationship(pool, includedMap, key) {
  const id = pool.relationships?.[key]?.data?.id;
  return id ? includedMap.get(id)?.attributes : null;
}

async function fetchPoolTrades(address) {
  try {
    const json = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/bsc/pools/${address}/trades`, 1);
    return json.data?.slice(0, 35) ?? [];
  } catch {
    return [];
  }
}

async function fetchOhlcv(address) {
  try {
    const json = await fetchJson(
      `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${address}/ohlcv/minute?aggregate=1&limit=30`,
      1
    );
    return json.data?.attributes?.ohlcv_list ?? [];
  } catch {
    return [];
  }
}

function buildSeriesFromOhlcv(ohlcv, fallbackValue) {
  if (!ohlcv.length) {
    return [{ t: "当前", value: Math.max(0, Math.round(fallbackValue)) }];
  }
  return ohlcv
    .slice()
    .reverse()
    .map((row) => ({
      t: new Date(row[0] * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      value: number(row[4])
    }));
}

function buildFlowFromOhlcv(ohlcv, fallbackValue) {
  if (!ohlcv.length) {
    return [{ t: "当前", value: Math.max(0, Math.round(fallbackValue)) }];
  }
  return ohlcv
    .slice()
    .reverse()
    .map((row) => ({
      t: new Date(row[0] * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      value: number(row[5])
    }));
}

function narrativeFor(symbol, name = "") {
  const text = `${symbol} ${name}`.toLowerCase();
  const rules = [
    ["AI", ["ai", "gpt", "agent", "gpu", "compute"]],
    ["BNB/CZ", ["bnb", "cz", "binance", "pancake"]],
    ["USD/Stable", ["usd", "usdt", "usdc"]],
    ["Animal Meme", ["dog", "cat", "frog", "shib", "pepe"]],
    ["Chinese Meme", ["牛", "龙", "币", "财", "狗"]]
  ];
  return rules.find(([, words]) => words.some((word) => text.includes(word)))?.[0] ?? "Meme/新池";
}

async function fetchNativePrices() {
  try {
    const json = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=solana,binancecoin&vs_currencies=usd", 1);
    return {
      solana: number(json.solana?.usd),
      bsc: number(json.binancecoin?.usd)
    };
  } catch {
    return { solana: 0, bsc: 0 };
  }
}

function scorePool({ age, fdv, liquidity, volumeM5, volumeH1, buysM5, sellsM5, buyersM5, sellersM5, priceM5 }) {
  const buyPressure = pct(buysM5, buysM5 + sellsM5);
  const holderGrowth = Math.max(0, buyersM5 - sellersM5);
  const volumeAcceleration = volumeH1 > 0 ? volumeM5 / Math.max(volumeH1 / 12, 1) : 0;
  const lowCapBoost = fdv > 0 && fdv < 250_000 ? 20 : fdv < 1_000_000 ? 10 : 0;
  const newBoost = age != null && age < 180 ? 18 : age != null && age < 1440 ? 8 : 0;
  const alphaScore = clamp(
    Math.round(volumeAcceleration * 12 + buyPressure * 0.28 + holderGrowth * 2 + number(priceM5) * 0.45 + lowCapBoost + newBoost),
    0,
    99
  );
  const riskScore = clamp(
    Math.round((liquidity < 10_000 ? 32 : liquidity < 50_000 ? 16 : 5) + (fdv < 15_000 ? 20 : 8) + (buyPressure > 90 ? 18 : 0) + (age != null && age < 60 ? 14 : 0)),
    0,
    99
  );
  return { alphaScore, riskScore, buyPressure, holderGrowth, volumeAcceleration };
}

function walletAddress(trade) {
  const attr = trade.attributes ?? {};
  return attr.tx_from_address || attr.from_address || attr.sender || attr.maker || attr.tx_hash || null;
}

function tradeKind(trade) {
  return String(trade.attributes?.kind ?? trade.attributes?.trade_type ?? "").toLowerCase();
}

function buildWalletSummary(tokensWithTrades) {
  const wallets = new Map();
  for (const token of tokensWithTrades) {
    for (const trade of token.trades) {
      const address = walletAddress(trade);
      if (!address) continue;
      const kind = tradeKind(trade);
      if (kind && !kind.includes("buy")) continue;
      const item = wallets.get(address) ?? { wallet: address, buys: [], volume: 0, trades: 0 };
      item.buys.push(token.token);
      item.volume += number(trade.attributes?.volume_in_usd);
      item.trades += 1;
      wallets.set(address, item);
    }
  }
  return [...wallets.values()]
    .filter((item) => new Set(item.buys).size > 1 || item.trades > 1 || item.volume > 500)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 8)
    .map((item) => ({
      wallet: `${item.wallet.slice(0, 6)}...${item.wallet.slice(-4)}`,
      winRate: null,
      pnl30d: `$${Math.round(item.volume).toLocaleString("en-US")}`,
      buys: [...new Set(item.buys)].slice(0, 4),
      conviction: item.trades > 2 ? "高频买入" : "重复出现"
    }));
}

function bondingLabel(age, reserve) {
  if (age == null) return { label: "已建池", value: 100 };
  if (age < 60) return { label: "新迁移 <1h", value: 100 };
  if (age < 360) return { label: "新池 <6h", value: 100 };
  return { label: reserve > 0 ? "Pancake/DEX 已建池" : "已建池", value: 100 };
}

async function fetchOpenPositionPrices() {
  const open = strategyBook.positions.filter((position) => position.status === "持仓中");
  const byChain = open.reduce((acc, position) => {
    if (!acc[position.chain]) acc[position.chain] = [];
    acc[position.chain].push(position.address);
    return acc;
  }, {});
  const tokens = [];
  const missing = new Set();

  for (const [chain, addresses] of Object.entries(byChain)) {
    const unique = [...new Set(addresses)];
    for (let index = 0; index < unique.length; index += 25) {
      const chunk = unique.slice(index, index + 25);
      try {
        const json = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${chunk.join(",")}`, 1);
        const pairs = (json.pairs ?? (json.pair ? [json.pair] : [])).filter(Boolean);
        const seen = new Set(pairs.map((pair) => pair.pairAddress));
        for (const address of chunk) {
          if (!seen.has(address)) missing.add(address);
        }
        tokens.push(...pairs.map(pairToToken).filter(Boolean));
      } catch {
        for (const address of chunk) {
          const position = open.find((item) => item.address === address);
          if (position) position.missedUpdates = (position.missedUpdates || 0) + 1;
        }
      }
    }
  }

  return { tokens, missing };
}

function pairToToken(pair) {
  if (!pair?.pairAddress) return null;
  const age = ageMinutes(pair.pairCreatedAt);
  const volumeM5 = number(pair.volume?.m5);
  const volumeH1 = number(pair.volume?.h1);
  const txM5 = pair.txns?.m5 ?? {};
  const fdv = number(pair.marketCap || pair.fdv);
  const liquidity = number(pair.liquidity?.usd);
  const scores = scorePool({
    age,
    fdv,
    liquidity,
    volumeM5,
    volumeH1,
    buysM5: number(txM5.buys),
    sellsM5: number(txM5.sells),
    buyersM5: number(txM5.buys),
    sellersM5: number(txM5.sells),
    priceM5: number(pair.priceChange?.m5)
  });
  const curve = bondingLabel(age, liquidity);
  return {
    id: pair.pairAddress,
    chain: pair.chainId === "solana" ? "solana" : "bsc",
    token: pair.baseToken?.symbol ?? "UNKNOWN",
    pair: `${pair.baseToken?.symbol ?? "UNKNOWN"}/${pair.quoteToken?.symbol ?? "QUOTE"}`,
    address: pair.pairAddress,
    dex: pair.dexId,
    mc: fdv,
    liquidity,
    ageMinutes: age,
    alphaScore: scores.alphaScore,
    riskScore: scores.riskScore,
    narrative: narrativeFor(pair.baseToken?.symbol, pair.baseToken?.name),
    smartMoney: 0,
    volumeAcceleration: Number(scores.volumeAcceleration.toFixed(2)),
    buyPressure: scores.buyPressure,
    holderGrowth: number(txM5.buys),
    bondingCurve: curve.value,
    bondingCurveLabel: curve.label,
    priceUsd: number(pair.priceUsd),
    priceChange5m: number(pair.priceChange?.m5),
    volume5m: volumeM5,
    volume1h: volumeH1,
    transactions5m: `${number(txM5.buys)}/${number(txM5.sells)}`,
    sourceUrl: pair.url,
    priceSeries: dexSeries(pair, "price"),
    mcSeries: dexSeries(pair, "mc"),
    flowSeries: [
      { t: "24h", value: number(pair.volume?.h24) },
      { t: "6h", value: number(pair.volume?.h6) },
      { t: "1h", value: volumeH1 },
      { t: "5m", value: volumeM5 }
    ],
    holders: [
      { name: "流动性", value: Math.round(liquidity) },
      { name: "5m成交", value: Math.round(volumeM5) },
      { name: "1h成交", value: Math.round(volumeH1) }
    ],
    wallets: [
      `真实池地址：${pair.pairAddress}`,
      `DEX：${pair.dexId}`,
      `5分钟买/卖笔数：${number(txM5.buys)} / ${number(txM5.sells)}`,
      "DexScreener 当前接口不返回钱包地址"
    ],
    timeline: [
      { t: "创建", event: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toLocaleString("zh-CN") : "未知" },
      { t: "5m", event: `成交量 $${Math.round(volumeM5).toLocaleString("en-US")}，价格变化 ${number(pair.priceChange?.m5).toFixed(2)}%` },
      { t: "实时", event: `买压 ${scores.buyPressure}%，Alpha ${scores.alphaScore}，Risk ${scores.riskScore}` }
    ]
  };
}

async function geckoSnapshot() {
  const [newPools, trendingPools] = await Promise.all([
    fetchJson("https://api.geckoterminal.com/api/v2/networks/bsc/new_pools?include=base_token,quote_token,dex&page=1"),
    fetchJson("https://api.geckoterminal.com/api/v2/networks/bsc/trending_pools?include=base_token,quote_token,dex&page=1&duration=5m")
  ]);
  const includedMap = buildIncludedMap([...(newPools.included ?? []), ...(trendingPools.included ?? [])]);
  const seen = new Set();
  const pools = [...(newPools.data ?? []), ...(trendingPools.data ?? [])]
    .filter((pool) => {
      const address = pool.attributes?.address;
      if (!address || seen.has(address)) return false;
      seen.add(address);
      return true;
    })
    .slice(0, 10);

  const topAddresses = pools.slice(0, 2).map((pool) => pool.attributes.address);
  const tradesByAddress = new Map(await Promise.all(topAddresses.map(async (address) => [address, await fetchPoolTrades(address)])));
  const ohlcvByAddress = new Map(await Promise.all(topAddresses.slice(0, 1).map(async (address) => [address, await fetchOhlcv(address)])));

  const tokens = pools.map((pool) => {
    const attr = pool.attributes;
    const base = tokenFromRelationship(pool, includedMap, "base_token");
    const quote = tokenFromRelationship(pool, includedMap, "quote_token");
    const dex = includedMap.get(pool.relationships?.dex?.data?.id)?.attributes?.name ?? pool.relationships?.dex?.data?.id ?? "DEX";
    const symbol = base?.symbol ?? attr.name?.split(" / ")?.[0] ?? "UNKNOWN";
    const quoteSymbol = quote?.symbol ?? attr.name?.split(" / ")?.[1] ?? "QUOTE";
    const fdv = number(attr.market_cap_usd || attr.fdv_usd);
    const liquidity = number(attr.reserve_in_usd);
    const volumeM5 = number(attr.volume_usd?.m5);
    const volumeH1 = number(attr.volume_usd?.h1);
    const txM5 = attr.transactions?.m5 ?? {};
    const age = ageMinutes(attr.pool_created_at);
    const scores = scorePool({
      age,
      fdv,
      liquidity,
      volumeM5,
      volumeH1,
      buysM5: number(txM5.buys),
      sellsM5: number(txM5.sells),
      buyersM5: number(txM5.buyers),
      sellersM5: number(txM5.sellers),
      priceM5: number(attr.price_change_percentage?.m5)
    });
    const trades = tradesByAddress.get(attr.address) ?? [];
    const smartSet = new Set(
      trades
        .filter((trade) => tradeKind(trade).includes("buy"))
        .map(walletAddress)
        .filter(Boolean)
    );
    const curve = bondingLabel(age, liquidity);
    const ohlcv = ohlcvByAddress.get(attr.address) ?? [];
    return {
      id: attr.address,
      chain: "bsc",
      token: symbol,
      pair: `${symbol}/${quoteSymbol}`,
      address: attr.address,
      dex,
      mc: fdv,
      liquidity,
      ageMinutes: age,
      alphaScore: scores.alphaScore,
      riskScore: scores.riskScore,
      narrative: narrativeFor(symbol, base?.name),
      smartMoney: smartSet.size,
      volumeAcceleration: Number(scores.volumeAcceleration.toFixed(2)),
      buyPressure: scores.buyPressure,
      holderGrowth: scores.holderGrowth,
      bondingCurve: curve.value,
      bondingCurveLabel: curve.label,
      priceUsd: number(attr.base_token_price_usd),
      priceChange5m: number(attr.price_change_percentage?.m5),
      volume5m: volumeM5,
      volume1h: volumeH1,
      transactions5m: `${number(txM5.buys)}/${number(txM5.sells)}`,
      sourceUrl: `https://www.geckoterminal.com/bsc/pools/${attr.address}`,
      priceSeries: buildSeriesFromOhlcv(ohlcv, number(attr.base_token_price_usd)),
      mcSeries: buildSeriesFromOhlcv(ohlcv, fdv),
      flowSeries: buildFlowFromOhlcv(ohlcv, volumeM5),
      holders: [
        { name: "流动性", value: Math.round(liquidity) },
        { name: "5m成交", value: Math.round(volumeM5) },
        { name: "1h成交", value: Math.round(volumeH1) }
      ],
      wallets: [
        `真实池地址：${attr.address}`,
        `DEX：${dex}`,
        `5分钟买/卖笔数：${number(txM5.buys)} / ${number(txM5.sells)}`,
        `池龄：${age == null ? "未知" : `${age} 分钟`}`
      ],
      timeline: [
        { t: "创建", event: attr.pool_created_at ? new Date(attr.pool_created_at).toLocaleString("zh-CN") : "未知" },
        { t: "5m", event: `成交量 $${Math.round(volumeM5).toLocaleString("en-US")}，价格变化 ${number(attr.price_change_percentage?.m5).toFixed(2)}%` },
        { t: "实时", event: `买压 ${scores.buyPressure}%，Alpha ${scores.alphaScore}，Risk ${scores.riskScore}` }
      ],
      trades
    };
  });

  const cleanTokens = tokens
    .map(({ trades, ...token }) => token)
    .sort((a, b) => b.alphaScore - a.alphaScore);

  return buildSnapshot("GeckoTerminal BSC 新池/趋势池", cleanTokens, buildWalletSummary(tokens));
}

function dexSeries(pair, key) {
  const current = number(key === "price" ? pair.priceUsd : pair.marketCap || pair.fdv);
  const changes = [
    ["24h", number(pair.priceChange?.h24)],
    ["6h", number(pair.priceChange?.h6)],
    ["1h", number(pair.priceChange?.h1)],
    ["5m", number(pair.priceChange?.m5)],
    ["当前", 0]
  ];
  return changes.map(([t, change]) => ({
    t,
    value: change ? current / (1 + change / 100) : current
  }));
}

async function dexSnapshot() {
  const profiles = await fetchJson("https://api.dexscreener.com/token-profiles/latest/v1");
  const trackedProfiles = profiles.filter((item) => item.chainId === "bsc" || item.chainId === "solana").slice(0, 16);
  const profilePairGroups = await Promise.all(
    trackedProfiles.map(async (item) => {
      try {
        return await fetchJson(`https://api.dexscreener.com/token-pairs/v1/${item.chainId}/${item.tokenAddress}`, 1);
      } catch {
        return [];
      }
    })
  );
  const searchTerms = ["bsc meme", "ai bsc", "four", "pancakeswap", "cz bsc", "bnb chain", "solana meme", "pumpfun", "sol ai", "raydium", "bonk", "jupiter"];
  const searchGroups = await Promise.all(
    searchTerms.map(async (term) => {
      try {
        const json = await fetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`, 1);
        return json.pairs ?? [];
      } catch {
        return [];
      }
    })
  );
  const seen = new Set();
  const pairs = [...profilePairGroups.flat(), ...searchGroups.flat()]
    .filter((pair) => (pair?.chainId === "bsc" || pair?.chainId === "solana") && pair.pairAddress)
    .filter((pair) => {
      if (seen.has(pair.pairAddress)) return false;
      seen.add(pair.pairAddress);
      return true;
    })
    .sort((a, b) => {
      const scoreA = number(a.volume?.m5) * 5 + number(a.txns?.m5?.buys) * 250 + (number(a.marketCap || a.fdv) < 250_000 ? 5_000 : 0);
      const scoreB = number(b.volume?.m5) * 5 + number(b.txns?.m5?.buys) * 250 + (number(b.marketCap || b.fdv) < 250_000 ? 5_000 : 0);
      return scoreB - scoreA;
    })
    .slice(0, 10);
  const tokens = pairs.map((pair) => {
    const age = ageMinutes(pair.pairCreatedAt);
    const volumeM5 = number(pair.volume?.m5);
    const volumeH1 = number(pair.volume?.h1);
    const txM5 = pair.txns?.m5 ?? {};
    const fdv = number(pair.marketCap || pair.fdv);
    const liquidity = number(pair.liquidity?.usd);
    const scores = scorePool({
      age,
      fdv,
      liquidity,
      volumeM5,
      volumeH1,
      buysM5: number(txM5.buys),
      sellsM5: number(txM5.sells),
      buyersM5: number(txM5.buys),
      sellersM5: number(txM5.sells),
      priceM5: number(pair.priceChange?.m5)
    });
    const curve = bondingLabel(age, liquidity);
    return {
      id: pair.pairAddress,
      chain: pair.chainId === "solana" ? "solana" : "bsc",
      token: pair.baseToken?.symbol ?? "UNKNOWN",
      pair: `${pair.baseToken?.symbol ?? "UNKNOWN"}/${pair.quoteToken?.symbol ?? "QUOTE"}`,
      address: pair.pairAddress,
      dex: pair.dexId,
      mc: fdv,
      liquidity,
      ageMinutes: age,
      alphaScore: scores.alphaScore,
      riskScore: scores.riskScore,
      narrative: narrativeFor(pair.baseToken?.symbol, pair.baseToken?.name),
      smartMoney: 0,
      volumeAcceleration: Number(scores.volumeAcceleration.toFixed(2)),
      buyPressure: scores.buyPressure,
      holderGrowth: number(txM5.buys),
      bondingCurve: curve.value,
      bondingCurveLabel: curve.label,
      priceUsd: number(pair.priceUsd),
      priceChange5m: number(pair.priceChange?.m5),
      volume5m: volumeM5,
      volume1h: volumeH1,
      transactions5m: `${number(txM5.buys)}/${number(txM5.sells)}`,
      sourceUrl: pair.url,
      priceSeries: dexSeries(pair, "price"),
      mcSeries: dexSeries(pair, "mc"),
      flowSeries: [
        { t: "24h", value: number(pair.volume?.h24) },
        { t: "6h", value: number(pair.volume?.h6) },
        { t: "1h", value: volumeH1 },
        { t: "5m", value: volumeM5 }
      ],
      holders: [
        { name: "流动性", value: Math.round(liquidity) },
        { name: "5m成交", value: Math.round(volumeM5) },
        { name: "1h成交", value: Math.round(volumeH1) }
      ],
      wallets: [
        `真实池地址：${pair.pairAddress}`,
        `DEX：${pair.dexId}`,
        `5分钟买/卖笔数：${number(txM5.buys)} / ${number(txM5.sells)}`,
        "DexScreener 当前接口不返回钱包地址"
      ],
      timeline: [
        { t: "创建", event: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toLocaleString("zh-CN") : "未知" },
        { t: "5m", event: `成交量 $${Math.round(volumeM5).toLocaleString("en-US")}，价格变化 ${number(pair.priceChange?.m5).toFixed(2)}%` },
        { t: "实时", event: `买压 ${scores.buyPressure}%，Alpha ${scores.alphaScore}，Risk ${scores.riskScore}` }
      ]
    };
  });
  return buildSnapshot("DexScreener SOL+BSC 真实搜索/交易对", tokens.sort((a, b) => b.alphaScore - a.alphaScore), []);
}

async function attachNativePrices(snapshot) {
  return { ...snapshot, nativePrices: await fetchNativePrices() };
}

function buildSnapshot(source, tokens, smartMoney, nativePrices = {}) {
  return {
    generatedAt: new Date().toISOString(),
    mode: "真实数据",
    source,
    nativePrices,
    error: null,
    tokens,
    smartMoney,
    paperTrades: paperTradeSummary(),
    breakouts: tokens.slice(0, 4).map((token) => ({
      token: token.token,
      signal:
        token.volumeAcceleration >= 2
          ? "5分钟成交加速"
          : token.buyPressure >= 70
            ? "买压显著"
            : token.ageMinutes != null && token.ageMinutes < 60
              ? "新池创建"
              : "Alpha 分数靠前",
      strength: token.alphaScore >= 80 ? "A+" : token.alphaScore >= 65 ? "A" : token.alphaScore >= 45 ? "B" : "C",
      age: token.ageMinutes == null ? "未知" : `${token.ageMinutes}m`
    })),
    risks: [...tokens]
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 4)
      .map((token) => ({
        token: token.token,
        issue: token.liquidity < 10_000 ? "流动性过低" : token.buyPressure > 90 ? "买压过热" : token.mc < 15_000 ? "市值极低" : "风险分较高",
        level: token.riskScore >= 70 ? "高" : token.riskScore >= 40 ? "中" : "低",
        note: `流动性 $${Math.round(token.liquidity).toLocaleString("en-US")}，池龄 ${token.ageMinutes ?? "未知"} 分钟`
      }))
  };
}

async function buildRealSnapshot() {
  try {
    return await attachNativePrices(await dexSnapshot());
  } catch (geckoError) {
    try {
      const fallback = await attachNativePrices(await geckoSnapshot());
      fallback.error = `DexScreener 暂不可用，已使用 GeckoTerminal BSC 真实数据：${geckoError.message}`;
      return fallback;
    } catch (fallbackError) {
      throw new Error(`DexScreener: ${geckoError.message}; GeckoTerminal: ${fallbackError.message}`);
    }
  }
}

async function refreshSnapshot() {
  if (lastSnapshot && Date.now() - lastFetchAt < CACHE_TTL_MS) return lastSnapshot;
  if (refreshPromise) return refreshPromise;
  refreshPromise = buildRealSnapshot()
    .then((snapshot) => {
      return updatePaperTrades(snapshot.tokens, snapshot.nativePrices).then(() => {
        const next = { ...snapshot, paperTrades: paperTradeSummary() };
        lastSnapshot = next;
        lastFetchAt = Date.now();
        return next;
      });
    })
    .then((snapshot) => {
      lastError = null;
      return snapshot;
    })
    .catch((error) => {
      lastError = error.message;
      if (lastSnapshot) {
        return { ...lastSnapshot, error: `实时刷新失败，显示上一份真实快照：${error.message}` };
      }
      return {
        generatedAt: new Date().toISOString(),
        mode: "真实数据",
        source: "暂无可用数据源",
        error: error.message,
        tokens: [],
        smartMoney: [],
        paperTrades: paperTradeSummary(),
        breakouts: [],
        risks: []
      };
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

wss.on("connection", async (ws) => {
  ws.send(JSON.stringify(lastSnapshot ?? (await refreshSnapshot())));
});

setInterval(async () => {
  const data = JSON.stringify(await refreshSnapshot());
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}, REFRESH_MS);

server.listen(port, async () => {
  console.log(`BSC Early Alpha Radar API listening on http://localhost:${port}`);
  await loadPaperTrades();
  await refreshSnapshot();
});
