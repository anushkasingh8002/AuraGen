// server/ast/validate.js
// ─────────────────────────────────────────────────────────────────────
// STRICT ALLOW-LIST AST security validator for LLM-generated React components.
//
// WHY A TRUE ALLOW-LIST?
//   A block-list only stops known-bad patterns. A strict allow-list rejects
//   ANY unrecognized global identifier, unsafe JSX tag, JSX spread attribute,
//   getter/setter, dynamic computed call, or prototype introspection trick.
//
// This module parses untrusted code with Babel, walks the AST, and
// collects ALL violations without executing any code.
// ─────────────────────────────────────────────────────────────────────

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default ?? _traverse;

// ── Allow-Lists ──────────────────────────────────────────────────────

/** Only these module import sources are permitted. */
const ALLOWED_IMPORT_SOURCES = new Set(["react", "@/ui"]);

/** Named exports allowed from "react". */
const ALLOWED_REACT_EXPORTS = new Set([
  "default",
  "React",
  "useState",
  "useEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useReducer",
  "useId",
  "Fragment",
]);

/** Named exports allowed from "@/ui". */
const ALLOWED_UI_EXPORTS = new Set([
  "Button",
  "Input",
  "Select",
  "Stepper",
  "Card",
  "ProgressBar",
]);

/** Strict safe global identifiers permitted as unbound references. */
const ALLOWED_GLOBALS = new Set([
  "React",
  "JSON",
  "Math",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "Date",
  "Intl",
  "RegExp",
  "Map",
  "Set",
  "Error",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "undefined",
  "NaN",
  "Infinity",
  "encodeURIComponent",
  "decodeURIComponent",
]);

/** Safe standard HTML tags permitted in JSX (no script, iframe, svg, style, etc.). */
const ALLOWED_HTML_ELEMENTS = new Set([
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "form",
  "button",
  "a",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "small",
  "b",
  "i",
  "br",
  "hr",
  "section",
  "header",
  "footer",
  "main",
  "fieldset",
  "legend",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);

// ── Explicit Security Prohibitions ───────────────────────────────────

/** Identifiers NEVER allowed as free references or shadowed local bindings. */
const FORBIDDEN_IDENTIFIERS = new Set([
  "eval",
  "Function",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "document",
  "window",
  "globalThis",
  "self",
  "top",
  "parent",
  "opener",
  "frames",
  "location",
  "navigator",
  "history",
  "alert",
  "confirm",
  "prompt",
  "open",
  "postMessage",
  "importScripts",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "Reflect",
  "Proxy",
  "WebAssembly",
  "Worker",
  "SharedWorker",
  "ServiceWorker",
  "BroadcastChannel",
  "process",
  "Deno",
  "Bun",
  "global",
  "arguments",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
]);

/** Member property names that enable sandbox escapes or prototype pollution. */
const FORBIDDEN_MEMBER_PROPS = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "callee",
  "caller",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getOwnPropertyNames",
  "getOwnPropertySymbols",
  "defineProperty",
  "defineProperties",
  "fromCharCode",
  "fromCodePoint",
]);

/** Unsafe static introspection/mutation helpers on Object and String. */
const FORBIDDEN_OBJECT_METHODS = new Set([
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getOwnPropertyNames",
  "getOwnPropertySymbols",
  "defineProperty",
  "defineProperties",
  "create",
  "__defineGetter__",
  "__defineSetter__",
]);

const FORBIDDEN_STRING_METHODS = new Set(["fromCharCode", "fromCodePoint"]);

/** Dangerous HTML elements called out explicitly in violation diagnostics. */
const FORBIDDEN_JSX_ELEMENTS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "style",
  "base",
  "svg",
  "math",
]);

/** JSX attributes carrying navigable URLs or payloads. */
const URL_ATTR_NAMES = new Set([
  "href",
  "src",
  "action",
  "formAction",
  "xlinkHref",
  "data",
  "poster",
]);

// ── size limits ──────────────────────────────────────────────────────

const MAX_CODE_BYTES = 20 * 1024; // 20 KB
const MAX_AST_DEPTH = 40;

// ── helpers ──────────────────────────────────────────────────────────

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

function loc(node) {
  if (!node?.loc?.start) return "";
  return ` (line ${node.loc.start.line}, col ${node.loc.start.column})`;
}

function hasDangerousScheme(str) {
  if (typeof str !== "string") return false;
  const normalized = str.replace(/[\u0000-\u0020\s]/g, "").toLowerCase();
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("vbscript:")
  );
}

