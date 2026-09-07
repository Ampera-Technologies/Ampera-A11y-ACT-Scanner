import { Router } from "express";
import { requireAuth } from "../middlewares/authMiddleware";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";

const router = Router();

const AI_PUBLIC_KEYS = [
  "ai_engine_enabled",
  "ai_external_enabled",
  "ai_external_provider",
  "ai_external_model",
  "smart_analysis_ai_enabled",
] as const;

// GET /api/ai/config
router.get("/ai/config", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [...AI_PUBLIC_KEYS]));
  const map: Record<string, string> = {};
  for (const r of rows) if (r.value != null) map[r.key] = r.value;
  res.json({
    engineEnabled: map["ai_engine_enabled"] !== "false",
    externalEnabled: map["ai_external_enabled"] === "true",
    provider: (map["ai_external_provider"] as "gemini" | "openai") ?? "gemini",
    model: map["ai_external_model"] ?? "",
    smartAnalysisAiEnabled: map["smart_analysis_ai_enabled"] === "true",
  });
});

// POST /api/ai/analyze
router.post("/ai/analyze", requireAuth, async (req, res): Promise<void> => {
  const ALL_AI_KEYS = [...AI_PUBLIC_KEYS, "ai_external_api_key"] as const;
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [...ALL_AI_KEYS]));
  const cfg: Record<string, string> = {};
  for (const r of rows) if (r.value != null) cfg[r.key] = r.value;

  if (cfg["ai_external_enabled"] !== "true") {
    res.status(403).json({ error: "External AI is not enabled." });
    return;
  }
  const apiKey = cfg["ai_external_api_key"];
  if (!apiKey) {
    res.status(503).json({ error: "External AI API key not configured." });
    return;
  }

  const { ruleId, description, element, elementContext, selector, pageUrl, wcagCriteria, wcagLevel } = req.body ?? {};
  if (!ruleId || !description) {
    res.status(400).json({ error: "ruleId and description are required." });
    return;
  }

  const provider = cfg["ai_external_provider"] ?? "gemini";
  const model = cfg["ai_external_model"] || (provider === "gemini" ? "gemini-2.0-flash" : "gpt-4o-mini");

  // elementContext = full element HTML with children (stored from scanner).
  // element = opening tag only (cloneNode(false) — used for Code View display).
  // When elementContext is absent the AI only sees the opening tag; flag this so
  // the prompt warns it not to fabricate visible text.
  const hasFullContext = !!(elementContext && elementContext.trim().length > 0);
  const htmlForAI = hasFullContext ? elementContext : element;
  const isAEM = detectAEM(element, pageUrl);
  const prompt = buildPrompt({ ruleId, description, element: htmlForAI, selector, pageUrl, wcagCriteria, wcagLevel, isAEM, hasFullContext });

  try {
    let text: string;
    if (provider === "gemini") {
      text = await callGemini(apiKey, model, prompt);
    } else {
      text = await callOpenAI(apiKey, model, prompt);
    }
    req.log.info({ rawAiPreview: text.slice(0, 600) }, "AI raw response preview");
    const parsed = parseAIResponse(text);
    if (parsed.whatIsTheIssue === "AI response could not be parsed.") {
      req.log.warn({ rawAi: text.slice(0, 2000) }, "AI response parse failed — raw text");
    }
    res.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `AI request failed: ${msg}` });
  }
});

// ─── AEM detection ────────────────────────────────────────────────────────────

