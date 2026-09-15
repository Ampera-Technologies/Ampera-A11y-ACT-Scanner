import { francAll } from "franc-min";
import type { ScanRawResult, PushStatFn } from "../types";
import { VALID_ROLES } from "../aria-data";
import { elementContextForAI, getSelector, outerHtmlSnippet } from "../dom-helpers";
import { isProgrammaticallyHidden } from "../visibility";

export const LANGUAGE_DETECTOR_BUILD_MARKER =
  "language-detector-franc-min-v1";

const ISO_639_3_TO_PRIMARY: Record<string, string> = {
  ara: "ar",
  cat: "ca",
  ces: "cs",
  dan: "da",
  deu: "de",
  ell: "el",
  eng: "en",
  fin: "fi",
  fra: "fr",
  heb: "he",
  hin: "hi",
  hun: "hu",
  ind: "id",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  nld: "nl",
  nor: "no",
  pol: "pl",
  por: "pt",
  ron: "ro",
  rus: "ru",
  spa: "es",
  swe: "sv",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  vie: "vi",
  zho: "zh",
};

const LANGUAGE_NAMES: Record<string, string> = {
  ar: "Arabic",
  ca: "Catalan",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  fi: "Finnish",
  fr: "French",
  he: "Hebrew",
  hi: "Hindi",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  nl: "Dutch",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sv: "Swedish",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  zh: "Chinese",
};

export function detectPrimaryLanguage(text: string): string | null {
  const normalized = text
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const letterCount = (normalized.match(/\p{L}/gu) ?? []).length;
  if (letterCount < 40) return null;

  const candidates = francAll(normalized, { minLength: 40 });
  const [detected, detectedScore] = candidates[0] ?? ["und", 0];
  const runnerUpScore = candidates[1]?.[1] ?? 0;

  // Statistical language detection is noisy for short marketing headings.
  // Require a clear lead before reporting a language change; otherwise an
  // ordinary English phrase such as "Buy travel packages..." can be labelled
  // French based on a handful of shared trigrams.
  if (letterCount < 100 && detectedScore - runnerUpScore < 0.2) {
    return null;
  }

  return ISO_639_3_TO_PRIMARY[detected] ?? null;
}

export function verifyLanguageDetectorBundle(): boolean {
  return (
    detectPrimaryLanguage(
      "This accessibility scanner verifies that English language detection is fully bundled and available in the browser runtime.",
    ) === "en"
  );
}

function directVisibleText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectHeadingLanguageWithAdjacentText(
  headingText: string,
  adjacentText: string,
  documentPrimary: string,
): string | null {
  const adjacentPrimary = detectPrimaryLanguage(adjacentText);
  if (!adjacentPrimary || adjacentPrimary === documentPrimary) return null;
  return detectPrimaryLanguage(`${headingText} ${adjacentText}`);
}

