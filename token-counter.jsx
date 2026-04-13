import { useState, useCallback, useRef, useMemo } from "react";

// ─── Model Pricing Data ───────────────────────────────────────────────
const MODELS = [
  {
    id: "claude-opus-4-6",
    name: "Opus 4.6",
    tier: "Most Capable",
    inputPer1M: 5.0,
    outputPer1M: 25.0,
    batchInputPer1M: 2.5,
    batchOutputPer1M: 12.5,
    cacheReadPer1M: 0.5,
    cacheWritePer1M: 6.25,
    color: "#7C3AED",
    bgLight: "#F5F3FF",
    borderLight: "#DDD6FE",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Sonnet 4.6",
    tier: "Balanced",
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    batchInputPer1M: 1.5,
    batchOutputPer1M: 7.5,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
    color: "#2563EB",
    bgLight: "#EFF6FF",
    borderLight: "#BFDBFE",
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Haiku 4.5",
    tier: "Fastest",
    inputPer1M: 1.0,
    outputPer1M: 5.0,
    batchInputPer1M: 0.5,
    batchOutputPer1M: 2.5,
    cacheReadPer1M: 0.1,
    cacheWritePer1M: 1.25,
    color: "#059669",
    bgLight: "#ECFDF5",
    borderLight: "#A7F3D0",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────
function formatCost(dollars) {
  if (dollars < 0.001) return `$${dollars.toFixed(6)}`;
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 1) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function estimateTokenCount(text) {
  if (!text || !text.trim()) return 0;
  const charCount = text.length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const charEstimate = Math.ceil(charCount / 4);
  const wordEstimate = Math.ceil(wordCount * 1.33);
  return Math.ceil((charEstimate + wordEstimate) / 2);
}

// ─── Token Optimization Engine ────────────────────────────────────────
// Each rule: { id, check(prompt, system, tokens), severity, category }
// check returns null (no issue) or { title, detail, savingsPercent, savingsTokens?, fix? }

const OPTIMIZATION_RULES = [
  // ── Prompt Structure ──
  {
    id: "no-system-prompt",
    category: "structure",
    check: (prompt, system, tokens) => {
      if (system && system.trim().length > 0) return null;
      // Look for instruction-like content that should be a system prompt
      const instructionPatterns = [
        /you are a/i, /act as/i, /your role/i, /you should always/i,
        /respond in/i, /format your/i, /always include/i, /never include/i,
        /you must/i, /your task is/i, /instructions:/i, /guidelines:/i,
      ];
      const hasInstructions = instructionPatterns.some((p) => p.test(prompt));
      if (!hasInstructions) return null;
      const instructionLines = prompt.split("\n").filter((line) =>
        instructionPatterns.some((p) => p.test(line))
      );
      const estInstructionTokens = Math.max(estimateTokenCount(instructionLines.join("\n")), Math.round(tokens * 0.15));
      return {
        title: "Move instructions to a system prompt",
        detail:
          "Your prompt contains behavioral instructions (\"you are\", \"act as\", etc.) mixed in with the user message. Moving these to a dedicated system prompt makes them cacheable with Anthropic's prompt caching, meaning you'd only pay full price once, then 90% less on subsequent requests.",
        savingsPercent: 0,
        savingsTokens: 0,
        cacheSavingsTokens: estInstructionTokens,
        fix: "caching",
      };
    },
  },
  {
    id: "caching-opportunity",
    category: "structure",
    check: (prompt, system, tokens) => {
      if (!system || system.trim().length === 0) return null;
      const sysTokens = estimateTokenCount(system);
      if (sysTokens < 200) return null;
      return {
        title: "Enable prompt caching on your system prompt",
        detail: `Your system prompt is ~${formatTokens(sysTokens)} tokens. With prompt caching enabled, repeat calls pay only 10% of the input price for cached content. At 100 requests/day, this saves ~${formatTokens(Math.round(sysTokens * 99 * 0.9))} tokens worth of cost daily.`,
        savingsPercent: 0,
        savingsTokens: 0,
        cacheSavingsTokens: sysTokens,
        fix: "caching",
      };
    },
  },
  // ── Redundancy & Verbosity ──
  {
    id: "repeated-phrases",
    category: "redundancy",
    check: (prompt, system, tokens) => {
      const text = prompt + " " + (system || "");
      const sentences = text.split(/[.!?\n]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 20);
      const seen = {};
      const dupes = [];
      for (const s of sentences) {
        if (seen[s]) {
          dupes.push(s);
        } else {
          seen[s] = true;
        }
      }
      if (dupes.length === 0) return null;
      const dupeTokens = dupes.reduce((sum, d) => sum + estimateTokenCount(d), 0);
      return {
        title: `${dupes.length} repeated sentence${dupes.length > 1 ? "s" : ""} detected`,
        detail: `Found duplicate sentences that can be removed: "${dupes[0].slice(0, 60)}..."${dupes.length > 1 ? ` and ${dupes.length - 1} more` : ""}. Removing these saves ~${formatTokens(dupeTokens)} tokens per request.`,
        savingsPercent: Math.round((dupeTokens / Math.max(tokens, 1)) * 100),
        savingsTokens: dupeTokens,
        fix: "edit",
      };
    },
  },
  {
    id: "verbose-phrasing",
    category: "redundancy",
    check: (prompt, system, tokens) => {
      const text = prompt + " " + (system || "");
      const verbosePatterns = [
        { pattern: /I would like you to please/gi, replacement: "Please" },
        { pattern: /Could you please be so kind as to/gi, replacement: "Please" },
        { pattern: /It is important to note that/gi, replacement: "(remove — just state the fact)" },
        { pattern: /In order to/gi, replacement: "To" },
        { pattern: /Please make sure that you/gi, replacement: "Please" },
        { pattern: /I want you to/gi, replacement: "(just state the instruction)" },
        { pattern: /What I need you to do is/gi, replacement: "(just state the instruction)" },
        { pattern: /It should be noted that/gi, replacement: "(remove — just state the fact)" },
        { pattern: /The reason for this is because/gi, replacement: "Because" },
        { pattern: /Due to the fact that/gi, replacement: "Because" },
        { pattern: /In the event that/gi, replacement: "If" },
        { pattern: /At this point in time/gi, replacement: "Now" },
        { pattern: /For the purpose of/gi, replacement: "To" },
        { pattern: /In spite of the fact that/gi, replacement: "Although" },
        { pattern: /With regard to/gi, replacement: "About" },
        { pattern: /It is essential that/gi, replacement: "(just state the instruction)" },
        { pattern: /Please ensure that/gi, replacement: "Ensure" },
        { pattern: /I would appreciate it if you could/gi, replacement: "Please" },
      ];
      const matches = [];
      for (const { pattern, replacement } of verbosePatterns) {
        const found = text.match(pattern);
        if (found) {
          matches.push({ phrase: found[0], replacement, count: found.length });
        }
      }
      if (matches.length === 0) return null;
      const estSavings = matches.reduce((sum, m) => sum + estimateTokenCount(m.phrase) * m.count * 0.5, 0);
      const topExamples = matches.slice(0, 3).map((m) => `"${m.phrase}" → ${m.replacement}`).join("; ");
      return {
        title: `${matches.length} verbose phrase pattern${matches.length > 1 ? "s" : ""} found`,
        detail: `Tightening wordy phrases saves tokens without losing meaning. Examples: ${topExamples}.`,
        savingsPercent: Math.round((estSavings / Math.max(tokens, 1)) * 100),
        savingsTokens: Math.round(estSavings),
        fix: "edit",
      };
    },
  },
  // ── Content Optimization ──
  {
    id: "excessive-examples",
    category: "content",
    check: (prompt, system, tokens) => {
      const text = prompt + " " + (system || "");
      const exampleMarkers = text.match(/(example\s*\d|e\.g\.|for instance|such as|here is an example|sample \d|example:)/gi);
      if (!exampleMarkers || exampleMarkers.length < 4) return null;
      const estExampleTokens = Math.round(tokens * 0.3);
      return {
        title: `${exampleMarkers.length} examples detected — consider reducing`,
        detail:
          "Claude typically needs only 2-3 well-chosen examples to understand a pattern. More examples add tokens without proportionally improving quality. Consider keeping your best 2-3 and removing the rest.",
        savingsPercent: Math.round(((exampleMarkers.length - 3) / exampleMarkers.length) * 30),
        savingsTokens: Math.round(estExampleTokens * ((exampleMarkers.length - 3) / exampleMarkers.length)),
        fix: "edit",
      };
    },
  },
  {
    id: "large-pasted-content",
    category: "content",
    check: (prompt, system, tokens) => {
      if (tokens < 2000) return null;
      // Look for signs of pasted documents
      const indicators = [
        prompt.split("\n").length > 80,
        /\b(chapter|section|page|abstract|introduction|conclusion|references)\b/gi.test(prompt),
        prompt.length > 10000,
      ];
      const score = indicators.filter(Boolean).length;
      if (score < 2) return null;
      return {
        title: "Large document pasted — consider pre-processing",
        detail:
          "This prompt appears to contain a large pasted document. Consider extracting only the relevant sections, summarizing first with a cheaper Haiku call, or using document-level prompt caching if you'll query this document multiple times.",
        savingsPercent: 40,
        savingsTokens: Math.round(tokens * 0.4),
        fix: "strategy",
      };
    },
  },
  {
    id: "whitespace-bloat",
    category: "content",
    check: (prompt, system, tokens) => {
      const text = prompt + " " + (system || "");
      const compressed = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      const savedChars = text.length - compressed.length;
      const savedTokens = Math.round(savedChars / 4);
      if (savedTokens < 20) return null;
      return {
        title: "Excess whitespace can be trimmed",
        detail: `Found ~${savedChars} unnecessary whitespace characters (extra blank lines, repeated spaces, excessive indentation). Compressing these saves ~${formatTokens(savedTokens)} tokens.`,
        savingsPercent: Math.round((savedTokens / Math.max(tokens, 1)) * 100),
        savingsTokens: savedTokens,
        fix: "auto",
      };
    },
  },
  // ── Cost Strategy ──
  {
    id: "model-downgrade",
    category: "strategy",
    check: (prompt, system, tokens) => {
      const text = (prompt + " " + (system || "")).toLowerCase();
      const simpleTaskPatterns = [
        /summarize/i, /extract/i, /classify/i, /categorize/i,
        /translate/i, /format/i, /convert/i, /list/i, /sort/i,
        /rewrite/i, /proofread/i, /spell.?check/i, /grammar/i,
      ];
      const isSimple = simpleTaskPatterns.filter((p) => p.test(text)).length >= 1;
      if (!isSimple || tokens > 8000) return null;
      const sonnetCost = (tokens / 1_000_000) * 3;
      const haikuCost = (tokens / 1_000_000) * 1;
      const savings = sonnetCost - haikuCost;
      return {
        title: "This task may work well with a smaller model",
        detail:
          "Tasks like summarization, extraction, classification, translation, and formatting often perform well on Haiku 4.5 at 1/3 the cost of Sonnet (and 1/5 of Opus). Consider testing with Haiku first and only upgrading if quality isn't sufficient.",
        savingsPercent: 67,
        savingsTokens: 0,
        costSavings: savings,
        fix: "strategy",
      };
    },
  },
  {
    id: "batch-api",
    category: "strategy",
    check: (prompt, system, tokens) => {
      if (tokens < 100) return null;
      return {
        title: "Use the Batch API for non-urgent requests",
        detail:
          "If this request doesn't need a real-time response, the Batch API provides a flat 50% discount on both input and output tokens. Batches process within 24 hours and are ideal for data processing, content generation, and analysis pipelines.",
        savingsPercent: 50,
        savingsTokens: 0,
        fix: "strategy",
      };
    },
  },
  {
    id: "output-constraint",
    category: "strategy",
    check: (prompt, system, tokens) => {
      const text = (prompt + " " + (system || "")).toLowerCase();
      const hasConstraint = /(be (brief|concise|short)|max(imum)?\s*\d+\s*(word|sentence|paragraph|token)|keep.*(short|brief)|limit.*(response|answer|output))/i.test(text);
      if (hasConstraint) return null;
      return {
        title: "Add output length constraints",
        detail:
          "Your prompt doesn't specify a desired output length. Adding instructions like \"respond in 2-3 sentences\" or \"keep your answer under 200 words\" prevents Claude from generating unnecessarily long responses, directly reducing output token costs (which are 3-5x more expensive than input tokens).",
        savingsPercent: 0,
        savingsTokens: 0,
        fix: "edit",
      };
    },
  },
  {
    id: "xml-structure",
    category: "structure",
    check: (prompt, system, tokens) => {
      const text = prompt + " " + (system || "");
      // Check if they're using XML tags efficiently
      const xmlTags = text.match(/<[a-zA-Z_][^>]*>/g);
      if (!xmlTags || xmlTags.length < 2) return null;
      // Check for very long tag names
      const longTags = xmlTags.filter((t) => t.length > 25);
      if (longTags.length === 0) return null;
      const savings = longTags.reduce((sum, t) => sum + (t.length - 10) * 2, 0); // opening + closing
      const savedTokens = Math.round(savings / 4);
      return {
        title: "Shorten XML tag names",
        detail: `Found ${longTags.length} verbose XML tag name${longTags.length > 1 ? "s" : ""} (e.g., ${longTags[0]}). Claude works just as well with short names like <ctx>, <inst>, <ex>. This saves ~${formatTokens(savedTokens)} tokens.`,
        savingsPercent: Math.round((savedTokens / Math.max(tokens, 1)) * 100),
        savingsTokens: savedTokens,
        fix: "edit",
      };
    },
  },
  {
    id: "repeated-context-hint",
    category: "strategy",
    check: (prompt, system, tokens) => {
      if (tokens < 500) return null;
      const text = prompt + " " + (system || "");
      const hasConversation = /\b(conversation|chat|history|previous|earlier|above)\b/i.test(text);
      if (!hasConversation) return null;
      return {
        title: "Use prompt caching for multi-turn conversations",
        detail:
          "This prompt references conversation history. With prompt caching, you pay full price for the conversation prefix only once, then just 10% on subsequent turns. For a 10-turn conversation, this can reduce total input costs by 50-80%.",
        savingsPercent: 60,
        savingsTokens: 0,
        cacheSavingsTokens: Math.round(tokens * 0.6),
        fix: "caching",
      };
    },
  },
];

function analyzePrompt(prompt, system) {
  const combinedTokens = estimateTokenCount((prompt || "") + " " + (system || ""));
  if (!prompt || !prompt.trim()) return { suggestions: [], score: 100, tokens: 0 };

  const suggestions = [];
  for (const rule of OPTIMIZATION_RULES) {
    try {
      const result = rule.check(prompt, system, combinedTokens);
      if (result) {
        suggestions.push({ ...result, id: rule.id, category: rule.category });
      }
    } catch (e) {
      // Skip rules that error
    }
  }

  // Sort: highest savings first, then by category priority
  const catOrder = { redundancy: 0, content: 1, structure: 2, strategy: 3 };
  suggestions.sort((a, b) => {
    if (b.savingsPercent !== a.savingsPercent) return b.savingsPercent - a.savingsPercent;
    return (catOrder[a.category] || 9) - (catOrder[b.category] || 9);
  });

  // Score: 100 = no issues, lower = more room to optimize
  const totalSavingsPercent = suggestions.reduce((s, r) => s + (r.savingsPercent || 0), 0);
  const score = Math.max(0, Math.min(100, 100 - Math.min(totalSavingsPercent, 80)));

  return { suggestions, score, tokens: combinedTokens };
}

// ─── Severity & Category Styles ───────────────────────────────────────
const CATEGORY_META = {
  redundancy: { label: "Redundancy", color: "#DC2626", bg: "#FEF2F2", icon: "x" },
  content: { label: "Content", color: "#D97706", bg: "#FFFBEB", icon: "!" },
  structure: { label: "Structure", color: "#2563EB", bg: "#EFF6FF", icon: "~" },
  strategy: { label: "Strategy", color: "#059669", bg: "#ECFDF5", icon: "$" },
};

const FIX_LABELS = {
  edit: "Edit prompt",
  auto: "Auto-fixable",
  caching: "Enable caching",
  strategy: "API strategy",
};

// ─── Components ───────────────────────────────────────────────────────

function SuggestionCard({ suggestion, index }) {
  const [expanded, setExpanded] = useState(index < 3);
  const cat = CATEGORY_META[suggestion.category] || CATEGORY_META.strategy;

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E5E7EB",
        borderRadius: 10,
        marginBottom: 10,
        overflow: "hidden",
        borderLeft: `4px solid ${cat.color}`,
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            background: cat.bg,
            color: cat.color,
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            whiteSpace: "nowrap",
          }}
        >
          {cat.label}
        </span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: "#1F2937" }}>
          {suggestion.title}
        </span>
        {(suggestion.savingsPercent > 0 || suggestion.cacheSavingsTokens > 0) && (
          <span
            style={{
              background: "#ECFDF5",
              color: "#059669",
              fontSize: 12,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              whiteSpace: "nowrap",
            }}
          >
            {suggestion.savingsPercent > 0
              ? `~${suggestion.savingsPercent}% savings`
              : suggestion.cacheSavingsTokens
              ? `~${formatTokens(suggestion.cacheSavingsTokens)} cacheable`
              : ""}
          </span>
        )}
        <span style={{ color: "#9CA3AF", fontSize: 16, transform: expanded ? "rotate(180deg)" : "none", transition: "0.15s" }}>
          ▾
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 14px 16px" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#4B5563", lineHeight: 1.65 }}>
            {suggestion.detail}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {suggestion.fix && (
              <span
                style={{
                  fontSize: 11,
                  color: "#6B7280",
                  background: "#F3F4F6",
                  padding: "3px 10px",
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                {FIX_LABELS[suggestion.fix] || suggestion.fix}
              </span>
            )}
            {suggestion.savingsTokens > 0 && (
              <span style={{ fontSize: 11, color: "#059669", fontWeight: 600 }}>
                Save ~{formatTokens(suggestion.savingsTokens)} tokens/request
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OptimizationScore({ score }) {
  const getColor = (s) => {
    if (s >= 80) return "#059669";
    if (s >= 50) return "#D97706";
    return "#DC2626";
  };
  const getLabel = (s) => {
    if (s >= 90) return "Well optimized";
    if (s >= 70) return "Good, some room to improve";
    if (s >= 50) return "Several optimizations available";
    return "Significant savings possible";
  };
  const color = getColor(score);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
      <div
        style={{
          position: "relative",
          width: 64,
          height: 64,
        }}
      >
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="#E5E7EB" strokeWidth="6" />
          <circle
            cx="32"
            cy="32"
            r="28"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 175.9} 175.9`}
            transform="rotate(-90 32 32)"
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 18,
            color,
            fontFamily: "monospace",
          }}
        >
          {score}
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#1F2937" }}>
          Optimization Score
        </div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>{getLabel(score)}</div>
      </div>
    </div>
  );
}

function OptimizerPanel({ prompt, systemPrompt, inputTokens }) {
  const analysis = useMemo(
    () => analyzePrompt(prompt, systemPrompt),
    [prompt, systemPrompt]
  );

  if (!prompt || !prompt.trim()) return null;

  const totalSavableTokens = analysis.suggestions.reduce(
    (sum, s) => sum + (s.savingsTokens || 0),
    0
  );
  const totalCacheableTokens = analysis.suggestions.reduce(
    (sum, s) => sum + (s.cacheSavingsTokens || 0),
    0
  );
  const tokensUsed = inputTokens || analysis.tokens;

  return (
    <div
      style={{
        background: "#FAFAFA",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        padding: 24,
        marginTop: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1F2937" }}>
          Token Optimizer
        </h2>
        {analysis.suggestions.length > 0 && (
          <span style={{ fontSize: 13, color: "#6B7280" }}>
            {analysis.suggestions.length} suggestion{analysis.suggestions.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <OptimizationScore score={analysis.score} />

      {/* Summary stats */}
      {(totalSavableTokens > 0 || totalCacheableTokens > 0) && (
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          {totalSavableTokens > 0 && (
            <div
              style={{
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                borderRadius: 8,
                padding: "10px 16px",
                flex: 1,
                minWidth: 180,
              }}
            >
              <div style={{ fontSize: 11, color: "#059669", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Potential Token Savings
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#059669", fontFamily: "monospace" }}>
                {formatTokens(totalSavableTokens)}
              </div>
              <div style={{ fontSize: 12, color: "#6B7280" }}>
                {Math.round((totalSavableTokens / Math.max(tokensUsed, 1)) * 100)}% of current input
              </div>
            </div>
          )}
          {totalCacheableTokens > 0 && (
            <div
              style={{
                background: "#EFF6FF",
                border: "1px solid #BFDBFE",
                borderRadius: 8,
                padding: "10px 16px",
                flex: 1,
                minWidth: 180,
              }}
            >
              <div style={{ fontSize: 11, color: "#2563EB", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Cacheable Tokens
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#2563EB", fontFamily: "monospace" }}>
                {formatTokens(totalCacheableTokens)}
              </div>
              <div style={{ fontSize: 12, color: "#6B7280" }}>
                90% cheaper on repeat calls
              </div>
            </div>
          )}
        </div>
      )}

      {/* Suggestion cards */}
      {analysis.suggestions.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 24,
            color: "#059669",
            fontSize: 14,
          }}
        >
          Your prompt looks well-optimized! No major savings found.
        </div>
      ) : (
        analysis.suggestions.map((s, i) => (
          <SuggestionCard key={s.id} suggestion={s} index={i} />
        ))
      )}

      {/* Quick reference */}
      <div
        style={{
          marginTop: 20,
          padding: 16,
          background: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 8,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, color: "#1F2937", marginBottom: 10 }}>
          Quick Reference: Top Token-Saving Strategies
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px", fontSize: 12, color: "#4B5563", lineHeight: 1.6 }}>
          <div><strong style={{ color: "#059669" }}>Prompt Caching</strong> — 90% off repeat content</div>
          <div><strong style={{ color: "#059669" }}>Batch API</strong> — 50% off all tokens</div>
          <div><strong style={{ color: "#059669" }}>Model Selection</strong> — Haiku is 1/5 the cost of Opus</div>
          <div><strong style={{ color: "#059669" }}>Output Constraints</strong> — Limit verbose responses</div>
          <div><strong style={{ color: "#059669" }}>Fewer Examples</strong> — 2-3 is usually enough</div>
          <div><strong style={{ color: "#059669" }}>Pre-processing</strong> — Summarize before querying</div>
        </div>
      </div>

      {/* Optimizer caveats */}
      <div
        style={{
          marginTop: 20,
          padding: 16,
          background: "#FFFBEB",
          border: "1px solid #FDE68A",
          borderRadius: 8,
          fontSize: 12,
          color: "#92400E",
          lineHeight: 1.65,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
          What these suggestions can and can't tell you
        </div>
        <div style={{ marginBottom: 6 }}>
          <strong>Savings estimates are approximate.</strong> Token savings are based on the local heuristic estimator, not the actual tokenizer. Use Exact Count mode for precise measurements.
        </div>
        <div style={{ marginBottom: 6 }}>
          <strong>Caching savings depend on your usage patterns.</strong> The optimizer flags tokens that <em>could</em> be cached, but actual savings require implementing the <code style={{ background: "#FEF3C7", padding: "1px 4px", borderRadius: 3 }}>cache_control</code> parameter and making repeat requests within the cache TTL (5 min or 1 hour).
        </div>
        <div style={{ marginBottom: 6 }}>
          <strong>Model downgrade suggestions need testing.</strong> When we suggest Haiku might work, it's based on task type patterns. Always validate output quality for your specific use case before switching models in production.
        </div>
        <div>
          <strong>Hidden overhead isn't analyzed.</strong> Tool definitions, image inputs, and internal system tokens (300-700+ per request) add to your actual bill but aren't reflected in these suggestions.
        </div>
      </div>
    </div>
  );
}

function CostCard({ model, inputTokens, outputTokens, showBatch }) {
  const inputCost = (inputTokens / 1_000_000) * model.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * model.outputPer1M;
  const totalCost = inputCost + outputCost;

  const batchInputCost = (inputTokens / 1_000_000) * model.batchInputPer1M;
  const batchOutputCost = (outputTokens / 1_000_000) * model.batchOutputPer1M;
  const batchTotalCost = batchInputCost + batchOutputCost;

  return (
    <div
      style={{
        background: model.bgLight,
        border: `1px solid ${model.borderLight}`,
        borderRadius: 12,
        padding: 20,
        flex: 1,
        minWidth: 220,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: model.color }} />
        <span style={{ fontWeight: 700, fontSize: 16, color: "#1F2937" }}>{model.name}</span>
      </div>
      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16 }}>{model.tier}</div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
          Standard API
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#4B5563", marginBottom: 2 }}>
          <span>Input</span>
          <span style={{ fontFamily: "monospace" }}>{formatCost(inputCost)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#4B5563", marginBottom: 2 }}>
          <span>Output</span>
          <span style={{ fontFamily: "monospace" }}>{formatCost(outputCost)}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 15,
            fontWeight: 700,
            color: model.color,
            borderTop: `1px solid ${model.borderLight}`,
            paddingTop: 6,
            marginTop: 4,
          }}
        >
          <span>Total</span>
          <span style={{ fontFamily: "monospace" }}>{formatCost(totalCost)}</span>
        </div>
      </div>

      {showBatch && (
        <div>
          <div style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Batch API (50% off)
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#4B5563", marginBottom: 2 }}>
            <span>Input</span>
            <span style={{ fontFamily: "monospace" }}>{formatCost(batchInputCost)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#4B5563", marginBottom: 2 }}>
            <span>Output</span>
            <span style={{ fontFamily: "monospace" }}>{formatCost(batchOutputCost)}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 15,
              fontWeight: 700,
              color: model.color,
              borderTop: `1px solid ${model.borderLight}`,
              paddingTop: 6,
              marginTop: 4,
            }}
          >
            <span>Total</span>
            <span style={{ fontFamily: "monospace" }}>{formatCost(batchTotalCost)}</span>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 12 }}>
        ${model.inputPer1M}/MTok in &middot; ${model.outputPer1M}/MTok out
      </div>
    </div>
  );
}

function ScaleEstimator({ inputTokens, outputTokens }) {
  const [requestsPerDay, setRequestsPerDay] = useState(100);

  if (!inputTokens) return null;

  const dailyCosts = MODELS.map((m) => {
    const dailyInput = (inputTokens * requestsPerDay) / 1_000_000;
    const dailyOutput = (outputTokens * requestsPerDay) / 1_000_000;
    return {
      model: m.name,
      color: m.color,
      daily: dailyInput * m.inputPer1M + dailyOutput * m.outputPer1M,
      monthly: (dailyInput * m.inputPer1M + dailyOutput * m.outputPer1M) * 30,
    };
  });

  return (
    <div
      style={{
        background: "#F9FAFB",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        padding: 20,
        marginTop: 20,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, color: "#1F2937", marginBottom: 12 }}>
        Scale Estimator
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "#4B5563" }}>Requests per day:</label>
        <input
          type="number"
          value={requestsPerDay}
          onChange={(e) => setRequestsPerDay(Math.max(1, parseInt(e.target.value) || 1))}
          style={{
            width: 100,
            padding: "6px 10px",
            border: "1px solid #D1D5DB",
            borderRadius: 6,
            fontSize: 14,
            fontFamily: "monospace",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {dailyCosts.map((c) => (
          <div
            key={c.model}
            style={{
              flex: 1,
              minWidth: 150,
              padding: 12,
              background: "white",
              borderRadius: 8,
              border: "1px solid #E5E7EB",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: c.color, marginBottom: 8 }}>
              {c.model}
            </div>
            <div style={{ fontSize: 12, color: "#6B7280" }}>
              Daily: <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#1F2937" }}>{formatCost(c.daily)}</span>
            </div>
            <div style={{ fontSize: 12, color: "#6B7280" }}>
              Monthly: <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#1F2937" }}>{formatCost(c.monthly)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Limitations Section ──────────────────────────────────────────────
function LimitationsSection() {
  const [expanded, setExpanded] = useState(false);

  const caveats = [
    {
      title: "Local estimate accuracy",
      detail: "Quick Estimate uses a heuristic that averages character-based (~4 chars/token) and word-based (~1.33 tokens/word) counts. This is a reasonable approximation for standard English prose, but can diverge significantly for code (symbols and indentation tokenize differently), non-Latin scripts (especially CJK, which often use more tokens per character), and heavily structured content like JSON, XML, or markdown tables. For budget-critical decisions, always use Exact Count mode.",
    },
    {
      title: "Output tokens are unpredictable",
      detail: "The Anthropic token counting API only measures input tokens. The output slider in this app is a manual estimate — actual output length depends on the task complexity, how Claude interprets the prompt, and whether you've set max_tokens in your API call. Output tokens are 3-5x more expensive than input tokens, so underestimating output length can meaningfully affect cost projections.",
    },
    {
      title: "Hidden system token overhead",
      detail: "When you use features like tool definitions, computer use, or text editor tools, Claude automatically injects internal system prompt tokens (roughly 300-700+ tokens depending on the model and tools configured). These are billed as input tokens but don't appear in your prompt text. This app counts only what you type — so real API bills will be higher than shown, especially for tool-heavy workflows.",
    },
    {
      title: "Prompt caching requires implementation",
      detail: "The optimizer flags content that could benefit from caching, but savings only materialize if you actually implement the cache_control parameter in your API calls and make repeat requests within the cache window (5 minutes or 1 hour). One-off requests see no caching benefit, and cached content must meet a minimum size threshold that varies by model.",
    },
    {
      title: "Pricing is a point-in-time snapshot",
      detail: "Token rates in this app are hardcoded based on Anthropic's published pricing as of April 2026. If Anthropic adjusts pricing, introduces new models, or changes tier structures, the cost figures here will be stale until manually updated. Always cross-check against the official pricing page for budget approvals.",
    },
    {
      title: "Cost figures are a lower bound",
      detail: "The costs shown reflect only the tokens you can see in this tool. Real-world API costs also include: output tokens (which depend on Claude's response), tool-use system tokens, any image/PDF input tokens, web search charges ($10/1,000 searches), and potential long-context premiums. Treat the figures here as a floor, not a ceiling.",
    },
  ];

  return (
    <div
      style={{
        marginTop: 28,
        border: "1px solid #E5E7EB",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          background: "#F9FAFB",
          border: "none",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 700,
          color: "#374151",
        }}
      >
        <span>Limitations & Caveats</span>
        <span style={{ color: "#9CA3AF", fontSize: 16, transform: expanded ? "rotate(180deg)" : "none", transition: "0.15s" }}>
          ▾
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "0 20px 20px" }}>
          <p style={{ fontSize: 13, color: "#6B7280", marginTop: 12, marginBottom: 16, lineHeight: 1.5 }}>
            This tool provides estimates to help your team plan and optimize Claude API usage. Keep these limitations in mind when making budget decisions.
          </p>
          {caveats.map((c, i) => (
            <div
              key={i}
              style={{
                marginBottom: 14,
                paddingBottom: 14,
                borderBottom: i < caveats.length - 1 ? "1px solid #F3F4F6" : "none",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: "#1F2937", marginBottom: 4 }}>
                {i + 1}. {c.title}
              </div>
              <div style={{ fontSize: 12, color: "#4B5563", lineHeight: 1.6 }}>
                {c.detail}
              </div>
            </div>
          ))}
          <div
            style={{
              marginTop: 8,
              padding: "10px 14px",
              background: "#EFF6FF",
              borderRadius: 6,
              fontSize: 12,
              color: "#1E40AF",
              lineHeight: 1.5,
            }}
          >
            For the most current pricing and API details, see{" "}
            <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noopener noreferrer" style={{ color: "#1E40AF" }}>
              Anthropic's official pricing
            </a>{" "}
            and the{" "}
            <a href="https://platform.claude.com/docs/en/api/messages-count-tokens" target="_blank" rel="noopener noreferrer" style={{ color: "#1E40AF" }}>
              token counting API reference
            </a>.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────
export default function TokenCounter() {
  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [inputTokens, setInputTokens] = useState(null);
  const [outputTokens, setOutputTokens] = useState(256);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("estimate");
  const [showBatch, setShowBatch] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [activeTab, setActiveTab] = useState("counter");

  const countViaAPI = useCallback(async () => {
    if (!apiKey.trim()) {
      setError("Please enter your Anthropic API key");
      return;
    }
    if (!prompt.trim()) {
      setError("Please enter a prompt to count");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = { model: "claude-sonnet-4-6", messages: [{ role: "user", content: prompt }] };
      if (systemPrompt.trim()) body.system = systemPrompt;
      const response = await fetch("http://localhost:3456/count-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, ...body }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `API error: ${response.status}`);
      }
      const data = await response.json();
      setInputTokens(data.input_tokens);
    } catch (err) {
      if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
        setError("Cannot reach the proxy server. Make sure server.js is running on port 3456.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [apiKey, prompt, systemPrompt]);

  const handleCount = useCallback(() => {
    if (mode === "estimate") {
      setInputTokens(estimateTokenCount(prompt + (systemPrompt || "")));
    } else {
      countViaAPI();
    }
  }, [mode, prompt, systemPrompt, countViaAPI]);

  const charCount = prompt.length + systemPrompt.length;

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#1F2937", margin: 0 }}>
          Claude Token Counter & Optimizer
        </h1>
        <p style={{ color: "#6B7280", fontSize: 14, marginTop: 6 }}>
          Count tokens, compare costs, and get suggestions to reduce token usage
        </p>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          borderBottom: "2px solid #E5E7EB",
          marginBottom: 24,
          gap: 0,
        }}
      >
        {[
          { key: "counter", label: "Token Counter" },
          { key: "optimizer", label: "Optimizer" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 24px",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid #D97706" : "2px solid transparent",
              marginBottom: -2,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              background: "none",
              color: activeTab === tab.key ? "#D97706" : "#6B7280",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mode toggle */}
      <div
        style={{
          display: "flex",
          background: "#F3F4F6",
          borderRadius: 8,
          padding: 3,
          marginBottom: 20,
          width: "fit-content",
        }}
      >
        {[
          { key: "estimate", label: "Quick Estimate" },
          { key: "api", label: "Exact Count (API)" },
        ].map((m) => (
          <button
            key={m.key}
            onClick={() => { setMode(m.key); setError(null); }}
            style={{
              padding: "8px 20px",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: mode === m.key ? "white" : "transparent",
              color: mode === m.key ? "#1F2937" : "#6B7280",
              boxShadow: mode === m.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Mode caveat */}
      {mode === "estimate" && (
        <div style={{ fontSize: 12, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "8px 12px", marginBottom: 16, lineHeight: 1.5 }}>
          <strong>Note:</strong> Quick Estimate uses a heuristic (~4 chars/token, ~1.33 tokens/word). Accuracy varies for code, JSON/XML, and non-English text. Use <strong>Exact Count</strong> for precise results.
        </div>
      )}

      {/* API Key */}
      {mode === "api" && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>API Key</label>
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              style={{ background: "none", border: "none", fontSize: 11, color: "#6B7280", cursor: "pointer", textDecoration: "underline" }}
            >
              {showApiKey ? "hide" : "show"}
            </button>
          </div>
          <input
            type={showApiKey ? "text" : "password"}
            placeholder="sk-ant-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{
              width: "100%", padding: "10px 14px", border: "1px solid #D1D5DB",
              borderRadius: 8, fontSize: 14, fontFamily: "monospace", boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
            Your key is only sent to the local proxy server, never stored.
          </div>
        </div>
      )}

      {/* System prompt */}
      <button
        onClick={() => setShowSystem(!showSystem)}
        style={{ background: "none", border: "none", fontSize: 13, color: "#6B7280", cursor: "pointer", marginBottom: 8, padding: 0, textDecoration: "underline" }}
      >
        {showSystem ? "Hide system prompt" : "+ Add system prompt"}
      </button>

      {showSystem && (
        <textarea
          placeholder="Enter your system prompt here..."
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          style={{
            width: "100%", minHeight: 80, padding: "12px 14px", border: "1px solid #D1D5DB",
            borderRadius: 8, fontSize: 14, fontFamily: "monospace", resize: "vertical",
            marginBottom: 12, boxSizing: "border-box", lineHeight: 1.5,
          }}
        />
      )}

      {/* Main textarea */}
      <textarea
        placeholder="Paste your prompt here to count tokens and get optimization suggestions..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        style={{
          width: "100%", minHeight: 180, padding: "14px 16px", border: "1px solid #D1D5DB",
          borderRadius: 10, fontSize: 14, fontFamily: "monospace", resize: "vertical",
          boxSizing: "border-box", lineHeight: 1.6,
        }}
      />

      {/* Count button row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#9CA3AF" }}>{charCount.toLocaleString()} characters</span>
        <button
          onClick={handleCount}
          disabled={loading || !prompt.trim()}
          style={{
            padding: "10px 28px", background: loading ? "#9CA3AF" : "#D97706",
            color: "white", border: "none", borderRadius: 8, fontSize: 14,
            fontWeight: 700, cursor: loading ? "default" : "pointer", transition: "background 0.15s",
          }}
        >
          {loading ? "Counting..." : mode === "api" ? "Count Tokens (API)" : "Estimate Tokens"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", color: "#B91C1C", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* ── Counter Tab ── */}
      {activeTab === "counter" && inputTokens !== null && (
        <div>
          <div
            style={{
              background: "white", border: "1px solid #E5E7EB", borderRadius: 10,
              padding: "16px 20px", marginBottom: 20, display: "flex", gap: 32,
              alignItems: "center", flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Input Tokens {mode === "estimate" ? "(est.)" : "(exact)"}
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#D97706", fontFamily: "monospace" }}>
                {formatTokens(inputTokens)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5 }}>Expected Output (manual estimate)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="range" min={1} max={8192} value={outputTokens}
                  onChange={(e) => setOutputTokens(parseInt(e.target.value))}
                  style={{ width: 120 }}
                />
                <span style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", fontFamily: "monospace" }}>
                  {formatTokens(outputTokens)}
                </span>
              </div>
              <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>
                Actual output varies by task. Output tokens cost 3-5x more than input.
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 12, color: "#6B7280" }}>Show Batch pricing</label>
              <input type="checkbox" checked={showBatch} onChange={(e) => setShowBatch(e.target.checked)} />
            </div>
          </div>

          {/* Hidden overhead note */}
          <div style={{ fontSize: 11, color: "#6B7280", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 12px", marginBottom: 16, lineHeight: 1.5 }}>
            <strong>Note:</strong> Costs shown reflect your prompt text only. Tool use definitions add ~300-700 hidden system tokens per request (not counted here). Treat these as a <strong>lower bound</strong> for budgeting.
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {MODELS.map((model) => (
              <CostCard key={model.id} model={model} inputTokens={inputTokens} outputTokens={outputTokens} showBatch={showBatch} />
            ))}
          </div>

          <ScaleEstimator inputTokens={inputTokens} outputTokens={outputTokens} />
        </div>
      )}

      {/* ── Optimizer Tab ── */}
      {activeTab === "optimizer" && (
        <OptimizerPanel prompt={prompt} systemPrompt={systemPrompt} inputTokens={inputTokens} />
      )}

      {/* Setup Guide */}
      {mode === "api" && (
        <div
          style={{
            background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10,
            padding: 20, marginTop: 24, fontSize: 13, color: "#92400E", lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Setup Guide for Exact Counting</div>
          <p style={{ margin: "0 0 8px" }}>
            Due to browser CORS restrictions, API calls go through a lightweight local proxy.
            Run the companion <code style={{ background: "#FEF3C7", padding: "1px 5px", borderRadius: 3 }}>server.js</code> file:
          </p>
          <pre style={{ background: "#1F2937", color: "#F9FAFB", padding: 14, borderRadius: 8, overflow: "auto", fontSize: 12, lineHeight: 1.5 }}>
{`# Install dependency (one-time)
npm install express

# Run the proxy server
node server.js`}
          </pre>
          <p style={{ margin: "8px 0 0" }}>
            The proxy runs on <code style={{ background: "#FEF3C7", padding: "1px 5px", borderRadius: 3 }}>localhost:3456</code> and
            forwards your requests to the Anthropic API. Your API key is never stored.
          </p>
        </div>
      )}

      {/* ── Limitations & Caveats Section ── */}
      <LimitationsSection />
    </div>
  );
}
