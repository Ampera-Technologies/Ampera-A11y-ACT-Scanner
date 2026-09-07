// ─── ARIA DATA ────────────────────────────────────────────────────────────────
export const ARIA_PROHIBITED: Record<string, string[]> = {
  presentation: ["aria-label","aria-labelledby"],
  none: ["aria-label","aria-labelledby"],
  caption: ["aria-label","aria-labelledby"],
  code: ["aria-label","aria-labelledby"],
  deletion: ["aria-label","aria-labelledby"],
  emphasis: ["aria-label","aria-labelledby"],
  generic: ["aria-label","aria-labelledby"],
  insertion: ["aria-label","aria-labelledby"],
  mark: ["aria-label","aria-labelledby"],
  paragraph: ["aria-label","aria-labelledby"],
  strong: ["aria-label","aria-labelledby"],
  subscript: ["aria-label","aria-labelledby"],
  superscript: ["aria-label","aria-labelledby"],
  time: ["aria-label","aria-labelledby"],
};

export const ALL_ARIA_ATTRS = new Set([
  "aria-activedescendant","aria-atomic","aria-autocomplete","aria-busy","aria-checked",
  "aria-colcount","aria-colindex","aria-colindextext","aria-colspan","aria-controls","aria-current",
  "aria-describedby","aria-description","aria-details","aria-disabled","aria-dropeffect",
  "aria-errormessage","aria-expanded","aria-flowto","aria-grabbed","aria-haspopup",
  "aria-hidden","aria-invalid","aria-keyshortcuts","aria-label","aria-labelledby",
  "aria-level","aria-live","aria-modal","aria-multiline","aria-multiselectable",
  "aria-orientation","aria-owns","aria-placeholder","aria-posinset","aria-pressed",
  "aria-readonly","aria-relevant","aria-required","aria-roledescription","aria-rowcount",
  "aria-rowindex","aria-rowindextext","aria-rowspan","aria-selected","aria-setsize","aria-sort",
  "aria-valuemax","aria-valuemin","aria-valuenow","aria-valuetext",
]);

// ARIA 1.2 global states/properties — allowed on every element in the
// accessibility tree (aria-label/labelledby are global but PROHIBITED on
// naming-prohibited roles, handled via NAMING_PROHIBITED_ROLES).
export const GLOBAL_ARIA_ATTRS = new Set([
  "aria-atomic","aria-busy","aria-controls","aria-current","aria-describedby",
  "aria-description","aria-details","aria-dropeffect","aria-flowto","aria-grabbed",
  "aria-hidden","aria-keyshortcuts","aria-label","aria-labelledby","aria-live",
  "aria-owns","aria-relevant","aria-roledescription",
]);

export const NAMING_PROHIBITED_ROLES = new Set([
  "generic","paragraph","code","emphasis","strong","deletion","insertion",
  "subscript","superscript","time","caption","mark","none","presentation","term",
]);

