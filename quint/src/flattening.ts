import { IdGenerator, newIdGenerator } from "./idGenerator"
import { LookupTable } from "./lookupTable"
import { QuintDef, QuintEx, QuintModule, QuintOpDef, isAnnotatedDef } from "./quintIr"
import { defaultValueDefinitions } from "./definitionsCollector"
import { definitionToString } from "./IRprinting"
import { QuintType, Row } from "./quintTypes"

export function flatten(module: QuintModule, table: LookupTable, modules: Map<string, QuintModule>): QuintModule {
  const lastId = [...modules.values()].map(m => m.id).sort((a, b) => Number(a - b))[-1]
  const idGenerator = newIdGenerator(lastId)
  const builtinNames = new Set(defaultValueDefinitions().map(d => d.identifier))

  const context = { idGenerator, table, builtinNames }

  const newDefs = module.defs.reduce((acc, def) => {
    if (def.kind === 'instance') {
      const protoModule = modules.get(def.protoName)!

      def.overrides.forEach(([param, expr]) => {
        const constDef = table.get(param.id)!
        const name = `${def.name}::${param.name}`
        acc.push({
          kind: 'def',
          name,
          qualifier: 'pureval',
          expr,
          typeAnnotation: constDef.typeAnnotation
            ? addNamespaceToType(context, def.name, constDef.typeAnnotation)
            : undefined,
          id: idGenerator.nextId(),
        })
      })

      protoModule.defs.forEach(protoDef => {
        if (!acc.some(d => d.name === `${def.name}::${protoDef.name}`)) {
          // Push a namespaced def if it was not previously defined by an override
          if (isAnnotatedDef(protoDef)) {
            const type = addNamespaceToType(context, def.name, protoDef.typeAnnotation)
            const newDef = addNamespaceToDef(context, def.name, protoDef)
            if (!isAnnotatedDef(newDef)) {
              throw new Error(`Impossible: transformation should preserve kind`)
            }
            acc.push({ ...newDef, typeAnnotation: type })
          } else {
            acc.push(addNamespaceToDef(context, def.name, protoDef))
          }
        }
      })
    } else {
      acc.push(def)
    }

    return acc
  }, [] as QuintDef[])

  return { ...module, defs: newDefs }
}

interface FlatteningContext {
  idGenerator: IdGenerator,
  table: LookupTable,
  builtinNames: Set<string>,
}

function addNamespaceToDef(ctx: FlatteningContext, name: string, def: QuintDef): QuintDef {
  switch (def.kind) {
    case 'def':
      return addNamespaceToOpDef(ctx, name, def)
    case 'assume':
      return {
        ...def,
        name: `${name}::${def.name}`,
        assumption: addNamespaceToExpr(ctx, name, def.assumption),
        id: ctx.idGenerator.nextId(),
      }
    case 'const':
    case 'var':
      return { ...def, name: `${name}::${def.name}`, id: ctx.idGenerator.nextId() }
    case 'typedef':
      return {
        ...def,
        name: `${name}::${def.name}`,
        type: def.type ? addNamespaceToType(ctx, name, def.type) : undefined,
        id: ctx.idGenerator.nextId(),
      }
    case 'instance':
      throw new Error(`Instance in ${definitionToString(def)} should have been flatenned already`)
    case 'import':
      return def
  }
}

function addNamespaceToOpDef(ctx: FlatteningContext, name: string, opdef: QuintOpDef): QuintOpDef {
  return {
    ...opdef,
    name: `${name}::${opdef.name}`,
    expr: addNamespaceToExpr(ctx, name, opdef.expr),
    id: ctx.idGenerator.nextId(),
  }
}

function addNamespaceToExpr(ctx: FlatteningContext, name: string, expr: QuintEx): QuintEx {
  const id = ctx.idGenerator.nextId()
  switch (expr.kind) {
    case 'name':
      if (shouldAddNamespace(ctx, expr.name, expr.id)) {
        return { ...expr, name: `${name}::${expr.name}`, id }
      }

      return { ...expr, id }
    case 'bool':
    case 'int':
    case 'str':
      return { ...expr, id }
    case 'app': {
      if (shouldAddNamespace(ctx, expr.opcode, expr.id)) {
        return {
          ...expr,
          opcode: `${name}::${expr.opcode}`,
          args: expr.args.map(arg => addNamespaceToExpr(ctx, name, arg)),
          id,
        }
      }

      return {
        ...expr,
        args: expr.args.map(arg => addNamespaceToExpr(ctx, name, arg)),
        id,
      }
    }
    case 'lambda':
      return {
        ...expr,
        params: expr.params.map(param => ({ ...param, id: ctx.idGenerator.nextId() })),
        expr: addNamespaceToExpr(ctx, name, expr.expr),
        id,
      }

    case 'let':
      return {
        ...expr,
        opdef: addNamespaceToOpDef(ctx, name, expr.opdef),
        expr: addNamespaceToExpr(ctx, name, expr.expr),
        id,
      }
  }
}

function addNamespaceToType(ctx: FlatteningContext, name: string, type: QuintType): QuintType {
  const id = ctx.idGenerator.nextId()
  switch (type.kind) {
    case 'bool':
    case 'int':
    case 'str':
    case 'var':
      return { ...type, id }
    case 'const':
      return { ...type, name: `${name}::${type.name}`, id }
    case 'set':
    case 'list':
      return { ...type, elem: addNamespaceToType(ctx, name, type.elem), id }
    case 'fun':
      return {
        ...type,
        arg: addNamespaceToType(ctx, name, type.arg),
        res: addNamespaceToType(ctx, name, type.res),
        id,
      }
    case 'oper':
      return {
        ...type,
        args: type.args.map(arg => addNamespaceToType(ctx, name, arg)),
        res: addNamespaceToType(ctx, name, type.res),
        id,
      }
    case 'tup':
    case 'rec':
      return {
        ...type,
        fields: addNamespaceToRow(ctx, name, type.fields),
        id,
      }
    case 'union':
      return {
        ...type,
        records: type.records.map(record => {
          return {
            ...record,
            fields: addNamespaceToRow(ctx, name, record.fields),
          }
        }),
        id,
      }
  }
}

function addNamespaceToRow(ctx: FlatteningContext, name: string, row: Row): Row {
  if (row.kind === 'row') {
    return {
      ...row, fields: row.fields.map(field => {
        return {
          ...field,
          fieldType: addNamespaceToType(ctx, name, field.fieldType),
        }
      }),
    }
  } else {
    return row
  }
}

function shouldAddNamespace(ctx: FlatteningContext, name: string, id: bigint): boolean {
  if (ctx.builtinNames.has(name)) {
    return false
  }

  const def = ctx.table.get(id)
  if (!def) {
    throw new Error(`Could not find def for id ${id}, name: ${name}`)
  }

  if (def.kind === 'param') {
    return false
  }

  return true
}
