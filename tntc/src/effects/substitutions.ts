/* ----------------------------------------------------------------------------------
 * Copyright (c) Informal Systems 2022. All rights reserved.
 * Licensed under the Apache 2.0.
 * See License.txt in the project root for license information.
 * --------------------------------------------------------------------------------- */

/**
 * Substitutions for effects and its variables, including composition and application
 *
 * @author Gabriela Moreira
 *
 * @module
 */

import { Either, right, mergeInMany } from '@sweet-monads/either'
import { buildErrorTree, ErrorTree } from '../errorTree'
import { Effect, Variables } from './base'
import { effectToString, substitutionsToString } from './printing'
import { simplifyConcreteEffect } from './simplification'

/*
 * Substitutions can be applied to both effects and variables, replacing
 * quantified values with concrete ones
 */
export type Substitutions = Substitution[]

type Substitution =
  | { kind: 'variable', name: string, value: Variables }
  | { kind: 'effect', name: string, value: Effect }

/*
 * Compose two substitutions by applying the first one to the second one's values
 *
 * @param s1 substitutions to be applied and returned unchanged
 * @param s2 substitutions to be updated and returned
 *
 * @returns a new substitutions list containing the composition of given substitutions, if succeeded.
 *          Otherwise, an error tree with the substitution application failure
 */
export function compose (s1: Substitutions, s2: Substitutions): Either<ErrorTree, Substitutions> {
  return applySubstitutionsToSubstitutions(s1, s2)
    .map((s: Substitutions) => s1.concat(s))
    .mapLeft(error => buildErrorTree(`Composing substitutions ${substitutionsToString(s1)} and ${substitutionsToString(s2)}`, error))
}

/**
 * Applies substitutions to an effect, replacing all quantified names with their
 * substitution values when they are defined.
 *
 * @param subs the substitutions to be applied
 * @param e the effect to be transformed
 *
 * @returns the effect resulting from the substitutions' application on the given
 *          effect, when successful. Otherwise, an error tree with an error message and its trace.
 */
export function applySubstitution (subs: Substitutions, e: Effect): Either<ErrorTree, Effect> {
  let result: Either<ErrorTree, Effect> = right(e)
  switch (e.kind) {
    case 'quantified': {
      // e is an effect variable
      const sub = subs.find(s => s.name === e.name)
      if (sub && sub.kind === 'effect') {
        result = right(sub.value)
      }
      break
    }
    case 'arrow': {
      // e takes effects as parameters and returs an effect as result
      const arrowParams = mergeInMany(e.params.map(ef => applySubstitution(subs, ef)))
      result = arrowParams.chain(ps => {
        const arrowResult = applySubstitution(subs, e.result)
        return arrowResult.map(r => ({ kind: e.kind, params: ps, result: r }))
      }).mapLeft(error => buildErrorTree(`Applying substitution to arrow effect ${effectToString(e)}`, error))
      break
    }
    case 'concrete': {
      // e is a an effect of the form Read[r] & Update[u]
      const read = applySubstitutionToVariables(subs, e.read)
      const update = applySubstitutionToVariables(subs, e.update)

      result = right({ kind: 'concrete', read: read, update: update })
      break
    }
  }

  return result.chain(e => e.kind === 'concrete' ? simplifyConcreteEffect(e) : right(e))
}

/**
 * Applies substitutions to variables, replacing all quantified names with their
 * substitution values when they are defined.
 *
 * @param subs the substitutions to be applied
 * @param variables the variables to be transformed
 *
 * @returns the varibales resulting from the substitutions' application on the given
 *          variables, when successful. Otherwise, an error tree with an error message and its trace.
 */
export function applySubstitutionToVariables (subs: Substitutions, variables: Variables): Variables {
  switch (variables.kind) {
    case 'quantified': {
      const sub = subs.find(s => s.name === variables.name)
      if (sub && sub.kind === 'variable') {
        return sub.value
      }
      break
    }
    case 'union': {
      const newVariables = variables.variables.map(v => applySubstitutionToVariables(subs, v))
      return { kind: 'union', variables: newVariables }
    }
  }
  return variables
}

function applySubstitutionsToSubstitutions (s1: Substitutions, s2: Substitutions): Either<ErrorTree[], Substitutions> {
  return mergeInMany(s2.map((s: Substitution): Either<ErrorTree, Substitution> => {
    switch (s.kind) {
      case 'effect': return applySubstitution(s1, s.value).map(v => ({ kind: s.kind, name: s.name, value: v }))
      case 'variable': return right({ kind: s.kind, name: s.name, value: applySubstitutionToVariables(s1, s.value) })
    }
  }))
}