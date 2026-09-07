import type { ScanRawResult, PushStatFn } from "../types";
import { elementContextForAI, getSelector, outerHtmlSnippet } from "../dom-helpers";
import { getAccessibleName } from "../accname";
import { isActuallyTabbable, isIncludedInAccessibilityTree, isVisible } from "../visibility";

export function runTablesFormsRules(results: ScanRawResult[], pushStat: PushStatFn): void {
  // ACT-R45: headers attribute refers to valid cells in the same table.
  // Current Alfa R45 validates explicit headers tokens; scope/association
  // heuristics belong to the separate local R46 compatibility rule.
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("table").forEach((table) => {
    if (!isVisible(table)) return;
    table.querySelectorAll("td, th").forEach((cell) => {
      const headersAttr = cell.getAttribute("headers");
      if (!headersAttr) return;
      const headersTokens = headersAttr.trim().split(/\s+/).filter(Boolean);
      const tableCells = Array.from(table.querySelectorAll("td, th"));
      const validTargets = headersTokens
        .map((token) => tableCells.find((candidate) => candidate.id === token))
        .filter((target): target is Element => !!target);
      const hasInvalidTarget = validTargets.length !== headersTokens.length;
      const referencesSelf = !!cell.id && headersTokens.includes(cell.id);
      if (hasInvalidTarget || referencesSelf) {
        results.push({ ruleId: "ACT-R45", type: "Issue", impact: "moderate", description: hasInvalidTarget
          ? "The headers attribute refers to a cell that is not present in the same table"
          : "The headers attribute refers to the cell defining it", element: outerHtmlSnippet(cell), elementContext: elementContextForAI(cell), selector: getSelector(cell) });
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R46: Table data cell not associated with header (WCAG 1.3.1)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("table").forEach((table) => {
    if (!isVisible(table)) return;
    const hasHeaders = table.querySelector("th, [role='columnheader'], [role='rowheader']");
    const dataCells = Array.from(table.querySelectorAll("td, [role='cell'], [role='gridcell']"));
    const rows = table.querySelectorAll("tr, [role='row']");
    if (!hasHeaders) {
      // A multi-row table made entirely from data cells has no possible
      // programmatic header association. Report the table once rather than
      // producing the same structural failure for every individual <td>.
      if (dataCells.length > 0 && rows.length > 1) {
        results.push({
          ruleId: "ACT-R46",
          type: "Issue",
          impact: "serious",
          description: "Table data cells cannot be associated with headers because the table has no <th>, columnheader, or rowheader cells",
          element: outerHtmlSnippet(table),
          elementContext: elementContextForAI(table),
          selector: getSelector(table),
        });
      }
      return;
    }
    const cells = Array.from(table.querySelectorAll("td, th, [role='cell'], [role='gridcell'], [role='columnheader'], [role='rowheader']"));
    const buildGrid = () => {
      const grid: Array<Array<Element | null>> = [];
      const occupied = new Map<number, number>();
      const rows = Array.from(table.querySelectorAll("tr"));
      rows.forEach((row, rowIndex) => {
        const rowCells = Array.from(row.children).filter((el) => el.matches("td, th, [role='cell'], [role='gridcell'], [role='columnheader'], [role='rowheader']"));
        let col = 0;
        grid[rowIndex] = grid[rowIndex] || [];
        for (const cell of rowCells) {
          while (occupied.get(col) && occupied.get(col)! > rowIndex) col++;
          const rowSpan = Math.max(1, parseInt(cell.getAttribute("rowspan") || "1", 10) || 1);
          const colSpan = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10) || 1);
          for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
            grid[r] = grid[r] || [];
            for (let c = col; c < col + colSpan; c++) grid[r][c] = cell;
          }
          for (let c = col; c < col + colSpan; c++) occupied.set(c, rowIndex + rowSpan);
          col += colSpan;
        }
      });
      return grid;
    };
    const grid = buildGrid();
    const headerCells = cells.filter((cell) => cell.matches("th, [role='columnheader'], [role='rowheader']"));
    table.querySelectorAll("td").forEach((td) => {
      const headersAttr = td.getAttribute("headers");
      const row = td.closest("tr");
      const rowIndex = row ? Array.from(table.querySelectorAll("tr")).indexOf(row) : -1;
      const rowHeader = row?.querySelector("th[scope='row'], th[scope='rowgroup'], [role='rowheader']");
      const colIdx = row ? Array.from(row.children).filter((el) => el.matches("td, th")).indexOf(td) : -1;
      const colHeaderByThead = colIdx >= 0 ? table.querySelector(`thead tr th:nth-child(${colIdx + 1}), thead tr [role='columnheader']:nth-child(${colIdx + 1})`) : null;
      const rowHeaderByScope = row?.querySelector("th[scope='row'], th[scope='rowgroup']");
      const explicitHeaders: Element[] = headersAttr
        ? headersAttr
          .trim()
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter((el): el is HTMLElement => !!el && table.contains(el))
        : [];
      const cellHeaders = rowIndex >= 0 && colIdx >= 0 ? [
        ...(grid[rowIndex]?.[colIdx] ? [grid[rowIndex][colIdx]!] : []),
        ...(explicitHeaders),
      ].filter((el) => el instanceof Element && (headerCells.includes(el) || el.matches("[role='columnheader'], [role='rowheader']"))) : explicitHeaders;
      const associated = !!headersAttr || !!rowHeader || !!rowHeaderByScope || !!colHeaderByThead || cellHeaders.length > 0;
      if (!associated) {
        results.push({ ruleId: "ACT-R46", type: "Issue", impact: "serious", description: "Table data cell cannot be associated with a header — use scope on <th> or headers attribute on <td>", element: outerHtmlSnippet(td), elementContext: elementContextForAI(td), selector: getSelector(td) });
      }
    });
  });

  // ACT-R76: Data table has no header cells (WCAG 1.3.1)
  document.querySelectorAll("table").forEach((table) => {
    if (!isVisible(table)) return;
    const hasAnyTh = table.querySelector("th") !== null;
    if (!hasAnyTh && table.querySelectorAll("tr").length > 1) {
      results.push({ ruleId: "ACT-R76", type: "Issue", impact: "serious", description: "Data table has no header cells (<th>) — use <th> to identify column and row headers", element: outerHtmlSnippet(table), elementContext: elementContextForAI(table), selector: getSelector(table) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R60: Fieldset without legend (WCAG 1.3.1)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("fieldset").forEach((el) => {
    if (!isVisible(el)) return;
    const namedGroup = isIncludedInAccessibilityTree(el) && !!getAccessibleName(el);
    const inputDescendants = Array.from(el.querySelectorAll("input, select, textarea")).filter((input) => isIncludedInAccessibilityTree(input));
    if (inputDescendants.length >= 2 && !namedGroup) {
      results.push({ ruleId: "ACT-R60", type: "Issue", impact: "serious", description: "Form group with multiple inputs has no accessible name — add a legend or accessible label", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R84: Scrollable element not keyboard accessible (WCAG 2.1.1)
  // ════════════════════════════════════════════════════════════════════════
  {
    const isScrollable = (el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      const canScrollY = (style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4;
      // Alfa alignment: horizontal scroll is only applicable with white-space:
      // nowrap — otherwise text wraps and no real scrolling occurs.
      const canScrollX = (style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4 && style.whiteSpace === "nowrap";
      return canScrollY || canScrollX;
    };
    const isKeyboardAccessible = (el: HTMLElement) =>
      isActuallyTabbable(el) ||
      Array.from(el.querySelectorAll("*")).some((descendant) => isActuallyTabbable(descendant));
    const isExcluded = (el: HTMLElement) => {
      const cls = typeof el.className === "string" ? el.className : "";
      if (cls.includes("sr-only") || cls.includes("visually-hidden") || cls.includes("screen-reader-only")) return true;
      if (el.closest('[aria-hidden="true"]')) return true;
      if (el.matches("iframe, object, embed, portal")) return true;
      const style = window.getComputedStyle(el);
      return style.display === "none" || style.visibility === "hidden";
    };
    const scrollableCandidates = Array.from(document.querySelectorAll("*"))
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .filter((el) => el !== document.documentElement && el !== document.body)
      .filter((el) => !isExcluded(el))
      .filter((el) => isScrollable(el));
    const inaccessible = scrollableCandidates.filter((el) => !isKeyboardAccessible(el));
    const deepest = inaccessible.filter((el) => !inaccessible.some((other) => other !== el && other.contains(el)));
    deepest.forEach((el) => {
      results.push({ ruleId: "ACT-R84", type: "Issue", impact: "moderate", description: "Scrollable element is not keyboard accessible — add tabindex='0'", element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R107: Custom interactive element not keyboard accessible (WCAG 2.1.1)
  // ════════════════════════════════════════════════════════════════════════
  document.querySelectorAll("[onclick], [ondblclick]").forEach((el) => {
    if (!isVisible(el)) return;
    const tag = el.tagName.toLowerCase();
    if (["a","button","input","select","textarea","summary","details","label","option"].includes(tag)) return;
    const tabindex = el.getAttribute("tabindex");
    const isKbAccessible = tabindex !== null && tabindex !== "-1";
    const hasKeyboardHandler = el.getAttribute("onkeydown") || el.getAttribute("onkeyup") || el.getAttribute("onkeypress");
    if (!isKbAccessible || !hasKeyboardHandler) {
      results.push({ ruleId: "ACT-R107", type: "Issue", impact: "serious", description: `<${tag}> has onclick but is ${!isKbAccessible ? "not keyboard focusable (missing tabindex)" : "missing keyboard event handler (onkeydown)"}`, element: outerHtmlSnippet(el), elementContext: elementContextForAI(el), selector: getSelector(el) });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ACT-R82: Form error message does not describe the invalid value (WCAG 3.3.1)
  // ════════════════════════════════════════════════════════════════════════
  {
    const invalidInputs = Array.from(document.querySelectorAll(
      "input[aria-invalid='true'], textarea[aria-invalid='true'], select[aria-invalid='true']"
    ));
    invalidInputs.forEach((input) => {
      if (!isVisible(input)) return;
      // Check aria-describedby → the target must exist and contain meaningful error text
      const describedBy = input.getAttribute("aria-describedby");
      if (describedBy) {
        const ids = describedBy.trim().split(/\s+/);
        const allTargetsHaveText = ids.every((id) => {
          const el = document.getElementById(id);
          return el && (el.textContent?.trim().length ?? 0) > 3;
        });
        if (allTargetsHaveText) return;
      }
      // Check for a sibling or parent-relative error element (common patterns)
      const parent = input.closest("div,fieldset,li,td,p,.form-group,.field,.input-wrapper,.form-field");
      if (parent) {
        const errorEl = parent.querySelector("[role='alert'],[class*='error'],[class*='invalid'],[class*='validation'],[id*='error']");
        if (errorEl && (errorEl.textContent?.trim().length ?? 0) > 3) return;
      }
      results.push({
        ruleId: "ACT-R82",
        type: "Issue",
        impact: "moderate",
        description: "Input marked aria-invalid but has no associated error message — add aria-describedby pointing to a descriptive error element",
        element: outerHtmlSnippet(input),
        elementContext: elementContextForAI(input),
        selector: getSelector(input),
      });
    });
  }

  // ── Scoring stats: total elements checked per rule ────────────────────────
  const tableEls = document.querySelectorAll("table").length;
  if (tableEls > 0) {
    pushStat("ACT-R45", document.querySelectorAll("th").length, "element");
    pushStat("ACT-R46", tableEls, "element");
    pushStat("ACT-R76", tableEls, "element");
  }
  const fieldsetEls = document.querySelectorAll("fieldset").length;
  if (fieldsetEls > 0) pushStat("ACT-R60", fieldsetEls, "element");
  const invalidInputEls = document.querySelectorAll("input[aria-invalid='true'],textarea[aria-invalid='true'],select[aria-invalid='true']").length;
  if (invalidInputEls > 0) pushStat("ACT-R82", invalidInputEls, "element");
  const scrollableEls = document.querySelectorAll("[style*='overflow'],[class*='scroll'],[class*='overflow']").length;
  if (scrollableEls > 0) pushStat("ACT-R84", scrollableEls, "element");
  const clickEls = document.querySelectorAll("[onclick],[ondblclick]").length;
  if (clickEls > 0) pushStat("ACT-R107", clickEls, "element");

  // ════════════════════════════════════════════════════════════════════════
}
