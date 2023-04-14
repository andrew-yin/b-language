/**
 * Explicit control evaluator for C sublanguage. Some  adapted from https://github.com/source-academy/js-slang/
 */
/* tslint:disable:max-classes-per-file */
import * as es from 'estree'
import { ADDRESS, CHAR, DATA_OFFSET, FLOAT, HEADER_SIZE, HEAP_SIZE, INT, LIST, SIZE_OFFSET, TYPE_OFFSET, WORD_SIZE } from '../constants'
import { ensureGlobalEnvironmentExist } from '../createContext'

import { Context, Value } from '../types'
import {
  evaluateBinaryExpression as computeBinaryExpression,
  evaluateUnaryExpression as computeUnaryExpression,
  computeAssignmentExpression
} from '../utils/operators'
import {
  Address,
  AgendaItem,
  ApplyInstruction,
  ArrayInstruction,
  AssignmentInstruction,
  BinaryOperatorInstruction,
  BranchInstruction,
  ClearEnvironmentInstruction,
  CommandEvaluator,
  ECError,
  EnvironmentInstruction,
  FunctionDeclarationWithPointer,
  FunctionExpressionWithPointer,
  FunctionMarker,
  InitializeInstruction,
  LoopInstruction,
  PopInstruction,
  PushNullInstruction,
  PushUndefinedInstruction,
  ResetInstruction,
  UnaryExpressionWithPointer,
  UnaryOperatorInstruction,
  VariableDeclarationWithPointer,
  VariableDeclaratorWithPointer,
} from './types'
import {
  assign,
  assignType,
  convertFromType,
  createBlockEnvironment,
  createFunctionEnvironment,
  currentEnvironment,
  getAddress,
  getDims,
  handleRuntimeError,
  initialize,
  lookup,
  popEnvironment,
  pushEnvironment
} from './utils'
import { RuntimeSourceError } from '../errors/runtimeSourceError'

function handleSequence(statements: Array<es.Statement | es.Expression>) {
  const sequence = []
  for (let i = 0; i < statements.length; i++) {
    sequence.push(statements[i])
    if (i < statements.length - 1) {
      sequence.push(<PopInstruction>{ type: 'PopInstruction' })
    }
  }
  return sequence.reverse()
}

const assignBuiltIns = (context: Context) => {
  ensureGlobalEnvironmentExist(context)
  const globalEnvironment = context.runtime.environments[0]
  // add console.log to global environment as 'print'
  globalEnvironment.head['print'] = (...args: Value) => {
    console.log(...args)
  }

  // add malloc/free abstraction
  globalEnvironment.head['malloc'] = {
    type: 'function',
    expression: (size: number) => {
      const freeList = context.runtime.freeList
      const heap = context.runtime.memory
      const nearestSize = Math.ceil(size / WORD_SIZE) * WORD_SIZE

      // first-fit
      for (let i = 0; i < freeList.length; i++) {
        const address = freeList[i]
        const objectSize = heap.getFloat64(address+SIZE_OFFSET)
        if (objectSize > nearestSize) {
          // allocate
          heap.setFloat64(address+TYPE_OFFSET, nearestSize > WORD_SIZE ? LIST : INT) // by default, make it a list so pointer arithmetic works no matter what
          heap.setFloat64(address+SIZE_OFFSET, nearestSize)
          freeList.splice(i, 1)

          const payloadPointer = address + DATA_OFFSET
          const nextFreePointer = payloadPointer + nearestSize
          // split
          if (nextFreePointer < HEAP_SIZE) {
            freeList.push(nextFreePointer)
            heap.setFloat64(nextFreePointer+SIZE_OFFSET, objectSize - nearestSize - HEADER_SIZE)
          }
          return <Address>{
            type: 'Address',
            offset: address
          }
        }
      }
      // throw error?
      return null
    }
  }

  globalEnvironment.head['free'] = {
    type: 'function',
    expression: (address: Address) => {
      context.runtime.freeList.push(address.offset)
    }
  }

}

