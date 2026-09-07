import type { ScanRawResult, PushStatFn } from "../types";
import { ALL_ARIA_ATTRS, ARIA_PROHIBITED, GLOBAL_ARIA_ATTRS, NAMING_PROHIBITED_ROLES, REQUIRED_ARIA_ATTRS, ROLE_SUPPORTED_ATTRS, VALID_ROLES, getEffectiveAriaRole, hasNonDefaultAriaRole } from "../aria-data";
import { ARIA_VALUE_DESCRIPTORS, ariaValueError } from "../aria-value-validator";
import { elementContextForAI, getSelector, outerHtmlSnippet } from "../dom-helpers";
import { isActuallyTabbable, isIncludedInAccessibilityTree, isProgrammaticallyHidden, isVisible, isVisibleRect } from "../visibility";

export function runAriaRules(results: ScanRawResult[], EMIT_MANUAL_ONLY_RULES: boolean, pushStat: PushStatFn): void {
  // ACT-R16: Required ARIA attribute missing (WAI-ARIA)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("[role]").forEach((el) => {
    if (!isIncludedInAccessibilityTree(el)) return;
    if (!hasNonDefaultAriaRole(el)) return;
    const role = getEffectiveAriaRole(el);
    const attrs = REQUIRED_ARIA_ATTRS[role] ?? [];
    for (const attr of attrs) {
      if (!el.hasAttribute(attr)) {
        results.push({ ruleId: "ACT-R16", type: "Issue", impact: "serious", description: `Element with role="${role}" is missing required attribute: ${attr}`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      }
    }
    if (role === "scrollbar" || role === "separator") {
      const controls = el.getAttribute("aria-controls");
      if (!controls || role === "separator") return;
      if (document.getElementById(controls)) {
        results.push({ ruleId: "ACT-R16", type: "Issue", impact: "serious", description: `Toggle control references #${controls} via aria-controls but is missing aria-expanded state`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      }
    }
  });
  document.querySelectorAll("button, [role='button'], a[href='#'], a[href='javascript:void(0)'], a[href='javascript:;']").forEach((el) => {
    // R16 applies to authored controls in dormant UI states too. Passenger
    // pickers and similar widgets commonly keep additional categories in the
    // DOM with display:none until activated; their required state must not be
    // skipped merely because that state is not initially rendered.
    if (el.getAttribute("aria-expanded") !== null) return;
    if (el.getAttribute("aria-haspopup")) return;
    const controls = el.getAttribute("aria-controls");
    if (!controls) return;
    if (document.getElementById(controls)) {
      results.push({ ruleId: "ACT-R16", type: "Issue", impact: "serious", description: `Toggle control references #${controls} via aria-controls but is missing aria-expanded state`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R17: Hidden element has focusable content (WCAG 1.3.1)
  // ════════════════════════════════════════════════════════════════════════
  {
    const r17Seen = new Set<string>();
    const r17FocusableSel = "a[href]:not([tabindex='-1']), button:not([disabled]):not([tabindex='-1']), input:not([disabled]):not([type='hidden']):not([tabindex='-1']), select:not([disabled]):not([tabindex='-1']), textarea:not([disabled]):not([tabindex='-1'])";
    // Alfa alignment: an element is only tabbable if it is actually rendered —
    // display:none (self or ancestor) removes it from the tab order entirely.
    const isActuallyTabbable = (e: Element) => e.getClientRects().length > 0 || (e instanceof HTMLElement && e.offsetParent !== null);
    document.querySelectorAll("[aria-hidden='true']").forEach((el) => {
      const tabIdx = el.getAttribute("tabindex");
      // Alfa alignment: only flag TABBABLE elements — tabindex="-1" removes the
      // element from tab order, so it does not violate R17. input[type=hidden]
      // is never focusable.
      const selfFocusable = ((el.matches("a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled])") && tabIdx !== "-1") || (tabIdx !== null && tabIdx !== "-1" && parseInt(tabIdx, 10) >= 0)) && isActuallyTabbable(el);
      if (selfFocusable) {
        const key = getSelector(el);
        if (!r17Seen.has(key)) {
          r17Seen.add(key);
          results.push({ ruleId: "ACT-R17", type: "Issue", impact: "serious", description: 'Interactive element has aria-hidden="true" — it is hidden from assistive technologies but keyboard users can still Tab to and activate it', element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: key });
        }
      }
      el.querySelectorAll(r17FocusableSel).forEach((child) => {
        if (!isActuallyTabbable(child)) return;
        const key = getSelector(child);
        if (r17Seen.has(key)) return;
        r17Seen.add(key);
        results.push({ ruleId: "ACT-R17", type: "Issue", impact: "serious", description: 'Focusable element is inside an aria-hidden="true" container — keyboard users can Tab to it but screen readers will not announce it', element: outerHtmlSnippet(child), elementContext: elementContextForAI(child), selector: key });
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R18: Unsupported ARIA attribute (WAI-ARIA)
  // ════════════════════════════════════════════════════════════════════════
  // Alfa R18 semantics: applicability = every aria-* attribute on an element
  // INCLUDED IN THE ACCESSIBILITY TREE. An attribute fails when it is neither
  // a global ARIA attribute nor supported by the element's (explicit or
  // implicit) role, or when it is a naming attribute on a naming-prohibited
  // role. Elements outside the tree (aria-hidden/display:none/hidden inputs)
  // are never applicable.
  {
    document.querySelectorAll("*").forEach((el) => {
      const ariaAttrs = el.getAttributeNames().filter((a) => a.startsWith("aria-") && ALL_ARIA_ATTRS.has(a));
      if (ariaAttrs.length === 0) return;
      if (!isIncludedInAccessibilityTree(el)) return;
      const explicitRole = (el.getAttribute("role") || "").split(/\s+/).filter(Boolean)[0] || "";
      const role = getEffectiveAriaRole(el);
      const supported = new Set(ROLE_SUPPORTED_ATTRS[role] ?? []);
      // Generic elements have an implicit generic role too. Do not require an
      // explicit role here: plain <div aria-label="..."> is the common case
      // covered by R18. Keep the narrow compatibility exception for accordion
      // wrappers observed in real pages, where an implicit generic element
      // carries aria-labelledby together with aria-expanded.
      const implicitAccordionWrapper =
        !explicitRole &&
        role === "generic" &&
        el.hasAttribute("aria-labelledby") &&
        el.hasAttribute("aria-expanded");
      const namingProhibited =
        NAMING_PROHIBITED_ROLES.has(role) && !implicitAccordionWrapper;
      const tag = el.tagName.toLowerCase();
      for (const attr of ariaAttrs) {
        if (attr === "aria-label" || attr === "aria-labelledby") {
          if (namingProhibited) {
            results.push({ ruleId: "ACT-R18", type: "Issue", impact: "moderate", description: `ARIA attribute "${attr}" is prohibited on role "${role || "generic"}" — this role does not allow naming from author`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
          }
          continue;
        }
        if (GLOBAL_ARIA_ATTRS.has(attr)) continue;
        if (role && !(role in ROLE_SUPPORTED_ATTRS)) continue;
        if (!supported.has(attr)) {
          results.push({ ruleId: "ACT-R18", type: "Issue", impact: "moderate", description: `ARIA attribute "${attr}" is not allowed on role "${role || "generic"}" (<${tag}>)`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
        }
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R19: Invalid value for ARIA attribute (WCAG 4.1.2)
  // ════════════════════════════════════════════════════════════════════════
  {
    document.querySelectorAll("*").forEach((el) => {
      Array.from(el.attributes).forEach(({ name, value }) => {
        const descriptor = ARIA_VALUE_DESCRIPTORS[name];
        if (!descriptor || !value.trim()) return;

        let error = ariaValueError(name, value);
        const role = getEffectiveAriaRole(el);
        const isRequiredReference =
          !error &&
          (descriptor.type === "idref" || descriptor.type === "idrefs") &&
          (
            (REQUIRED_ARIA_ATTRS[role] ?? []).includes(name) ||
            (role === "scrollbar" && name === "aria-controls")
          );
        if (isRequiredReference) {
          const ids = value.trim().split(/[\t\n\f\r ]+/);
          const root = el.getRootNode();
          const hasTarget = Array.from(
            (root as Document | ShadowRoot).querySelectorAll?.("[id]") ?? [],
          ).some((candidate) => ids.includes(candidate.id));
          if (!hasTarget) error = "reference at least one existing element";
        }

        if (!error) return;
        results.push({ ruleId: "ACT-R19", type: "Issue", impact: "moderate", description: `${name}="${value}" is not a valid value — ${error}`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R20: Non-existent ARIA attribute (WAI-ARIA)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("*").forEach((el) => {
    if (isProgrammaticallyHidden(el)) return;
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.startsWith("aria-") && !ALL_ARIA_ATTRS.has(attr.name)) {
        results.push({ ruleId: "ACT-R20", type: "Issue", impact: "moderate", description: `Element uses non-existent ARIA attribute "${attr.name}"`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R21: Every role token must be valid.
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("[role]").forEach((el) => {
    if (isProgrammaticallyHidden(el)) return;
    const roles = (el.getAttribute("role") || "").trim().split(/\s+/);
    if (roles.some((role) => role && !VALID_ROLES.has(role))) {
      results.push({ ruleId: "ACT-R21", type: "Issue", impact: "serious", description: "The role attribute contains one or more invalid role values", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R36: ARIA attribute unsupported or prohibited on role
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("[role]").forEach((el) => {
    if (isProgrammaticallyHidden(el)) return;
    const role = getEffectiveAriaRole(el);
    if (!role || !(role in ROLE_SUPPORTED_ATTRS)) return;
    const supported = new Set([
      ...GLOBAL_ARIA_ATTRS,
      ...ROLE_SUPPORTED_ATTRS[role],
    ]);
    const explicitlyProhibited = new Set(ARIA_PROHIBITED[role] || []);
    for (const { name: attr } of Array.from(el.attributes)) {
      if (!ALL_ARIA_ATTRS.has(attr)) continue;
      if (!explicitlyProhibited.has(attr) && supported.has(attr)) continue;
      results.push({ ruleId: "ACT-R36", type: "Issue", impact: "moderate", description: `ARIA attribute "${attr}" is unsupported or prohibited on role="${role}"`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R40: region landmark has no accessible name (WAI-ARIA)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("[role='region'], section[aria-label], section[aria-labelledby]").forEach((el) => {
    if (isProgrammaticallyHidden(el)) return;
    const ariaLabel = el.getAttribute("aria-label")?.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    const resolvedLabel = ariaLabel ? ariaLabel : labelledBy ? (document.getElementById(labelledBy)?.textContent?.trim() ?? "") : "";
    if (!resolvedLabel) {
      results.push({ ruleId: "ACT-R40", type: "Issue", impact: "moderate", description: `Element with role="region" has no accessible name — add aria-label or aria-labelledby`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R42: ARIA role not in correct context
  // ════════════════════════════════════════════════════════════════════════
  {
    const requiredParent: Record<string, string[]> = {
      listitem: ["ul","ol","menu","[role='list']","[role='menu']","[role='menubar']"],
      option: ["[role='listbox']","select"],
      menuitem: ["[role='menu']","[role='menubar']"],
      menuitemcheckbox: ["[role='menu']","[role='menubar']"],
      menuitemradio: ["[role='menu']","[role='menubar']"],
      tab: ["[role='tablist']"],
      row: ["[role='grid']","[role='rowgroup']","[role='table']","[role='treegrid']","table","thead","tbody","tfoot"],
      gridcell: ["[role='row']","tr"],
      cell: ["[role='row']","tr"],
      columnheader: ["[role='row']","tr"],
      rowheader: ["[role='row']","tr"],
      treeitem: ["[role='tree']","[role='treeitem']","[role='group']"],
    };
    document.querySelectorAll("li").forEach((li) => {
      const parent = li.parentElement;
      if (parent && !["ul","ol","menu"].includes(parent.tagName.toLowerCase())) {
        results.push({ ruleId: "ACT-R42", type: "Issue", impact: "moderate", description: "List item is not inside a list element", element: outerHtmlSnippet(li), elementContext: elementContextForAI(li), selector: getSelector(li) });
      }
    });
    for (const [role, parents] of Object.entries(requiredParent)) {
      document.querySelectorAll(`[role="${role}"]`).forEach((el) => {
        if (isProgrammaticallyHidden(el)) return;
        const hasValidParent = parents.some((sel) => el.closest(sel) !== null);
        if (!hasValidParent) {
          results.push({ ruleId: "ACT-R42", type: "Issue", impact: "moderate", description: `Element with role="${role}" is not inside a required parent element (${parents.join(", ")})`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R86: Element marked as decorative is not exposed (WCAG 4.1.2)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("[role='none'],[role='presentation']").forEach((el) => {
    if (!isIncludedInAccessibilityTree(el)) return;
    if (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")) {
      if (EMIT_MANUAL_ONLY_RULES) results.push({ ruleId: "ACT-R86", type: "Issue", impact: "moderate", description: `Element with role="${el.getAttribute("role")}" has aria-label/aria-labelledby — the decorative role will be ignored by assistive technologies`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      return;
    }
    const focusable = el.querySelector("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (focusable) {
      if (EMIT_MANUAL_ONLY_RULES) results.push({ ruleId: "ACT-R86", type: "Issue", impact: "moderate", description: `Element with role="${el.getAttribute("role")}" contains focusable content — the decorative role will be ignored`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R90: Role with implied hidden content has keyboard focus (WCAG 4.1.2)
  // ════════════════════════════════════════════════════════════════════════
  {
    const r90Seen = new Set<string>();
    const interactiveSel = "a[href], button, input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [tabindex]:not([tabindex='-1'])";
    const roleSel = "[role='button'],[role='link'],[role='menuitem'],[role='tab'],[role='option'],[role='switch'],[role='checkbox'],[role='radio'],[role='treeitem'],[role='menuitemcheckbox'],[role='menuitemradio']";
    document.querySelectorAll(roleSel).forEach((el) => {
      if (!isIncludedInAccessibilityTree(el)) return;
      Array.from(el.querySelectorAll(interactiveSel)).filter((c) => c !== el).forEach((child) => {
        const key = `${getSelector(el)}|${getSelector(child)}`;
        if (r90Seen.has(key)) return;
        r90Seen.add(key);
        results.push({ ruleId: "ACT-R90", type: "Issue", impact: "serious", description: "Element with an interactive role contains nested interactive content — assistive technologies cannot correctly announce this", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      });
    });
    document.querySelectorAll("a[href], button").forEach((el) => {
      if (!isActuallyTabbable(el)) return;
      const nestedRole = Array.from(el.querySelectorAll(roleSel)).find((c) => c !== el);
      if (!nestedRole) return;
      const key = `${getSelector(el)}|${getSelector(nestedRole)}`;
      if (r90Seen.has(key)) return;
      r90Seen.add(key);
      results.push({ ruleId: "ACT-R90", type: "Issue", impact: "serious", description: "Interactive element contains a nested element with an interactive role", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    });
    const r90FocusableSel = "a[href]:not([tabindex='-1']), button:not([disabled]):not([tabindex='-1']), input:not([disabled]):not([tabindex='-1']), select:not([disabled]):not([tabindex='-1']), textarea:not([disabled]):not([tabindex='-1'])";
    document.querySelectorAll(r90FocusableSel).forEach((el) => {
      const elStyle = window.getComputedStyle(el as HTMLElement);
      if (elStyle.display === "none" || elStyle.visibility === "hidden") return;
      let ancestor = (el as HTMLElement).parentElement;
      while (ancestor && ancestor !== document.documentElement) {
        const aStyle = window.getComputedStyle(ancestor);
        if (aStyle.display === "none") break;
        if (parseFloat(aStyle.opacity) === 0) {
          const key = getSelector(el);
          if (!r90Seen.has(key)) {
            r90Seen.add(key);
            results.push({ ruleId: "ACT-R90", type: "Issue", impact: "serious", description: "Focusable element is inside an opacity:0 container — visually invisible but still reachable by keyboard Tab", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: key });
          }
          break;
        }
        ancestor = ancestor.parentElement;
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R10: Autocomplete attribute missing or invalid (WCAG 1.3.5)
  // ════════════════════════════════════════════════════════════════════════
  {
    const VALID_AUTOCOMPLETE_TOKENS = new Set(["name","honorific-prefix","given-name","additional-name","family-name","honorific-suffix","nickname","username","new-password","current-password","one-time-code","organization-title","organization","street-address","address-line1","address-line2","address-line3","address-level4","address-level3","address-level2","address-level1","country","country-name","postal-code","cc-name","cc-given-name","cc-additional-name","cc-family-name","cc-number","cc-exp","cc-exp-month","cc-exp-year","cc-csc","cc-type","transaction-currency","transaction-amount","language","bday","bday-day","bday-month","bday-year","sex","url","photo","tel","tel-country-code","tel-national","tel-area-code","tel-local","tel-extension","impp","email","webauthn"]);
    document.querySelectorAll("input, select, textarea").forEach((el) => {
      if (!isVisibleRect(el)) return;
      const ac = el.getAttribute("autocomplete");
      if (!ac || ac === "on" || ac === "off") return;
      const tokens = ac.trim().toLowerCase().split(/\s+/);
      const lastToken = tokens[tokens.length - 1];
      if (!VALID_AUTOCOMPLETE_TOKENS.has(lastToken)) {
        results.push({ ruleId: "ACT-R10", type: "Issue", impact: "moderate", description: `autocomplete="${ac}" contains an invalid token "${lastToken}"`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
      }
    });
    const autocompleteMap: Record<string, string[]> = {
      name: ["name","full-name","first","last","given","family","fname","lname"],
      email: ["email","mail","e-mail"],
      tel: ["phone","telephone","mobile","cell"],
      "street-address": ["address","street","addr"],
      "postal-code": ["zip","postal","postcode"],
      country: ["country"],
      bday: ["birth","dob","birthday"],
      username: ["username","login"],
      "new-password": ["password","passwd","pwd"],
      "cc-number": ["card","credit","cardnumber"],
    };
    document.querySelectorAll("input[type='text'], input[type='email'], input[type='tel'], input[type='password'], input:not([type])").forEach((el) => {
      if (!isVisible(el)) return;
      const input = el as HTMLInputElement;
      const ac = input.getAttribute("autocomplete");
      if (ac && ac !== "off") return;
      const name = (input.name || "").toLowerCase();
      const id = (input.id || "").toLowerCase();
      const placeholder = (input.placeholder || "").toLowerCase();
      const combined = `${name} ${id} ${placeholder}`;
      for (const [token, patterns] of Object.entries(autocompleteMap)) {
        if (patterns.some((p) => combined.includes(p)) || combined.includes(token)) {
          results.push({ ruleId: "ACT-R10", type: "Issue", impact: "moderate", description: `Input collecting "${token}" data is missing autocomplete="${token}" attribute`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
          break;
        }
      }
    });
  }

  // ── Scoring stats: total elements checked per rule ────────────────────────
  const withRoleEls = document.querySelectorAll("[role]").length;
  if (withRoleEls > 0) {
    pushStat("ACT-R16", withRoleEls, "element");
    pushStat("ACT-R21", withRoleEls, "element");
    pushStat("ACT-R36", withRoleEls, "element");
  }
  const ariaHiddenEls = document.querySelectorAll("[aria-hidden='true']").length;
  if (ariaHiddenEls > 0) pushStat("ACT-R17", ariaHiddenEls, "element");
  const anyAriaEls = document.querySelectorAll(
    "[role],[aria-label],[aria-labelledby],[aria-describedby],[aria-hidden]," +
    "[aria-expanded],[aria-checked],[aria-selected],[aria-required],[aria-controls]," +
    "[aria-owns],[aria-live],[aria-pressed],[aria-disabled],[aria-invalid]",
  ).length;
  if (anyAriaEls > 0) {
    pushStat("ACT-R18", anyAriaEls, "element");
    pushStat("ACT-R20", anyAriaEls, "element");
  }
  const r19Els = Array.from(document.querySelectorAll("*")).filter((el) =>
    Array.from(el.attributes).some(
      ({ name, value }) => name in ARIA_VALUE_DESCRIPTORS && value.trim(),
    ),
  ).length;
  if (r19Els > 0) pushStat("ACT-R19", r19Els, "element");
  const regionEls = document.querySelectorAll("[role='region'],section[aria-label],section[aria-labelledby]").length;
  if (regionEls > 0) pushStat("ACT-R40", regionEls, "element");
  const listitemEls = document.querySelectorAll("li,[role='listitem'],[role='option'],[role='menuitem'],[role='treeitem'],[role='tab'],[role='gridcell']").length;
  if (listitemEls > 0) pushStat("ACT-R42", listitemEls, "element");
  const noneRoleEls = document.querySelectorAll("[role='none'],[role='presentation']").length;
  if (noneRoleEls > 0) pushStat("ACT-R86", noneRoleEls, "element");
  const interactiveAriaEls = document.querySelectorAll("a[href],button,[role='button'],[role='link']").length;
  if (interactiveAriaEls > 0) pushStat("ACT-R90", interactiveAriaEls, "element");
  const inputEls = document.querySelectorAll("input,select,textarea").length;
  if (inputEls > 0) pushStat("ACT-R10", inputEls, "element");

  // ════════════════════════════════════════════════════════════════════════
}
