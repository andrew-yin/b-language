import { BinaryOperator, UnaryOperator, LogicalOperator, AssignmentOperator, Identifier } from 'estree'

import { LazyBuiltIn } from '../createContext'
import {
  CallingNonFunctionValue,
  ExceptionError,
  GetInheritedPropertyError,
  InvalidNumberOfArguments,
} from '../errors/errors'
import { RuntimeSourceError } from '../errors/runtimeSourceError'
import { Context, Thunk } from '../types'
import { locationDummyNode } from './astCreator'
import * as create from './astCreator'
import { makeWrapper } from './makeWrapper'
import * as rttc from './rttc'
import { Address, UnaryPointerOperator } from '../interpreter/types'
import { convertFromType, currentEnvironment, getAddress, getType, handleRuntimeError, lookup } from '../interpreter/utils'
import { ADDRESS, CHAR, DATA_OFFSET, HEADER_SIZE, INT, LIST, SIZE_OFFSET, TYPE_OFFSET, WORD_SIZE } from '../constants'

export function forceIt(val: Thunk | any): any {
  if (val !== undefined && val !== null && val.isMemoized !== undefined) {
    if (val.isMemoized) {
      return val.memoizedValue
    }

    const evaluatedValue = forceIt(val.f())

    val.isMemoized = true
    val.memoizedValue = evaluatedValue

    return evaluatedValue
  } else {
    return val
  }
}

export function wrapLazyCallee(candidate: any) {
  candidate = forceIt(candidate)
  if (typeof candidate === 'function') {
    const wrapped: any = (...args: any[]) => candidate(...args.map(forceIt))
    makeWrapper(candidate, wrapped)
    wrapped[Symbol.toStringTag] = () => candidate.toString()
    wrapped.toString = () => candidate.toString()
    return wrapped
  } else if (candidate instanceof LazyBuiltIn) {
    if (candidate.evaluateArgs) {
      const wrapped: any = (...args: any[]) => candidate.func(...args.map(forceIt))
      makeWrapper(candidate.func, wrapped)
      wrapped[Symbol.toStringTag] = () => candidate.toString()
      wrapped.toString = () => candidate.toString()
      return wrapped
    } else {
      return candidate
    }
  }
  // doesn't look like a function, not our business to error now
  return candidate
}

export function makeLazyFunction(candidate: any) {
  return new LazyBuiltIn(candidate, false)
}

export function callIfFuncAndRightArgs(
  candidate: any,
  line: number,
  column: number,
  ...args: any[]
) {
  const dummy = create.callExpression(create.locationDummyNode(line, column), args, {
    start: { line, column },
    end: { line, column }
  })

  if (typeof candidate === 'function') {
    const originalCandidate = candidate
    if (candidate.transformedFunction !== undefined) {
      candidate = candidate.transformedFunction
    }
    const expectedLength = candidate.length
    const receivedLength = args.length
    const hasVarArgs = candidate.minArgsNeeded !== undefined
    if (hasVarArgs ? candidate.minArgsNeeded > receivedLength : expectedLength !== receivedLength) {
      throw new InvalidNumberOfArguments(
        dummy,
        hasVarArgs ? candidate.minArgsNeeded : expectedLength,
        receivedLength,
        hasVarArgs
      )
    }
    try {
      const forcedArgs = args.map(forceIt)
      return originalCandidate(...forcedArgs)
    } catch (error) {
      // if we already handled the error, simply pass it on
      if (!(error instanceof RuntimeSourceError || error instanceof ExceptionError)) {
        throw new ExceptionError(error, dummy.loc!)
      } else {
        throw error
      }
    }
  } else if (candidate instanceof LazyBuiltIn) {
    try {
      if (candidate.evaluateArgs) {
        args = args.map(forceIt)
      }
      return candidate.func(...args)
    } catch (error) {
      // if we already handled the error, simply pass it on
      if (!(error instanceof RuntimeSourceError || error instanceof ExceptionError)) {
        throw new ExceptionError(error, dummy.loc!)
      } else {
        throw error
      }
    }
  } else {
    throw new CallingNonFunctionValue(candidate, dummy)
  }
}

export function boolOrErr(candidate: any, line: number, column: number) {
  candidate = forceIt(candidate)
  const error = rttc.checkIfStatement(create.locationDummyNode(line, column), candidate)
  if (error === undefined) {
    return candidate
  } else {
    throw error
  }
}