export function evaluate(program: es.Program, context: Context): Value {
  let programOutput
  try {
    assignBuiltIns(context)
    // initialize heap
    context.runtime.memory.setFloat64(WORD_SIZE+SIZE_OFFSET, HEAP_SIZE - WORD_SIZE - HEADER_SIZE)
    context.runtime.isRunning = true
    context.runtime.agenda.push(program)
    programOutput = runEvaluator(context, context.runtime.agenda, context.runtime.stack)
  } catch (error) {
    console.error(error)
    programOutput = new ECError()
  } finally {
    context.runtime.isRunning = false
    return programOutput
  }
}

function runEvaluator(context: Context, agenda: AgendaItem[], stack: Value[]) {
  if (agenda.length == 0) {
    // somehow no program was pushed to the agenda
    return undefined
  }

  context.runtime.break = false
  while (agenda.length > 0) {
    const command = agenda.pop()
    if (command === undefined) {
      // somehow agenda was empty
      throw new Error('No command found')
    }
    evaluateCommand[command.type](command, context, agenda, stack)
  }
  return stack[0]
}

const evaluateCommand: { [type: string]: CommandEvaluator } = {
  Program: evaluateProgram,

  // ESTree Nodes
  BlockStatement: evaluateBlockStatement,
  Literal: evaluateLiteral,
  Identifier: evaluateIdentifier,
  IfStatement: evaluateIfStatement,
  WhileStatement: evaluateWhileStatement,
  DoWhileStatement: evaluateDoWhileStatement,
  ForStatement: evaluateForStatement,
  BreakStatement: evaluateBreakStatement,
  ContinueStatement: evaluateContinueStatement,
  ExpressionStatement: evaluateExpressionStatement,
  SequenceExpression: evaluateSequenceExpression,
  AssignmentExpression: evaluateAssignmentExpression,
  ArrayExpression: evaluateArrayExpression,
  BinaryExpression: evaluateBinaryExpression,
  UnaryExpression: evaluateUnaryExpression,
  LogicalExpression: evaluateLogicalExpression,
  UpdateExpression: evaluateUpdateExpression,
  ConditionalExpression: evaluateConditionalExpression,
  FunctionDeclaration: evaluateFunctionDeclaration,
  VariableDeclaration: evaluateVariableDeclaration,
  CallExpression: evaluateCallExpression,
  ReturnStatement: evaluateReturnStatement,

  // Instructions
  PopInstruction: evaluatePopInstruction,
  AssignmentInstruction: evaluateAssignmentInstruction,
  InitializeInstruction: evaluateInitializeInstruction,
  UnaryOperatorInstruction: evaluateUnaryOperatorInstruction,
  BinaryOperatorInstruction: evaluateBinaryOperatorInstruction,
  EnvironmentInstruction: evaluateEnvironmentInstruction,
  ClearEnvironmentInstruction: evaluateClearEnvironmentInstruction,
  BranchInstruction: evaluateBranchInstruction,
  LoopInstruction: evaluateLoopInstruction,
  ArrayInstruction: evaluateArrayInstruction,
  ApplyInstruction: evaluateApplyInstruction,
  ResetInstruction: evaluateResetInstruction,
  PushNullInstruction: evaluatePushNullInstruction,
  PushUndefinedInstruction: evaluatePushUndefinedInstruction
}

/**
 * ESTree Nodes
 */

function evaluateProgram(
  command: es.Program,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const programEnvironment = createBlockEnvironment(context, 'programEnvironment')
  pushEnvironment(context, programEnvironment)
  agenda.push(...handleSequence(<es.Statement[]>command.body))
}

function evaluateBlockStatement(
  command: es.BlockStatement,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  // let function and for loop handle environment separately
  if (!command.innerComments) {
    agenda.push(<EnvironmentInstruction>{
      type: 'EnvironmentInstruction',
      environment: currentEnvironment(context),
      fp: context.runtime.sp
    })
    const environment = createBlockEnvironment(context)
    pushEnvironment(context, environment)
  }

  agenda.push(...handleSequence(command.body))
}

function evaluateLiteral(
  command: es.Literal,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  stack.push(command.value)
}

function evaluateIdentifier(
  command: es.Identifier,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const environment = currentEnvironment(context)
  if (command.hasOwnProperty('lvalue') && command['lvalue'] == true) {
    stack.push(getAddress(command, environment, context))
  }
  else {
    stack.push(lookup(command, environment, context))
  }
}

