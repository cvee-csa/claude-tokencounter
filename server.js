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
 * The server runs on port 3456 by default (set PORT env var to change).
 */

const express = require("express");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3456;

// Serve static files (token-counter.html, etc.) from the same directory
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
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * POST /count-tokens
 *
 * Expects JSON body:
 * {
 *   apiKey: "sk-ant-...",
 *   model: "claude-sonnet-4-6",
 *   messages: [...],
 *   system?: "...",
 *   tools?: [...]
 * }
 *
 * Returns the Anthropic API response: { input_tokens: number }
 */
app.post("/count-tokens", (req, res) => {
  const { apiKey, ...payload } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: "Missing apiKey in request body" });
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
  console.log(`  Endpoints:`);
  console.log(`    GET  /                — serves the token counter app`);
  console.log(`    POST /count-tokens   — proxies to Anthropic's token counting API\n`);
});
