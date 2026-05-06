const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8787;
const SECRET = process.env.TV_SECRET || "alice_secret_123";

const app = express();

app.use(cors());

// TradingView가 application/json 또는 text/plain으로 보내도 받기
app.use(express.json({ limit: "1mb", type: ["application/json", "application/*+json"] }));
app.use(express.text({ limit: "1mb", type: ["text/*", "*/*"] }));

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

  if (text.includes("QQQ")) return "qqq";
  if (text.includes("NQ")) return "nq";

  return "";
}

function parseBody(body) {
  if (!body) return {};

  if (typeof body === "object") {
    return body;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (error) {
      return {};
    }
  }

  return {};
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

function updateLatest(body) {
  const key = normalizeSymbol(body.symbol || body.ticker);

  if (!key) {
    return {
      ok: false,
      status: 400,
      error: "unknown symbol",
      received: body.symbol || body.ticker,
    };
  }

  const current = toNumber(body.current ?? body.close);
  const open = toNumber(body.open);
  const high = toNumber(body.high);
  const low = toNumber(body.low);
  const prevClose = toNumber(body.prevClose);
  const vwap = toNumber(body.vwap || current);

  if (!current) {
    return {
      ok: false,
      status: 400,
      error: "current price missing",
      body,
    };
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

  return {
    ok: true,
    status: 200,
    updated: key,
    latest,
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "QQQ dashboard market server is running",
    endpoints: {
      webhook: "/webhook/tradingview",
      api: "/api/market/nq-qqq",
      websocket: "/ws",
      test: "/test?symbol=NQ&current=28500",
    },
    latest,
  });
});

app.post("/webhook/tradingview", (req, res) => {
  const body = parseBody(req.body);

  console.log("Webhook received:", body);

  if (body.secret !== SECRET) {
    console.log("Invalid secret:", body.secret);
    return res.status(401).json({
      ok: false,
      error: "invalid secret",
      receivedSecret: body.secret || null,
    });
  }

  const result = updateLatest(body);

  console.log("Webhook result:", result);

  return res.status(result.status).json(result);
});

// 브라우저에서 직접 테스트용
app.get("/test", (req, res) => {
  const body = {
    secret: SECRET,
    symbol: req.query.symbol || "NQ",
    current: req.query.current || req.query.close || 28500,
    open: req.query.open || req.query.current || 28500,
    high: req.query.high || req.query.current || 28500,
    low: req.query.low || req.query.current || 28500,
    prevClose: req.query.prevClose || req.query.current || 28500,
    vwap: req.query.vwap || req.query.current || 28500,
    time: new Date().toISOString(),
  };

  const result = updateLatest(body);

  return res.status(result.status).json(result);
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
  console.log(`TV_SECRET loaded: ${SECRET ? "yes" : "no"}`);
});