function evaluateIfStatement(
  command: es.IfStatement,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<PushUndefinedInstruction> { type: 'PushUndefinedInstruction' })
  const hasElse = command.alternate != null
  if (hasElse) {
    agenda.push(command.alternate!)
  }
  agenda.push(command.consequent)
  agenda.push(<BranchInstruction>{ type: 'BranchInstruction', hasElse })
  agenda.push(command.test)
}

function evaluateWhileStatement(
  command: es.WhileStatement,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<PushUndefinedInstruction> { type: 'PushUndefinedInstruction' })
  agenda.push(<LoopInstruction>{
    type: 'LoopInstruction',
    test: command.test,
    body: command.body
  })
  agenda.push(command.test)
}

function evaluateDoWhileStatement(
  command: es.DoWhileStatement,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<PushUndefinedInstruction> { type: 'PushUndefinedInstruction' })
  agenda.push(<LoopInstruction>{
    type: 'LoopInstruction',
    test: command.test,
    body: command.body
  })
  agenda.push(command.test)
  agenda.push(command.body)
}

function evaluateForStatement(
  command: es.ForStatement,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const loop = <LoopInstruction>{
    type: 'LoopInstruction',
    test: command.test,
    params: [],
    update: command.update,
    body: command.body
  }
  // create environment for declaring for loop variables
  agenda.push(<EnvironmentInstruction>{
    type: 'EnvironmentInstruction',
    environment: currentEnvironment(context),
    fp: context.runtime.sp
  })
  const environment = createBlockEnvironment(context)
  pushEnvironment(context, environment)
  if (command.init?.type == 'VariableDeclaration') {
    loop.params = command.init.declarations.map(declaration => (<es.Identifier>declaration.id).name)
  }

  agenda.push(loop)
  if (command.test) {
    agenda.push(command.test)
  }
  if (command.init) {
    agenda.push(command.init)
  }
}

function evaluateBreakStatement(
  command: es.BreakStatement,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  // keep popping, if env needs to be reset then do so
  while (agenda[agenda.length - 1]!.type != 'LoopInstruction') {
    const last = agenda.pop()
    if (last!.type == 'EnvironmentInstruction') {
      evaluateEnvironmentInstruction(last as EnvironmentInstruction, context, agenda, stack)
    }
  }
  // jump out of while loop
  agenda.pop()
}

function evaluateContinueStatement(
  command: es.ContinueStatement,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  // keep popping, if env needs to be reset then do so
  let last
  while (agenda[agenda.length - 1]!.type != 'LoopInstruction') {
    last = agenda.pop()
    if (last!.type == 'EnvironmentInstruction') {
      evaluateEnvironmentInstruction(last as EnvironmentInstruction, context, agenda, stack)
    }
  }
  // re-add predicate
  agenda.push(last)
}

function evaluateExpressionStatement(
  command: es.ExpressionStatement,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<PushUndefinedInstruction>{ type: 'PushUndefinedInstruction' })
  agenda.push(<PopInstruction>{ type: 'PopInstruction' })
  agenda.push(command.expression)
}

function evaluateSequenceExpression(
  command: es.SequenceExpression,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(...handleSequence(command.expressions))
}

function evaluateAssignmentExpression(
  command: es.AssignmentExpression,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<AssignmentInstruction>{
    type: 'AssignmentInstruction',
    operator: command.operator,
    init: false
  })
  agenda.push(command.right)
  agenda.push(command.left)
}

function evaluateArrayExpression(
  command: es.ArrayExpression,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<ArrayInstruction>{
    type: 'ArrayInstruction',
    length: command.elements.length
  })
  for (const element of (<Array<es.Expression>>command.elements).reverse()) {
    agenda.push(element)
  }
}

function evaluateBinaryExpression(
  command: es.BinaryExpression,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<BinaryOperatorInstruction>{
    type: 'BinaryOperatorInstruction',
    operator: command.operator
  })
  agenda.push(command.right)
  agenda.push(command.left)
}

