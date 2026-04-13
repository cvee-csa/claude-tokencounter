/**
 * Claude Token Counter — Local Proxy Server
 *
 * This lightweight Express server proxies requests from the React frontend
 * to the Anthropic API, bypassing browser CORS restrictions.
 *
 * Usage:
 *   npm install express
 *   node server.js
 *
 * The server runs on port 3456 by default (set PORT env var to change).
 */

const express = require("express");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3456;

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
  console.log(`\n  Claude Token Counter proxy server running`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Endpoints:`);
  console.log(`    POST /count-tokens — proxies to Anthropic's token counting API\n`);
});
