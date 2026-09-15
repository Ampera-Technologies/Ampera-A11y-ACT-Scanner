import { isCssHidden } from "./visibility";

const NAME_FROM_CONTENTS_ROLES = new Set([
  "button", "cell", "checkbox", "columnheader", "gridcell", "heading",
  "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
  "radio", "row", "rowheader", "switch", "tab", "tooltip", "treeitem",
]);

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function roleForName(el: Element): string {
  const explicit = (el.getAttribute("role") || "")
    .trim()
    .split(/\s+/)
    .find(Boolean);
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "img") return el.getAttribute("alt") === "" ? "presentation" : "img";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
    return "textbox";
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return el.hasAttribute("multiple") ? "listbox" : "combobox";
  return "generic";
}

function labelText(label: HTMLLabelElement, owner: Element, visited: WeakSet<Element>): string {
  let text = "";
  for (const child of Array.from(label.childNodes)) {
    if (child === owner) continue;
    text += textFromSubtree(child, visited, true);
  }
  return normalize(text);
}

function textFromSubtree(node: Node, visited: WeakSet<Element>, fromReference: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (!(node instanceof Element)) return "";
  if (visited.has(node)) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";
  if (!fromReference && isCssHidden(node)) return "";

  if (node instanceof HTMLImageElement) return node.alt || "";
  if (node instanceof HTMLInputElement) {
    const type = node.type.toLowerCase();
    if (type === "text" || type === "search" || type === "email" || type === "tel" || type === "url") {
      return node.value || "";
    }
  }
  if (node instanceof HTMLSelectElement) {
    return Array.from(node.selectedOptions).map((option) => option.text).join(" ");
  }

  visited.add(node);
  const pieces: string[] = [];
  for (const child of Array.from(node.childNodes)) {
    const value = textFromSubtree(child, visited, fromReference);
    if (value) pieces.push(value);
  }
  visited.delete(node);
  return pieces.join(" ");
}

function nativeLabel(el: Element, visited: WeakSet<Element>): string {
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLSelectElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    !(el instanceof HTMLMeterElement) &&
    !(el instanceof HTMLProgressElement)
  ) {
    return "";
  }
  const labels = Array.from((el as HTMLInputElement).labels || []);
  const text = labels
    .map((label) => labelText(label, el, visited))
    .filter(Boolean)
    .join(" ");
  return normalize(text);
}

/**
 * AccName 1.1-compatible browser implementation used by rule applicability.
 * Referenced aria-labelledby content is intentionally allowed to be hidden;
 * ordinary descendant content is not.
 */
export function getAccessibleName(el: Element, visited: WeakSet<Element> = new WeakSet()): string {
  if (visited.has(el)) return "";
  visited.add(el);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const name = labelledBy
      .trim()
      .split(/\s+/)
      .map((id) => {
        const reference = document.getElementById(id);
        if (!reference || visited.has(reference)) return "";
        return getAccessibleName(reference, visited);
      })
      .filter(Boolean)
      .join(" ");
    if (normalize(name)) return normalize(name);
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && normalize(ariaLabel)) return normalize(ariaLabel);

  if (el instanceof HTMLInputElement) {
    const type = el.type.toLowerCase();
    if (type === "image") return normalize(el.alt || el.getAttribute("title") || "");
    if (type === "submit") return normalize(el.value || "Submit");
    if (type === "reset") return normalize(el.value || "Reset");
    if (type === "button") return normalize(el.value || "");
  }

  if (el instanceof HTMLImageElement) return normalize(el.alt || "");

  const label = nativeLabel(el, visited);
  if (label) return label;

  if (el instanceof HTMLFieldSetElement) {
    const legend = el.querySelector(":scope > legend");
    if (legend) {
      const text = textFromSubtree(legend, visited, false);
      if (normalize(text)) return normalize(text);
    }
  }

  if (el.tagName.toLowerCase() === "table") {
    const caption = el.querySelector(":scope > caption");
    if (caption) {
      const text = textFromSubtree(caption, visited, false);
      if (normalize(text)) return normalize(text);
    }
  }

  if (el.tagName.toLowerCase() === "svg") {
    const title = el.querySelector(":scope > title");
    if (title) {
      const text = textFromSubtree(title, visited, true);
      if (normalize(text)) return normalize(text);
    }
  }

  const title = el.getAttribute("title");
  if (title && normalize(title)) return normalize(title);

  const role = roleForName(el);
  if (NAME_FROM_CONTENTS_ROLES.has(role) || role === "generic") {
    visited.delete(el);
    return normalize(textFromSubtree(el, visited, false));
  }
  return "";
}

// ─── HELPER: getVisibleLabel (form field visible label) ──────────────────────
export function getVisibleLabel(el: Element): string {
  // For Label in Name checks, an existing aria-labelledby target is the
  // authoritative label source. Only fall back when no referenced target
  // exists or all referenced targets are empty.
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const referencedText = labelledBy
      .trim()
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() || "")
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (referencedText) return referencedText;
  }

  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent?.trim() || "";
    }
    const parentLabel = el.closest("label");
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input,select,textarea").forEach((c) => c.remove());
      return clone.textContent?.trim() || "";
    }
    if (el instanceof HTMLInputElement && el.placeholder) return el.placeholder;
    if (el instanceof HTMLTextAreaElement && el.placeholder) return el.placeholder;
  }

  return el.textContent?.trim() || "";
}

// ─── HELPER: isInsideLandmark ─────────────────────────────────────────────────
// <section> is landmark ONLY with aria-label/aria-labelledby (not title).
export function isInsideLandmark(el: Element): boolean {
  const landmarkRoles = ["main","navigation","complementary","contentinfo","banner","search","form","region"];
  const alwaysLandmarkTags = ["main","nav","aside","form"];
  const sectioningTags = ["article","aside","main","nav","section"];
  let node: Element | null = el.parentElement;
  while (node && node !== document.body) {
    const tag = node.tagName.toLowerCase();
    if (alwaysLandmarkTags.includes(tag)) return true;
    if (tag === "section") {
      if (node.hasAttribute("aria-label") || node.hasAttribute("aria-labelledby")) return true;
    }
    if (tag === "header" || tag === "footer") {
      const parentTag = (node.parentElement?.tagName || "").toLowerCase();
      if (!sectioningTags.includes(parentTag)) return true;
    }
    const role = node.getAttribute("role");
    if (role && landmarkRoles.includes(role)) return true;
    node = node.parentElement;
  }
  return false;
}


// Siteimprove/Alfa do not count placeholder as a valid accessible name.
export function getFormFieldAccessibleName(el: Element): string {
  return getAccessibleName(el);
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN RULES FUNCTION