function detectAEM(element?: string, pageUrl?: string): boolean {
  const html = element ?? "";
  const url = pageUrl ?? "";
  return (
    /data-sly-|data-cq-|\.dtmData|data-parentvalue|data-pub-key|\/content\/dam\/|jcr:content/.test(html) ||
    /keysight\.com|adobeaemcloud|\.html(\?|$)/.test(url)
  );
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(params: {
  ruleId: string;
  description: string;
  element?: string;
  selector?: string;
  pageUrl?: string;
  wcagCriteria?: string;
  wcagLevel?: string;
  isAEM?: boolean;
  hasFullContext?: boolean;
}): string {
  const { ruleId, description, element, selector, pageUrl, wcagCriteria, wcagLevel, isAEM, hasFullContext } = params;

  // Send more HTML to the AI — truncation was causing it to guess
  const MAX_HTML = 5000;
  const rawHtml = element ?? "";
  const elementSnippet = rawHtml.slice(0, MAX_HTML);
  const wasTruncated = rawHtml.length > MAX_HTML;

  const ctx: string[] = [`Rule: ${ruleId}`];
  if (wcagCriteria) ctx.push(`WCAG: ${wcagCriteria}${wcagLevel ? ` Level ${wcagLevel}` : ""}`);
  ctx.push(`Violation: ${description}`);
  if (pageUrl) ctx.push(`Page: ${pageUrl}`);
  if (selector) ctx.push(`Selector: ${selector}`);
  if (isAEM) ctx.push(`CMS: Adobe Experience Manager (AEM) — include HTL fix`);

  const contextWarning = !hasFullContext && elementSnippet
    ? `\n⚠ CONTEXT WARNING: The HTML below shows ONLY the element's opening tag — child elements are NOT included. Do NOT guess or invent the element's visible text content. Reason from aria-* attributes, data-value, data-content-type-name, and similar attribute values only. State clearly in whyIsItAnIssue what information is missing if needed.`
    : "";

  const elementBlock = elementSnippet
    ? `${contextWarning}\nFAILING ELEMENT HTML:\n\`\`\`html\n${elementSnippet}${wasTruncated ? "\n<!-- truncated -->" : ""}\n\`\`\``
    : "\nNo element HTML available — give general fix for this rule.";

  const htlField = isAEM
    ? `  "htlFix": "HTL (Sightly) template fix — use data-sly-* or Sling Model expression to set the correct attribute. Provide a complete, copy-ready snippet.",`
    : `  "htlFix": "",`;

  return `You are a WCAG accessibility engineer. Analyse the violation below and output a JSON remediation report.

RULES:
- Output ONLY a valid JSON object. No markdown, no explanations, no reasoning text.
- Every string value must be a final answer, not a reasoning step.
- Be concise. No filler sentences.
- Code fields must be complete, copy-ready snippets.
- howToFix steps: plain imperative sentences, no "Step N:" prefix, max 4 steps.
- CRITICAL: In htmlFix, htlFix, jsFix, cssFix, beforeCode, afterCode — use ONLY single quotes for HTML attribute values (e.g. href='...' not href="..."). Double quotes inside JSON strings break the response.

VIOLATION
${ctx.join("\n")}
${elementBlock}

OUTPUT this JSON object exactly (all fields required, use "" for non-applicable fields):
{
  "whatIsTheIssue": "≤15 words — name the accessibility problem",
  "whyIsItAnIssue": "≤40 words — explain why THIS element fails, citing actual attribute values or text from the HTML",
  "impact": "≤25 words — who is affected and how",
  "whatIsTheFix": "≤15 words — one-line solution",
  "howToFix": [
    "action 1",
    "action 2"
  ],
  "htmlFix": "complete corrected HTML element",
${htlField}
  "jsFix": "JS/React fix if the issue is set dynamically, else \"\"",
  "cssFix": "CSS fix if styling causes the issue, else \"\"",
  "beforeCode": "",
  "afterCode": "complete corrected HTML element — all original attributes preserved, only the accessibility fix applied",
  "notes": "WCAG technique refs only (e.g. H30, ARIA14), else \"\""
}`;
}

// ─── API callers ───────────────────────────────────────────────────────────────

async function callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.05,
      maxOutputTokens: 4000,
      responseMimeType: "application/json",
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Gemini API ${r.status}: ${err.slice(0, 200)}`);
  }
  const data = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callOpenAI(apiKey: string, model: string, prompt: string): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a WCAG accessibility engineer. Output only valid JSON — no markdown, no explanations, no reasoning." },
        { role: "user", content: prompt },
      ],
      temperature: 0.05,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`OpenAI API ${r.status}: ${err.slice(0, 200)}`);
  }
  const data = await r.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Types & parser ───────────────────────────────────────────────────────────

export interface AIAnalysisResult {
  whatIsTheIssue: string;
  whyIsItAnIssue: string;
  impact: string;
  whatIsTheFix: string;
  howToFix: string[];
  htmlFix: string;
  htlFix: string;
  jsFix: string;
  cssFix: string;
  beforeCode: string;
  afterCode: string;
  notes: string;
  /** @deprecated use whyIsItAnIssue */
  why: string;
}

/**
 * Repair JSON that may contain unescaped double-quotes or control characters
 * inside string values — the most common Gemini failure mode for HTML code fields.
 *
 * Uses a state machine that tracks object/array nesting context to distinguish
 * legitimate string terminators from embedded HTML attribute quotes.
 *
 * Key heuristic:
 *   - A key string ends at " followed (ignoring whitespace) by ":"
 *   - A value string ends at " followed (ignoring whitespace) by "," "}" or "]"
 *   - Any other " inside a string is escaped to \"
 */
function repairJson(s: string): string {
  let out = "";
  let i = 0;
  const n = s.length;

  // Stack: 'o' = object, 'a' = array
  const ctxStack: ("o" | "a")[] = [];
  // After "{" or "," in an object context → next string is a key
  let expectKey = false;

  function skipWs(pos: number): number {
    while (pos < n && /\s/.test(s[pos])) pos++;
    return pos;
  }

  while (i < n) {
    const ch = s[i];

    if (ch === "{") {
      ctxStack.push("o"); expectKey = true;
      out += ch; i++; continue;
    }
    if (ch === "[") {
      ctxStack.push("a"); expectKey = false;
      out += ch; i++; continue;
    }
    if (ch === "}" || ch === "]") {
      ctxStack.pop();
      out += ch; i++; continue;
    }
    if (ch === ":") {
      expectKey = false;   // colon → next token is a value
      out += ch; i++; continue;
    }
    if (ch === ",") {
      expectKey = ctxStack[ctxStack.length - 1] === "o";  // object → next is key; array → value
      out += ch; i++; continue;
    }

    if (ch === '"') {
      const isKey = expectKey;
      out += '"'; i++;
      let stringClosed = false;

      while (i < n) {
        const c = s[i];
        if (c === "\\") {
          // Valid escape — copy both chars verbatim
          out += s[i++];
          if (i < n) out += s[i++];
        } else if (c === "\n") { out += "\\n"; i++; }
        else if (c === "\r") { out += "\\r"; i++; }
        else if (c === "\t") { out += "\\t"; i++; }
        else if (c === '"') {
          const nxt = skipWs(i + 1);
          const nxtCh = nxt < n ? s[nxt] : "";
          const isEnd = isKey
            ? nxtCh === ":"
            : (nxtCh === "," || nxtCh === "}" || nxtCh === "]" || nxt >= n);
          if (isEnd) { out += '"'; i++; stringClosed = true; break; }
          out += '\\"'; i++;   // embedded quote — escape it
        } else {
          out += s[i++];
        }
      }

      // Truncated mid-string (Gemini cut off the response): close the string.
      // The partial value is preserved up to the cut point, then closed.
      if (!stringClosed) {
        out += '"';
      }
      continue;
    }

    if (/\s/.test(ch)) {
      out += ch; i++; continue;
    }

    // Number, boolean, null — copy until structural delimiter
    while (i < n && !/[,\}\]\s]/.test(s[i])) out += s[i++];
  }

  // Epilogue: close any open JSON contexts left unclosed by a truncated response.
  // This turns a half-written JSON object into something JSON.parse can accept.
  for (let j = ctxStack.length - 1; j >= 0; j--) {
    out += ctxStack[j] === "o" ? "}" : "]";
  }

  return out;
}

function parseAIResponse(text: string): AIAnalysisResult {
  // Step 1: strip markdown fences
  let clean = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  // Step 2: extract outermost JSON object (handles any preamble/postamble Gemini emits)
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    clean = clean.slice(first, last + 1);
  }

  // Step 3: repair — fixes unescaped HTML attribute quotes AND literal newlines/tabs
  const repaired = repairJson(clean);

  // Step 4: parse (try both repaired and original in case repair itself introduced a bug)
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(repaired) as Record<string, unknown>;
  } catch {
    try {
      obj = JSON.parse(clean) as Record<string, unknown>;
    } catch {
      return {
        whatIsTheIssue: "AI response could not be parsed.",
        whyIsItAnIssue: "",
        impact: "", whatIsTheFix: "", howToFix: [],
        htmlFix: "", htlFix: "", jsFix: "", cssFix: "",
        beforeCode: "", afterCode: "", notes: "", why: "",
      };
    }
  }

  const howToFix = Array.isArray(obj.howToFix)
    ? (obj.howToFix as unknown[]).map(String)
    : obj.howToFix
      ? [String(obj.howToFix)]
      : [];
  return {
    whatIsTheIssue: String(obj.whatIsTheIssue ?? ""),
    whyIsItAnIssue: String(obj.whyIsItAnIssue ?? obj.why ?? ""),
    impact: String(obj.impact ?? ""),
    whatIsTheFix: String(obj.whatIsTheFix ?? ""),
    howToFix,
    htmlFix: String(obj.htmlFix ?? ""),
    htlFix: String(obj.htlFix ?? ""),
    jsFix: String(obj.jsFix ?? ""),
    cssFix: String(obj.cssFix ?? ""),
    beforeCode: String(obj.beforeCode ?? obj.codeExample ?? ""),
    afterCode: String(obj.afterCode ?? ""),
    notes: String(obj.notes ?? ""),
    why: String(obj.whyIsItAnIssue ?? obj.why ?? ""),
  };
}

export default router;