// Per-role supported NON-global attributes (ARIA 1.2, incl. inherited).
export const ROLE_SUPPORTED_ATTRS: Record<string, string[]> = {
  alert: [], alertdialog: ["aria-modal"], log: [], marquee: [], status: [], timer: [],
  application: ["aria-activedescendant","aria-disabled","aria-expanded","aria-haspopup","aria-invalid","aria-errormessage"],
  article: ["aria-posinset","aria-setsize"],
  banner: [], complementary: [], contentinfo: [], main: [], navigation: [], search: [], region: [], form: [],
  button: ["aria-disabled","aria-expanded","aria-haspopup","aria-pressed"],
  link: ["aria-disabled","aria-expanded","aria-haspopup"],
  checkbox: ["aria-checked","aria-disabled","aria-errormessage","aria-expanded","aria-invalid","aria-readonly","aria-required"],
  switch: ["aria-checked","aria-disabled","aria-errormessage","aria-expanded","aria-invalid","aria-readonly","aria-required"],
  radio: ["aria-checked","aria-disabled","aria-posinset","aria-setsize"],
  radiogroup: ["aria-activedescendant","aria-disabled","aria-errormessage","aria-invalid","aria-orientation","aria-readonly","aria-required"],
  combobox: ["aria-activedescendant","aria-autocomplete","aria-disabled","aria-errormessage","aria-expanded","aria-haspopup","aria-invalid","aria-readonly","aria-required"],
  textbox: ["aria-activedescendant","aria-autocomplete","aria-disabled","aria-errormessage","aria-haspopup","aria-invalid","aria-multiline","aria-placeholder","aria-readonly","aria-required"],
  searchbox: ["aria-activedescendant","aria-autocomplete","aria-disabled","aria-errormessage","aria-haspopup","aria-invalid","aria-multiline","aria-placeholder","aria-readonly","aria-required"],
  heading: ["aria-level"],
  listbox: ["aria-activedescendant","aria-disabled","aria-errormessage","aria-expanded","aria-invalid","aria-multiselectable","aria-orientation","aria-readonly","aria-required"],
  option: ["aria-checked","aria-disabled","aria-posinset","aria-selected","aria-setsize"],
  list: [], listitem: ["aria-level","aria-posinset","aria-setsize"],
  directory: [], feed: [], figure: [], definition: [], note: [], tooltip: [], group: ["aria-activedescendant","aria-disabled"],
  menu: ["aria-activedescendant","aria-disabled","aria-orientation"],
  menubar: ["aria-activedescendant","aria-disabled","aria-orientation"],
  menuitem: ["aria-disabled","aria-expanded","aria-haspopup","aria-posinset","aria-setsize"],
  menuitemcheckbox: ["aria-checked","aria-disabled","aria-expanded","aria-haspopup","aria-posinset","aria-setsize"],
  menuitemradio: ["aria-checked","aria-disabled","aria-expanded","aria-haspopup","aria-posinset","aria-setsize"],
  tab: ["aria-disabled","aria-expanded","aria-haspopup","aria-posinset","aria-selected","aria-setsize"],
  tablist: ["aria-activedescendant","aria-disabled","aria-multiselectable","aria-orientation"],
  tabpanel: [],
  dialog: ["aria-modal"], document: [], math: [], img: [], presentation: [], none: [],
  grid: ["aria-activedescendant","aria-colcount","aria-disabled","aria-multiselectable","aria-readonly","aria-rowcount"],
  table: ["aria-colcount","aria-rowcount"],
  treegrid: ["aria-activedescendant","aria-colcount","aria-disabled","aria-errormessage","aria-invalid","aria-multiselectable","aria-orientation","aria-readonly","aria-required","aria-rowcount"],
  row: ["aria-activedescendant","aria-colindex","aria-disabled","aria-expanded","aria-level","aria-posinset","aria-rowindex","aria-selected","aria-setsize"],
  rowgroup: [],
  cell: ["aria-colindex","aria-colspan","aria-rowindex","aria-rowspan"],
  gridcell: ["aria-colindex","aria-colspan","aria-disabled","aria-errormessage","aria-expanded","aria-haspopup","aria-invalid","aria-readonly","aria-required","aria-rowindex","aria-rowspan","aria-selected"],
  columnheader: ["aria-colindex","aria-colspan","aria-disabled","aria-errormessage","aria-expanded","aria-haspopup","aria-invalid","aria-readonly","aria-required","aria-rowindex","aria-rowspan","aria-selected","aria-sort"],
  rowheader: ["aria-colindex","aria-colspan","aria-disabled","aria-errormessage","aria-expanded","aria-haspopup","aria-invalid","aria-readonly","aria-required","aria-rowindex","aria-rowspan","aria-selected","aria-sort"],
  slider: ["aria-disabled","aria-errormessage","aria-haspopup","aria-invalid","aria-orientation","aria-readonly","aria-valuemax","aria-valuemin","aria-valuenow","aria-valuetext"],
  spinbutton: ["aria-activedescendant","aria-disabled","aria-errormessage","aria-invalid","aria-readonly","aria-required","aria-valuemax","aria-valuemin","aria-valuenow","aria-valuetext"],
  progressbar: ["aria-valuemax","aria-valuemin","aria-valuenow","aria-valuetext"],
  scrollbar: ["aria-disabled","aria-orientation","aria-valuemax","aria-valuemin","aria-valuenow","aria-valuetext"],
  meter: ["aria-valuemax","aria-valuemin","aria-valuenow","aria-valuetext"],
  separator: ["aria-disabled","aria-orientation","aria-valuemax","aria-valuemin","aria-valuenow","aria-valuetext"],
  toolbar: ["aria-activedescendant","aria-disabled","aria-orientation"],
  tree: ["aria-activedescendant","aria-disabled","aria-errormessage","aria-invalid","aria-multiselectable","aria-orientation","aria-required"],
  treeitem: ["aria-checked","aria-disabled","aria-expanded","aria-haspopup","aria-level","aria-posinset","aria-selected","aria-setsize"],
  term: [], generic: [], paragraph: [], code: [], emphasis: [], strong: [],
  deletion: [], insertion: [], subscript: [], superscript: [], time: [], caption: [], mark: [],
};

