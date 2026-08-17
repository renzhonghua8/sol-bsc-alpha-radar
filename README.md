# BSC Early Alpha Radar

SOL + BSC early-alpha dashboard with a paper-trading strategy ledger.

## Strategy

- Initial capital: `100 SOL` and `100 BNB`
- Chains: Solana and BSC
- Each opportunity buy: `0.1 SOL` or `0.1 BNB`
- Take profit: sell `50%` at `3x`
- Stop loss: clear remaining position at `0.5x`
- Records full buy/sell executions with time, price, token amount, native amount, USD amount, and chart URL

## Local Run

```bash
npm install
npm run dev
```

Open:

- Dashboard: http://localhost:5174
- API health: http://localhost:8787/api/health
- Positions JSON: http://localhost:8787/api/paper-trades
- Positions CSV: http://localhost:8787/api/paper-trades.csv
- Executions CSV: http://localhost:8787/api/executions.csv

## Docker Run

```bash
docker compose up -d --build
```

Open:

```text
http://SERVER_IP:5174
```

The browser UI connects to the API on the same server at `http://SERVER_IP:8787`.
Make sure both ports are open in the cloud security group and the server firewall.

Logs:

```bash
docker compose logs -f radar
```

Stop:

```bash
docker compose down
```

Reset simulated strategy data:

```bash
docker compose down -v
```

## Server Deploy

On a fresh Ubuntu server:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
git clone https://github.com/renzhonghua8/bsc-early-alpha-radar.git
cd bsc-early-alpha-radar
docker compose up -d --build
```

If the server has a firewall:

```bash
sudo ufw allow 5174/tcp
sudo ufw allow 8787/tcp
```
