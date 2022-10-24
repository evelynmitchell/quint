import { describe, it } from 'mocha'
import { assert } from 'chai'
import { DefinitionTable, LookupTable, LookupTableByModule } from '../src/definitionsCollector'
import { buildModuleWithDefs } from './builders/ir'
import { resolveImports } from '../src/importResolver'

describe('resolveImports', () => {
  const moduleName = 'wrapper'

  const table: LookupTable = new Map<string, DefinitionTable>([
    ['a', { valueDefinitions: [{ kind: 'def', identifier: 'a', reference: 1n }], typeDefinitions: [] }],
    ['b', { valueDefinitions: [{ kind: 'def', identifier: 'b', reference: 2n }], typeDefinitions: [] }],
    ['c', { valueDefinitions: [{ kind: 'def', identifier: 'c', reference: 3n, scope: 10n }], typeDefinitions: [] }],
    ['nested_module', { valueDefinitions: [{ kind: 'module', identifier: 'nested_module', reference: 4n }], typeDefinitions: [] }],
    ['unexisting_module', { valueDefinitions: [{ kind: 'module', identifier: 'unexisting_module', reference: 5n }], typeDefinitions: [] }],
  ])

  const nestedModuleTable: LookupTable = new Map<string, DefinitionTable>([
    ['d', { valueDefinitions: [{ kind: 'def', identifier: 'd', reference: 1n }], typeDefinitions: [] }],
    ['e', { valueDefinitions: [{ kind: 'def', identifier: 'e', reference: 2n, scope: 10n }], typeDefinitions: [] }],
  ])

  const tables: LookupTableByModule = new Map<string, LookupTable>([
    ['wrapper', new Map<string, DefinitionTable>()], ['test_module', table], ['nested_module', nestedModuleTable],
  ])

  describe('existing modules', () => {
    it('imports named definitions', () => {
      const tntModule = buildModuleWithDefs([
        'module test_module { def a = 1 def b =2 }',
        'import test_module.a',
      ])

      const result = resolveImports(tntModule, tables)
      assert.deepEqual(result.kind, 'ok')
      if (result.kind === 'ok') {
        const defs = result.definitions.get(moduleName)

        assert.deepInclude([...defs!.keys()], 'a')
        assert.notDeepInclude([...defs!.keys()], 'b')
      }
    })

    it('imports all definitions', () => {
      const tntModule = buildModuleWithDefs([
        'module test_module { def a = 1 def b = 2 }',
        'import test_module.*',
      ])

      const result = resolveImports(tntModule, tables)
      assert.deepEqual(result.kind, 'ok')
      if (result.kind === 'ok') {
        const defs = result.definitions.get(moduleName)

        assert.includeDeepMembers([...defs!.keys()], ['a', 'b'])
      }
    })

    it('intantiates modules', () => {
      const tntModule = buildModuleWithDefs([
        'module test_module { def a = 1 def b = 2 }',
        'module test_module_instance = test_module(a = 3, b = 4)',
      ])

      const result = resolveImports(tntModule, tables)
      assert.deepEqual(result.kind, 'ok')
      if (result.kind === 'ok') {
        const defs = result.definitions.get(moduleName)

        assert.includeDeepMembers([...defs!.keys()], [
          'test_module_instance::a',
          'test_module_instance::b',
        ])
      }
    })

    it('imports nested module', () => {
      const tntModule = buildModuleWithDefs([
        'module test_module { module nested_module { def d = 10 } }',
        'import test_module.nested_module',
      ])

      const result = resolveImports(tntModule, tables)
      assert.deepEqual(result.kind, 'ok')
      if (result.kind === 'ok') {
        const defs = result.definitions.get(moduleName)

        assert.includeDeepMembers([...defs!.keys()], [
          'nested_module::d',
        ])
      }
    })
  })

  describe('unexisting modules', () => {
    it('fails importing', () => {
      const tntModule = buildModuleWithDefs([
        'module test_module { def a = 1 def b = 2 }',
        'import unexisting_module.*',
      ])

      const result = resolveImports(tntModule, tables)
      assert.deepEqual(result.kind, 'error')
      if (result.kind === 'error') {
        assert.deepEqual(result.errors.map(e => e.moduleName), ['unexisting_module'])
      }
    })

    it('fails instantiating', () => {
      const tntModule = buildModuleWithDefs([
        'module test_module { def a = 1 def b = 2 }',
        'module test_module_instance = unexisting_module(a = a, b = b)',
      ])

      const result = resolveImports(tntModule, tables)
      assert.deepEqual(result.kind, 'error')
      if (result.kind === 'error') {
        assert.deepEqual(result.errors.map(e => e.moduleName), ['unexisting_module'])
      }
    })

    it('fails importing nested', () => {
      const tntModule = buildModuleWithDefs([
        'module test_module { def a = 1 def b = 2 }',
        'import test_module.unexisting_module',
      ])

      const result = resolveImports(tntModule, tables)
      assert.deepEqual(result.kind, 'error')
      if (result.kind === 'error') {
        assert.deepEqual(result.errors.map(e => e.defName), ['unexisting_module'])
      }
    })
  })
})
