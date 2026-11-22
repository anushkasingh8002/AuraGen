// server/ast/validate.js
// ─────────────────────────────────────────────────────────────────────
// ALLOW-LIST AST security validator for LLM-generated React components.
//
// WHY AN ALLOW-LIST?
//   A block-list says "reject these known-bad things."  An attacker
//   only needs to find ONE thing the list forgot.  An allow-list says
//   "reject everything EXCEPT these known-good things."  An attacker
//   must find a way to do harm using ONLY the allowed surface — which
//   is a vastly harder problem.
//
//   Concretely: if a future JS feature adds a new global (e.g.
//   `Temporal`) or a new way to execute code, a block-list would miss
//   it, but our allow-list would reject it automatically because it is
//   not in the allowed set.
//
// RULES
//   This module parses untrusted code with Babel, walks the AST, and
//   collects ALL violations (not just the first) so they can be fed
//   back to the LLM for self-correction.  It NEVER executes the code.
// ─────────────────────────────────────────────────────────────────────

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

// In ESM, @babel/traverse exports a default-wrapped object.
const traverse = _traverse.default ?? _traverse;

// ── allow-lists ──────────────────────────────────────────────────────

/** Only these import sources are permitted. */
const ALLOWED_IMPORT_SOURCES = new Set(["react", "@/ui"]);

/** Named exports allowed from "@/ui". */
const ALLOWED_UI_EXPORTS = new Set([
  "Button",
  "Input",
  "Select",
  "Stepper",
  "Card",
  "ProgressBar",
]);

/** Identifiers that must NEVER appear as free references. */
const FORBIDDEN_IDENTIFIERS = new Set([
  "eval",
  "Function",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "localStorage",
  "sessionStorage",
  "document",
  "window",
  "globalThis",
  "self",
  "top",
  "parent",
  "importScripts",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "Reflect",
  "Proxy",
]);

/** Member property names that enable sandbox escapes. */
const FORBIDDEN_MEMBER_PROPS = new Set([
  "constructor",
  "__proto__",
  "prototype",
]);

/** HTML elements that must never appear in JSX. */
const FORBIDDEN_JSX_ELEMENTS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
]);

// ── size limits ──────────────────────────────────────────────────────

const MAX_CODE_BYTES = 20 * 1024; // 20 KB
const MAX_AST_DEPTH = 40;

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Compute the maximum nesting depth of an AST node tree.
 * Uses an iterative stack to avoid blowing the call stack on deep ASTs.
 */
function maxDepth(node) {
  if (!node || typeof node !== "object") return 0;

  let max = 0;
  const stack = [{ node, depth: 1 }];

  while (stack.length > 0) {
    const { node: current, depth } = stack.pop();
    if (depth > max) max = depth;

    for (const key of Object.keys(current)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const child = current[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && item.type) {
            stack.push({ node: item, depth: depth + 1 });
          }
        }
      } else if (child && typeof child === "object" && child.type) {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }

  return max;
}

/** Format a location string for error messages. */
function loc(node) {
  if (!node?.loc?.start) return "";
  return ` (line ${node.loc.start.line}, col ${node.loc.start.column})`;
}

// ── main validator ───────────────────────────────────────────────────

/**
 * Validate untrusted LLM-generated React component code.
 *
 * @param {string} code – raw JSX source code string
 * @returns {{ ok: boolean, errors: string[], ast?: object }}
 */
