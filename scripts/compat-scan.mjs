// Finds every WebExtension API a source file uses, and whether each use sits
// behind the platform switch (IS_CHROME from extension/lib/platform.js).
// Used by scripts/check-safari-compat.mjs; unit-tested in tests/unit/compat-scan.test.js.
//
// A use counts as behind the switch when it is:
// - in the consequent of `if (IS_CHROME …)` or `IS_CHROME ? … : …`, in the
//   alternate of `if (!IS_CHROME)` / `!IS_CHROME ? … : …`, or right of
//   `IS_CHROME && …`;
// - in a function whose first statement is `if (!IS_CHROME) return|throw …`;
// - a feature test (`typeof api.downloads?.download`), which is how
//   platform.js tells the browsers apart.
// IS_CHROME only counts in a file that imports it from platform.js (or is
// platform.js, which declares it).
import * as acorn from 'acorn';

const ROOTS = new Set(['api', 'chrome', 'browser']);
const GUARD = 'IS_CHROME';
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

export function parse(src) {
  const opts = { ecmaVersion: 'latest', locations: true, allowHashBang: true };
  try {
    return acorn.parse(src, { ...opts, sourceType: 'module' });
  } catch {
    return acorn.parse(src, { ...opts, sourceType: 'script' });
  }
}

function walk(node, ancestors, visit) {
  visit(node, ancestors);
  ancestors.push(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && typeof child.type === 'string') walk(child, ancestors, visit);
    }
  }
  ancestors.pop();
}

const isGuard = (n) =>
  (n?.type === 'Identifier' && n.name === GUARD) || (n?.type === 'LogicalExpression' && n.operator === '&&' && (isGuard(n.left) || isGuard(n.right)));
const isNotGuard = (n) => n?.type === 'UnaryExpression' && n.operator === '!' && n.argument.type === 'Identifier' && n.argument.name === GUARD;
const exits = (n) => n?.type === 'ReturnStatement' || n?.type === 'ThrowStatement' || (n?.type === 'BlockStatement' && exits(n.body.at(-1)));
const earlyExit = (fn) => fn.body.type === 'BlockStatement' && fn.body.body[0]?.type === 'IfStatement' && isNotGuard(fn.body.body[0].test) && exits(fn.body.body[0].consequent);

function bindsGuard(ast) {
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration' && /(^|\/)platform\.js$/.test(node.source.value)) {
      if (node.specifiers.some((s) => s.type === 'ImportSpecifier' && s.imported.name === GUARD && s.local.name === GUARD)) return true;
    }
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type === 'VariableDeclaration' && decl.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === GUARD)) return true;
  }
  return false;
}

function behindSwitch(node, ancestors) {
  let child = node;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'IfStatement' || a.type === 'ConditionalExpression') {
      if (child === a.consequent && isGuard(a.test)) return true;
      if (child === a.alternate && isNotGuard(a.test)) return true;
    }
    if (a.type === 'LogicalExpression' && a.operator === '&&' && child === a.right && isGuard(a.left)) return true;
    if (FUNCTIONS.has(a.type) && child === a.body && earlyExit(a)) return true;
    child = a;
  }
  return false;
}

function featureTest(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'UnaryExpression' && a.operator === 'typeof') return true;
    if (!['MemberExpression', 'ChainExpression'].includes(a.type)) return false;
  }
  return false;
}

// features: { propertyName: 'bcd.key' }, e.g. { tabIds: 'declarativeNetRequest.RuleCondition.tabIds' }:
// object literal keys that use a sub-feature (a rule condition) rather than a call.
export function scanSource(src, { features = {} } = {}) {
  const ast = parse(src);
  const bound = bindsGuard(ast);
  const uses = [];
  const add = (key, node, ancestors) =>
    uses.push({
      key,
      line: node.loc.start.line,
      guarded: bound && behindSwitch(node, ancestors),
      featureTest: featureTest(ancestors),
    });

  walk(ast, [], (node, ancestors) => {
    if (node.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && ROOTS.has(node.object.name)) {
      // api.ns.member, or api.storage.area.member
      const ns = node.property.name;
      const parent = ancestors.at(-1);
      if (parent?.type !== 'MemberExpression' || parent.object !== node || parent.computed) return;
      const member = parent.property.name;
      const grand = ancestors.at(-2);
      const sub = grand?.type === 'MemberExpression' && grand.object === parent && !grand.computed ? grand.property.name : null;
      const key = ns === 'storage' && sub ? `${ns}.${member}.${sub}` : `${ns}.${member}`;
      add(key, node, ancestors);
    }
    if (node.type === 'Property' && !node.computed) {
      const name = node.key.type === 'Identifier' ? node.key.name : node.key.value;
      if (Object.hasOwn(features, name)) add(features[name], node, ancestors);
    }
  });
  return uses;
}
