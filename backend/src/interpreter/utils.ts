/**
 * Explicit control evaluator related utils, some adapted from https://github.com/source-academy/js-slang
 */
import * as es from 'estree'
import { uniqueId } from 'lodash'

import { RuntimeSourceError } from '../errors/runtimeSourceError'
import { Context, Environment, Frame, Value } from '../types'
import { UndefinedVariable, VariableRedeclaration } from '../errors/errors'
import { Address, FunctionDeclarationWithPointer, FunctionExpressionWithPointer, VariableDeclaratorWithPointer} from './types'
import { ADDRESS, CHAR, DATA_OFFSET, FLOAT, HEADER_SIZE, HEAP_SIZE, INT, LIST, SIZE_OFFSET, TYPE_OFFSET, WORD_SIZE } from '../constants'

export const currentEnvironment = (context: Context): Environment => {
  return context.runtime.environments[0]
}

export const createFunctionEnvironment = (
  context: Context,
  func: es.FunctionExpression,
  args: Value[],
  name = 'functionEnvironment',
  head: Frame = {}
): Environment => {
  const pointerFunc = <FunctionExpressionWithPointer> func
  const environment = createBlockEnvironment(context, name, head)
  for (const decl of pointerFunc.declarations) {
    initialize(decl.declarations[0], environment, context)
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const param = <es.Identifier> pointerFunc.declarations[i].declarations[0].id
    assign(param, arg, environment, context)
  }
  return environment
}

export const createBlockEnvironment = (
  context: Context,
  name = 'blockEnvironment',
  head: Frame = {}
): Environment => {
  return {
    name: name,
    tail: currentEnvironment(context),
    head: head,
    id: uniqueId()
  }
}


const declareVariable = (
  decl: VariableDeclaratorWithPointer,
  environment: Environment,
  context: Context,
  dims: number[] = []
) => {
  const id = <es.Identifier> decl.id
  const name = id.name

  if (context.runtime.sp <= HEAP_SIZE) {
    handleRuntimeError(context, new RuntimeSourceError()) // out of stack memory
  }

  if (environment.head.hasOwnProperty(name)) {
    handleRuntimeError(context, new VariableRedeclaration(decl, name))
  }

  const size = dims.length == 0 ? 1 : computeSize(dims)
  if (decl.init?.type == 'ArrayExpression' && dims.length != decl.pointer) {
    handleRuntimeError(context, new RuntimeSourceError()) // pointer mismatch
  }

  const address = context.runtime.sp - (HEADER_SIZE + size*WORD_SIZE) // address of the payload
  context.runtime.memory.setFloat64(address+SIZE_OFFSET, size)
  environment.head[name] = address
  context.runtime.sp = address
}

const declareFunction = (
  decl: FunctionDeclarationWithPointer,
  environment: Environment,
  context: Context
) => {
  const id = <es.Identifier> decl.id
  const name = id.name

  if (environment.head.hasOwnProperty(name)) {
    handleRuntimeError(context, new VariableRedeclaration(decl, name))
  }

  environment.head[name] = {
    type: 'function',
    expression: undefined
  }
}

export const pushEnvironment = (context: Context, environment: Environment) => {
  context.runtime.environments.unshift(environment)
  context.runtime.environmentTree.insert(environment)
}

export const popEnvironment = (context: Context) => {
  context.runtime.environments.shift()
}

export const handleRuntimeError = (context: Context, error: RuntimeSourceError) => {
  context.errors.push(error)
  throw error
}

export function lookup(id: es.Identifier, environment: Environment, context: Context): Value {
  const name = id.name
  if (environment == null) {
    handleRuntimeError(context, new UndefinedVariable(id.name, id))
  }
  const frame = environment.head
  if (frame.hasOwnProperty(name)) {
    if (frame[name].type == 'function') {
      return frame[name].expression
    }

    const address = frame[name]
    return convertFromType(address, context)
  } else {
    return lookup(id, environment.tail!, context)
  }
}

export function initialize(symbol: VariableDeclaratorWithPointer | FunctionDeclarationWithPointer, environment: Environment, context: Context, size: number[] = []) {
  if (symbol.type == 'VariableDeclarator') {
    declareVariable(symbol, environment, context, size)
  }
  else {
    declareFunction(symbol, environment, context)
  }
}

