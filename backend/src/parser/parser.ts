/* tslint:disable:max-classes-per-file */
import * as es from 'estree'

import { CLexer } from '../lang/CLexer'
import { CVisitor } from '../lang/CVisitor'
import {
  AssignmentExpressionContext,
  BlockStatementContext,
  ConstantContext,
  CParser,
  ExpressionContext,
  ExpressionStatementContext,
  IdentifierContext,
  LineContext,
  ProgramContext,
  ParenthesesContext,
  PostfixExpressionContext,
  StatementContext,
  StringLiteralContext,
  UnaryExpressionContext,
  MultiplicativeExpressionContext,
  AdditiveExpressionContext,
  ShiftExpressionContext,
  RelationalExpressionContext,
  EqualityExpressionContext,
  AndExpressionContext,
  ExclusiveOrExpressionContext,
  InclusiveOrExpressionContext,
  LogicalAndExpressionContext,
  LogicalOrExpressionContext,
  ConditionalExpressionContext,
  IfStatementContext,
  WhileStatementContext,
  BreakContext,
  ContinueContext,
  DoWhileStatementContext,
  ForStatementContext,
  ForExpressionContext,
  ForConditionContext,
  FunctionDeclarationContext,
  ArgumentExpressionListContext,
  ReturnContext,
  DeclarationContext,
  VariableDeclarationContext,
  InitDeclaratorContext,
  ForDeclarationContext,
  ParameterContext,
  DeclaratorContext,
  DirectDeclaratorContext,
  InitializerContext,
  InitializerListContext,
} from '../lang/CParser'
import { Context, ErrorSeverity, ErrorType, SourceError, Value } from '../types'
import { stripIndent } from '../utils/formatters'
import { CharStreams, CommonTokenStream, ParserRuleContext } from 'antlr4ts'
import { ParseTree } from 'antlr4ts/tree/ParseTree'
import { RuleNode } from 'antlr4ts/tree/RuleNode'
import { TerminalNode } from 'antlr4ts/tree/TerminalNode'
import { ErrorNode } from 'antlr4ts/tree/ErrorNode'
import { UnaryPointerOperator, VariableDeclarationWithPointer, VariableDeclaratorWithPointer, FunctionDeclarationWithPointer } from '../interpreter/types'

export class DisallowedConstructError implements SourceError {
  public type = ErrorType.SYNTAX
  public severity = ErrorSeverity.ERROR
  public nodeType: string

  constructor(public node: es.Node) {
    this.nodeType = this.formatNodeType(this.node.type)
  }

  get location() {
    return this.node.loc!
  }

  public explain() {
    return `${this.nodeType} are not allowed`
  }

  public elaborate() {
    return stripIndent`
      You are trying to use ${this.nodeType}, which is not allowed (yet).
    `
  }

  /**
   * Converts estree node.type into english
   * e.g. ThisExpression -> 'this' expressions
   *      Property -> Properties
   *      EmptyStatement -> Empty Statements
   */
  private formatNodeType(nodeType: string) {
    switch (nodeType) {
      case 'ThisExpression':
        return "'this' expressions"
      case 'Property':
        return 'Properties'
      default: {
        const words = nodeType.split(/(?=[A-Z])/)
        return words.map((word, i) => (i === 0 ? word : word.toLowerCase())).join(' ') + 's'
      }
    }
  }
}

export class FatalSyntaxError implements SourceError {
  public type = ErrorType.SYNTAX
  public severity = ErrorSeverity.ERROR
  public constructor(public location: es.SourceLocation, public message: string) { }

  public explain() {
    return this.message
  }

  public elaborate() {
    return 'There is a syntax error in your program'
  }
}

export class MissingSemicolonError implements SourceError {
  public type = ErrorType.SYNTAX
  public severity = ErrorSeverity.ERROR
  public constructor(public location: es.SourceLocation) { }

  public explain() {
    return 'Missing semicolon at the end of statement'
  }

  public elaborate() {
    return 'Every statement must be terminated by a semicolon.'
  }
}

export class TrailingCommaError implements SourceError {
  public type: ErrorType.SYNTAX
  public severity: ErrorSeverity.WARNING
  public constructor(public location: es.SourceLocation) { }

  public explain() {
    return 'Trailing comma'
  }

  public elaborate() {
    return 'Please remove the trailing comma'
  }
}

function contextToLocation(ctx: ParserRuleContext): es.SourceLocation {
  return {
    start: {
      line: ctx.start.line,
      column: ctx.start.charPositionInLine
    },
    end: {
      line: ctx.stop ? ctx.stop.line : ctx.start.line,
      column: ctx.stop ? ctx.stop.charPositionInLine : ctx.start.charPositionInLine
    }
  }
}

