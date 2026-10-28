import ts from 'typescript';

type ZodVersion = readonly [major: number, minor: number, patch: number];

function propertyNamed(
  node: ts.Node,
  name: string,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return ts.isPropertyAccessExpression(node)
    ? node.name.text === name
    : ts.isElementAccessExpression(node) &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === name;
}

function literalVersion(node: ts.Expression): ZodVersion | undefined {
  if (!ts.isObjectLiteralExpression(node) || node.properties.length !== 3)
    return;
  const fields = new Map<string, number>();
  for (const property of node.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) ||
      !ts.isNumericLiteral(property.initializer)
    )
      return;
    const value = Number(property.initializer.text);
    if (!Number.isInteger(value) || value < 0) return;
    fields.set(property.name.text, value);
  }
  const major = fields.get('major');
  const minor = fields.get('minor');
  const patch = fields.get('patch');
  if (major === undefined || minor === undefined || patch === undefined) return;
  return [major, minor, patch];
}

/** Resolves compiler-emitted literal bindings used only to initialize Zod metadata. */
export function embeddedZodVersions(
  source: string,
): readonly ZodVersion[] | undefined {
  const filename = '/sdk-runtime.js';
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const program = ts.createProgram(
    [filename],
    {
      allowJs: true,
      noLib: true,
      noResolve: true,
      types: [],
      target: ts.ScriptTarget.Latest,
    },
    {
      getSourceFile: (name) => (name === filename ? file : undefined),
      getDefaultLibFileName: () => '',
      writeFile() {},
      getCurrentDirectory: () => '/',
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (name) => name === filename,
      readFile: (name) => (name === filename ? source : undefined),
    },
  );
  if (program.getSyntacticDiagnostics(file).length) return;
  const checker = program.getTypeChecker();
  const bindings: ts.Expression[] = [];
  let unsupported = false;
  const visit = (node: ts.Node) => {
    if (
      propertyNamed(node, 'version') &&
      propertyNamed(node.expression, '_zod')
    ) {
      const parent = node.parent;
      if (
        ts.isBinaryExpression(parent) &&
        parent.left === node &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      )
        bindings.push(parent.right);
      else unsupported = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (unsupported || !bindings.length) return;
  const versions: ZodVersion[] = [];
  const symbols = new Set<ts.Symbol>();
  const names = new Set<string>();
  const allowedUses = new Set<ts.Node>();
  for (const binding of bindings) {
    if (!ts.isIdentifier(binding)) return;
    const symbol = checker.getSymbolAtLocation(binding);
    if (!symbol || symbol.declarations?.length !== 1) return;
    const declaration = symbol.declarations[0];
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name) ||
      !declaration.initializer
    )
      return;
    const version = literalVersion(declaration.initializer);
    if (!version) return;
    symbols.add(symbol);
    names.add(binding.text);
    allowedUses.add(binding);
    allowedUses.add(declaration.name);
    versions.push(version);
  }
  let escaped = false;
  const checkUses = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      names.has(node.text) &&
      !allowedUses.has(node)
    ) {
      const parent = node.parent;
      const symbol = ts.isShorthandPropertyAssignment(parent)
        ? checker.getShorthandAssignmentValueSymbol(parent)
        : ts.isExportSpecifier(parent)
          ? checker.getExportSpecifierLocalTargetSymbol(parent)
          : checker.getSymbolAtLocation(node);
      if (symbol && symbols.has(symbol)) escaped = true;
    }
    ts.forEachChild(node, checkUses);
  };
  checkUses(file);
  return escaped ? undefined : versions;
}