function isSafeStaticUrl(str) {
  if (typeof str !== "string") return false;
  const trimmed = str.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return true;
  if (hasDangerousScheme(trimmed)) return false;
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("/")
  );
}

function resolveStaticPropertyName(node, propertyPath) {
  if (!node.computed) {
    return node.property?.name ?? node.property?.value ?? null;
  }
  if (node.property?.type === "StringLiteral") {
    return node.property.value;
  }
  if (node.property?.type === "NumericLiteral") {
    return node.property.value;
  }
  if (propertyPath) {
    const evalRes = propertyPath.evaluate();
    if (evalRes.confident) {
      return evalRes.value;
    }
  }
  return undefined; // dynamic / unresolvable at compile time
}

function resolveObjectKeyName(propNode, keyPath) {
  if (!propNode.computed) {
    if (propNode.key?.type === "Identifier") return propNode.key.name;
    if (propNode.key?.type === "StringLiteral") return propNode.key.value;
    return null;
  }
  if (keyPath) {
    const evalRes = keyPath.evaluate();
    if (evalRes.confident && typeof evalRes.value === "string") {
      return evalRes.value;
    }
  }
  return undefined;
}

// ── main validator ───────────────────────────────────────────────────

/**
 * Validate untrusted LLM-generated React component code using strict allow-lists.
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

  // ── 3. Traverse — strict allow-list + security visitors ────────────
  let defaultExportCount = 0;
  let defaultExportIsFunctionComponent = false;
  let referencesInitialValues = false;
  const importedUiNames = new Set();
  const importedReactNames = new Set();

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

      if (source === "react") {
        for (const spec of path.node.specifiers) {
          if (spec.type === "ImportNamespaceSpecifier") {
            errors.push(
              `Namespace import from "react" is forbidden${loc(spec)}. Use named or default imports.`
            );
          } else if (spec.type === "ImportSpecifier") {
            const imported = spec.imported.name ?? spec.imported.value;
            if (!ALLOWED_REACT_EXPORTS.has(imported)) {
              errors.push(
                `"${imported}" is not an allowed export from "react"${loc(spec)}.`
              );
            } else {
              importedReactNames.add(spec.local.name);
            }
          } else if (spec.type === "ImportDefaultSpecifier") {
            importedReactNames.add(spec.local.name);
          }
        }
      }

      if (source === "@/ui") {
        for (const spec of path.node.specifiers) {
          if (spec.type === "ImportSpecifier") {
            const name = spec.imported.name ?? spec.imported.value;
            if (!ALLOWED_UI_EXPORTS.has(name)) {
              errors.push(
                `"${name}" is not an allowed export from "@/ui"${loc(spec)}. ` +
                  `Allowed: ${[...ALLOWED_UI_EXPORTS].join(", ")}.`
              );
            } else {
              importedUiNames.add(spec.local.name);
            }
          } else if (spec.type === "ImportDefaultSpecifier") {
            errors.push(
              `Default import from "@/ui" is not allowed${loc(spec)}. ` +
                `Use named imports: { Button, Input, ... }.`
            );
          } else if (spec.type === "ImportNamespaceSpecifier") {
            errors.push(
              `Namespace import from "@/ui" is not allowed${loc(spec)}.`
            );
          }
        }
      }
    },

    // ── 3b. Dynamic import(), require(), computed calls ─────────────
    ImportExpression(path) {
      errors.push(`Dynamic import() is forbidden${loc(path.node)}.`);
    },

    ThisExpression(path) {
      errors.push(`'this' expression is forbidden${loc(path.node)}.`);
    },

    WithStatement(path) {
      errors.push(`'with' statement is forbidden${loc(path.node)}.`);
    },

    ClassDeclaration(path) {
      errors.push(`Class declarations are forbidden${loc(path.node)}. Use function components.`);
    },

    ClassExpression(path) {
      errors.push(`Class expressions are forbidden${loc(path.node)}.`);
    },

    MetaProperty(path) {
      errors.push(`Meta property is forbidden${loc(path.node)}.`);
    },

    "CallExpression|OptionalCallExpression"(path) {
      const callee = path.node.callee;

      if (callee.type === "Import") {
        errors.push(`Dynamic import() is forbidden${loc(path.node)}.`);
        return;
      }

      if (callee.type === "Identifier" && callee.name === "require") {
        errors.push(`require() is forbidden${loc(path.node)}. Use static import.`);
        return;
      }

      if (
        (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
        callee.computed
      ) {
        errors.push(
          `Dynamic computed method calls are forbidden${loc(callee)}.`
        );
      }

      // If callee is a local identifier initialized via dynamic computed MemberExpression, reject it
      if (callee.type === "Identifier") {
        const binding = path.scope.getBinding(callee.name);
        const init = binding?.path?.node?.init;
        if (init && (init.type === "MemberExpression" || init.type === "OptionalMemberExpression") && init.computed) {
          errors.push(
            `Calling a function obtained from computed property lookup "${callee.name}" is forbidden${loc(path.node)}.`
          );
        }
      }
    },

    // ── 3c. Strict allow-list for ReferencedIdentifier + Param Shadowing ─
    ReferencedIdentifier(path) {
      const name = path.node.name;

      // Never allow JSXElement identifiers to double-report unless needed (checked in JSXOpeningElement)
      if (path.parent.type === "JSXOpeningElement" || path.parent.type === "JSXClosingElement") {
        return;
      }

      if (FORBIDDEN_IDENTIFIERS.has(name)) {
        errors.push(
          `Forbidden global identifier "${name}"${loc(path.node)}. ` +
            `Access to browser/runtime APIs is not permitted.`
        );
        return;
      }

      // Track initialValues usage
      if (name === "initialValues") {
        referencesInitialValues = true;
      }

      // Allow locally bound variables (noGlobals = true, except FORBIDDEN_IDENTIFIERS caught above)
      if (path.scope.hasBinding(name, true)) {
        return;
      }

      // Allow JSX labels/keys handled by Babel helper transforms? ReferencedIdentifier only fires on actual value references.
      if (!ALLOWED_GLOBALS.has(name)) {
        errors.push(
          `Unrecognized or disallowed global identifier "${name}"${loc(path.node)}.`
        );
      }
    },

    // Forbid declaring variables or parameters with forbidden global names (shadowing bypass)
    BindingIdentifier(path) {
      const name = path.node.name;
      if (FORBIDDEN_IDENTIFIERS.has(name)) {
        errors.push(
          `Shadowing or declaring forbidden identifier "${name}" is not allowed${loc(path.node)}.`
        );
      }
    },

    // ── 3d. Forbidden member props, prototype introspection, & computed traps ─
    "MemberExpression|OptionalMemberExpression"(path) {
      const propPath = path.get("property");
      const resolvedProp = resolveStaticPropertyName(path.node, propPath);

      // 1. Check static/evaluated property names
      if (typeof resolvedProp === "string" && FORBIDDEN_MEMBER_PROPS.has(resolvedProp)) {
        const prefix = path.node.computed
          ? `Computed member access ["${resolvedProp}"]`
          : `Member access ".${resolvedProp}"`;
        errors.push(
          `${prefix} is forbidden${loc(path.node)}. This pattern can enable sandbox escapes.`
        );
      }

      // 2. Check Object.* and String.* unsafe introspection/builders
      if (path.node.object.type === "Identifier" && !path.scope.hasBinding(path.node.object.name, true)) {
        const objName = path.node.object.name;
        if (objName === "Object" && (resolvedProp === undefined || FORBIDDEN_OBJECT_METHODS.has(String(resolvedProp)))) {
          errors.push(
            `Unsafe Object.${resolvedProp ?? "[dynamic]"} introspection is forbidden${loc(path.node)}.`
          );
        }
        if (objName === "String" && (resolvedProp === undefined || FORBIDDEN_STRING_METHODS.has(String(resolvedProp)))) {
          errors.push(
            `Unsafe String.${resolvedProp ?? "[dynamic]"} call is forbidden${loc(path.node)}.`
          );
        }
        if (objName === "React" && typeof resolvedProp === "string" && resolvedProp.startsWith("__")) {
          errors.push(
            `Access to internal React property "${resolvedProp}" is forbidden${loc(path.node)}.`
          );
        }
      }

      // 3. Block unresolvable dynamic property access on functions, inline literals, or imports
      if (path.node.computed && resolvedProp === undefined) {
        const obj = path.node.object;
        const isInlineFn =
          obj.type === "ArrowFunctionExpression" ||
          obj.type === "FunctionExpression";
        let isUnsafeObjBinding = false;
        if (obj.type === "Identifier") {
          const b = path.scope.getBinding(obj.name);
          const init = b?.path?.node?.init;
          if (
            !b || // global object like Math[x] / Object[x]
            importedReactNames.has(obj.name) ||
            importedUiNames.has(obj.name) ||
            b.path.node.type === "FunctionDeclaration" ||
            init?.type === "ArrowFunctionExpression" ||
            init?.type === "FunctionExpression"
          ) {
            isUnsafeObjBinding = true;
          }
        }
        if (isInlineFn || isUnsafeObjBinding) {
          errors.push(
            `Dynamic computed property access on functions or restricted objects is forbidden${loc(path.node)}.`
          );
        }
      }

      // Track props.initialValues or anyObj.initialValues
      if (resolvedProp === "initialValues") {
        referencesInitialValues = true;
      }
    },

    // ── 3e. Destructuring patterns (block { constructor: F } = ...) ───
    ObjectPattern(path) {
      for (let idx = 0; idx < path.node.properties.length; idx++) {
        const prop = path.node.properties[idx];
        if (prop.type === "ObjectProperty") {
          const propPath = path.get(`properties.${idx}.key`);
          const keyName = resolveObjectKeyName(prop, propPath);
          if (keyName === undefined || FORBIDDEN_MEMBER_PROPS.has(keyName) || FORBIDDEN_IDENTIFIERS.has(keyName)) {
            errors.push(
              `Destructuring restricted property "${keyName ?? "[dynamic]"}" is forbidden${loc(prop)}.`
            );
          }
        }
      }
    },

    // ── 3f. Object literals (forbid getters/setters and dangerous keys) ─
    ObjectMethod(path) {
      if (path.node.kind === "get" || path.node.kind === "set") {
        errors.push(
          `Object ${path.node.kind}ter traps are forbidden${loc(path.node)}.`
        );
      }
    },

    ObjectProperty(path) {
      // Only check object literals (not ObjectPattern, handled above)
      if (path.parent.type !== "ObjectExpression") return;

      const keyName = resolveObjectKeyName(path.node, path.get("key"));
      if (
        typeof keyName === "string" &&
        (FORBIDDEN_MEMBER_PROPS.has(keyName) ||
          keyName === "dangerouslySetInnerHTML" ||
          keyName === "__html")
      ) {
        errors.push(
          `Forbidden object property key "${keyName}"${loc(path.node)}.`
        );
      }
    },

    // ── 3g. JSX attributes & spread checks ──────────────────────────
    JSXSpreadAttribute(path) {
      errors.push(
        `JSX spread attributes {...props} are forbidden${loc(path.node)}. Pass explicit props only.`
      );
    },

    JSXAttribute(path) {
      const attrName = path.node.name?.name ?? path.node.name?.value ?? "";

      if (attrName === "dangerouslySetInnerHTML") {
        errors.push(
          `"dangerouslySetInnerHTML" attribute is forbidden${loc(path.node)}. ` +
            `It allows arbitrary HTML injection.`
        );
        return;
      }

      if (
        attrName.startsWith("on") &&
        attrName.length > 2 &&
        path.node.value?.type === "StringLiteral"
      ) {
        errors.push(
          `Inline string event handler "${attrName}" is forbidden${loc(path.node)}. ` +
            `Use JSX expression handlers instead.`
        );
        return;
      }

      // Strict check on URL attributes (href, src, action, formAction, etc.)
      if (URL_ATTR_NAMES.has(attrName) && path.node.value) {
        if (path.node.value.type === "StringLiteral") {
          if (!isSafeStaticUrl(path.node.value.value)) {
            errors.push(
              `Unsafe URL "${path.node.value.value.slice(0, 30)}" in "${attrName}" is forbidden${loc(path.node)}.`
            );
          }
        } else if (path.node.value.type === "JSXExpressionContainer") {
          const exprPath = path.get("value.expression");
          const evalRes = exprPath.evaluate();
          if (!evalRes.confident || typeof evalRes.value !== "string" || !isSafeStaticUrl(evalRes.value)) {
            errors.push(
              `Dynamic or unsafe URL expression in "${attrName}" is forbidden${loc(path.node)}.`
            );
          }
        }
      }
    },

    // ── 3h. Strict JSX element allow-list ───────────────────────────
    JSXOpeningElement(path) {
      const nameNode = path.node.name;

      // Support <React.Fragment> only for member expressions
      if (nameNode.type === "JSXMemberExpression") {
        const isReactFragment =
          nameNode.object?.type === "JSXIdentifier" &&
          importedReactNames.has(nameNode.object.name) &&
          nameNode.property?.name === "Fragment";
        if (!isReactFragment) {
          errors.push(`JSX member element is forbidden${loc(path.node)}.`);
        }
        return;
      }

      const elemName = nameNode?.name;
      if (typeof elemName !== "string") {
        errors.push(`Unsupported JSX element${loc(path.node)}.`);
        return;
      }

      const lower = elemName.toLowerCase();
      if (FORBIDDEN_JSX_ELEMENTS.has(lower)) {
        errors.push(`JSX element <${elemName}> is forbidden${loc(path.node)}.`);
        return;
      }

      // Intrinsic lowercase HTML tags must be on ALLOWED_HTML_ELEMENTS
      if (/^[a-z]/.test(elemName)) {
        if (!ALLOWED_HTML_ELEMENTS.has(elemName)) {
          errors.push(
            `JSX element <${elemName}> is not in allowed HTML tags${loc(path.node)}.`
          );
        }
        return;
      }

      // Capitalized React components: must be @/ui import, React Fragment, or local function component
      if (importedUiNames.has(elemName) || (elemName === "Fragment" && importedReactNames.has("Fragment"))) {
        return;
      }

      const binding = path.scope.getBinding(elemName);
      const isLocalFnComponent =
        binding &&
        (binding.path.node.type === "FunctionDeclaration" ||
          (binding.path.node.type === "VariableDeclarator" &&
            (binding.path.node.init?.type === "ArrowFunctionExpression" ||
              binding.path.node.init?.type === "FunctionExpression")));

      if (!isLocalFnComponent) {
        errors.push(
          `Dynamic or unrecognized JSX component <${elemName}> is forbidden${loc(path.node)}.`
        );
      }
    },

    // ── 3i. Tagged templates & dangerous URL schemes (evaluated & cooked) ─
    TaggedTemplateExpression(path) {
      errors.push(`Tagged template expressions are forbidden${loc(path.node)}.`);
    },

    BinaryExpression(path) {
      if (path.node.operator === "+") {
        const evalRes = path.evaluate();
        if (evalRes.confident && typeof evalRes.value === "string") {
          if (hasDangerousScheme(evalRes.value)) {
            errors.push(
              `String concatenation with dangerous URL scheme "${evalRes.value.slice(0, 30)}..." is forbidden${loc(path.node)}.`
            );
          }
          return;
        }
        // Even non-confident concats with leading dangerous literal
        if (
          path.node.left.type === "StringLiteral" &&
          hasDangerousScheme(path.node.left.value)
        ) {
          errors.push(
            `String concatenation with dangerous URL scheme "${path.node.left.value.slice(0, 30)}..." is forbidden${loc(path.node)}.`
          );
        }
      }
    },

    StringLiteral(path) {
      if (hasDangerousScheme(path.node.value)) {
        errors.push(
          `String with dangerous URL scheme "${path.node.value.slice(0, 30)}..." is forbidden${loc(path.node)}.`
        );
      }
    },

    TemplateLiteral(path) {
      const evalRes = path.evaluate();
      if (evalRes.confident && typeof evalRes.value === "string" && hasDangerousScheme(evalRes.value)) {
        errors.push(
          `Template literal with dangerous URL scheme "${evalRes.value.slice(0, 30)}..." is forbidden${loc(path.node)}.`
        );
        return;
      }

      const joinedCooked = path.node.quasis
        .map((q) => q.value.cooked ?? q.value.raw ?? "")
        .join("");
      if (hasDangerousScheme(joinedCooked)) {
        errors.push(
          `Template literal with dangerous URL scheme is forbidden${loc(path.node)}.`
        );
        return;
      }

      for (const quasi of path.node.quasis) {
        const cooked = quasi.value.cooked ?? quasi.value.raw ?? "";
        if (hasDangerousScheme(cooked)) {
          errors.push(
            `Template literal with dangerous URL scheme is forbidden${loc(path.node)}.`
          );
        }
      }
    },

    // ── 3j. Default export tracking ─────────────────────────────────
    ExportDefaultDeclaration(path) {
      defaultExportCount++;

      const decl = path.node.declaration;

      if (
        decl.type === "FunctionDeclaration" ||
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression"
      ) {
        defaultExportIsFunctionComponent = true;
        checkParamsForInitialValues(decl.params);
      } else if (decl.type === "Identifier") {
        const binding = path.scope.getBinding(decl.name);
        if (binding) {
          const bindNode = binding.path.node;
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

  function checkParamsForInitialValues(params) {
    if (!params || params.length === 0) return;

    for (const param of params) {
      if (param.type === "ObjectPattern") {
        for (const prop of param.properties) {
          if (
            prop.type === "ObjectProperty" &&
            (prop.key?.name === "initialValues" ||
              prop.key?.value === "initialValues")
          ) {
            referencesInitialValues = true;
          }
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
    }
  }
}

export {
  ALLOWED_IMPORT_SOURCES,
  ALLOWED_REACT_EXPORTS,
  ALLOWED_UI_EXPORTS,
  ALLOWED_GLOBALS,
  ALLOWED_HTML_ELEMENTS,
  FORBIDDEN_IDENTIFIERS,
};