export function validate(code) {
  const errors = [];

  // ── 0. Size gate ───────────────────────────────────────────────────
  if (typeof code !== "string" || code.trim().length === 0) {
    return { ok: false, errors: ["Code is empty or not a string."] };
  }

  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    errors.push(
      `Code exceeds ${MAX_CODE_BYTES / 1024} KB size limit ` +
        `(${Buffer.byteLength(code, "utf8")} bytes).`
    );
    // Still try to parse so we can report other issues too.
  }

  // ── 1. Parse ───────────────────────────────────────────────────────
  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx"],
    });
  } catch (err) {
    const position = err.loc
      ? ` (line ${err.loc.line}, col ${err.loc.column})`
      : "";
    return {
      ok: false,
      errors: [`Syntax error${position}: ${err.message}`],
    };
  }

  // ── 2. AST depth check ─────────────────────────────────────────────
  const depth = maxDepth(ast.program);
  if (depth > MAX_AST_DEPTH) {
    errors.push(
      `AST depth ${depth} exceeds the maximum of ${MAX_AST_DEPTH}. ` +
        `Simplify the component structure.`
    );
  }

  // ── 3. Traverse — collect every violation ──────────────────────────
  let defaultExportCount = 0;
  let defaultExportIsFunctionComponent = false;
  let referencesInitialValues = false;

  traverse(ast, {
    // ── 3a. Import declarations ─────────────────────────────────────
    ImportDeclaration(path) {
      const source = path.node.source.value;

      if (!ALLOWED_IMPORT_SOURCES.has(source)) {
        errors.push(
          `Forbidden import source "${source}"${loc(path.node)}. ` +
            `Only "react" and "@/ui" are allowed.`
        );
        return;
      }

      // For "@/ui", check that only allowed components are imported.
      if (source === "@/ui") {
        for (const spec of path.node.specifiers) {
          if (spec.type === "ImportSpecifier") {
            const name = spec.imported.name ?? spec.imported.value;
            if (!ALLOWED_UI_EXPORTS.has(name)) {
              errors.push(
                `"${name}" is not an allowed export from "@/ui"${loc(spec)}. ` +
                  `Allowed: ${[...ALLOWED_UI_EXPORTS].join(", ")}.`
              );
            }
          } else if (spec.type === "ImportDefaultSpecifier") {
            errors.push(
              `Default import from "@/ui" is not allowed${loc(spec)}. ` +
                `Use named imports: { Button, Input, ... }.`
            );
          }
        }
      }
    },

    // ── 3b. Dynamic import() ────────────────────────────────────────
    ImportExpression(path) {
      errors.push(`Dynamic import() is forbidden${loc(path.node)}.`);
    },

    "CallExpression|OptionalCallExpression"(path) {
      const callee = path.node.callee;

      // import() — appears as callee.type === "Import" or callee.type === "Identifier" with name "require"
      if (callee.type === "Import") {
        errors.push(
          `Dynamic import() is forbidden${loc(path.node)}.`
        );
        return;
      }

      // require()
      if (callee.type === "Identifier" && callee.name === "require") {
        errors.push(
          `require() is forbidden${loc(path.node)}. Use static import.`
        );
        return;
      }
    },

    // ── 3c. Forbidden identifiers ───────────────────────────────────
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (FORBIDDEN_IDENTIFIERS.has(name)) {
        // eval and Function are NEVER allowed even if Babel marks them with bindings
        if (name !== "eval" && name !== "Function" && path.scope.hasOwnBinding(name)) {
          return;
        }

        errors.push(
          `Forbidden global identifier "${name}"${loc(path.node)}. ` +
            `Access to browser/runtime APIs is not permitted.`
        );
      }

      // Track initialValues reference (free variable or destructuring).
      if (name === "initialValues") {
        referencesInitialValues = true;
      }
    },

    // ── 3d. Forbidden member access (.constructor, .__proto__, .prototype)
    MemberExpression(path) {
      const prop = path.node.computed
        ? null
        : path.node.property?.name ?? path.node.property?.value;

      if (prop && FORBIDDEN_MEMBER_PROPS.has(prop)) {
        errors.push(
          `Member access ".${prop}" is forbidden${loc(path.node)}. ` +
            `This pattern can enable sandbox escapes.`
        );
      }

      // Also check computed access with string literals: obj["constructor"]
      if (
        path.node.computed &&
        path.node.property?.type === "StringLiteral" &&
        FORBIDDEN_MEMBER_PROPS.has(path.node.property.value)
      ) {
        errors.push(
          `Computed member access ["${path.node.property.value}"] is forbidden${loc(path.node)}. ` +
            `This pattern can enable sandbox escapes.`
        );
      }

      // Track props.initialValues or anyObj.initialValues
      if (!path.node.computed && path.node.property?.name === "initialValues") {
        referencesInitialValues = true;
      } else if (
        path.node.computed &&
        path.node.property?.type === "StringLiteral" &&
        path.node.property.value === "initialValues"
      ) {
        referencesInitialValues = true;
      }
    },

    // ── 3e. JSX attribute checks ────────────────────────────────────
    JSXAttribute(path) {
      const attrName =
        path.node.name?.name ?? path.node.name?.value ?? "";

      // dangerouslySetInnerHTML
      if (attrName === "dangerouslySetInnerHTML") {
        errors.push(
          `"dangerouslySetInnerHTML" attribute is forbidden${loc(path.node)}. ` +
            `It allows arbitrary HTML injection.`
        );
      }

      // on* handlers with string literal values (inline handlers like onClick="alert()")
      if (
        attrName.startsWith("on") &&
        attrName.length > 2 &&
        path.node.value?.type === "StringLiteral"
      ) {
        errors.push(
          `Inline string event handler "${attrName}" is forbidden${loc(path.node)}. ` +
            `Use JSX expression handlers instead.`
        );
      }
    },

    // ── 3f. Forbidden JSX elements ──────────────────────────────────
    JSXOpeningElement(path) {
      const elemName = path.node.name?.name;
      if (typeof elemName === "string") {
        if (FORBIDDEN_JSX_ELEMENTS.has(elemName.toLowerCase())) {
          errors.push(
            `JSX element <${elemName}> is forbidden${loc(path.node)}.`
          );
        }

        // <style> with children is unsafe (can inject CSS/JS)
        if (elemName.toLowerCase() === "style") {
          errors.push(
            `JSX element <style> is forbidden${loc(path.node)}. ` +
              `Use Tailwind classes instead.`
          );
        }
      }
    },

    // ── 3g. Tagged templates and binary string concatenation ────────
    TaggedTemplateExpression(path) {
      errors.push(
        `Tagged template expressions are forbidden${loc(path.node)}.`
      );
    },

    BinaryExpression(path) {
      if (path.node.operator === "+") {
        // Check for string concatenations like "java" + "script:..." or "data:" + ...
        let prefix = null;
        if (path.node.left.type === "StringLiteral") {
          prefix = path.node.left.value;
          if (path.node.right.type === "StringLiteral") {
            prefix += path.node.right.value;
          }
        }
        if (prefix) {
          const val = prefix.trim().toLowerCase();
          if (val.startsWith("javascript:") || val.startsWith("data:")) {
            errors.push(
              `String concatenation with dangerous URL scheme "${prefix.slice(0, 30)}..." is forbidden${loc(path.node)}.`
            );
          }
        }
      }
    },

    // ── 3h. String literals containing dangerous URL schemes ────────
    StringLiteral(path) {
      const val = path.node.value.trim().toLowerCase();
      if (val.startsWith("javascript:") || val.startsWith("data:")) {
        errors.push(
          `String with dangerous URL scheme "${path.node.value.slice(0, 30)}..." is forbidden${loc(path.node)}.`
        );
      }
    },

    TemplateLiteral(path) {
      // Check if any quasis start with javascript: or data:
      for (const quasi of path.node.quasis) {
        const raw = (quasi.value.raw ?? "").trim().toLowerCase();
        if (raw.startsWith("javascript:") || raw.startsWith("data:")) {
          errors.push(
            `Template literal with dangerous URL scheme is forbidden${loc(path.node)}.`
          );
        }
      }
    },

    // ── 3i. Default export tracking ─────────────────────────────────
    ExportDefaultDeclaration(path) {
      defaultExportCount++;

      const decl = path.node.declaration;

      // Check if the default export is a function or arrow function.
      if (
        decl.type === "FunctionDeclaration" ||
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression"
      ) {
        defaultExportIsFunctionComponent = true;

        // Check if it destructures initialValues from props.
        checkParamsForInitialValues(decl.params);
      } else if (decl.type === "Identifier") {
        // `export default MyComponent;` — we need to look up the binding.
        const binding = path.scope.getBinding(decl.name);
        if (binding) {
          const bindNode = binding.path.node;
          // Variable declarator with function/arrow
          if (bindNode.type === "VariableDeclarator" && bindNode.init) {
            if (
              bindNode.init.type === "ArrowFunctionExpression" ||
              bindNode.init.type === "FunctionExpression"
            ) {
              defaultExportIsFunctionComponent = true;
              checkParamsForInitialValues(bindNode.init.params);
            }
          } else if (bindNode.type === "FunctionDeclaration") {
            defaultExportIsFunctionComponent = true;
            checkParamsForInitialValues(bindNode.params);
          }
        }
      }
    },
  });

  // ── 4. Structural requirements ─────────────────────────────────────

  if (defaultExportCount === 0) {
    errors.push(
      "Missing default export. The component must be exported as default."
    );
  } else if (defaultExportCount > 1) {
    errors.push(
      `Found ${defaultExportCount} default exports. There must be exactly one.`
    );
  }

  if (defaultExportCount === 1 && !defaultExportIsFunctionComponent) {
    errors.push(
      "Default export must be a function component " +
        "(function declaration, arrow function, or function expression)."
    );
  }

  if (!referencesInitialValues && defaultExportCount > 0) {
    errors.push(
      "Component does not reference 'initialValues'. " +
        "It should use initialValues to preserve previously entered data."
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    ast: errors.length === 0 ? ast : undefined,
  };

  // ── inner helpers ──────────────────────────────────────────────────

  function checkParamsForInitialValues(params) {
    if (!params || params.length === 0) return;

    for (const param of params) {
      // Destructured: ({ initialValues, ... })
      if (param.type === "ObjectPattern") {
        for (const prop of param.properties) {
          if (
            prop.type === "ObjectProperty" &&
            (prop.key?.name === "initialValues" ||
              prop.key?.value === "initialValues")
          ) {
            referencesInitialValues = true;
          }
          // Might have a default: { initialValues = {} }
          if (
            prop.type === "ObjectProperty" &&
            prop.value?.type === "AssignmentPattern" &&
            (prop.key?.name === "initialValues" ||
              prop.key?.value === "initialValues")
          ) {
            referencesInitialValues = true;
          }
        }
      }
      // Assignment pattern with destructuring: (props = {}) — handled by identifier check
    }
  }
}

export { ALLOWED_IMPORT_SOURCES, ALLOWED_UI_EXPORTS, FORBIDDEN_IDENTIFIERS };