function parseRawConstant(raw: string): Value {
  if (raw == 'true') {
    return 1
  }
  else if (raw == 'false') {
    return 0
  }
  else if (raw == 'null') {
    return null
  }
  else if (raw == 'undefined') {
    return undefined
  }
  else if (raw[0] == "'") {
    return raw[1]
  }
  else if (raw.includes('.')) {
    return parseFloat(raw)
  }
  else {
    return parseInt(raw)
  }
}

function isBinaryOperator(operator: string): operator is es.BinaryOperator {
  return ["==", "!=", "===", "!==", "<", "<=", ">", ">=", "<<", ">>", ">>>", "+", "-", "*", "/", "%", "**", "|", "^", "&", "in", "instanceof"].includes(operator)
}

class ProgramGenerator implements CVisitor<any> {
  visitSequence(ctx: any[]): Array<any> {
    const statements = []
    for (let i = 0; i < ctx.length; i++) {
      statements.push(this.visit(ctx[i]))
    }
    return statements
  }

  buildLeftRightExpression(expressions: ParserRuleContext[], operators: (ParserRuleContext | TerminalNode)[]): es.Expression {
    if (expressions.length === 1) {
      return this.visit(expressions[0])
    }
    if (isBinaryOperator(operators[0].text)) {
      return {
        type: 'BinaryExpression',
        operator: operators[0].text,
        left: this.visit(expressions[0]),
        right: this.buildLeftRightExpression(expressions.slice(1), operators.slice(1)),
        loc: contextToLocation(expressions[0])
      }
    }
    return {
      type: 'LogicalExpression',
      operator: <es.LogicalOperator>operators[0].text,
      left: this.visit(expressions[0]),
      right: this.buildLeftRightExpression(expressions.slice(1), operators.slice(1)),
      loc: contextToLocation(expressions[0])
    }
  }

  getForTest(ctx: ForConditionContext): es.Expression | null {
    const forExpressions = ctx.forExpression()
    if (forExpressions.length == 0) {
      return null
    }
    const test = forExpressions[0]
    const idx = ctx.children!.indexOf(test)
    if (idx == 0 || idx == ctx.children!.length - 1) {
      return null
    }

    const left = ctx.children![idx - 1]
    const right = ctx.children![idx + 1]
    if (left.text != ';' || right.text != ';') {
      return null
    }
    return this.visit(test)
  }

  getForUpdate(ctx: ForConditionContext): es.Expression | null {
    const forExpressions = ctx.forExpression()
    if (forExpressions.length == 0) {
      return null
    }
    const update = forExpressions[forExpressions.length - 1]
    const idx = ctx.children!.indexOf(update)
    if (idx != ctx.children!.length - 1) {
      return null
    }
    return this.visit(update)
  }

  visit(tree: ParseTree): any {
    return tree.accept(this)
  }

  visitChildren(node: RuleNode): Array<any> {
    const children = []
    for (let i = 0; i < node.childCount; i++) {
      children.push(this.visit(node.getChild(i)))
    }
    return children
  }

  visitTerminal(node: TerminalNode): any {
    return node.symbol.text
  }

  visitErrorNode(node: ErrorNode): any {
    throw new FatalSyntaxError(
      {
        start: {
          line: node.symbol.line,
          column: node.symbol.charPositionInLine
        },
        end: {
          line: node.symbol.line,
          column: node.symbol.charPositionInLine + 1
        }
      },
      `invalid syntax ${node.symbol.text}`
    )
  }

  visitProgram(ctx: ProgramContext): es.Program {
    const body = this.visitSequence(ctx.line())
    if (ctx.expression()) {
      body.push(this.visit(ctx.expression()!))
    }
    return {
      type: 'Program',
      sourceType: 'script',
      body,
      loc: contextToLocation(ctx)
    }
  }

  visitLine(ctx: LineContext): es.Statement {
    return this.visit(ctx.getChild(0))
  }

  visitDeclaration(ctx: DeclarationContext): es.Statement {
    return this.visit(ctx.getChild(0))
  }

  visitVariableDeclaration(ctx: VariableDeclarationContext): es.VariableDeclaration {
    const variableDeclaration: VariableDeclarationWithPointer = {
      type: 'VariableDeclaration',
      kind: 'let',
      declarations: [],
      loc: contextToLocation(ctx)
    }
    const initDeclaratorList = ctx.initDeclaratorList()
    if (initDeclaratorList) {
      const declarations = []
      for (const initDeclarator of initDeclaratorList.initDeclarator()) {
        declarations.push(this.visit(initDeclarator))
      }
      variableDeclaration.declarations = declarations
    }
    return variableDeclaration
  }