export function evaluateUnaryExpression(operator: UnaryOperator | UnaryPointerOperator, value: any, context: Context, lvalue: boolean): any {
  if (operator === '!') {
    return +(!value) // C doesn't have boolean values, so we convert to number
  }
  else if (operator === '-') {
    return -value
  }
  else if (operator === '~') {
    return ~value
  }
  else if (operator === '+') {
    return +value
  }
  else if (operator === '&') {
    if (value.type != 'Identifier') {
      handleRuntimeError(context, new RuntimeSourceError())
    }
    return getAddress(<Identifier> value, currentEnvironment(context), context)
  }
  else if (operator === '*') {
    if (value.type != 'Address') {
      handleRuntimeError(context, new RuntimeSourceError())
    }
    return lvalue ? value : convertFromType(value.offset, context)
  }
  else {
    handleRuntimeError(context, new RuntimeSourceError())
  }
}

export function evaluateBinaryExpression(operator: BinaryOperator | LogicalOperator, left: any, right: any, context: Context) {
  // convert to int if necessary
  if (left.type == 'Address' && right.type == 'Address') {
    handleRuntimeError(context, new RuntimeSourceError()) // can't compute two pointers
  }

  if (left.type == 'Address') {
    return <Address> {
      type: 'Address',
      offset: computePointerIncrement(operator, left, right, context)
    }
  }
  if (right.type == 'Address') {
    return <Address> {
      type: 'Address',
      offset: computePointerIncrement(operator, right, left, context)
    }
  }

  switch (operator) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      return left / right
    case '%':
      return left % right
    case '<<':
      return left << right
    case '>>':
      return left >> right
    case '==':
      return +(left == right)
    case '!=':
      return +(left != right)
    case '<=':
      return +(left <= right)
    case '<':
      return +(left < right)
    case '>':
      return +(left > right)
    case '>=':
      return +(left >= right)
    case '^':
      return left ^ right
    case '&':
      return left & right
    case '|':
      return left | right
    case '||':
      return +(left || right)
    case '&&':
      return +(left && right)
    case '??':
      return +(left ?? right)
    default:
      handleRuntimeError(context, new RuntimeSourceError())
      break
  }
}

function computePointerIncrement(operator: BinaryOperator | LogicalOperator, pointer: Address, value: number, context: Context) {
  const size = context.runtime.memory.getFloat64(pointer.offset + SIZE_OFFSET)
  value *= size*WORD_SIZE + HEADER_SIZE

  switch (operator) {
    case '+':
      return pointer.offset + value
    case '-':
      return pointer.offset - value
    default:
      handleRuntimeError(context, new RuntimeSourceError()) // no other operators allowed
      return undefined
  }
}

export function computeAssignmentExpression(
  operator: AssignmentOperator | undefined,
  prev: any,
  right: any,
  context: Context
) {
  if (operator == '=' || operator == undefined) {
    return right
  }
  if (prev == undefined) {
    handleRuntimeError(context, new RuntimeSourceError())
  }
  switch (operator) {
    case '+=':
      return evaluateBinaryExpression('+', prev, right, context)
    case '-=':
      return evaluateBinaryExpression('-', prev, right, context)
    case '*=':
      return evaluateBinaryExpression('*', prev, right, context)
    case '/=':
      return evaluateBinaryExpression('/', prev, right, context)
    case '%=':
      return evaluateBinaryExpression('%', prev, right, context)
    case '<<=':
      return evaluateBinaryExpression('<<', prev, right, context)
    case '>>=':
      return evaluateBinaryExpression('>>', prev, right, context)
    case '^=':
      return evaluateBinaryExpression('^', prev, right, context)
    case '&=':
      return evaluateBinaryExpression('&', prev, right, context)
    case '|=':
      return evaluateBinaryExpression('|', prev, right, context)
    default:
      handleRuntimeError(context, new RuntimeSourceError())
  }
}

export const setProp = (obj: any, prop: any, value: any, line: number, column: number) => {
  const dummy = locationDummyNode(line, column)
  const error = rttc.checkMemberAccess(dummy, obj, prop)
  if (error === undefined) {
    return (obj[prop] = value)
  } else {
    throw error
  }
}

export const getProp = (obj: any, prop: any, line: number, column: number) => {
  const dummy = locationDummyNode(line, column)
  const error = rttc.checkMemberAccess(dummy, obj, prop)
  if (error === undefined) {
    if (obj[prop] !== undefined && !obj.hasOwnProperty(prop)) {
      throw new GetInheritedPropertyError(dummy, obj, prop)
    } else {
      return obj[prop]
    }
  } else {
    throw error
  }
}
