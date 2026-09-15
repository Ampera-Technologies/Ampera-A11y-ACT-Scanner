import type { ScanRawResult, PushStatFn } from "../types";
import { getAccessibleName } from "../accname";
import { getAlfaTabOrder, hasAlfaFocusIndicator, isInsideAlfaLandmarkOrDialog } from "../alfa-helpers";
import { elementContextForAI, getSelector, outerHtmlSnippet } from "../dom-helpers";
import { isProgrammaticallyHidden, isRendered, isVisible } from "../visibility";

type LandmarkIdentity = { role: string; name: string };

export function findDuplicateLandmarkNames<T extends LandmarkIdentity>(
  landmarks: readonly T[],
): T[][] {
  const byRoleAndName = new Map<string, T[]>();
  for (const landmark of landmarks) {
    const normalizedName = landmark.name.replace(/\s+/g, " ").trim().toLowerCase();
    const key = `${landmark.role}\u0000${normalizedName}`;
    const group = byRoleAndName.get(key);
    if (group) group.push(landmark);
    else byRoleAndName.set(key, [landmark]);
  }
  return [...byRoleAndName.values()].filter((group) => group.length > 1);
}

export function runHeadingsLandmarksRules(results: ScanRawResult[], EMIT_MANUAL_ONLY_RULES: boolean, pushStat: PushStatFn): void {
  // ACT-R53: Headings not structured / level skipped (WCAG 1.3.1)
  // ════════════════════════════════════════════════════════════════════════
  {
    // Alfa alignment: applicability includes [role="heading"] with aria-level.
    const headingLevel = (h: Element): number => {
      if (/^H[1-6]$/.test(h.tagName)) return parseInt(h.tagName[1], 10);
      const lvl = parseInt(h.getAttribute("aria-level") || "2", 10);
      return isFinite(lvl) && lvl >= 1 ? lvl : 2;
    };
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")).filter((h) => isRendered(h));
    headings.forEach((h, i) => {
      if (i === 0) return;
      const prev = headings[i - 1];
      const prevLevel = headingLevel(prev);
      const currLevel = headingLevel(h);
      if (currLevel > prevLevel + 1) {
        results.push({ ruleId: "ACT-R53", type: "Issue", impact: "moderate", description: `Heading level skipped: level ${prevLevel} followed by level ${currLevel} — level ${prevLevel + 1} is missing`, element: outerHtmlSnippet(h), elementContext: elementContextForAI(h), selector: getSelector(h) });
      }
    });
  }

  // ACT-R59: Page has no headings at all
  {
    const anyHeading = document.querySelector("h1,h2,h3,h4,h5,h6,[role='heading']");
    if (!anyHeading) {
      results.push({ ruleId: "ACT-R59", type: "Issue", impact: "moderate", description: "Page contains no heading elements", element: "<body>", selector: "body" });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R64: Empty heading (WCAG 1.3.1 / 2.4.6)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']").forEach((el) => {
    if (!isRendered(el)) return;
    if (!getAccessibleName(el)) {
      results.push({ ruleId: "ACT-R64", type: "Potential Issue", impact: "moderate", description: `Empty ${el.tagName.toLowerCase()} element provides no accessible heading`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ACT-R34: Content missing after heading (Siteimprove check)
  // A heading must be followed by perceivable content (text, image, or
  // control) before the next heading of the same or higher rank, or the end
  // of the document.
  {
    const isHeadingEl = (el: Element) => /^H[1-6]$/i.test(el.tagName) || el.getAttribute("role") === "heading";
    const allHeadings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')).filter((h) => isRendered(h) && !h.closest("[aria-hidden='true']"));
    const headingLevel = (el: Element) => {
      const al = el.getAttribute("aria-level");
      if (al && /^\d+$/.test(al)) return parseInt(al, 10);
      return /^H[1-6]$/i.test(el.tagName) ? parseInt(el.tagName.substring(1), 10) : 2;
    };
    const isPerceivableContent = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent || "").trim();
        if (!t) return false;
        const p = node.parentElement;
        if (!p) return false;
        if (["script", "style", "noscript", "template"].includes(p.tagName.toLowerCase())) return false;
        return isRendered(p);
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName.toLowerCase();
        if (["img", "svg", "video", "audio", "canvas", "input", "select", "textarea", "button", "iframe", "object", "embed"].includes(tag)) {
          return isRendered(el);
        }
      }
      return false;
    };
    allHeadings.forEach((h) => {
      const level = headingLevel(h);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      walker.currentNode = h;
      // Skip the heading's own subtree.
      let node: Node | null = walker.nextNode();
      while (node && h.contains(node)) node = walker.nextNode();
      let foundContent = false;
      while (node) {
        if (node.nodeType === Node.ELEMENT_NODE && isHeadingEl(node as Element) && isRendered(node as Element)) {
          // Siteimprove: any following heading (regardless of level) bounds
          // the section — a heading directly followed by another heading has
          // no content of its own.
          void level;
          break;
        } else if (isPerceivableContent(node)) {
          foundContent = true;
          break;
        }
        node = walker.nextNode();
      }
      if (!foundContent) {
        results.push({ ruleId: "ACT-R34", type: "Issue", impact: "moderate", description: `Content missing after heading: <${h.tagName.toLowerCase()}> "${(h.textContent || "").trim().substring(0, 60)}" has no content before the next heading`, element: outerHtmlSnippet(h), elementContext: elementContextForAI(h), selector: getSelector(h) });
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Text content not inside a landmark region remains a manual/legacy check;
  // ACT-R35 is reserved for Siteimprove's visual-only video alternative rule.
  // ════════════════════════════════════════════════════════════════════════
  {
    const firstTabbable = getAlfaTabOrder()[0];
    function checkTextNodes(node: Node): void {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim() || "";
        // Alfa counts every perceivable text node — no minimum length beyond
        // non-whitespace content (pure punctuation is still perceivable text).
        if (text.length < 1) return;
        const parent = node.parentElement;
        if (!parent) return;
        if (!isRendered(parent)) return;
        const isInFirstFocusable = !!firstTabbable && firstTabbable.contains(parent);
        if (!isInsideAlfaLandmarkOrDialog(parent) && !isInFirstFocusable) {
          results.push({ ruleId: "ACT-R57", type: "WAI-ARIA", impact: "minor", description: `Text "${text.substring(0, 80)}" is not contained within a landmark region`, element: outerHtmlSnippet(parent), elementContext: elementContextForAI(parent), selector: getSelector(parent) });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName?.toLowerCase();
        if (["script","style","noscript","template"].includes(tag)) return;
        const role = el.getAttribute("role");
        const landmarkRoles = ["main","navigation","complementary","contentinfo","banner","search","form","region"];
        const alwaysStop = ["main","nav","aside","form"];
        if (alwaysStop.includes(tag)) return;
        if (tag === "section" && (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby"))) return;
        if ((tag === "header" || tag === "footer") && !["article","aside","main","nav","section"].includes((el.parentElement?.tagName || "").toLowerCase())) return;
        if (role && landmarkRoles.includes(role)) return;
        node.childNodes.forEach((child) => checkTextNodes(child));
      }
    }
    document.body.childNodes.forEach((child) => checkTextNodes(child));
  }

  // ACT-R54: aria-live="assertive" region without aria-atomic="true"
  document.querySelectorAll('[aria-live="assertive"]').forEach((el) => {
    if (isProgrammaticallyHidden(el)) return;
    if (!el.querySelector("*")) return;
    if (el.getAttribute("aria-atomic") !== "true") {
      results.push({ ruleId: "ACT-R54", type: "Best Practice", impact: "moderate", description: `aria-live="assertive" region should also have aria-atomic="true" to prevent partial announcements`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R55 / ACT-R56: Same-role landmarks duplicate / non-unique names
  // ════════════════════════════════════════════════════════════════════════
  {
    type LandmarkInfo = { el: Element; role: string; name: string };
    const landmarks: LandmarkInfo[] = [];
    const landmarkSelectors = [
      { sel: "header:not([role])", role: "banner" },
      { sel: "footer:not([role])", role: "contentinfo" },
      { sel: "main:not([role])", role: "main" },
      { sel: "nav:not([role])", role: "navigation" },
      { sel: "aside:not([role])", role: "complementary" },
      { sel: "form[aria-label], form[aria-labelledby]", role: "form" },
      { sel: "section[aria-label], section[aria-labelledby]", role: "region" },
      { sel: "[role='banner']", role: "banner" },
      { sel: "[role='contentinfo']", role: "contentinfo" },
      { sel: "[role='main']", role: "main" },
      { sel: "[role='navigation']", role: "navigation" },
      { sel: "[role='complementary']", role: "complementary" },
      { sel: "[role='form']", role: "form" },
      { sel: "[role='region']", role: "region" },
      { sel: "[role='search']", role: "search" },
    ];
    for (const { sel, role } of landmarkSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        if (isProgrammaticallyHidden(el)) return;
        const name = (el.getAttribute("aria-label") || document.getElementById(el.getAttribute("aria-labelledby") || "")?.textContent?.trim() || el.getAttribute("title") || "").toLowerCase().trim();
        landmarks.push({ el, role, name });
      });
    }
    const byRoleName: Record<string, LandmarkInfo[]> = {};
    for (const info of landmarks) {
      if (!info.name) continue;
      const key = `${info.role}:${info.name}`;
      byRoleName[key] = byRoleName[key] || [];
      byRoleName[key].push(info);
    }
    // Landmark content fingerprint — headings + link hrefs + trimmed text prefix
    const landmarkFingerprint = (el: Element): string => {
      const headings = Array.from(el.querySelectorAll("h1,h2,h3,h4,h5,h6"))
        .map((h) => h.textContent?.trim().toLowerCase().slice(0, 80)).join("|");
      const links = Array.from(el.querySelectorAll("a[href]"))
        .map((a) => (a.getAttribute("href") || "").replace(/[?#].*/, "").toLowerCase().slice(0, 60)).join("|");
      const text = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200);
      return `${headings}||${links}||${text}`;
    };
    // Known carousel/slider patterns — don't flag same-name regions that are intentional repeating slide containers
    const isCarouselPattern = (nameStr: string, group: { el: Element }[]): boolean => {
      const lower = nameStr.toLowerCase();
      if (/carousel|slide|slider|rotator|banner/.test(lower)) return true;
      return group.some((g) => {
        const p = g.el.parentElement;
        return p && (
          p.classList.contains("carousel") || p.classList.contains("slider") ||
          !!p.querySelector('[role="tablist"]') || !!p.querySelector("[aria-roledescription]")
        );
      });
    };
    for (const [key, group] of Object.entries(byRoleName)) {
      if (group.length < 2) continue;
      const [roleStr, ...nameParts] = key.split(":");
      const nameStr = nameParts.join(":");
      // Skip known carousel/slider patterns
      if (isCarouselPattern(nameStr, group)) continue;
      // ACT-R55 spec: only flag when same-named landmarks have DIFFERENT content (misleading name)
      const fingerprints = group.map((g) => landmarkFingerprint(g.el));
      const uniqueFingerprints = new Set(fingerprints);
      if (uniqueFingerprints.size < 2) continue; // identical content → repeated component, not an issue
      for (const { el } of group) {
        results.push({ ruleId: "ACT-R55", type: "Potential Issue", impact: "moderate", description: `Multiple "${roleStr}" landmark regions share the accessible name "${nameStr}" but contain different content`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      }
    }
    // ACT-R56: landmarks with the same role must have unique accessible names.
    // The empty accessible name participates in comparison, so two unnamed
    // navigation or banner landmarks fail just like two equally named ones.
    for (const duplicateGroup of findDuplicateLandmarkNames(landmarks)) {
      for (const info of duplicateGroup) {
        const duplicateName = info.name
          ? `the accessible name "${info.name}"`
          : "no accessible name";
        results.push({
          ruleId: "ACT-R56",
          type: "Issue",
          impact: "moderate",
          description: `Multiple "${info.role}" landmarks have ${duplicateName} — give each landmark of this role a unique accessible name`,
          element: outerHtmlSnippet(info.el),
          elementContext: elementContextForAI(info.el),
          selector: getSelector(info.el),
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R87 / SIA-R87: First focusable element is a link to main content.
  // This follows Alfa's expectation chain:
  //   first sequentially tabbable element -> visible, non-ignored link ->
  //   same-page fragment -> main landmark at the start of the content.
  // ════════════════════════════════════════════════════════════════════════
  {
    const isActuallyHidden = (el: Element): boolean =>
      isProgrammaticallyHidden(el) ||
      !!el.closest("[aria-hidden='true'], [inert]");
    const isTabbable = (el: Element): boolean => {
      if (isActuallyHidden(el) || !isVisible(el)) return false;
      const tabIndexAttr = el.getAttribute("tabindex");
      if (tabIndexAttr !== null && Number.parseInt(tabIndexAttr, 10) < 0) return false;
      if (tabIndexAttr !== null && Number.parseInt(tabIndexAttr, 10) >= 0) return true;
      const tag = el.tagName.toLowerCase();
      if (["a", "area"].includes(tag)) return !!el.getAttribute("href");
      if (["button", "select", "textarea"].includes(tag)) return !(el as HTMLButtonElement).disabled;
      if (tag === "input") return !(el as HTMLInputElement).disabled && (el as HTMLInputElement).type !== "hidden";
      return false;
    };
    const tabbables = Array.from(document.querySelectorAll("*")).filter(isTabbable);
    const firstTabbable = tabbables[0];

    if (firstTabbable) {
      const tag = firstTabbable.tagName.toLowerCase();
      const isLink = tag === "a" || tag === "area" ||
        firstTabbable.getAttribute("role") === "link";
      const href = firstTabbable.getAttribute("href") || "";
      const isFragmentLink = isLink && href.startsWith("#") && href.length > 1;
      const target = isFragmentLink
        ? document.getElementById(href.slice(1)) ??
          document.querySelector(`[name="${CSS.escape(href.slice(1))}"]`)
        : null;
      const mainLandmarks = Array.from(document.querySelectorAll("main, [role='main']"));
      const targetMain = target && (target.matches("main, [role='main']") ? target : target.closest("main, [role='main']"));
      const targetIsMain = !!targetMain && mainLandmarks.includes(targetMain);
      const targetIsAtStart = !!targetMain && (() => {
        let node: Node | null = targetMain;
        while (node) {
          const previous = node.previousSibling;
          if (previous) {
            const text = (previous.textContent || "").trim();
            if (text || (previous.nodeType === Node.ELEMENT_NODE && isRendered(previous as Element))) return false;
          }
          node = node.parentNode;
          if (node === document.body) break;
        }
        return true;
      })();
      const accessibleName = getAccessibleName(firstTabbable).toLowerCase();
      const communicatesSkip = /skip|main content|jump to|go to content|bypass/.test(accessibleName);

      if (!isLink || !isFragmentLink || !targetIsMain || !targetIsAtStart || !communicatesSkip) {
        results.push({
          ruleId: "ACT-R87",
          type: "Best Practice",
          impact: "moderate",
          description: "The first focusable element is not a link to the main content",
          element: outerHtmlSnippet(firstTabbable),
          elementContext: elementContextForAI(firstTabbable),
          selector: getSelector(firstTabbable),
        });
      }
    }

    // ACT-R101 / SIA-R101: repeated content before the main landmark.
    // Alfa applies this to the document and passes when there is no accessible
    // content before the first main landmark. Otherwise the result requires
    // manual review of whether a bypass mechanism exists.
    const main = document.querySelector("main, [role='main']");
    if (main) {
      const beforeMain = Array.from(document.body.querySelectorAll("*")).filter((el) => {
        const position = el.compareDocumentPosition(main);
        return !!(position & Node.DOCUMENT_POSITION_FOLLOWING) && el !== main &&
          !el.closest("main, [role='main']") &&
          isRendered(el) &&
          !isProgrammaticallyHidden(el);
      });
      const hasAccessibleContentBeforeMain = beforeMain.some((el) => {
        const text = (el.textContent || "").trim();
        return text.length > 0 && !/^(script|style|template|noscript)$/i.test(el.tagName);
      });
      if (hasAccessibleContentBeforeMain) {
        results.push({ ruleId: "ACT-R101", type: "Potential Issue", impact: "moderate", description: "Repeated content exists before the main content — verify that keyboard users can bypass it", element: outerHtmlSnippet(main), elementContext: elementContextForAI(main), selector: getSelector(main) });
      }
    }

    // Local compatibility check: skip-link target exists. This is not Alfa's
    // current R101 semantics, so keep it under the platform's auxiliary R102.
    const anchorLinks = Array.from(document.querySelectorAll("a[href^='#']"));
    const skipLinks = anchorLinks.filter((link) => {
      const text = (link.textContent || link.getAttribute("aria-label") || "").toLowerCase();
      const href = link.getAttribute("href") || "#";
      return href.length > 1 && (text.includes("skip") || text.includes("main content") || text.includes("jump to") || text.includes("go to content"));
    });
    skipLinks.forEach((link) => {
      const href = link.getAttribute("href") ?? "#";
      if (href.length <= 1) return;
      const targetId = href.slice(1);
      const target = document.getElementById(targetId) ?? document.querySelector(`[name="${CSS.escape(targetId)}"]`);
      if (!target) {
        results.push({ ruleId: "ACT-R102", type: "Potential Issue", impact: "moderate", description: `Skip link points to "#${targetId}" but no element with that id exists on the page`, element: outerHtmlSnippet(link), elementContext: elementContextForAI(link), selector: getSelector(link) });
      }
    });

    // ACT-R102: Page has navigable content before <main> but no valid skip link
    // Only fire when a nav element with enough links exists and no skip link was found.
    const navLinks = document.querySelectorAll("nav a[href], header a[href]");
    if (EMIT_MANUAL_ONLY_RULES && navLinks.length >= 3 && skipLinks.length === 0) {
      results.push({ ruleId: "ACT-R102", type: "Best Practice", impact: "moderate", description: "Page has navigation with multiple links but no skip-navigation link — add a skip link to help keyboard users bypass repeated blocks", element: "<body>", selector: "body" });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R99: Primary content is not exposed as a main landmark (WCAG 1.3.1)
  // ════════════════════════════════════════════════════════════════════════
  {
    const mainLandmarks = Array.from(
      document.querySelectorAll("main, [role='main']"),
    ).filter((el) => isRendered(el));

    if (mainLandmarks.length === 0) {
      // Prefer the page-level generic wrapper used by older sites. These
      // selectors intentionally identify one primary content container rather
      // than reporting every generic div on a page without <main>.
      const preferredIds = ["content", "main", "appForm"];
      const namedCandidates = preferredIds
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => {
          if (!el || !isRendered(el)) return false;
          if (el.closest("header, nav, aside, footer")) return false;
          return (el.textContent || "").trim().length >= 80;
        });
      const classCandidates = Array.from(
        document.querySelectorAll(
          "[class~='content'],[class~='main'],[class~='primary-content'],[class~='page-content']",
        ),
      ).filter((el) => {
        if (!isRendered(el)) return false;
        if (el.closest("header, nav, aside, footer")) return false;
        return (el.textContent || "").trim().length >= 80;
      });
      const contentContainer = namedCandidates[0] ?? classCandidates[0];

      if (contentContainer) {
        const tag = contentContainer.tagName.toLowerCase();
        const identifier = contentContainer.id
          ? `#${contentContainer.id}`
          : "";
        results.push({
          ruleId: "ACT-R99",
          type: "Potential Issue",
          impact: "moderate",
          description: `Primary content is contained in <${tag}${identifier}> without a main landmark`,
          element: outerHtmlSnippet(contentContainer),
          elementContext: elementContextForAI(contentContainer),
          selector: getSelector(contentContainer),
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R97: Collapsible element aria-expanded/aria-controls broken (WCAG 4.1.2)
  // ════════════════════════════════════════════════════════════════════════
  {
    const expandables = Array.from(document.querySelectorAll("[aria-expanded]"));
    expandables.forEach((el) => {
      if (!isVisible(el)) return;
      const tag = el.tagName.toLowerCase();
      // Must be a keyboard-reachable trigger element
      const tabIndex = (el as HTMLElement).tabIndex;
      const isNativeInteractive = ["button", "a", "summary", "details"].includes(tag);
      if (!isNativeInteractive && tabIndex < 0) {
        results.push({ ruleId: "ACT-R97", type: "Issue", impact: "moderate", description: `Element with aria-expanded is not keyboard reachable — add tabindex="0" or use a <button> element`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
        return;
      }
      // aria-controls must point to an existing element
      const controls = el.getAttribute("aria-controls");
      if (!controls) return; // no aria-controls — not necessarily wrong (Details/Summary is self-contained)
      const ids = controls.trim().split(/\s+/);
      const missingIds = ids.filter((id) => !document.getElementById(id));
      if (missingIds.length > 0) {
        results.push({ ruleId: "ACT-R97", type: "Issue", impact: "moderate", description: `aria-controls="${controls}" references id${missingIds.length > 1 ? "s" : ""} that do not exist in the DOM: ${missingIds.map((id) => `#${id}`).join(", ")}`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R65: Focus indicator not visible (WCAG 2.4.7)
  // ════════════════════════════════════════════════════════════════════════
  {
    getAlfaTabOrder().forEach((el) => {
      if (hasAlfaFocusIndicator(el)) return;
      results.push({ ruleId: "ACT-R65", type: "Issue", impact: "serious", description: "CSS removes focus outline without providing a visible replacement focus indicator", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    });
  }

  // ── Scoring stats: total elements / pages checked per rule ────────────────
  const headingEls = document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']").length;
  if (headingEls > 0) {
    pushStat("ACT-R53", headingEls, "element");
    pushStat("ACT-R64", headingEls, "element");
    pushStat("ACT-R34", headingEls, "element");
  }
  pushStat("ACT-R59", 1, "page");
  const assertiveLiveEls = document.querySelectorAll('[aria-live="assertive"]').length;
  if (assertiveLiveEls > 0) pushStat("ACT-R54", assertiveLiveEls, "element");
  const landmarkEls = document.querySelectorAll(
    "header:not([role]),footer:not([role]),main,nav,aside," +
    "form[aria-label],form[aria-labelledby],section[aria-label],section[aria-labelledby]," +
    "[role='banner'],[role='contentinfo'],[role='main'],[role='navigation']," +
    "[role='complementary'],[role='form'],[role='region'],[role='search']",
  ).length;
  if (landmarkEls > 0) {
    pushStat("ACT-R55", landmarkEls, "element");
    pushStat("ACT-R56", landmarkEls, "element");
  }
  pushStat("ACT-R87", 1, "page");
  pushStat("ACT-R99", 1, "page");
  pushStat("ACT-R101", 1, "page");
  pushStat("ACT-R102", 1, "page");
  const expandableEls = document.querySelectorAll("[aria-expanded]").length;
  if (expandableEls > 0) pushStat("ACT-R97", expandableEls, "element");
  const focusableEls = getAlfaTabOrder().length;
  if (focusableEls > 0) pushStat("ACT-R65", focusableEls, "element");

  // ════════════════════════════════════════════════════════════════════════
}
