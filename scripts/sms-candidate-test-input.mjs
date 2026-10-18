import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import ts from 'typescript'

export async function smsTestSource(envName, fallback, slug) {
  const prefix = process.env[envName]
  if (!prefix) return readFileSync(fallback, 'utf8')
  const { decryptMemory } = await import('./migration.local/encryption.mjs')
  const { parseReviewedEszip } = await import('./migration.local/eszip-reviewed-parser.mjs')
  const proof = JSON.parse(readFileSync(prefix + '.json', 'utf8'))
  assert.equal(proof.slug, slug)
  const bytes = await decryptMemory(prefix)
  try {
    const sha = b => createHash('sha256').update(b).digest('hex')
    assert.equal(sha(bytes), proof.candidateBodySha256)
    const entry = parseReviewedEszip(bytes).modules.find(m => m.specifier === proof.entrySpecifier)
    assert.ok(entry)
    assert.equal(sha(entry.source), proof.entrySourceSha256)
    return entry.source.toString('utf8')
  } finally { bytes.fill(0) }
}

export function actualSmsFunctions(source, names) {
  const ast = ts.createSourceFile('handler.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (!names.length) {
    const serve = ast.statements.filter(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(ast) === 'serve')
    assert.equal(serve.length, 1)
    return serve[0].getText(ast)
  }
  return names.map(name => {
    const found = []
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.equal(found.length, 1, `Expected actual function ${name}`)
    return found[0].getText(ast)
  }).join('\n')
}