  visitInitDeclarator(ctx: InitDeclaratorContext): es.VariableDeclarator {
    const declarator = this.visit(ctx.declarator())
    if (ctx.initializer()) {
      declarator.init = this.visit(ctx.initializer()!)
    }
    return declarator
  }

  visitInitializer(ctx: InitializerContext): es.Expression {
    if (ctx.assignmentExpression()) {
      return this.visit(ctx.assignmentExpression()!)
    }
    else {
      return this.visit(ctx.initializerList()!)
    }
  }

  visitInitializerList(ctx: InitializerListContext): es.ArrayExpression {
    const elements = []
    for (const initializer of ctx.initializer()) {
      elements.push(this.visit(initializer))
    }
    return {
      type: 'ArrayExpression',
      elements,
      loc: contextToLocation(ctx)
    }
  }

  visitFunctionDeclaration(ctx: FunctionDeclarationContext): es.FunctionDeclaration {
    const declarations = []
    if (ctx.parameterList()) {
      for (const parameter of ctx.parameterList()!.parameter()) {
        declarations.push(this.visit(parameter))
      }
    }

    const body = this.visit(ctx.blockStatement())
    body.innerComments = [{
      type: 'Line',
      value: 'function'
    }]
    return <FunctionDeclarationWithPointer>{
      type: 'FunctionDeclaration',
      id: {
        type: 'Identifier',
        name: this.visit(ctx.Identifier())
      },
      params: [],
      declarations,
      body,
      loc: contextToLocation(ctx)
    }
  }

  visitParameter(ctx: ParameterContext): es.VariableDeclaration {
    return <VariableDeclarationWithPointer>{
      type: 'VariableDeclaration',
      kind: 'let',
      declarations: [
        this.visit(ctx.declarator())
      ]
    }
  }

  visitDeclarator(ctx: DeclaratorContext): es.VariableDeclarator {
    const variableDeclarator: VariableDeclaratorWithPointer = this.visit(ctx.directDeclarator())
    if (ctx.pointer()) {
      variableDeclarator.pointer += ctx.pointer()!.Star().length
    }
    return variableDeclarator
  }

  visitDirectDeclarator(ctx: DirectDeclaratorContext): es.VariableDeclarator {
    if (ctx.Identifier()) {
      return <VariableDeclaratorWithPointer>{
        type: 'VariableDeclarator',
        id: {
          type: 'Identifier',
          name: this.visit(ctx.Identifier()!)
        },
        pointer: 0,
        loc: contextToLocation(ctx)
      }
    }
    const declarator = this.visit(ctx.directDeclarator()!)
    declarator.pointer++
    return declarator
  }

  visitStatement(ctx: StatementContext): es.Statement {
    return this.visit(ctx.getChild(0))
  }

  visitBlockStatement(ctx: BlockStatementContext): es.BlockStatement {
    return {
      type: 'BlockStatement',
      body: this.visitSequence(ctx.statement()),
      loc: contextToLocation(ctx)
    }
  }

  visitExpressionStatement(ctx: ExpressionStatementContext): es.ExpressionStatement {
    return {
      type: 'ExpressionStatement',
      expression: this.visit(ctx.expression()),
      loc: contextToLocation(ctx)
    }
  }

  visitIfStatement(ctx: IfStatementContext): es.IfStatement {
    const statements = ctx.statement()
    return {
      type: 'IfStatement',
      test: this.visit(ctx.expression()),
      consequent: this.visit(statements[0]),
      alternate: statements.length == 2 ? this.visit(statements[1]) : null,
      loc: contextToLocation(ctx)
    }
  }

  visitWhileStatement(ctx: WhileStatementContext): es.WhileStatement {
    return {
      type: 'WhileStatement',
      test: this.visit(ctx.expression()),
      body: this.visit(ctx.statement()),
      loc: contextToLocation(ctx)
    }
  }

  visitDoWhileStatement(ctx: DoWhileStatementContext): es.DoWhileStatement {
    return {
      type: 'DoWhileStatement',
      test: this.visit(ctx.expression()),
      body: this.visit(ctx.statement()),
      loc: contextToLocation(ctx)
    }
  }

