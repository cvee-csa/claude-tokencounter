/**
 * Claude Token Counter — Server
 *
 * Serves the token counter app and proxies requests to the Anthropic API.
 *
 * Usage:
 *   npm install express
 *   node server.js
 *
 * Then open http://localhost:3456 in your browser.
 *
 * API Key Configuration (pick one):
 *   1. Environment variable (recommended):
 *        export ANTHROPIC_API_KEY=sk-ant-...
 *        node server.js
 *
 *   2. .env file — create a file called .env in this directory:
 *        ANTHROPIC_API_KEY=sk-ant-...
 *
 *   3. Paste in the browser — the app will remember it locally.
 *
 * The server runs on port 3456 by default (set PORT env var to change).
 */

const express = require("express");
const path = require("path");
const https = require("https");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3456;

// ─── Load .env file if present ────────────────────────────────────────
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const val = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const SERVER_API_KEY = process.env.ANTHROPIC_API_KEY || null;

// Serve static files from the same directory
app.use(express.static(path.join(__dirname)));

// Redirect root to the app
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "token-counter.html"));
});

app.use(express.json({ limit: "2mb" }));

// CORS — allow requests from any local origin
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * GET /api/config
 *
 * Tells the frontend whether the server has an API key configured,
 * so the UI can hide the key input field.
 */
app.get("/api/config", (req, res) => {
  res.json({ hasServerKey: !!SERVER_API_KEY });
});

/**
 * POST /count-tokens
 *
 * Expects JSON body:
 * {
 *   apiKey?: "sk-ant-...",   // optional if server has ANTHROPIC_API_KEY
 *   model: "claude-sonnet-4-6",
 *   messages: [...],
 *   system?: "...",
 *   tools?: [...]
 * }
 *
 * Returns the Anthropic API response: { input_tokens: number }
 */
app.post("/count-tokens", (req, res) => {
  const { apiKey: clientKey, ...payload } = req.body;

  // Use server key if available, otherwise fall back to client-provided key
  const apiKey = SERVER_API_KEY || clientKey;

  if (!apiKey) {
    return res.status(400).json({
      error: "No API key available. Set ANTHROPIC_API_KEY as an environment variable, add it to a .env file, or paste it in the app.",
    });
  }
  if (!payload.model) {
    return res.status(400).json({ error: "Missing model in request body" });
  }
  if (!payload.messages || !payload.messages.length) {
    return res.status(400).json({ error: "Missing messages in request body" });
  }

  const postData = JSON.stringify(payload);

  const options = {
    hostname: "api.anthropic.com",
    port: 443,
    path: "/v1/messages/count_tokens",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", (chunk) => (data += chunk));
    apiRes.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (apiRes.statusCode !== 200) {
          return res.status(apiRes.statusCode).json({
            error: parsed.error?.message || `Anthropic API error (${apiRes.statusCode})`,
          });
        }
        res.json(parsed);
      } catch (e) {
        res.status(500).json({ error: "Failed to parse Anthropic API response" });
      }
    });
  });

  apiReq.on("error", (err) => {
    res.status(500).json({ error: `Proxy error: ${err.message}` });
  });

  apiReq.write(postData);
  apiReq.end();
});

app.listen(PORT, () => {
  console.log(`\n  Claude Token Counter is running!`);
  console.log(`  Open http://localhost:${PORT} in your browser.\n`);
  console.log(`  API Key: ${SERVER_API_KEY ? "Loaded from environment" : "Not set — users will enter their own in the browser"}`);
  console.log(`\n  Endpoints:`);
  console.log(`    GET  /                — serves the token counter app`);
  console.log(`    GET  /api/config      — reports whether server has an API key`);
  console.log(`    POST /count-tokens   — proxies to Anthropic's token counting API\n`);
});
