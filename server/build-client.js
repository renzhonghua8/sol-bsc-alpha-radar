import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

await fs.writeFile(
  path.join(dist, "index.html"),
  `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BSC Early Alpha Radar</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#070b10;color:#e7eef7}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 18% -8%,rgba(18,214,160,.1),transparent 28rem),linear-gradient(135deg,#070b10 0%,#0d141f 55%,#080b0f 100%)}main{width:min(1760px,100%);margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:10px 0 18px}.eyebrow{color:#12d6a0;font-size:12px;font-weight:800;text-transform:uppercase}h1,h2,p{margin:0}h1{font-size:28px;line-height:1.15}.status,.pill,.link{display:inline-flex;align-items:center;border:1px solid #273546;background:#0c131d;border-radius:8px;color:#98a9bd}.status{gap:8px;min-height:38px;padding:0 12px}.link{min-height:28px;padding:0 10px;margin-left:8px;color:#12d6a0;text-decoration:none;font-size:12px;font-weight:800}.chartLink{color:#e7eef7;text-decoration:none}.chartLink:hover{color:#12d6a0}.chartLink small{display:block}.status.live{border-color:rgba(18,214,160,.45);color:#12d6a0}.metrics{display:grid;grid-template-columns:repeat(6,minmax(150px,1fr));gap:12px;margin-bottom:14px}.metric,.panel{border:1px solid #1d2a39;background:rgba(9,15,23,.88);box-shadow:0 16px 50px rgba(0,0,0,.22);border-radius:8px}.metric{min-height:78px;padding:14px}.metric span,.muted,th{color:#7c8da5;font-size:12px}.metric strong{display:block;margin-top:5px;font-size:20px}.good{color:#12d6a0}.warn{color:#f7c948}.bad{color:#ff6b6b}.info{color:#3aa0ff}.stack{display:grid;gap:14px}.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.panel{overflow:hidden}.panel h2{font-size:15px}.panelHeader{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #1d2a39;background:#0b111a}.tableWrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:1120px}th,td{padding:12px 11px;border-bottom:1px solid #162231;text-align:left;font-size:13px;white-space:nowrap}th{text-transform:uppercase}tbody tr:hover{background:rgba(58,160,255,.08)}.token strong,.tradeToken{display:block;font-weight:800}.token small,.tradeTable small{color:#7c8da5}.score,.tag,.pill{min-height:24px;padding:0 8px;font-weight:800;background:#101924}.score,.tag{display:inline-flex;align-items:center;border-radius:6px}.tag{color:#c7d3e3;border:1px solid #263547}.bar{display:inline-flex;width:72px;height:6px;overflow:hidden;margin-right:8px;border-radius:99px;background:#192535;vertical-align:middle}.bar i{display:block;background:#12d6a0}.bar.blue i{background:#3aa0ff}.notice{border:1px solid rgba(247,201,72,.32);background:rgba(247,201,72,.08);border-radius:8px;margin-bottom:14px;color:#f7c948;padding:14px 15px;font-size:13px}.tradeStats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:13px}.tradeStats>div,.bestTrade,.card{border:1px solid #1d2a39;background:#0d141f;border-radius:8px;padding:12px}.tradeStats span,.tradeStats small,.bestTrade span{display:block;color:#7c8da5;font-size:12px}.tradeStats strong{display:block;margin:5px 0;font-size:22px}.bestTrade{margin:0 13px 13px}.tradeTable{min-width:1280px}.open{color:#12d6a0;border-color:rgba(18,214,160,.28)}.closed{color:#f7c948;border-color:rgba(247,201,72,.28)}.list{display:grid}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-bottom:1px solid #162231}.signals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:12px}.signal{min-height:108px;border:1px solid #1d2a39;border-radius:8px;padding:12px;background:#0d141f}.signal b{color:#f7c948}.signal strong{display:block;margin:8px 0 5px}.detail{display:grid;grid-template-columns:1.2fr .8fr;gap:14px;padding:14px}.detail p{color:#98a9bd;font-size:13px;line-height:1.45;margin-top:8px}.spark{width:100%;height:260px}@media(max-width:1180px){.metrics{grid-template-columns:repeat(3,minmax(150px,1fr))}.grid3,.detail{grid-template-columns:1fr}}@media(max-width:680px){main{padding:14px}.topbar{align-items:flex-start;flex-direction:column}h1{font-size:23px}.metrics,.signals,.tradeStats{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <div><span class="eyebrow">BSC Early Alpha Radar</span><h1>实时链上交易终端</h1></div>
      <div id="status" class="status">连接中</div>
    </header>
    <section class="metrics" id="metrics"></section>
    <div id="notice"></div>
    <div class="stack">
      <section class="panel"><div class="panelHeader"><h2>Early Alpha 排行榜</h2></div><div class="tableWrap"><table><thead><tr><th>代币</th><th>市值</th><th>Alpha 分</th><th>风险分</th><th>叙事</th><th>聪明钱数</th><th>5分钟成交加速</th><th>买盘压力</th><th>买家增长</th><th>建池状态</th></tr></thead><tbody id="rankBody"></tbody></table></div></section>
      <section class="panel"><div class="panelHeader"><h2>策略收益统计 / 完整交易记录</h2><div><a class="link exportLink" data-path="/api/paper-trades" target="_blank">JSON</a><a class="link exportLink" data-path="/api/paper-trades.csv" target="_blank">仓位CSV</a><a class="link exportLink" data-path="/api/executions.csv" target="_blank">流水CSV</a></div></div><div id="paperTrades"></div></section>
      <div class="grid3">
        <section class="panel"><div class="panelHeader"><h2>聪明钱 / 重复买入钱包</h2></div><div class="list" id="smartMoney"></div></section>
        <section class="panel"><div class="panelHeader"><h2>Breakout / 异动</h2></div><div class="signals" id="breakouts"></div></section>
        <section class="panel"><div class="panelHeader"><h2>Risk 风险</h2></div><div class="list" id="risks"></div></section>
      </div>
      <section class="panel"><div class="panelHeader"><h2 id="detailTitle">Token 详情</h2></div><div class="detail" id="detail"></div></section>
    </div>
  </main>
  <script>
    const api = "";
    const wsApi = (window.location.protocol === "https:" ? "wss" : "ws") + "://" + window.location.host + "/ws";
    const fmtUsd = (v) => v ? new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(v) : "-";
    const fmtPrice = (v) => !v ? "-" : v < 0.0001 ? "$" + Number(v).toExponential(3) : v < 1 ? "$" + Number(v).toFixed(8) : fmtUsd(v);
    const cls = (v, inv=false) => inv ? (v>=70?"bad":v>=45?"warn":"good") : (v>=75?"good":v>=50?"warn":"bad");
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    let selectedId = null;

    function metric(label, value, klass="info"){ return '<div class="metric"><span>'+label+'</span><strong class="'+klass+'">'+esc(value)+'</strong></div>'; }
    function renderSpark(points){
      if(!points?.length) return "";
      const values = points.map(p=>Number(p.value)||0), min=Math.min(...values), max=Math.max(...values), span=max-min||1;
      const d = points.map((p,i)=>((i?'L':'M')+(i/(points.length-1||1)*100).toFixed(2)+','+(100-(Number(p.value)-min)/span*90-5).toFixed(2))).join(' ');
      return '<svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="'+d+'" fill="none" stroke="#12d6a0" stroke-width="1.6"/><line x1="0" y1="95" x2="100" y2="95" stroke="#1d2a39"/></svg>';
    }
    function render(data){
      selectedId = selectedId || data.tokens?.[0]?.id;
      const selected = data.tokens?.find(t=>t.id===selectedId) || data.tokens?.[0];
      const avgAlpha = Math.round((data.tokens||[]).reduce((s,t)=>s+t.alphaScore,0)/Math.max((data.tokens||[]).length,1));
      const avgRisk = Math.round((data.tokens||[]).reduce((s,t)=>s+t.riskScore,0)/Math.max((data.tokens||[]).length,1));
      document.getElementById("metrics").innerHTML =
        metric("平均 Alpha", avgAlpha, cls(avgAlpha)) + metric("平均风险", avgRisk, cls(avgRisk,true)) +
        metric("聪明钱包", data.smartMoney?.length || 0, "good") + metric("数据源", data.source || data.mode, "info") +
        metric("最高倍数", ((data.paperTrades?.bestMultiple || 1).toFixed(2)+"x"), "good") + metric("更新时间", new Date(data.generatedAt).toLocaleTimeString(), "info");
      document.getElementById("notice").innerHTML = data.error ? '<div class="notice">'+esc(data.error)+'</div>' : "";
      document.getElementById("rankBody").innerHTML = (data.tokens||[]).map(t =>
        '<tr data-id="'+esc(t.id)+'"><td class="token"><a class="chartLink" href="'+esc(t.sourceUrl)+'" target="_blank" rel="noreferrer" onclick="event.stopPropagation()"><strong>'+esc(t.token)+' ↗</strong><small>'+esc(t.pair)+'</small></a></td><td>'+fmtUsd(t.mc)+'</td><td><span class="score '+cls(t.alphaScore)+'">'+t.alphaScore+'</span></td><td><span class="score '+cls(t.riskScore,true)+'">'+t.riskScore+'</span></td><td><span class="tag">'+esc(t.narrative)+'</span></td><td>'+t.smartMoney+'</td><td>'+t.volumeAcceleration+'x</td><td><span class="bar"><i style="width:'+t.buyPressure+'%"></i></span>'+t.buyPressure+'%</td><td>+'+t.holderGrowth+'</td><td><span class="bar blue"><i style="width:'+t.bondingCurve+'%"></i></span>'+esc(t.bondingCurveLabel)+'</td></tr>'
      ).join("");
      document.querySelectorAll("#rankBody tr").forEach(row => row.onclick = () => { selectedId = row.dataset.id; render(data); });
      const p = data.paperTrades || {trades:[],bestMultiple:1,total:0,open:0,bestToken:"-",stats:{}};
      const s = p.stats || {};
      const bsc = p.portfolio?.chains?.bsc || {};
      const sol = p.portfolio?.chains?.solana || {};
      const best = p.trades?.find(x=>x.id===p.bestTradeId) || p.trades?.[0];
      document.getElementById("paperTrades").innerHTML =
        '<div class="tradeStats"><div><span>当前总收益</span><strong class="'+(s.profitableNow?"good":"bad")+'">'+(s.totalUnrealizedReturnPct??0).toFixed(2)+'%</strong><small>'+(s.profitableNow?"当前赚钱":"当前亏损或持平")+'</small></div><div><span>胜率</span><strong class="'+((s.winRate??0)>=50?"good":"warn")+'">'+(s.winRate??0).toFixed(2)+'%</strong><small>当前倍数 > 1x</small></div><div><span>平均当前倍数</span><strong class="'+((s.averageCurrentMultiple??1)>=1?"good":"bad")+'">'+(s.averageCurrentMultiple??1).toFixed(2)+'x</strong><small>全部记录平均</small></div><div><span>最高达到</span><strong class="good">'+(p.bestMultiple||1).toFixed(2)+'x</strong><small>'+esc(p.bestToken||"-")+'</small></div><div><span>平均最高倍数</span><strong class="good">'+(s.averageMaxMultiple??1).toFixed(2)+'x</strong><small>看卖飞空间</small></div><div><span>最大回撤</span><strong class="'+((s.maxDrawdownPct??0)>35?"bad":"warn")+'">'+(s.maxDrawdownPct??0).toFixed(2)+'%</strong><small>从最高点回撤</small></div><div><span>3x+ 命中</span><strong class="'+((s.winner3xRate??0)>0?"good":"warn")+'">'+(s.winner3xRate??0).toFixed(2)+'%</strong><small>'+esc(s.winner3xCount??0)+' 笔达到 3x</small></div><div><span>100x+ 命中</span><strong class="'+((s.winner100xRate??0)>0?"good":"warn")+'">'+(s.winner100xRate??0).toFixed(2)+'%</strong><small>'+esc(s.winner100xCount??0)+' 笔达到 100x</small></div><div><span>1000x+ 命中</span><strong class="'+((s.winner1000xRate??0)>0?"good":"warn")+'">'+(s.winner1000xRate??0).toFixed(2)+'%</strong><small>'+esc(s.winner1000xCount??0)+' 笔达到 1000x</small></div></div>' +
        '<div class="tradeStats"><div><span>BNB 组合</span><strong class="'+((bsc.pnlPct??0)>=0?"good":"bad")+'">'+Number(bsc.totalNative??100).toFixed(4)+' BNB</strong><small>可用 '+Number(bsc.available??100).toFixed(4)+' · 仓位 '+Number(bsc.openValueNative??0).toFixed(4)+' · '+Number(bsc.pnlPct??0).toFixed(2)+'%</small></div><div><span>SOL 组合</span><strong class="'+((sol.pnlPct??0)>=0?"good":"bad")+'">'+Number(sol.totalNative??100).toFixed(4)+' SOL</strong><small>可用 '+Number(sol.available??100).toFixed(4)+' · 仓位 '+Number(sol.openValueNative??0).toFixed(4)+' · '+Number(sol.pnlPct??0).toFixed(2)+'%</small></div><div><span>策略规则</span><strong>0.1/笔</strong><small>3x卖50%，100x卖25%，1000x卖25%；0.5x清仓</small></div></div>' +
        (best ? '<div class="bestTrade"><strong>'+esc(best.token)+' 最高 '+esc(best.maxMultipleText)+'</strong><span>买入 '+fmtPrice(best.entryPriceUsd)+' · 最高 '+fmtPrice(best.maxPriceUsd)+' · '+esc(best.reason)+'</span></div>' : "") +
        '<div class="tableWrap"><table class="tradeTable"><thead><tr><th>链</th><th>代币</th><th>状态</th><th>买入时间</th><th>最后更新</th><th>投入</th><th>买入价</th><th>当前价</th><th>当前倍数</th><th>最高倍数</th><th>收益</th><th>已实现</th><th>剩余估值</th><th>Alpha</th><th>风险</th><th>买入信号</th></tr></thead><tbody>' +
        ((p.trades||[]).map(tr => { const cm=Number(tr.currentMultiple||1), mm=Number(tr.maxMultiple||1), ret=((Number(tr.realizedNative||0)+Number(tr.remainingValueNative||0))/Number(tr.entryNativeSpent||1)-1)*100; return '<tr><td>'+esc((tr.chain==="bsc"?"BSC":"SOL"))+'</td><td><a class="chartLink" href="'+esc(tr.sourceUrl)+'" target="_blank" rel="noreferrer"><span class="tradeToken">'+esc(tr.token)+' ↗</span><small>'+esc(tr.pair)+'</small></a></td><td><span class="pill '+(tr.status==="持仓中"?"open":"closed")+'">'+esc(tr.status)+'</span></td><td>'+new Date(tr.entryAt).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})+'</td><td>'+new Date(tr.lastSeenAt).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})+'</td><td>'+Number(tr.entryNativeSpent||0).toFixed(4)+' '+esc(tr.native)+'</td><td>'+fmtPrice(tr.entryPriceUsd)+'</td><td>'+fmtPrice(tr.currentPriceUsd)+'</td><td class="'+(cm>=1?"good":"bad")+'">'+esc(tr.currentMultipleText)+'</td><td class="good">'+esc(tr.maxMultipleText)+'</td><td class="'+(ret>=0?"good":"bad")+'">'+ret.toFixed(2)+'%</td><td>'+Number(tr.realizedNative||0).toFixed(4)+' '+esc(tr.native)+'</td><td>'+Number(tr.remainingValueNative||0).toFixed(4)+' '+esc(tr.native)+'</td><td>'+esc(tr.entryAlphaScore)+' → '+esc(tr.lastAlphaScore)+'</td><td>'+esc(tr.entryRiskScore)+' → '+esc(tr.lastRiskScore)+'</td><td>'+esc(tr.reason)+'</td></tr>'; }).join("") || '<tr><td colspan="16">等待真实行情触发自动记录条件。</td></tr>') +
        '</tbody></table></div>' +
        '<div class="panelHeader"><h2>买入 / 卖出流水</h2></div><div class="tableWrap"><table class="tradeTable"><thead><tr><th>时间</th><th>动作</th><th>链</th><th>代币</th><th>成交价</th><th>数量</th><th>原生币金额</th><th>USD金额</th><th>成交倍数</th><th>原因</th></tr></thead><tbody>' +
        ((p.executions||[]).map(ex => '<tr><td>'+new Date(ex.timestamp).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})+'</td><td><span class="pill '+(ex.type==="BUY"?"open":"closed")+'">'+esc(ex.type)+'</span></td><td>'+esc(ex.chain==="bsc"?"BSC":"SOL")+'</td><td><a class="chartLink" href="'+esc(ex.sourceUrl)+'" target="_blank" rel="noreferrer">'+esc(ex.token)+' ↗</a></td><td>'+fmtPrice(ex.tokenPriceUsd)+'</td><td>'+Number(ex.tokenAmount||0).toFixed(4)+'</td><td>'+Number(ex.nativeAmount||0).toFixed(4)+' '+esc(ex.native)+'</td><td>'+fmtUsd(ex.usdAmount)+'</td><td>'+Number(ex.multipleAtExecution||1).toFixed(2)+'x</td><td>'+esc(ex.reason)+'</td></tr>').join("") || '<tr><td colspan="10">暂无成交流水。</td></tr>') +
        '</tbody></table></div>';
      document.getElementById("smartMoney").innerHTML = (data.smartMoney||[]).map(w => '<div class="row"><div><strong>'+esc(w.wallet)+'</strong><div class="muted">'+esc(w.buys?.join(" / "))+'</div></div><div class="good">'+esc(w.pnl30d)+'</div></div>').join("") || '<div class="row"><span class="muted">当前真实数据源未返回可识别的钱包地址。</span></div>';
      document.getElementById("breakouts").innerHTML = (data.breakouts||[]).map(b => '<article class="signal"><b>'+esc(b.strength)+'</b><strong>'+esc(b.token)+'</strong><p>'+esc(b.signal)+'</p><span class="muted">'+esc(b.age)+'</span></article>').join("");
      document.getElementById("risks").innerHTML = (data.risks||[]).map(r => '<div class="row"><div><strong>'+esc(r.token)+' · '+esc(r.issue)+'</strong><div class="muted">'+esc(r.note)+'</div></div><b class="'+(r.level==="高"?"bad":r.level==="中"?"warn":"good")+'">'+esc(r.level)+'</b></div>').join("");
      if(selected){
        document.getElementById("detailTitle").textContent = selected.token + " Token 详情";
        document.getElementById("detail").innerHTML = '<div class="card"><h2>价格 / 市值曲线</h2>'+renderSpark(selected.mcSeries)+'</div><div class="card"><h2>信号摘要</h2>'+selected.wallets.map(x=>'<p>'+esc(x)+'</p>').join("")+'<p>叙事：'+esc(selected.narrative)+' / '+esc(selected.dex)+' / 真实数据</p>'+selected.timeline.map(x=>'<p>'+esc(x.t)+'：'+esc(x.event)+'</p>').join("")+'</div>';
      }
    }
    async function load(){ const r = await fetch(api + "/api/snapshot"); render(await r.json()); document.getElementById("status").textContent="轮询同步"; }
    document.querySelectorAll(".exportLink").forEach(a => a.href = api + a.dataset.path);
    load(); setInterval(load, 30000);
    try{ const ws = new WebSocket(wsApi); ws.onopen=()=>{document.getElementById("status").classList.add("live");document.getElementById("status").textContent="WebSocket 实时"}; ws.onmessage=e=>render(JSON.parse(e.data)); }catch{}
  </script>
</body>
</html>`
);

console.log("Client built to dist/");
