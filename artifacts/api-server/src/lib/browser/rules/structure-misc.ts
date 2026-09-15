import type { ScanRawResult, PushStatFn } from "../types";
import { getAccessibleName } from "../accname";
import { getEffectiveAriaRole } from "../aria-data";
import { isImportantBlocked } from "../contrast";
import { elementContextForAI, getSelector, outerHtmlSnippet } from "../dom-helpers";
import { isIncludedInAccessibilityTree, isRendered, isVisible } from "../visibility";

export function runStructureMiscRules(results: ScanRawResult[], EMIT_MANUAL_ONLY_RULES: boolean, pushStat: PushStatFn): void {
  // ACT-R79: <pre> element contains text outside <code>/<kbd>/<samp>
  document.querySelectorAll("pre").forEach((el) => {
    if (!isRendered(el)) return;
    if (!isVisible(el)) return;
    if (!!el.closest("figure")) return;
    function hasUnwrappedText(node: Node): boolean {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length || 0) > 0) return true;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as Element).tagName.toLowerCase();
        if (["code","kbd","samp"].includes(tag)) return false;
        for (const child of Array.from(node.childNodes)) if (hasUnwrappedText(child)) return true;
      }
      return false;
    }
    if (hasUnwrappedText(el)) {
      results.push({ ruleId: "ACT-R79", type: "Best Practice", impact: "minor", description: "<pre> element contains text not wrapped in <code>, <kbd>, or <samp>", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ACT-R84(link): Link opens in new window without warning
  let visibleBlankTargetLinks = 0;
  document.querySelectorAll("a[target='_blank']").forEach((el) => {
    if (!isVisible(el)) return;
    visibleBlankTargetLinks++;
    const text = (el.textContent || "").toLowerCase();
    const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
    const title = (el.getAttribute("title") || "").toLowerCase();
    const hasWarning = ["new window","new tab","opens in","external"].some((w) => text.includes(w) || ariaLabel.includes(w) || title.includes(w));
    const hasIconHint = el.querySelector("[aria-label*='new'], [title*='new'], [aria-label*='external'], [title*='external']");
    if (!hasWarning && !hasIconHint) {
      if (EMIT_MANUAL_ONLY_RULES) results.push({ ruleId: "ACT-R84(link)", type: "Best Practice", impact: "moderate", description: "Link opens in a new window/tab without warning", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });
  if (visibleBlankTargetLinks > 0) {
    pushStat("ACT-R84", visibleBlankTargetLinks, "element");
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R91/R92/R93: letter/word/line-height locked with !important (WCAG 1.4.12)
  // ════════════════════════════════════════════════════════════════════════
  {
    const textEls = Array.from(document.querySelectorAll("p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote")).slice(0, 400);
    const r91Seen = new Set<string>(), r92Seen = new Set<string>(), r93Seen = new Set<string>();
    for (const el of textEls) {
      if (!(el instanceof HTMLElement)) continue;
      if (!isVisible(el)) continue;
      const hasDirectText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim()?.length || 0) > 0);
      if (!hasDirectText) continue;
      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      if (isNaN(fontSize) || fontSize <= 0) continue;
      const origLSStr = style.letterSpacing;
      if (origLSStr && origLSStr !== "normal") {
        const origLS = parseFloat(origLSStr);
        if (!isNaN(origLS) && origLS / fontSize < 0.12) {
          if (isImportantBlocked(el, "letter-spacing", "999px")) {
            const sel = getSelector(el);
            if (!r91Seen.has(sel)) { r91Seen.add(sel); results.push({ ruleId: "ACT-R91", type: "Potential Issue", impact: "moderate", description: `letter-spacing is locked with !important (${origLS.toFixed(1)}px, ${(origLS / fontSize).toFixed(3)}× font-size) below 0.12× minimum`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: sel }); }
          }
        }
      }
      const wsRaw = style.wordSpacing;
      if (wsRaw && wsRaw !== "normal") {
        const origWS = parseFloat(wsRaw);
        if (!isNaN(origWS) && origWS / fontSize < 0.16) {
          if (isImportantBlocked(el, "word-spacing", "999px")) {
            const sel = getSelector(el);
            if (!r92Seen.has(sel)) { r92Seen.add(sel); results.push({ ruleId: "ACT-R92", type: "Potential Issue", impact: "moderate", description: `word-spacing is locked with !important (${origWS.toFixed(1)}px, ${(origWS / fontSize).toFixed(3)}× font-size) below 0.16× minimum`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: sel }); }
          }
        }
      }
      const lhRaw = style.lineHeight;
      if (lhRaw && lhRaw !== "normal") {
        const origLH = parseFloat(lhRaw);
        if (!isNaN(origLH) && origLH / fontSize < 1.5) {
          if (isImportantBlocked(el, "line-height", "999")) {
            const sel = getSelector(el);
            if (!r93Seen.has(sel)) { r93Seen.add(sel); results.push({ ruleId: "ACT-R93", type: "Potential Issue", impact: "moderate", description: `line-height is locked with !important (${(origLH / fontSize).toFixed(2)}× below 1.5× minimum)`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: sel }); }
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R94 (radio grouping): Radio buttons not in fieldset (WCAG 1.3.1)
  // ════════════════════════════════════════════════════════════════════════
  {
    const radioGroups: Record<string, HTMLInputElement[]> = {};
    document.querySelectorAll("input[type='radio']:not([disabled])").forEach((el) => {
      const input = el as HTMLInputElement;
      if (!isVisible(input)) return;
      const name = input.name || "_ungrouped_";
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(input);
    });
    Object.values(radioGroups).forEach((inputs) => {
      if (inputs.length < 2) return;
      if (!inputs[0].closest("fieldset")) {
        results.push({ ruleId: "ACT-R60", type: "Issue", impact: "moderate", description: `Radio button group "${inputs[0].name}" is not wrapped in a <fieldset> with <legend>`, element: outerHtmlSnippet(inputs[0]), selector: getSelector(inputs[0]) });
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R98: Section landmark with no heading or accessible label
  // ════════════════════════════════════════════════════════════════════════
  const visibleLandmarks = Array.from(document.querySelectorAll("main, nav, aside, section, [role='region'], [role='complementary']")).filter((el) => isVisible(el));
  visibleLandmarks.forEach((el) => {
    if (!!el.querySelector("h1,h2,h3,h4,h5,h6")) return;
    if (el.getAttribute("aria-label")?.trim()) return;
    if (el.getAttribute("aria-labelledby")) return;
    if (EMIT_MANUAL_ONLY_RULES) results.push({ ruleId: "ACT-R98", type: "Potential Issue", impact: "minor", description: `${el.tagName.toLowerCase()} landmark region has no heading or accessible label`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
  });
  if (visibleLandmarks.length > 0) {
    pushStat("ACT-R98", visibleLandmarks.length, "element");
  }

  // ACT-R100: PDF link without accessible alternative
  document.querySelectorAll("a[href]").forEach((el) => {
    if (!isVisible(el)) return;
    const href = (el as HTMLAnchorElement).href || "";
    if (!/\.pdf(\?|$|#)/i.test(href)) return;
    const nearby = el.parentElement?.textContent?.toLowerCase() || "";
    if (!/html version|accessible version|text version|word version|alternative format/i.test(nearby)) {
      if (EMIT_MANUAL_ONLY_RULES) results.push({ ruleId: "ACT-R100", type: "Best Practice", impact: "moderate", description: `Link to PDF "${el.textContent?.trim() || href.split("/").pop()}" has no adjacent accessible alternative`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R115: Heading is not descriptive
  // ════════════════════════════════════════════════════════════════════════
  const MEASUREMENT_ONLY_RE = /^\d[\d\s.,:%\-\/\\+×xX()]*[a-zA-Z\u00B5\u03A9\u03BC]{0,4}$/;
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
    if (!isVisible(el)) return;
    const text = (el.textContent || "").trim();
    if (!text) return;
    const isSingleChar = text.length <= 1;
    const isMeasurementOnly = MEASUREMENT_ONLY_RE.test(text);
    if (isSingleChar || isMeasurementOnly) {
      results.push({ ruleId: "ACT-R115", type: "Potential Issue", impact: "minor", description: `<${el.tagName.toLowerCase()}> heading text "${text.substring(0, 60)}" is not descriptive — use clear, meaningful heading text`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R117: element with role='img' has no accessible name (WCAG 1.1.1)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("[role='img']").forEach((el) => {
    if (!isVisible(el)) return;
    if (!getAccessibleName(el)) {
      results.push({ ruleId: "ACT-R117", type: "Issue", impact: "critical", description: "Element with role='img' has no accessible name — add aria-label or aria-labelledby", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ACT-R118: HTML images contain no text (WCAG 1.4.5 / 1.4.9)
  // Applicability follows the effective HTML image role, not the tag name:
  // decorative images (alt="") and elements hidden from the accessibility tree
  // are excluded. The browser cannot answer the five human-review questions,
  // so the applicable targets remain Potential Issues rather than automatic
  // failures.
  const imageOfTextTargets = Array.from(document.querySelectorAll("*"))
    .filter(
      (el) =>
        el instanceof HTMLElement &&
        getEffectiveAriaRole(el) === "img" &&
        isIncludedInAccessibilityTree(el),
    );
  if (EMIT_MANUAL_ONLY_RULES) {
    imageOfTextTargets.forEach((el) => {
      results.push({
        ruleId: "ACT-R118",
        type: "Potential Issue",
        displayTitle: "Does this image contain human-language text?",
        impact: "serious",
        description:
          "Manual review sequence: (1) Does the image contain visible text that expresses something in a human language? If no, the review passes. If yes, (2) is the image with text purely decorative, (3) is the text insignificant or incidental, (4) is presenting the text in the image essential, for example a logo, or (5) is the same information available as regular text on the same page? A Potential Issue remains only when the image contains human-language text and none of these exceptions applies.",
        element: outerHtmlSnippet(el),
        elementContext: elementContextForAI(el),
        selector: getSelector(el),
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // WCAG 2.2 — NEW CRITERIA
  // ════════════════════════════════════════════════════════════════════════

  // ACT-R119: Focus Not Obscured – Minimum (WCAG 2.4.11, AA)
  {
    const seenR119 = new Set<string>();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    document.querySelectorAll("*").forEach((el) => {
      if (!isVisible(el)) return;
      const s = window.getComputedStyle(el);
      if (s.position !== "fixed" && s.position !== "sticky") return;
      const rect = el.getBoundingClientRect();
      if (rect.width < vw * 0.4 || rect.height <= 0 || rect.height > 160) return;
      const isTopBar = rect.top <= 10 && rect.bottom > 0;
      const isBottomBar = rect.bottom >= vh - 10 && rect.top < vh;
      if (!isTopBar && !isBottomBar) return;
      const sel = getSelector(el);
      if (seenR119.has(sel)) return;
      seenR119.add(sel);
      const hasFocusable = el.querySelectorAll("a[href], button, input, select, textarea, [tabindex]").length > 0 || document.querySelectorAll("a[href], button:not([disabled]), input:not([type='hidden']):not([disabled])").length > 0;
      if (!hasFocusable) return;
      if (EMIT_MANUAL_ONLY_RULES) results.push({ ruleId: "ACT-R119", type: "Potential Issue", impact: "minor", description: `${s.position === "fixed" ? "Fixed" : "Sticky"} ${isTopBar ? "header" : "footer"} (${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}, height: ${Math.round(rect.height)}px) may obscure keyboard-focused elements scrolled behind it — verify with keyboard navigation`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: sel });
    });
  }

  // ACT-R121: Focus Appearance (WCAG 2.4.13, AAA)
  {
    const suppressed: string[] = [];
    try {
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          Array.from((sheet as CSSStyleSheet).cssRules || []).forEach((rule) => {
            if (!(rule instanceof CSSStyleRule)) return;
            const sel = rule.selectorText || "";
            if (!/:focus/.test(sel)) return;
            const st = (rule as CSSStyleRule).style;
            const outlineVal = st.getPropertyValue("outline");
            const outlineStyle = st.getPropertyValue("outline-style");
            const outlineWidth = st.getPropertyValue("outline-width");
            const suppressesOutline = outlineVal === "none" || outlineVal === "0" || outlineStyle === "none" || outlineWidth === "0" || outlineWidth === "0px";
            if (!suppressesOutline) return;
            const hasReplacement = st.getPropertyValue("box-shadow") || st.getPropertyValue("border") || st.getPropertyValue("border-color") || st.getPropertyValue("background-color") || st.getPropertyValue("text-decoration");
            if (!hasReplacement) suppressed.push(sel);
          });
        } catch { /* cross-origin sheet */ }
      });
    } catch { /* no styleSheets */ }
    if (suppressed.length > 0) {
      if (EMIT_MANUAL_ONLY_RULES) results.push({ ruleId: "ACT-R121", type: "Potential Issue", impact: "minor", description: `Focus outline suppressed without a visible replacement in ${suppressed.length} CSS rule(s): ${suppressed.slice(0, 4).join(", ")}${suppressed.length > 4 ? " …" : ""} — WCAG 2.4.13 requires a focus indicator of sufficient size and contrast`, element: `<style> ... ${suppressed[0]} { outline: none } ... </style>`, elementContext: "", selector: "" });
    }
  }

  // ACT-R126: Accessible Authentication – Minimum (WCAG 3.3.8, AA)
  {
    const captchaPatterns = ["iframe[src*='recaptcha']","iframe[src*='hcaptcha']","iframe[src*='captcha']","iframe[src*='turnstile']",".g-recaptcha",".h-captcha","[class*='captcha']:not(script):not(style)","[id*='captcha']:not(script):not(style)","img[alt*='captcha' i]","img[src*='captcha' i]"];
    const seenR126 = new WeakSet<Element>();
    captchaPatterns.forEach((pattern) => {
      try {
        document.querySelectorAll(pattern).forEach((el) => {
          if (seenR126.has(el)) return;
          if (!isVisible(el)) return;
          seenR126.add(el);
          results.push({ ruleId: "ACT-R126", type: "Potential Issue", impact: "major", description: `CAPTCHA or cognitive-function challenge detected — users with cognitive disabilities may be unable to authenticate. Provide an accessible alternative (audio CAPTCHA, magic-link email, passkey, or SSO) per WCAG 3.3.8`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
        });
      } catch { /* invalid selector in some browsers */ }
    });
  }

  // ACT-R128: Abbreviations and acronyms should have their full expansion
  // available (WCAG 3.1.4, AAA). The browser cannot reliably determine
  // whether a reader already knows an abbreviation, so findings are
  // intentionally emitted as Potential Issues for human review.
  {
    const commonUppercaseWords = new Set([
      "A", "AM", "AN", "AND", "ARE", "AS", "AT", "BE", "BETWEEN", "BY",
      "CAN", "DO", "FOR", "FROM", "GO", "HAS", "HAD", "HE", "HOW", "IF",
      "IN", "INTO", "IS", "IT", "ITS", "MAY", "ME", "MORE", "MY", "NEW",
      "NO", "NOT", "OF", "ON", "ONE", "OR", "OUR", "OUT", "PER", "SEE",
      "SO", "THAN", "THAT", "THE", "THESE", "THIS", "TO", "TWO", "UP",
      "US", "USE", "VIA", "WAS", "WE", "WHAT", "WHEN", "WHO", "WHY",
      "WITH", "YOU", "YOUR",
    ]);
    const acronymToken = /\b[A-Z]{2,8}(?:[0-9][A-Z0-9]{0,7})?\b/g;
    const ignoredAncestors = "script,style,noscript,template";
    const expandedTokens = new Set<string>();
    const reportedTokens = new Set<string>();
    let checkedTextNodes = 0;

    const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

    const hasUsableExpansionAttribute = (el: Element): boolean => {
      const token = normalizeText(el.textContent || "").toUpperCase();
      const title = normalizeText(el.getAttribute("title") || "");
      const ariaLabel = normalizeText(el.getAttribute("aria-label") || "");
      const labelledBy = el.getAttribute("aria-labelledby");
      const labelledByText = labelledBy
        ? normalizeText(
            labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent || "")
              .join(" "),
          )
        : "";
      return [title, ariaLabel, labelledByText].some(
        (value) => value.length > token.length && value.toUpperCase() !== token,
      );
    };

    const hasExpansionInContext = (token: string, context: string): boolean => {
      const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const normalized = normalizeText(context);
      if (!normalized) return false;
      const fullNameBefore = new RegExp(
        "\\b[A-Za-z][A-Za-z0-9&'/-]*(?:\\s+[A-Za-z][A-Za-z0-9&'/-]*){0,10}\\s*\\(\\s*" +
          escapedToken +
          "\\s*\\)",
        "i",
      );
      const fullNameAfter = new RegExp(
        "\\b" +
          escapedToken +
          "\\b\\s*\\(\\s*[A-Za-z][A-Za-z0-9&'/-]*(?:\\s+[A-Za-z][A-Za-z0-9&'/-]*){1,10}\\s*\\)",
        "i",
      );
      return fullNameBefore.test(normalized) || fullNameAfter.test(normalized);
    };

    const reportCandidate = (token: string, el: Element, reason: string) => {
      const normalizedToken = token.toUpperCase();
      const selector = getSelector(el);
      const reportKey = `${normalizedToken}|${selector}`;
      if (reportedTokens.has(normalizedToken) || reportedTokens.has(reportKey)) return;
      reportedTokens.add(normalizedToken);
      reportedTokens.add(reportKey);
      results.push({
        ruleId: "ACT-R128",
        type: "Potential Issue",
        impact: "minor",
        description: `Abbreviation or acronym "${token}" may not have its full expansion available at first use — ${reason}. Verify that the full meaning is provided in visible text, an <abbr title>, or an equivalent glossary`,
        element: outerHtmlSnippet(el),
        elementContext: elementContextForAI(el),
        selector,
      });
    };

    document.querySelectorAll("abbr").forEach((el) => {
      if (!(el instanceof HTMLElement) || !isVisible(el)) return;
      if (el.closest(ignoredAncestors) || el.closest("[aria-hidden='true'],[inert]")) return;
      const token = normalizeText(el.textContent || "");
      if (!token || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(token)) return;
      checkedTextNodes += 1;
      if (hasUsableExpansionAttribute(el)) {
        expandedTokens.add(token.toUpperCase());
        return;
      }
      if (hasExpansionInContext(token, el.parentElement?.textContent || "")) {
        expandedTokens.add(token.toUpperCase());
        return;
      }
      reportCandidate(token, el, "the element has no detectable expansion");
    });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    let precedingText = "";
    while ((textNode = walker.nextNode())) {
      const parent = textNode.parentElement;
      if (!parent || parent.closest(ignoredAncestors)) continue;
      if (parent.closest("abbr") || parent.closest("[aria-hidden='true'],[inert]")) continue;
      if (!isVisible(parent)) continue;
      const text = textNode.textContent || "";
      if (!text.trim()) continue;
      checkedTextNodes += 1;
      let match: RegExpExecArray | null;
      acronymToken.lastIndex = 0;
      while ((match = acronymToken.exec(text))) {
        const token = match[0];
        const normalizedToken = token.toUpperCase();
        if (commonUppercaseWords.has(normalizedToken)) continue;
        const textWithoutToken = `${text.slice(0, match.index)} ${text.slice(match.index + token.length)}`;
        const hasMixedCaseContext =
          /[a-z]/.test(textWithoutToken) || /[a-z]/.test(precedingText.slice(-200));
        const isShortStandaloneAcronym = token.length >= 3 && token.length <= 5;
        // A currency/code label such as the standalone "USD" in a selector
        // is still a meaningful abbreviation even when its own text node has
        // no lowercase prose. Keep longer all-caps labels conservative.
        if (!hasMixedCaseContext && !isShortStandaloneAcronym) continue;
        const context = `${precedingText.slice(-700)} ${text.slice(
          Math.max(0, match.index - 120),
          Math.min(text.length, match.index + token.length + 120),
        )}`;
        if (hasExpansionInContext(normalizedToken, context)) {
          expandedTokens.add(normalizedToken);
          continue;
        }
        if (expandedTokens.has(normalizedToken) || reportedTokens.has(normalizedToken)) continue;
        reportCandidate(token, parent, "the page does not show its full meaning before this use");
      }
      precedingText += ` ${text}`;
    }
    if (checkedTextNodes > 0) pushStat("ACT-R128", checkedTextNodes, "element");
  }

  // ── Scoring stats: total elements checked per rule ────────────────────────
  const abbrEls = document.querySelectorAll("abbr").length;
  const preEls = document.querySelectorAll("pre").length;
  if (preEls > 0) pushStat("ACT-R79", preEls, "element");
  const blankLinks = document.querySelectorAll("a[target='_blank']").length;
  if (blankLinks > 0) pushStat("ACT-R100", blankLinks, "element");
  const allLinks = document.querySelectorAll("a[href]").length;
  if (allLinks > 0) pushStat("ACT-R81", allLinks, "element");
  const structHeadings = document.querySelectorAll("h1,h2,h3,h4,h5,h6").length;
  if (structHeadings > 0) pushStat("ACT-R115", structHeadings, "element");
  const imgRoleEls = document.querySelectorAll("[role='img']").length;
  if (imgRoleEls > 0) pushStat("ACT-R117", imgRoleEls, "element");
  if (imageOfTextTargets.length > 0) pushStat("ACT-R118", imageOfTextTargets.length, "element");
  const fixedEls = document.querySelectorAll("[style*='position:fixed'],[style*='position: fixed']").length;
  if (fixedEls > 0) pushStat("ACT-R119", fixedEls, "element");
  pushStat("ACT-R121", 1, "page");
  pushStat("ACT-R126", 1, "page");

  // ════════════════════════════════════════════════════════════════════════
}
