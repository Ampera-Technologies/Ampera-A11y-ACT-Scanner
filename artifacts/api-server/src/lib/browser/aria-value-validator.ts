type AriaValueDescriptor =
  | { type: "string" }
  | { type: "boolean" }
  | { type: "booleanUndefined" }
  | { type: "tristate" }
  | { type: "token"; values: readonly string[] }
  | { type: "tokenList"; values: readonly string[] }
  | { type: "integer"; min: number }
  | { type: "number" }
  | { type: "idref" }
  | { type: "idrefs" };

export const ARIA_VALUE_DESCRIPTORS: Readonly<
  Record<string, AriaValueDescriptor>
> = Object.freeze({
  "aria-atomic": { type: "boolean" },
  "aria-autocomplete": { type: "token", values: ["inline", "list", "both", "none"] },
  "aria-busy": { type: "boolean" },
  "aria-checked": { type: "tristate" },
  "aria-colcount": { type: "integer", min: -1 },
  "aria-colindex": { type: "integer", min: 1 },
  "aria-colindextext": { type: "string" },
  "aria-colspan": { type: "integer", min: 1 },
  "aria-controls": { type: "idrefs" },
  "aria-current": { type: "token", values: ["page", "step", "location", "date", "time", "true", "false"] },
  "aria-describedby": { type: "idrefs" },
  "aria-description": { type: "string" },
  "aria-details": { type: "idref" },
  "aria-disabled": { type: "boolean" },
  "aria-dropeffect": { type: "tokenList", values: ["copy", "execute", "link", "move", "none", "popup"] },
  "aria-errormessage": { type: "idref" },
  "aria-expanded": { type: "booleanUndefined" },
  "aria-flowto": { type: "idrefs" },
  "aria-grabbed": { type: "booleanUndefined" },
  "aria-haspopup": { type: "token", values: ["false", "true", "menu", "listbox", "tree", "grid", "dialog"] },
  "aria-hidden": { type: "boolean" },
  "aria-invalid": { type: "token", values: ["false", "true", "grammar", "spelling"] },
  "aria-keyshortcuts": { type: "string" },
  "aria-label": { type: "string" },
  "aria-labelledby": { type: "idrefs" },
  "aria-level": { type: "integer", min: 1 },
  "aria-live": { type: "token", values: ["off", "polite", "assertive"] },
  "aria-modal": { type: "boolean" },
  "aria-multiline": { type: "boolean" },
  "aria-multiselectable": { type: "boolean" },
  "aria-orientation": { type: "token", values: ["horizontal", "vertical", "undefined"] },
  "aria-owns": { type: "idrefs" },
  "aria-placeholder": { type: "string" },
  "aria-posinset": { type: "integer", min: 1 },
  "aria-pressed": { type: "tristate" },
  "aria-readonly": { type: "boolean" },
  "aria-relevant": { type: "tokenList", values: ["additions", "removals", "text", "all"] },
  "aria-required": { type: "boolean" },
  "aria-roledescription": { type: "string" },
  "aria-rowcount": { type: "integer", min: -1 },
  "aria-rowindex": { type: "integer", min: 1 },
  "aria-rowindextext": { type: "string" },
  "aria-rowspan": { type: "integer", min: 1 },
  "aria-selected": { type: "booleanUndefined" },
  "aria-setsize": { type: "integer", min: -1 },
  "aria-sort": { type: "token", values: ["ascending", "descending", "none", "other"] },
  "aria-valuemax": { type: "number" },
  "aria-valuemin": { type: "number" },
  "aria-valuenow": { type: "number" },
  "aria-valuetext": { type: "string" },
});

const INTEGER_RE = /^-?\d+$/;
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const IDREF_RE = /^[^\t\n\f\r ]+$/;

export function ariaValueError(
  attribute: string,
  rawValue: string,
): string | null {
  const descriptor = ARIA_VALUE_DESCRIPTORS[attribute];
  if (!descriptor) return null;

  // ACT rule 6a7281 applies only to non-empty ARIA values.
  const value = rawValue.trim();
  if (!value) return null;

  switch (descriptor.type) {
    case "string":
      return null;
    case "boolean":
      return ["true", "false"].includes(value)
        ? null
        : 'use "true" or "false"';
    case "booleanUndefined":
      return ["true", "false", "undefined"].includes(value)
        ? null
        : 'use "true", "false", or "undefined"';
    case "tristate":
      return ["true", "false", "mixed", "undefined"].includes(value)
        ? null
        : 'use "true", "false", "mixed", or "undefined"';
    case "token":
      return descriptor.values.includes(value)
        ? null
        : `use one of: ${descriptor.values.join(", ")}`;
    case "tokenList": {
      const tokens = value.split(/[\t\n\f\r ]+/);
      if (!tokens.every((token) => descriptor.values.includes(token))) {
        return `use only: ${descriptor.values.join(", ")}`;
      }
      return null;
    }
    case "integer":
      return INTEGER_RE.test(value) && Number(value) >= descriptor.min
        ? null
        : `use an integer greater than or equal to ${descriptor.min}`;
    case "number":
      return NUMBER_RE.test(value) && Number.isFinite(Number(value))
        ? null
        : "use a valid number";
    case "idref":
      return IDREF_RE.test(value)
        ? null
        : "use one ID without whitespace";
    case "idrefs":
      return value
        .split(/[\t\n\f\r ]+/)
        .every((token) => IDREF_RE.test(token))
        ? null
        : "use a whitespace-separated list of IDs";
  }
}