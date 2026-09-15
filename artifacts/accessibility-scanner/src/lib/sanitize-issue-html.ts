const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "a", "code", "pre", "blockquote", "h3", "h4", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "figure", "figcaption", "img"]);
const REMOVE_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "svg", "math"]);

/**
 * The API sanitizes writes, but this second pass keeps legacy or imported records
 * from becoming executable when rendered in an issue detail view.
 */
export function sanitizeIssueHtml(value: string | null | undefined): string {
  if (!value || typeof window === "undefined") return "";
  const parsed = new DOMParser().parseFromString(value, "text/html");
  const clean = (node: Node, document: Document): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (REMOVE_WITH_CONTENT.has(tag)) return null;
    const children = Array.from(element.childNodes).map((child) => clean(child, document)).filter(Boolean) as Node[];
    if (!ALLOWED_TAGS.has(tag)) {
      const fragment = document.createDocumentFragment();
      children.forEach((child) => fragment.appendChild(child));
      return fragment;
    }
    const safe = document.createElement(tag);
    if (tag === "a") {
      const href = element.getAttribute("href") || "";
      if (/^(https?:|mailto:)/i.test(href)) {
        safe.setAttribute("href", href);
        safe.setAttribute("rel", "noopener noreferrer");
      }
    } else if (tag === "img") {
      const src = element.getAttribute("src") || "";
      if (!/^\/api\/issues\/\d+\/attachments\/\d+$/.test(src)) return null;
      safe.setAttribute("src", src);
      safe.setAttribute("alt", (element.getAttribute("alt") || "").slice(0, 500));
      safe.setAttribute("loading", "lazy");
      const width = Number.parseInt(element.style.width, 10);
      if (Number.isFinite(width) && width >= 20 && width <= 100 && width % 5 === 0) {
        safe.setAttribute("style", `width:${width}%;height:auto;max-width:100%`);
      }
    }
    children.forEach((child) => safe.appendChild(child));
    return safe;
  };
  const output = document.createElement("div");
  Array.from(parsed.body.childNodes).forEach((node) => {
    const safeNode = clean(node, document);
    if (safeNode) output.appendChild(safeNode);
  });
  return output.innerHTML;
}