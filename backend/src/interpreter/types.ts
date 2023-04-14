/**
 * Explicit control evaluator types, some adapted from https://github.com/source-academy/js-slang
 */
import * as es from 'estree'

import { Context, Environment, Value } from '../types'

export interface VariableDeclaratorWithPointer extends es.VariableDeclarator {
  pointer: number
}

export interface VariableDeclarationWithPointer extends es.VariableDeclaration {
  declarations: VariableDeclaratorWithPointer[]
}

export interface FunctionDeclarationWithPointer extends es.FunctionDeclaration {
  declarations: VariableDeclarationWithPointer[]
}

export interface FunctionExpressionWithPointer extends es.FunctionExpression {
  declarations: VariableDeclarationWithPointer[]
}

export interface UnaryExpressionWithPointer extends es.UnaryExpression {
  pointerOperator?: UnaryPointerOperator
}

interface BaseInstruction {
  type: string
}

export interface PopInstruction extends BaseInstruction {
  type: 'PopInstruction'
}

export interface ArrayInstruction extends BaseInstruction {
  type: 'ArrayInstruction'
  length: number
}

export interface InitializeInstruction extends BaseInstruction {
  type: 'InitializeInstruction'
  symbol: VariableDeclaratorWithPointer | FunctionDeclarationWithPointer
  assign: boolean
}

export interface AssignmentInstruction extends BaseInstruction {
  type: 'AssignmentInstruction'
  operator?: es.AssignmentOperator,
}

export interface BinaryOperatorInstruction extends BaseInstruction {
  type: 'BinaryOperatorInstruction'
  operator: es.BinaryOperator | es.LogicalOperator
}

export interface UnaryOperatorInstruction extends BaseInstruction {
  type: 'UnaryOperatorInstruction'
  operator: es.UnaryOperator | UnaryPointerOperator
  lvalue: boolean
}

export interface EnvironmentInstruction extends BaseInstruction {
  type: 'EnvironmentInstruction'
  environment: Environment
  fp: number
}

export interface PushNullInstruction extends BaseInstruction {
  type: 'PushNullInstruction'
}

export interface PushUndefinedInstruction extends BaseInstruction {
  type: 'PushUndefinedInstruction'
}

export interface BranchInstruction extends BaseInstruction {
  type: 'BranchInstruction',
  hasElse: boolean
}

export interface LoopInstruction extends BaseInstruction {
  type: 'LoopInstruction',
  test: es.Expression
  update?: es.Expression
  params?: string[]
  body: es.Statement
}

export interface ClearEnvironmentInstruction extends BaseInstruction {
  type: 'ClearEnvironmentInstruction'
  keepParams: string[]
  fp: number
}

export interface ApplyInstruction extends BaseInstruction {
  type: 'ApplyInstruction',
  arity: number,
}

export interface ResetInstruction extends BaseInstruction {
  type: 'ResetInstruction'
}

export interface FunctionMarker extends BaseInstruction {
  type: 'FunctionMarker'
}

export type Instruction = BaseInstruction

export type AgendaItem = es.Node | Instruction | undefined

export type CommandEvaluator = (
  command: AgendaItem,
  context: Context,
  agenda: AgendaItem[],
  stack: Value[]
) => void

export class ECError extends Error {}

export interface Address {
  type: 'Address'
  offset: number
}

export type UnaryPointerOperator =  '&' | '*'