// Implicit ARIA role for an element (common-tag subset of html-aria mapping).
export function getImplicitAriaRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "a": return el.hasAttribute("href") ? "link" : "generic";
    case "area": return el.hasAttribute("href") ? "link" : "generic";
    case "button": return "button";
    case "select": {
      const size = parseInt(el.getAttribute("size") || "1", 10);
      return el.hasAttribute("multiple") || size > 1 ? "listbox" : "combobox";
    }
    case "textarea": return "textbox";
    case "input": {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      const hasList = el.hasAttribute("list");
      switch (t) {
        case "checkbox": return "checkbox";
        case "radio": return "radio";
        case "range": return "slider";
        case "number": return "spinbutton";
        case "search": return hasList ? "combobox" : "searchbox";
        case "email": case "tel": case "text": case "url": return hasList ? "combobox" : "textbox";
        case "submit": case "reset": case "button": case "image": return "button";
        default: return "";
      }
    }
    case "option": return "option";
    case "optgroup": return "group";
    case "img": return el.getAttribute("alt") === "" ? "presentation" : "img";
    case "nav": return "navigation";
    case "main": return "main";
    case "aside": return "complementary";
    case "header": return el.closest("article, aside, main, nav, section") ? "generic" : "banner";
    case "footer": return el.closest("article, aside, main, nav, section") ? "generic" : "contentinfo";
    case "section": return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "generic";
    case "form": return "form";
    case "ul": case "ol": case "menu": return "list";
    case "li": return el.closest("ul, ol, menu") ? "listitem" : "generic";
    case "dl": return "";
    case "table": return "table";
    case "thead": case "tbody": case "tfoot": return "rowgroup";
    case "tr": return "row";
    case "td": return el.closest("table") ? "cell" : "generic";
    case "th": return el.getAttribute("scope") === "row" ? "rowheader" : "columnheader";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
    case "hr": return "separator";
    case "dialog": return "dialog";
    case "output": return "status";
    case "progress": return "progressbar";
    case "meter": return "meter";
    case "summary": return "button";
    case "details": case "fieldset": return "group";
    case "article": return "article";
    case "blockquote": return "blockquote";
    case "caption": return "caption";
    case "code": return "code";
    case "em": return "emphasis";
    case "strong": return "strong";
    case "del": case "s": return "deletion";
    case "ins": return "insertion";
    case "sub": return "subscript";
    case "sup": return "superscript";
    case "time": return "time";
    case "mark": return "mark";
    case "p": return "paragraph";
    case "figure": return "figure";
    case "figcaption": return "";
    case "iframe": case "embed": case "object": return "";
    case "svg": return "";
    case "label": case "legend": return "";
    case "audio": case "video": case "canvas": case "picture": case "source": case "track": case "map": return "";
    case "html": case "head": case "body": return tag === "body" ? "generic" : "";
    case "datalist": return "listbox";
    default: return "generic";
  }
}

/** Resolve the first valid explicit role, falling back to the native role. */
export function getEffectiveAriaRole(el: Element): string {
  const explicit = (el.getAttribute("role") || "")
    .trim()
    .split(/\s+/)
    .find((role) => VALID_ROLES.has(role));
  return explicit || getImplicitAriaRole(el);
}

/** True when an explicit role changes the native semantic role. */
export function hasNonDefaultAriaRole(el: Element): boolean {
  const explicit = (el.getAttribute("role") || "")
    .trim()
    .split(/\s+/)
    .find((role) => VALID_ROLES.has(role));
  if (!explicit) return false;
  const implicit = getImplicitAriaRole(el);
  return explicit !== implicit;
}

/**
 * Required ARIA states/properties from the role model used by the current
 * Alfa rules. Values are intentionally kept separate from supported
 * attributes: support does not imply that an attribute is required.
 */
export const REQUIRED_ARIA_ATTRS: Record<string, string[]> = {
  checkbox: ["aria-checked"],
  combobox: ["aria-expanded"],
  heading: ["aria-level"],
  radio: ["aria-checked"],
  scrollbar: ["aria-valuenow", "aria-valuemin", "aria-valuemax"],
  slider: ["aria-valuenow", "aria-valuemin", "aria-valuemax"],
  spinbutton: ["aria-valuenow"],
  switch: ["aria-checked"],
  tab: ["aria-selected"],
  option: ["aria-selected"],
  treeitem: ["aria-level", "aria-setsize", "aria-posinset"],
};

export const VALID_ROLES = new Set([
  "alert","alertdialog","application","article","banner","button","cell","checkbox",
  "columnheader","combobox","complementary","contentinfo","definition","dialog",
  "directory","document","feed","figure","form","grid","gridcell","group","heading",
  "img","link","list","listbox","listitem","log","main","marquee","math","menu",
  "menubar","menuitem","menuitemcheckbox","menuitemradio","navigation","none","note",
  "option","presentation","progressbar","radio","radiogroup","region","row","rowgroup",
  "rowheader","scrollbar","search","searchbox","separator","slider","spinbutton",
  "status","switch","tab","table","tablist","tabpanel","term","textbox","timer",
  "toolbar","tooltip","tree","treegrid","treeitem",
]);

// ─── HELPER: getFormFieldAccessibleName ──────────────────────────────────────
// AccName 1.1 for form fields.  Intentionally does NOT include placeholder —
