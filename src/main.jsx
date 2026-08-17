import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  Gauge,
  Radio,
  ShieldAlert,
  Trophy,
  Users,
  WalletCards,
  Zap
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "./styles.css";

const api = "";
const wsApi =
  typeof window === "undefined"
    ? "ws://localhost:8787/ws"
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

function formatUsd(value) {
  if (!value) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatPrice(value) {
  if (!value) return "-";
  if (value < 0.0001) return `$${Number(value).toExponential(3)}`;
  if (value < 1) return `$${Number(value).toFixed(8)}`;
  return formatUsd(value);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function scoreClass(value, inverse = false) {
  if (inverse) {
    if (value >= 70) return "bad";
    if (value >= 45) return "warn";
    return "good";
  }
  if (value >= 75) return "good";
  if (value >= 50) return "warn";
  return "bad";
}

function riskClass(level) {
  if (level === "高") return "high";
  if (level === "中") return "medium";
  return "low";
}

function Metric({ icon: Icon, label, value, accent }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong className={accent}>{value}</strong>
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, children, action }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <Icon size={18} />
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function AlphaTable({ tokens, selectedId, onSelect }) {
  return (
    <Panel title="Early Alpha 排行榜" icon={Radio}>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>代币</th>
              <th>市值</th>
              <th>Alpha 分</th>
              <th>风险分</th>
              <th>叙事</th>
              <th>聪明钱数</th>
              <th>5分钟成交加速</th>
              <th>买盘压力</th>
              <th>买家增长</th>
              <th>建池状态</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr
                key={token.id}
                className={selectedId === token.id ? "selected" : ""}
                onClick={() => onSelect(token.id)}
              >
                <td>
                  <button className="tokenButton" type="button">
                    <span>{token.token}</span>
                    <small>{token.pair}</small>
                  </button>
                </td>
                <td>{formatUsd(token.mc)}</td>
                <td><span className={`score ${scoreClass(token.alphaScore)}`}>{token.alphaScore}</span></td>
                <td><span className={`score ${scoreClass(token.riskScore, true)}`}>{token.riskScore}</span></td>
                <td><span className="tag">{token.narrative}</span></td>
                <td>{token.smartMoney}</td>
                <td>{token.volumeAcceleration}x</td>
                <td>
                  <div className="barMeter"><i style={{ width: `${token.buyPressure}%` }} /></div>
                  {token.buyPressure}%
                </td>
                <td>+{token.holderGrowth}</td>
                <td>
                  <div className="barMeter curve"><i style={{ width: `${token.bondingCurve}%` }} /></div>
                  {token.bondingCurveLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SmartMoney({ rows }) {
  return (
    <Panel title="聪明钱 / 重复买入钱包" icon={WalletCards}>
      <div className="list">
        {rows.length === 0 && <div className="empty">当前真实数据源未返回可识别的钱包地址，等待下一轮交易数据。</div>}
        {rows.map((row) => (
          <div className="listRow" key={row.wallet}>
            <div>
              <strong>{row.wallet}</strong>
              <span>{row.buys.join(" / ")}</span>
            </div>
            <div className="rightStack">
              <b>{row.pnl30d}</b>
              <small>{row.winRate ? `${row.winRate}% WR · ` : ""}{row.conviction}</small>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Breakouts({ rows }) {
  return (
    <Panel title="Breakout / 异动" icon={Zap}>
      <div className="signalGrid">
        {rows.map((row, index) => (
          <article className="signal" key={`${row.token}-${row.signal}-${index}`}>
            <span>{row.strength}</span>
            <strong>{row.token}</strong>
            <p>{row.signal}</p>
            <small>{row.age} ago</small>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function Risks({ rows }) {
  return (
    <Panel title="Risk 风险" icon={ShieldAlert}>
      <div className="riskList">
        {rows.map((row, index) => (
          <div className={`riskItem ${riskClass(row.level)}`} key={`${row.token}-${row.issue}-${index}`}>
            <AlertTriangle size={16} />
            <div>
              <strong>{row.token} · {row.issue}</strong>
              <span>{row.note}</span>
            </div>
            <b>{row.level}</b>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PaperTrades({ summary }) {
  const rows = summary?.trades ?? [];
  const best = rows.find((row) => row.id === summary?.bestTradeId) || rows.sort((a, b) => (b.maxMultiple ?? 0) - (a.maxMultiple ?? 0))[0];

  return (
    <Panel title="自动交易记录 / 最高倍数" icon={Bot}>
      <div className="tradeStats">
        <div>
          <span>最高达到</span>
          <strong className="good">{summary?.bestMultiple ? `${summary.bestMultiple.toFixed(2)}x` : "1.00x"}</strong>
          <small>{summary?.bestToken || "-"}</small>
        </div>
        <div>
          <span>总记录</span>
          <strong>{summary?.total ?? 0}</strong>
          <small>模拟自动买入</small>
        </div>
        <div>
          <span>持仓中</span>
          <strong>{summary?.open ?? 0}</strong>
          <small>持续追踪</small>
        </div>
      </div>

      {best && (
        <div className="bestTrade">
          <Trophy size={17} />
          <div>
            <strong>{best.token} 最高 {best.maxMultipleText}</strong>
            <span>买入 {formatPrice(best.entryPriceUsd)} · 最高 {formatPrice(best.maxPriceUsd)} · {best.reason}</span>
          </div>
        </div>
      )}

      <div className="tradeTableWrap">
        <table className="tradeTable">
          <thead>
            <tr>
              <th>代币</th>
              <th>状态</th>
              <th>买入时间</th>
              <th>买入价</th>
              <th>当前倍数</th>
              <th>最高倍数</th>
              <th>买入信号</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>等待真实行情触发自动记录条件。</td>
              </tr>
            )}
            {rows.slice(0, 12).map((trade) => (
              <tr key={trade.id}>
                <td>
                  <span className="tradeToken">{trade.token}</span>
                  <small>{trade.pair}</small>
                </td>
                <td><span className={`statusPill ${trade.status === "持仓中" ? "open" : "closed"}`}>{trade.status}</span></td>
                <td>{formatDate(trade.entryAt)}</td>
                <td>{formatPrice(trade.entryPriceUsd)}</td>
                <td className={trade.currentMultiple >= 1 ? "good" : "bad"}>{trade.currentMultipleText}</td>
                <td className="good">{trade.maxMultipleText}</td>
                <td>{trade.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TokenDetail({ token }) {
  const pieColors = ["#12d6a0", "#3aa0ff", "#f7c948", "#7c8da5"];

  return (
    <Panel title={`${token.token} Token 详情`} icon={Activity}>
      <div className="detail">
        <div className="chartBlock wide">
          <div className="chartTitle">价格 / 市值曲线</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={token.mcSeries}>
              <CartesianGrid stroke="#1d2a39" vertical={false} />
              <XAxis dataKey="t" tick={{ fill: "#7c8da5", fontSize: 11 }} />
              <YAxis tick={{ fill: "#7c8da5", fontSize: 11 }} width={52} />
              <Tooltip contentStyle={{ background: "#0b111a", border: "1px solid #253447" }} />
              <Line type="monotone" dataKey="value" stroke="#12d6a0" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="chartBlock">
          <div className="chartTitle">资金流</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={token.flowSeries}>
              <defs>
                <linearGradient id="flow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3aa0ff" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#3aa0ff" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fill: "#7c8da5", fontSize: 11 }} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "#0b111a", border: "1px solid #253447" }} />
              <Area type="monotone" dataKey="value" stroke="#3aa0ff" fill="url(#flow)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="chartBlock">
          <div className="chartTitle">持币结构</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={token.holders} dataKey="value" nameKey="name" innerRadius={46} outerRadius={78} paddingAngle={3}>
                {token.holders.map((entry, index) => (
                  <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "#0b111a", border: "1px solid #253447" }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend">
            {token.holders.map((item, index) => (
              <span key={item.name}><i style={{ background: pieColors[index] }} />{item.name} {formatUsd(item.value)}</span>
            ))}
          </div>
        </div>
        <div className="detailText">
          <div>
            <h3>钱包关系摘要</h3>
            {token.wallets.map((item) => <p key={item}>{item}</p>)}
          </div>
          <div>
            <h3>叙事标签</h3>
            <div className="tagCloud">
              {[token.narrative, "BSC", token.dex, token.bondingCurveLabel, "真实数据"].filter(Boolean).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}
            </div>
          </div>
        </div>
        <div className="timeline">
          <h3>信号时间线</h3>
          {token.timeline.map((item) => (
            <div className="timeItem" key={`${item.t}-${item.event}`}>
              <span>{item.t}</span>
              <p>{item.event}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function fallbackSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    mode: "真实数据",
    source: "连接中",
    error: null,
    tokens: [],
    smartMoney: [],
    paperTrades: { total: 0, open: 0, bestMultiple: 1, bestToken: "-", bestTradeId: null, trades: [] },
    breakouts: [],
    risks: []
  };
}

function App() {
  const [data, setData] = useState(fallbackSnapshot);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    let poll;
    let ws;

    async function loadOnce() {
      try {
        const res = await fetch(`${api}/api/snapshot`);
        const next = await res.json();
        setData(next);
        setSelectedId((current) => current || next.tokens[0]?.id);
        setStatus("polling");
      } catch {
        setStatus("offline");
      }
    }

    loadOnce();
    poll = setInterval(loadOnce, 6000);

    try {
      ws = new WebSocket(wsApi);
      ws.onmessage = (event) => {
        const next = JSON.parse(event.data);
        setData(next);
        setSelectedId((current) => current || next.tokens[0]?.id);
        setStatus("live");
      };
      ws.onerror = () => setStatus("polling");
      ws.onclose = () => setStatus((current) => (current === "live" ? "polling" : current));
    } catch {
      setStatus("polling");
    }

    return () => {
      clearInterval(poll);
      if (ws) ws.close();
    };
  }, []);

  const selected = useMemo(() => {
    return data.tokens.find((token) => token.id === selectedId) || data.tokens[0];
  }, [data.tokens, selectedId]);

  const avgAlpha = Math.round(data.tokens.reduce((sum, token) => sum + token.alphaScore, 0) / Math.max(data.tokens.length, 1));
  const avgRisk = Math.round(data.tokens.reduce((sum, token) => sum + token.riskScore, 0) / Math.max(data.tokens.length, 1));

  return (
    <main className="terminal">
      <header className="topbar">
        <div>
          <span className="eyebrow">BSC Early Alpha Radar</span>
          <h1>实时链上交易终端</h1>
        </div>
        <div className={`status ${status}`}>
          <Radio size={15} />
          <span>{status === "live" ? "WebSocket 实时" : status === "polling" ? "轮询同步" : "连接中"}</span>
        </div>
      </header>

      <section className="metrics">
        <Metric icon={Gauge} label="平均 Alpha" value={avgAlpha} accent={scoreClass(avgAlpha)} />
        <Metric icon={ShieldAlert} label="平均风险" value={avgRisk} accent={scoreClass(avgRisk, true)} />
        <Metric icon={Users} label="聪明钱包" value={data.smartMoney.length} accent="good" />
        <Metric icon={BrainCircuit} label="数据源" value={data.source || data.mode} accent="info" />
        <Metric icon={Trophy} label="最高倍数" value={`${(data.paperTrades?.bestMultiple ?? 1).toFixed(2)}x`} accent="good" />
        <Metric icon={ArrowUpRight} label="更新时间" value={new Date(data.generatedAt).toLocaleTimeString()} accent="info" />
      </section>

      {data.error && <div className="notice">{data.error}</div>}
      {data.tokens.length === 0 && <div className="notice">正在等待真实 BSC 数据源返回结果。</div>}

      <div className="dashboardStack">
        <AlphaTable tokens={data.tokens} selectedId={selected?.id} onSelect={setSelectedId} />
        <PaperTrades summary={data.paperTrades} />
        <div className="insightGrid">
          <SmartMoney rows={data.smartMoney} />
          <Breakouts rows={data.breakouts} />
          <Risks rows={data.risks} />
        </div>
      </div>

      {selected && <TokenDetail token={selected} />}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