export function runDocumentLanguageRules(results: ScanRawResult[], EMIT_MANUAL_ONLY_RULES: boolean, pushStat: PushStatFn): void {
  // ════════════════════════════════════════════════════════════════════════
  // ACT-R1: Page has no title (WCAG 2.4.2)
  // ════════════════════════════════════════════════════════════════════════
  if (!document.title || document.title.trim() === "") {
    results.push({ ruleId: "ACT-R1", type: "Issue", impact: "serious", description: "Page is missing a title element", element: "<title>", selector: "head > title" });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R114: Page title is not descriptive (WCAG 2.4.2)
  // ════════════════════════════════════════════════════════════════════════
  {
    const title = document.title?.trim();
    if (title && /^(home|index|untitled|page|document|new page|welcome)$/i.test(title)) {
      results.push({ ruleId: "ACT-R114", type: "Issue", impact: "moderate", description: `Page title "${title}" is not descriptive`, element: `<title>${title}</title>`, selector: "head > title" });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R4: HTML element missing lang attribute (WCAG 3.1.1)
  // ════════════════════════════════════════════════════════════════════════
  const htmlEl = document.documentElement;
  if (!htmlEl.getAttribute("lang") || htmlEl.getAttribute("lang")?.trim() === "") {
    results.push({ ruleId: "ACT-R4", type: "Issue", impact: "serious", description: "HTML element is missing lang attribute", element: "<html>", selector: "html" });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R5: lang attribute is not a valid BCP 47 code (WCAG 3.1.1)
  // ════════════════════════════════════════════════════════════════════════
  {
    const lang = htmlEl.getAttribute("lang")?.trim();
    if (lang) {
      const BCP47_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
      if (!BCP47_RE.test(lang)) {
        results.push({ ruleId: "ACT-R5", type: "Issue", impact: "serious", description: `HTML lang attribute "${lang}" is not a valid BCP 47 language code`, element: `<html lang="${lang}">`, selector: "html" });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R6: lang and xml:lang do not agree (WCAG 3.1.1)
  // ════════════════════════════════════════════════════════════════════════
  {
    const lang = htmlEl.getAttribute("lang")?.trim();
    const xmlLang = htmlEl.getAttribute("xml:lang")?.trim();
    if (lang && xmlLang) {
      const primaryLang = lang.split("-")[0].toLowerCase();
      const primaryXml = xmlLang.split("-")[0].toLowerCase();
      if (primaryLang !== primaryXml) {
        results.push({ ruleId: "ACT-R6", type: "Issue", impact: "serious", description: `lang="${lang}" and xml:lang="${xmlLang}" specify different primary language subtags`, element: `<html lang="${lang}" xml:lang="${xmlLang}">`, selector: "html" });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R7: Language of parts (WCAG 3.1.2)
  //
  // Alfa's automatic expectation validates explicit, non-empty lang attributes.
  // In addition, the platform scanner identifies language changes so undeclared
  // blocks can be reported as confirmed issues.
  // ════════════════════════════════════════════════════════════════════════
  {
    const BCP47_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
    document.querySelectorAll("[lang]").forEach((el) => {
      if (el === htmlEl) return;
      if (isProgrammaticallyHidden(el)) return;
      const lang = el.getAttribute("lang")?.trim();
      if (!lang) return;
      if (!BCP47_RE.test(lang)) {
        results.push({ ruleId: "ACT-R7", displayTitle: "Language is not valid", type: "Issue", impact: "moderate", description: `lang attribute "${lang}" is not a valid BCP 47 language tag`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      }
    });

    const documentLang = htmlEl.getAttribute("lang")?.trim() ?? "";
    const declaredDocumentPrimary = BCP47_RE.test(documentLang)
      ? documentLang.split("-")[0].toLowerCase()
      : null;
    const inferredDocumentPrimary = detectPrimaryLanguage(
      document.body?.innerText ?? "",
    );
    const documentPrimary = declaredDocumentPrimary ?? inferredDocumentPrimary;
    const textContainers = Array.from(document.body?.querySelectorAll("*") ?? [])
      .filter((el) => {
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) {
          return false;
        }
        return Array.from(el.childNodes).some(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            (node.textContent?.trim().length ?? 0) > 0,
        );
      });

    if (documentPrimary) {
      for (const el of textContainers) {
        if (isProgrammaticallyHidden(el)) continue;

        const declaredLangElement = el.closest("[lang]");
        if (declaredLangElement && declaredLangElement !== htmlEl) continue;

        // Analyze only text directly owned by this element. Descendant blocks
        // may carry their own valid lang declarations and must not make a broad
        // wrapper (such as .entry-content) look undeclared.
        const ownText = directVisibleText(el);
        if (!ownText) continue;

        let detectedPrimary: string | null = null;
        const ownLetterCount = (ownText.match(/\p{L}/gu) ?? []).length;
        const isHeadingLike =
          /^H[1-6]$/.test(el.tagName) ||
          el.getAttribute("role") === "heading" ||
          /(^|\s)heading(\s|$)/i.test(el.className);
        if (isHeadingLike && ownLetterCount < 40) {
          const next = el.nextElementSibling;
          if (
            next &&
            !isProgrammaticallyHidden(next) &&
            (next.closest("[lang]") === htmlEl || !next.closest("[lang]"))
          ) {
            const nextText = directVisibleText(next);
            detectedPrimary = detectHeadingLanguageWithAdjacentText(
              ownText,
              nextText,
              documentPrimary,
            );
          }
        } else {
          detectedPrimary = detectPrimaryLanguage(ownText);
        }

        if (!detectedPrimary || detectedPrimary === documentPrimary) continue;

        const detectedName = LANGUAGE_NAMES[detectedPrimary] ?? detectedPrimary;
        const inheritedLanguageDescription = declaredDocumentPrimary
          ? `the document language "${documentLang}"`
          : `the page's inferred primary language "${documentPrimary}"`;
        results.push({
          ruleId: "ACT-R7",
          displayTitle: "Language not specified",
          type: "Issue",
          impact: "moderate",
          description: `${detectedName} content differs from ${inheritedLanguageDescription} but has no language declaration — add lang="${detectedPrimary}" to this element or its containing section`,
          element: outerHtmlSnippet(el),
          elementContext: elementContextForAI(el),
          selector: getSelector(el),
        });
      }
    }
  }

  // ACT-R109 / SIA-R109: Alfa applies this rule only when the document has a
  // valid programmatic language, then asks whether the natural language of the
  // page matches it. The browser rule engine has no language-identification
  // service, so preserve Alfa's applicability and surface the expectation as
  // a Potential Issue for manual language comparison rather than guessing.
  {
    const lang = htmlEl.getAttribute("lang")?.trim();
    const BCP47_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
    const visibleText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const isApplicable = !!lang && BCP47_RE.test(lang) && visibleText.length > 0;
    if (isApplicable) {
      pushStat("ACT-R109", 1, "page");
    }
    if (EMIT_MANUAL_ONLY_RULES && isApplicable) {
      results.push({
        ruleId: "ACT-R109",
        type: "Potential Issue",
        impact: "moderate",
        description: `Review whether the document's natural language matches lang="${lang}"`,
        element: "<html>",
        elementContext: visibleText.slice(0, 400),
        selector: "html",
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R110: The role attribute must contain at least one valid role token.
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("[role]").forEach((el) => {
    if (isProgrammaticallyHidden(el)) return;
    const roles = (el.getAttribute("role") || "").trim().split(/\s+/);
    const nonEmptyRoles = roles.filter(Boolean);
    if (nonEmptyRoles.length > 0 && !nonEmptyRoles.some((role) => VALID_ROLES.has(role))) {
      results.push({ ruleId: "ACT-R110", type: "Issue", impact: "serious", description: "The role attribute does not contain a valid role value", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R3: Duplicate IDs referenced in accessibility relationships (WCAG 4.1.1)
  // ════════════════════════════════════════════════════════════════════════
  {
    const referencedIds = new Set<string>();
    // Siteimprove parity: only naming/description relationships create ambiguity when IDs are duplicated.
    // aria-controls/aria-owns/aria-activedescendant are reference relationships — accordion/tab patterns
    // commonly duplicate those target IDs across widget instances without causing AT confusion.
    document.querySelectorAll("[aria-labelledby],[aria-describedby]").forEach((el) => {
      ["aria-labelledby","aria-describedby"].forEach((attr) => {
        (el.getAttribute(attr) || "").split(/\s+/).filter(Boolean).forEach((id) => referencedIds.add(id));
      });
    });
    document.querySelectorAll("label[for]").forEach((el) => { const v = el.getAttribute("for"); if (v) referencedIds.add(v); });
    document.querySelectorAll("a[href^='#']").forEach((el) => { const h = el.getAttribute("href")!.slice(1); if (h) referencedIds.add(h); });
    const idCountMap: Record<string, number> = {};
    // Alfa parity: only count duplicates among elements that are actually in
    // the accessibility tree — carousel/template clones that are aria-hidden
    // or display:none don't create a conflicting reference for AT users.
    document.querySelectorAll("[id]").forEach((el) => {
      if (!referencedIds.has(el.id)) return;
      if (el.closest("[aria-hidden='true']")) return;
      if (el instanceof HTMLElement && window.getComputedStyle(el).display === "none") return;
      idCountMap[el.id] = (idCountMap[el.id] || 0) + 1;
    });
    for (const [id, count] of Object.entries(idCountMap)) {
      if (count > 1) {
        results.push({ ruleId: "ACT-R3", type: "Issue", impact: "critical", description: `Duplicate ID "${id}" is referenced for accessibility (${count} elements share this ID)`, element: `#${id}`, selector: `[id="${id}"]` });
      }
    }
  }

  // ── Scoring stats: total elements / pages checked per rule ────────────────
  pushStat("ACT-R1",   1, "page");
  pushStat("ACT-R114", 1, "page");
  pushStat("ACT-R4",   1, "page");
  pushStat("ACT-R5",   1, "page");
  pushStat("ACT-R6",   1, "page");
  const languageTargets =
    document.querySelectorAll("[lang]").length +
    document.querySelectorAll("body *").length;
  if (languageTargets > 0) pushStat("ACT-R7", languageTargets, "element");
  const roleEls = document.querySelectorAll("[role]").length;
  if (roleEls > 0) pushStat("ACT-R110", roleEls, "element");
  const idEls = document.querySelectorAll("[id]").length;
  if (idEls > 0) pushStat("ACT-R3", idEls, "element");

  // ════════════════════════════════════════════════════════════════════════
}