  visitForStatement(ctx: ForStatementContext): es.ForStatement {
    const forCondition = ctx.forCondition()
    const init = forCondition.forDeclaration()
      ? this.visit(forCondition.forDeclaration()!)
      : forCondition.expression()
        ? this.visit(forCondition.expression()!)
        : undefined
    const body = this.visit(ctx.statement())
    body.innerComments = [{
      type: 'Line',
      value: 'for'
    }]
    return {
      'type': 'ForStatement',
      init,
      test: this.getForTest(forCondition),
      update: this.getForUpdate(forCondition),
      body,
      loc: contextToLocation(ctx)
    }
  }

  visitForDeclaration(ctx: ForDeclarationContext): es.VariableDeclaration {
    return this.visitVariableDeclaration(ctx as VariableDeclarationContext)
  }

  visitForExpression(ctx: ForExpressionContext): es.Expression {
    const expressions = ctx.assignmentExpression().map(
      (assignmentExpression: AssignmentExpressionContext) => this.visit(assignmentExpression)
    )
    if (expressions.length == 1) {
      return expressions[0]
    }
    return {
      type: 'SequenceExpression',
      expressions: expressions,
      loc: contextToLocation(ctx)
    }
  }

  visitBreak(ctx: BreakContext): es.BreakStatement {
    return {
      type: 'BreakStatement',
      loc: contextToLocation(ctx)
    }
  }

  visitContinue(ctx: ContinueContext): es.ContinueStatement {
    return {
      type: 'ContinueStatement',
      loc: contextToLocation(ctx)
    }
  }

  visitReturn(ctx: ReturnContext): es.ReturnStatement {
    return {
      type: 'ReturnStatement',
      argument: ctx.expression() ? this.visit(ctx.expression()!) : undefined,
      loc: contextToLocation(ctx)
    }
  }

  visitExpression(ctx: ExpressionContext): es.Expression {
    const expressions = ctx.assignmentExpression().map(
      (assignmentExpression: AssignmentExpressionContext) => this.visit(assignmentExpression)
    )
    if (expressions.length == 1) {
      return expressions[0]
    }
    return {
      type: 'SequenceExpression',
      expressions: expressions,
      loc: contextToLocation(ctx)
    }
  }

  visitAssignmentExpression(ctx: AssignmentExpressionContext): es.Expression {
    if (ctx.conditionalExpression()) {
      return this.visit(ctx.conditionalExpression()!)
    }
    const operator = <es.AssignmentOperator>(ctx.assignmentOperator()!).text
    let left = this.visit(ctx.unaryExpression()!)
    left['lvalue'] = true
    const right = this.visit(ctx.assignmentExpression()!)

    return <es.AssignmentExpression>{
      type: 'AssignmentExpression',
      operator,
      left,
      right,
      loc: contextToLocation(ctx)
    }
  }

  visitConditionalExpression(ctx: ConditionalExpressionContext): es.Expression {
    if (ctx.Question() == undefined) {
      return this.visit(ctx.logicalOrExpression())
    }
    return {
      type: 'ConditionalExpression',
      test: this.visit(ctx.logicalOrExpression()),
      consequent: this.visit(ctx.expression()!),
      alternate: this.visit(ctx.conditionalExpression()!),
      loc: contextToLocation(ctx)
    }
  }