function evaluateUnaryExpression(
  command: UnaryExpressionWithPointer,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const instruction = <UnaryOperatorInstruction>{
    type: 'UnaryOperatorInstruction',
    operator: command.operator,
    lvalue: command.hasOwnProperty('lvalue') && command['lvalue'] == true
  }
  const argument = command.argument
  if (command.operator == 'void') {
    instruction.operator = command.pointerOperator!

  }
  agenda.push(instruction)

  if (instruction.operator == '&') {
    // ensure argument is an identifier
    if (argument.type != 'Identifier') {
      handleRuntimeError(context, new RuntimeSourceError())
    }
    lookup(<es.Identifier>argument, currentEnvironment(context), context)
    stack.push(argument)
  }
  else {
    agenda.push(argument)
  }
}

function evaluateLogicalExpression(
  command: es.LogicalExpression,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<BinaryOperatorInstruction>{
    type: 'BinaryOperatorInstruction',
    operator: command.operator
  })
  agenda.push(command.right)
  agenda.push(command.left)
}

function evaluateUpdateExpression(
  command: es.UpdateExpression,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const operator = command.operator == '++' ? '+=' : '-='
  command.argument['lvalue'] = true
  evaluateAssignmentExpression(
    <es.AssignmentExpression> {
      type: 'AssignmentExpression',
      operator,
      left: command.argument,
      right: <es.Literal>{ type: 'Literal', value: 1 }
    },
    context,
    agenda,
    stack
  )
}

function evaluateConditionalExpression(
  command: es.ConditionalExpression,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(command.alternate)
  agenda.push(command.consequent)
  agenda.push(<BranchInstruction>{ type: 'BranchInstruction', hasElse: true })
  agenda.push(command.test)
}

function evaluateVariableDeclaration(
  command: es.VariableDeclaration,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<PushUndefinedInstruction>{ type: 'PushUndefinedInstruction' })
  for (const decl of <VariableDeclaratorWithPointer[]>command.declarations) {
    agenda.push(<PopInstruction>{ type: 'PopInstruction' })
    agenda.push(<InitializeInstruction>{
      type: 'InitializeInstruction',
      symbol: decl,
      assign: decl.init != undefined
    })
    if (decl.init) {
      agenda.push(decl.init)
    }
  }
}

function evaluateFunctionDeclaration(
  command: es.FunctionDeclaration,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<PushUndefinedInstruction>{ type: 'PushUndefinedInstruction' })
  agenda.push(<PopInstruction>{ type: 'PopInstruction' })
  agenda.push(<InitializeInstruction>{
    type: 'InitializeInstruction',
    symbol: command,
    assign: true
  })
  stack.push(<FunctionExpressionWithPointer>{
    type: 'FunctionExpression',
    declarations: (<FunctionDeclarationWithPointer>command).declarations,
    body: command.body
  })
}

function evaluateCallExpression(
  command: es.CallExpression,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const arity = command.arguments.length
  agenda.push(<ApplyInstruction>{
    type: 'ApplyInstruction',
    arity,
  })
  for (let i = arity - 1; i >= 0; i--) {
    agenda.push(command.arguments[i])
  }
  agenda.push(command.callee)
}

function evaluateReturnStatement(
  command: es.ReturnStatement,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  agenda.push(<ResetInstruction>{ type: 'ResetInstruction' })
  if (command.argument != undefined) {
    agenda.push(command.argument)
  }
  else {
    agenda.push(<PushUndefinedInstruction>{ type: 'PushUndefinedInstruction' })
  }
}

function evaluateResetInstruction(
  command: ResetInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  while (agenda.length > 0 && agenda[agenda.length - 1]!.type != 'FunctionMarker') {
    agenda.pop()
  }
  agenda.pop()
}

/**
 * Instructions
 */

function evaluateArrayInstruction(
  command: ArrayInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const array = new Array(command.length)
  for (let i = command.length - 1; i >= 0; i--) {
    array[i] = stack.pop()
  }
  stack.push(array)
}

