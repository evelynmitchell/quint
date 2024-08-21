import { Either, left, right } from '@sweet-monads/either'
import { QuintError } from '../../quintError'
import { RuntimeValue } from './runtimeValue'
import { TraceRecorder } from '../trace'
import { Map as ImmutableMap, List, is } from 'immutable'
import { VarStorage } from './VarStorage'

export interface NondetPick {
  name: string
  value: Either<QuintError, RuntimeValue>
}

export interface Register {
  value: Either<QuintError, RuntimeValue>
}

export class Context {
  public consts: ImmutableMap<bigint, Either<QuintError, RuntimeValue>> = ImmutableMap()
  public namespaces: List<string> = List()
  public varStorage: VarStorage = new VarStorage()
  public rand: (n: bigint) => bigint
  public pureKeys: Set<bigint> = new Set()
  public nondetPicks: ImmutableMap<bigint, NondetPick> = ImmutableMap()
  public recorder: TraceRecorder

  public constsByInstance: Map<bigint, ImmutableMap<bigint, Either<QuintError, RuntimeValue>>> = new Map()

  private constHistory: ImmutableMap<bigint, Either<QuintError, RuntimeValue>>[] = []
  private namespacesHistory: List<string>[] = []

  constructor(recorder: TraceRecorder, rand: (n: bigint) => bigint) {
    this.recorder = recorder
    this.rand = rand
  }

  reset() {
    this.varStorage = new VarStorage()
  }

  discoverVar(id: bigint, name: string) {
    this.varStorage.varNames.set(id, name)
  }

  getVar(id: bigint): Either<QuintError, RuntimeValue> {
    const varName = this.varWithNamespaces(id)
    const key = [id, varName].join('#')
    const result = this.varStorage.vars.get(key)
    if (!result) {
      return left({ code: 'QNT502', message: `Variable ${varName} not set` })
    }

    return result
  }

  setNextVar(id: bigint, value: RuntimeValue) {
    const varName = this.varWithNamespaces(id)
    // console.log('setting', id, varName, value)
    const key = [id, varName].join('#')
    this.varStorage.nextVars.set(key, right(value))
  }

  private varWithNamespaces(id: bigint): string {
    const revertedNamespaces = this.namespaces.slice().reverse()
    return revertedNamespaces.concat([this.varStorage.varNames.get(id)!] || []).join('::')
  }

  addConstants(consts: ImmutableMap<bigint, Either<QuintError, RuntimeValue>>) {
    this.constHistory.push(this.consts)
    this.consts = this.consts.merge(consts)
  }

  removeConstants() {
    this.consts = this.constHistory.pop()!
  }

  addNamespaces(namespaces: List<string> | undefined) {
    this.namespacesHistory.push(this.namespaces)
    if (is(this.namespaces.take(namespaces?.size ?? 0), namespaces)) {
      // Redundant namespaces, nothing to add
      return
    }

    this.namespaces = this.namespaces.concat(namespaces || [])
  }

  removeNamespaces() {
    this.namespaces = this.namespacesHistory.pop()!
  }

  constsSnapshot(): [bigint, Either<QuintError, RuntimeValue>][] {
    return [...this.consts.entries()]
  }
}
