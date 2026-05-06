const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8787;
const SECRET = process.env.TV_SECRET || "mason_secret_123";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

let latest = {
  nq: null,
  qqq: null,
  time: null,
};

function toNumber(value) {
  if (value === undefined || value === null) return 0;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeSymbol(raw) {
  const text = String(raw || "").toUpperCase();

  if (text.includes("NQ")) return "nq";
  if (text.includes("QQQ")) return "qqq";

  return "";
}

function broadcast() {
  const payload = JSON.stringify({
    nq: latest.nq,
    qqq: latest.qqq,
    time: latest.time || new Date().toISOString(),
  });

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "QQQ dashboard market server is running",
    endpoints: {
      webhook: "/webhook/tradingview",
      api: "/api/market/nq-qqq",
      websocket: "/ws",
    },
    latest,
  });
});

app.post("/webhook/tradingview", (req, res) => {
  const body = req.body || {};

  if (body.secret !== SECRET) {
    return res.status(401).json({
      ok: false,
      error: "invalid secret",
    });
  }

  const key = normalizeSymbol(body.symbol || body.ticker);

  if (!key) {
    return res.status(400).json({
      ok: false,
      error: "unknown symbol",
      received: body.symbol || body.ticker,
    });
  }

  const current = toNumber(body.current ?? body.close);
  const open = toNumber(body.open);
  const high = toNumber(body.high);
  const low = toNumber(body.low);
  const prevClose = toNumber(body.prevClose);
  const vwap = toNumber(body.vwap || current);

  if (!current) {
    return res.status(400).json({
      ok: false,
      error: "current price missing",
    });
  }

  latest[key] = {
    current,
    open,
    high,
    low,
    prevClose,
    vwap,
  };

  latest.time = body.time || new Date().toISOString();

  broadcast();

  return res.json({
    ok: true,
    updated: key,
    latest,
  });
});

app.get("/api/market/nq-qqq", (req, res) => {
  if (!latest.nq || !latest.qqq) {
    return res.status(404).json({
      ok: false,
      error: "NQ and QQQ are not ready yet. Send both TradingView alerts first.",
      latest,
    });
  }

  res.json({
    nq: latest.nq,
    qqq: latest.qqq,
    time: latest.time || new Date().toISOString(),
  });
});

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      nq: latest.nq,
      qqq: latest.qqq,
      time: latest.time || new Date().toISOString(),
    })
  );
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