export function assign(id: es.Identifier, value: Value, environment: Environment, context: Context) {
  const name = id.name
  if (['print', 'malloc', 'free'].includes(name)) {
    handleRuntimeError(context, new VariableRedeclaration(id, id.name, false))
  }

  if (environment == null) {
    handleRuntimeError(context, new UndefinedVariable(id.name, id))
  }

  const frame = environment.head
  if (frame.hasOwnProperty(name)) {
    if (frame[name].type == 'function') {
      if (frame[name].expression != undefined) {
        handleRuntimeError(context, new VariableRedeclaration(id, id.name, false)) // can't reassign function
      }
      frame[name].expression = value
    }
    else {
      const address = frame[name]
      if (address == 0) {
        handleRuntimeError(context, new RuntimeSourceError()) // trying to assign to null
      }

      if (Array.isArray(value)) {
        const dims = getDims(value)
        assignArray(value, address, context, dims)
      }
      else {
        assignType(value, address, context)
      }
    }
  }
  else {
    assign(id, value, environment.tail!, context)
  }
}

export function getAddress(id: es.Identifier, environment: Environment, context: Context): Address {
  if (environment == null) {
    handleRuntimeError(context, new UndefinedVariable(id.name, id))
  }

  if (environment.head.hasOwnProperty(id.name)) {
    const data = environment.head[id.name]
    if (data.type == 'function') {
      handleRuntimeError(context, new RuntimeSourceError()) // can't get address of function
    }

    if (data == 0) {
      handleRuntimeError(context, new RuntimeSourceError()) // trying to get address of null
    }

    return <Address> { type: 'Address', offset: data }
  }
  else {
    return getAddress(id, environment.tail!, context)
  }
}

export function getType(id: es.Identifier, environment: Environment, context: Context): Value {
  if (environment == null) {
    handleRuntimeError(context, new UndefinedVariable(id.name, id))
  }

  if (environment.head.hasOwnProperty(id.name)) {
    const data = environment.head[id.name]
    if (data.type == 'function') {
      handleRuntimeError(context, new RuntimeSourceError()) // can't get type of function
    }

    return context.runtime.memory.getFloat64(data+TYPE_OFFSET)
  }
  else {
    return getType(id, environment.tail!, context)
  }
}

export function assignType(value: Value, address: number, context: Context) {
  if (value.type == 'Address') {
    context.runtime.memory.setFloat64(address+DATA_OFFSET, value.offset)
    context.runtime.memory.setFloat64(address+TYPE_OFFSET, ADDRESS)
  }
  else if (typeof value == 'string' && value.length == 1) {
    context.runtime.memory.setFloat64(address+DATA_OFFSET, value.charCodeAt(0))
    context.runtime.memory.setFloat64(address+TYPE_OFFSET, CHAR)
  }
  else {
    context.runtime.memory.setFloat64(address+DATA_OFFSET, value)
    if (Number.isInteger(value)) {
      context.runtime.memory.setFloat64(address+TYPE_OFFSET, INT)
    }
    else {
      context.runtime.memory.setFloat64(address+TYPE_OFFSET, FLOAT)
    }
  }
}

export function convertFromType(address: number, context: Context): Value {
  const type = context.runtime.memory.getFloat64(address+TYPE_OFFSET)
  const value = context.runtime.memory.getFloat64(address+DATA_OFFSET)
  return type == ADDRESS
          ? <Address> { type: 'Address', offset: value }
          : type == CHAR
          ? String.fromCharCode(value)
          : type == INT
          ? Math.floor(value)
          : type == LIST
          ? <Address> { type: 'Address', offset: address+DATA_OFFSET}
          : value
}

function computeSize(dims: number[]) {
  const totalElements = dims.reduce((acc, dim) => acc * dim, 1)

  let totalSize = totalElements * 3
  for (let i = dims.length-2; i >= 0; i--) {
    totalSize += dims[i] * 2
  }
  return totalSize
}

export function getDims(value: any[]) {
  var dims = [];
  while (Array.isArray(value)) {
    dims.push(value.length);
    value = value[0];
  }
  return dims;
}

export function assignArray(value: any[], address: any, context: Context<any>, dims: number[]) {
  const sizes = new Array(dims.length)
  sizes[dims.length-1] = 1
  for (let i = dims.length-2; i >= 0; i--) {
    sizes[i] = (sizes[i+1]+2) * dims[i+1]
  }

  allocateArray(value, address, context, dims, sizes)
}

function allocateArray(value: any[], address: any, context: Context<any>, dims: number[], sizes: any[]) {
  context.runtime.memory.setFloat64(address+TYPE_OFFSET, LIST)
  address += HEADER_SIZE
  if (sizes.length == 1) {
    for (let i = 0; i < dims[0]; i++) {
      context.runtime.memory.setFloat64(address+SIZE_OFFSET, sizes[0])
      assignType(value[i], address, context)
      address += HEADER_SIZE + WORD_SIZE*sizes[0]
    }
  }
  else {
    for (let i = 0; i < dims[0]; i++) {
      context.runtime.memory.setFloat64(address+SIZE_OFFSET, sizes[0])
      allocateArray(value[i], address, context, dims.slice(1), sizes.slice(1))
      address += HEADER_SIZE + WORD_SIZE*sizes[0]
    }
  }
}