function evaluateLoopInstruction(
  command: LoopInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const value = stack.pop()
  if (value) {
    agenda.push(command)
    agenda.push(command.test)

    agenda.push(<ClearEnvironmentInstruction>{
      type: 'ClearEnvironmentInstruction',
      keepParams: command.params,
      fp: context.runtime.sp
    })

    if (command.update != null) {
      agenda.push(<PopInstruction>{ type: 'PopInstruction' })
      agenda.push(command.update)
    }
    agenda.push(<PopInstruction>{ type: 'PopInstruction' })
    agenda.push(command.body)
  }
}

function evaluateClearEnvironmentInstruction(
  command: ClearEnvironmentInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const environment = currentEnvironment(context)
  for (const symbol of Object.keys(environment.head)) {
    if (!command.keepParams || command.keepParams.indexOf(symbol) == -1) {
      delete environment.head[symbol]
    }
  }
  context.runtime.sp = command.fp
}

function evaluatePopInstruction(
  command: PopInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  stack.pop()
}

function evaluateAssignmentInstruction(
  command: AssignmentInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const right = stack.pop()
  const left = stack.pop()

  const prev = convertFromType(left.offset, context)

  const res = computeAssignmentExpression(command.operator, prev, right, context)

  assignType(res, left.offset, context)
  stack.push(res)
}

function evaluateInitializeInstruction(
  command: InitializeInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const environment = currentEnvironment(context)
  if (command.assign) {
    const value = stack.pop()
    let dims: number[] = []
    if (Array.isArray(value)) {
      if (command.symbol.type != 'VariableDeclarator' || (<VariableDeclaratorWithPointer>command.symbol).pointer == 0) {
        handleRuntimeError(context, new RuntimeSourceError()) // can't assign array to non-pointer
      }
      dims = getDims(value)
    }
    initialize(command.symbol, environment, context, dims)
    assign(<es.Identifier>command.symbol.id, value, environment, context)
  }
  else {
    initialize(command.symbol, environment, context)
  }
}

function evaluateBinaryOperatorInstruction(
  command: BinaryOperatorInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const right = stack.pop()
  const left = stack.pop()
  stack.push(computeBinaryExpression(command.operator, left, right, context))
}

function evaluateUnaryOperatorInstruction(
  command: UnaryOperatorInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const value = stack.pop()
  stack.push(computeUnaryExpression(command.operator, value, context, command.lvalue))
}

function evaluateEnvironmentInstruction(
  command: EnvironmentInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const environment = command.environment
  while (currentEnvironment(context).id !== environment.id) {
    popEnvironment(context)
  }
}

function evaluateBranchInstruction(
  command: BranchInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const value = stack.pop()
  const consequent = agenda.pop()
  const alternate = command.hasElse ? agenda.pop() : null
  if (value) {
    agenda.push(consequent)
  }
  else {
    if (alternate) {
      agenda.push(alternate)
    }
  }
}

function evaluateApplyInstruction(
  command: ApplyInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  const args = []
  for (let i = 0; i < command.arity; i++) {
    args.unshift(stack.pop())
  }

  const func: es.FunctionExpression | Function = stack.pop()
  if (typeof func === 'function') {
    // built-in function
    const result = func(...args)
    stack.push(result)
  }
  else {
    // user-defined function
    if (agenda.length == 0 || agenda[agenda.length - 1]!.type == 'EnvironmentInstruction') {
      // redundant to push environment instruction
      agenda.push(<FunctionMarker>{ type: 'FunctionMarker' })
    }
    else if (agenda[agenda.length - 1]!.type == 'ResetInstruction') {
      // tail call case, pop the reset instruction
      agenda.pop()
    }
    else {
      agenda.push(<EnvironmentInstruction>{
        type: 'EnvironmentInstruction',
        environment: currentEnvironment(context),
        fp: context.runtime.sp,
      })
      agenda.push(<FunctionMarker>{ type: 'FunctionMarker' })
    }
    agenda.push(func.body)
    pushEnvironment(context, createFunctionEnvironment(context, func, args))
  }
}

function evaluatePushNullInstruction(
  command: PushNullInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  stack.push(null)
}

function evaluatePushUndefinedInstruction(
  command: PushUndefinedInstruction,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
): void {
  stack.push(undefined)
}