  visitLogicalOrExpression(ctx: LogicalOrExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.logicalAndExpression(), ctx.OrOr())
  }

  visitLogicalAndExpression(ctx: LogicalAndExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.inclusiveOrExpression(), ctx.AndAnd())
  }

  visitInclusiveOrExpression(ctx: InclusiveOrExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.exclusiveOrExpression(), ctx.Or())
  }

  visitExclusiveOrExpression(ctx: ExclusiveOrExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.andExpression(), ctx.Caret())
  }

  visitAndExpression(ctx: AndExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.equalityExpression(), ctx.And())
  }

  visitEqualityExpression(ctx: EqualityExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.relationalExpression(), ctx.equalityOperator())
  }

  visitRelationalExpression(ctx: RelationalExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.shiftExpression(), ctx.relationalOperator())
  }

  visitShiftExpression(ctx: ShiftExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.additiveExpression(), ctx.shiftOperator())
  }

  visitAdditiveExpression(ctx: AdditiveExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.multiplicativeExpression(), ctx.additiveOperator())
  }

  visitMultiplicativeExpression(ctx: MultiplicativeExpressionContext): es.Expression {
    return this.buildLeftRightExpression(ctx.unaryExpression(), ctx.multiplicativeOperator())
  }

  visitUnaryExpression(ctx: UnaryExpressionContext): es.Expression {
    let last_argument
    if (ctx.unaryExpression()) {
      last_argument = {
        type: 'UnaryExpression',
        operator: 'void',
        argument: this.visit(ctx.unaryExpression()!),
        loc: contextToLocation(ctx)
      }
      if (ctx.unaryOperator()!.text == '&' || ctx.unaryOperator()!.text == '*') {
        last_argument['pointerOperator'] = <UnaryPointerOperator>ctx.unaryOperator()!.text
      }
      else {
        last_argument.operator = <es.UnaryOperator>ctx.unaryOperator()!.text
      }
    }
    else {
      last_argument = this.visit(ctx.postfixExpression()!)
    }

    let argument = last_argument
    let i = 0
    while (i < ctx.childCount && ['++', '--'].includes(ctx.getChild(i).text)) {
      switch (ctx.getChild(i).text) {
        case '++':
          argument = {
            type: 'UpdateExpression',
            operator: '++',
            argument: last_argument,
            prefix: true,
            loc: contextToLocation(ctx)
          }
          break
        case '--':
          argument = {
            type: 'UpdateExpression',
            operator: '--',
            argument: last_argument,
            prefix: true,
            loc: contextToLocation(ctx)
          }
          break
        default:
          break
      }
      last_argument = argument
      i++
    }
    return argument
  }

  visitPostfixExpression(ctx: PostfixExpressionContext): es.Expression {
    let primary = this.visit(ctx.primaryExpression())
    if (ctx.childCount == 1) {
      return primary
    }

    let i = 1
    let last_expression = primary
    let expression = primary
    while (i < ctx.childCount) {
      switch (ctx.getChild(i).text) {
        case '++':
          expression = {
            type: 'UpdateExpression',
            operator: '++',
            argument: last_expression,
            prefix: false,
            loc: contextToLocation(ctx)
          }
          i++
          break
        case '--':
          expression = {
            type: 'UpdateExpression',
            operator: '--',
            argument: last_expression,
            prefix: false,
            loc: contextToLocation(ctx)
          }
          i++
          break
        case '(':
          if (ctx.getChild(i + 1).text == ')') {
            expression = {
              type: 'CallExpression',
              callee: last_expression,
              arguments: [],
              loc: contextToLocation(ctx)
            }
            i += 2
            break
          }
          const argumentExpressionList = ctx.getChild(i + 1) as ArgumentExpressionListContext
          const args = argumentExpressionList.assignmentExpression().map(
            (assignmentExpression: AssignmentExpressionContext) => this.visit(assignmentExpression)
          )
          expression = {
            type: 'CallExpression',
            callee: last_expression,
            arguments: args,
            loc: contextToLocation(ctx)
          }
          i += 3
          break
        case '[':
          expression = {
            type: 'UnaryExpression',
            operator: '*',
            argument: {
              type: 'BinaryExpression',
              operator: '+',
              left: last_expression,
              right: this.visit(ctx.getChild(i + 1) as ExpressionContext),
            }
          }
          i += 3
          break
        default:
          break
      }
      last_expression = expression
    }
    return expression
  }

  visitIdentifier(ctx: IdentifierContext): es.Identifier {
    return {
      type: 'Identifier',
      name: ctx.text,
      loc: contextToLocation(ctx)
    }
  }

  visitConstant(ctx: ConstantContext): es.Literal {
    return {
      type: 'Literal',
      value: parseRawConstant(ctx.text),
      raw: ctx.text,
      loc: contextToLocation(ctx)
    }
  }

  visitStringLiteral(ctx: StringLiteralContext): es.Literal {
    return {
      type: 'Literal',
      value: ctx.text.slice(1, -1),
      raw: ctx.text,
      loc: contextToLocation(ctx)
    }
  }

  visitParentheses(ctx: ParenthesesContext): es.Expression {
    return this.visit(ctx.expression())
  }
}


function convertSource(program: ProgramContext): es.Program {
  const generator = new ProgramGenerator()
  return program.accept(generator)
}

export function parse(source: string, context: Context) {
  let program: es.Program | undefined
  if (context.variant === 'C') {
    const inputStream = CharStreams.fromString(source)
    const lexer = new CLexer(inputStream)
    const tokenStream = new CommonTokenStream(lexer)
    const parser = new CParser(tokenStream)
    parser.buildParseTree = true
    try {
      const tree = parser.program()
      program = convertSource(tree)
    } catch (error) {
      if (error instanceof FatalSyntaxError) {
        context.errors.push(error)
      } else {
        throw error
      }
    }
    const hasErrors = context.errors.find(m => m.severity === ErrorSeverity.ERROR)
    if (program && !hasErrors) {
      return program
    } else {
      return undefined
    }
  } else {
    return undefined
  }
}
