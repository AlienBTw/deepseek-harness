/**
 * repomap/queries.ts — Tree-sitter tag queries per language.
 *
 * These are direct ports of Aider's `aider/queries/{tree-sitter-language-pack,tree-sitter-languages}/*-tags.scm`
 * files. Only the `@name.definition.*` and `@name.reference.*` captures matter for
 * tag production (see repomap.py lines 317–324); the outer `@definition.*` / `@reference.*`
 * captures are kept for query validity but ignored by the tag extractor.
 *
 * web-tree-sitter's Query API supports these patterns. The `#strip!` / `#select-adjacent!`
 * predicates in some original queries affect doc-comment attachment, which Aider does not use
 * for tag production — they have been omitted for portability.
 */

export type SupportedLang =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'c'
  | 'cpp'
  | 'c_sharp'
  | 'java'
  | 'php'
  | 'ruby'
  | 'kotlin'
  | 'swift'

/** Map a file extension to a supported language (or null if unsupported). */
export function langForFile(rel_fname: string): SupportedLang | null {
  const lower = rel_fname.toLowerCase()
  if (lower.endsWith('.tsx')) return 'tsx'
  if (lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs'))
    return 'javascript'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.rs')) return 'rust'
  if (lower.endsWith('.go')) return 'go'
  if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c'
  if (
    lower.endsWith('.cpp') ||
    lower.endsWith('.hpp') ||
    lower.endsWith('.cc') ||
    lower.endsWith('.cxx') ||
    lower.endsWith('.hxx')
  )
    return 'cpp'
  if (lower.endsWith('.cs')) return 'c_sharp'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.php')) return 'php'
  if (lower.endsWith('.rb')) return 'ruby'
  if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'kotlin'
  if (lower.endsWith('.swift')) return 'swift'
  return null
}

/** The .scm query source for TypeScript (non-tsx). Ported from Aider's typescript-tags.scm. */
export const TYPESCRIPT_QUERY = `
(function_signature
  name: (identifier) @name.definition.function) @definition.function

(method_signature
  name: (property_identifier) @name.definition.method) @definition.method

(abstract_method_signature
  name: (property_identifier) @name.definition.method) @definition.method

(abstract_class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(module
  name: (identifier) @name.definition.module) @definition.module

(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(type_annotation
  (type_identifier) @name.reference.type) @reference.type

(new_expression
  constructor: (identifier) @name.reference.class) @reference.class

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum
`

/** TSX uses the TypeScript grammar but allows JSX. Same query works. */
export const TSX_QUERY = TYPESCRIPT_QUERY

/** JavaScript query. Ported from Aider's javascript-tags.scm (predicates stripped). */
export const JAVASCRIPT_QUERY = `
(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(class
  name: (identifier) @name.definition.class) @definition.class

(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(function_expression
  name: (identifier) @name.definition.function) @definition.function

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(generator_function
  name: (identifier) @name.definition.function) @definition.function

(generator_function_declaration
  name: (identifier) @name.definition.function) @definition.function

(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

(assignment_expression
  left: [
    (identifier) @name.definition.function
    (member_expression
      property: (property_identifier) @name.definition.function)
  ]
  right: [(arrow_function) (function_expression)]) @definition.function

(pair
  key: (property_identifier) @name.definition.function
  value: [(arrow_function) (function_expression)]) @definition.function

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference.call)
  arguments: (_) @reference.call) @reference.call

(new_expression
  constructor: (_) @name.reference.class) @reference.class
`

/** Python query. Ported from Aider's python-tags.scm. */
export const PYTHON_QUERY = `
(module (expression_statement (assignment left: (identifier) @name.definition.constant) @definition.constant))

(class_definition
  name: (identifier) @name.definition.class) @definition.class

(function_definition
  name: (identifier) @name.definition.function) @definition.function

(call
  function: [
      (identifier) @name.reference.call
      (attribute
        attribute: (identifier) @name.reference.call)
  ]) @reference.call
`

/** Rust query. Ported from Aider's rust-tags.scm. */
export const RUST_QUERY = `
(struct_item
  name: (type_identifier) @name.definition.class) @definition.class

(enum_item
  name: (type_identifier) @name.definition.class) @definition.class

(union_item
  name: (type_identifier) @name.definition.class) @definition.class

(type_item
  name: (type_identifier) @name.definition.class) @definition.class

(declaration_list
  (function_item
    name: (identifier) @name.definition.method)) @definition.method

(function_item
  name: (identifier) @name.definition.function) @definition.function

(trait_item
  name: (type_identifier) @name.definition.interface) @definition.interface

(mod_item
  name: (identifier) @name.definition.module) @definition.module

(macro_definition
  name: (identifier) @name.definition.macro) @definition.macro

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (field_expression
    field: (field_identifier) @name.reference.call)) @reference.call

(macro_invocation
  macro: (identifier) @name.reference.call) @reference.call

(impl_item
  trait: (type_identifier) @name.reference.implementation) @reference.implementation

(impl_item
  type: (type_identifier) @name.reference.implementation
  !trait) @reference.implementation
`

/** Go query. Ported from Aider's go-tags.scm (predicates stripped). */
export const GO_QUERY = `
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_declaration
  name: (field_identifier) @name.definition.method) @definition.method

(call_expression
  function: [
    (identifier) @name.reference.call
    (parenthesized_expression (identifier) @name.reference.call)
    (selector_expression field: (field_identifier) @name.reference.call)
    (parenthesized_expression (selector_expression field: (field_identifier) @name.reference.call))
  ]) @reference.call

(type_spec
  name: (type_identifier) @name.definition.type) @definition.type

(type_identifier) @name.reference.type

(package_clause "package" (package_identifier) @name.definition.module)

(import_declaration (import_spec) @name.reference.module)

(var_declaration (var_spec name: (identifier) @name.definition.variable))

(const_declaration (const_spec name: (identifier) @name.definition.constant))
`

/** C query. */
export const C_QUERY = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name.definition.function)) @definition.function

(declaration
  declarator: (function_declarator
    declarator: (identifier) @name.definition.function)) @definition.function

(struct_specifier
  name: (type_identifier) @name.definition.class) @definition.class

(enum_specifier
  name: (type_identifier) @name.definition.enum) @definition.enum

(type_definition
  declarator: (type_identifier) @name.definition.type) @definition.type

(call_expression
  function: (identifier) @name.reference.call) @reference.call
`

/** C++ query. */
export const CPP_QUERY = `
(function_definition
  declarator: (function_declarator
    declarator: [(identifier) (field_identifier)] @name.definition.function)) @definition.function

(class_specifier
  name: (type_identifier) @name.definition.class) @definition.class

(struct_specifier
  name: (type_identifier) @name.definition.class) @definition.class

(namespace_definition
  name: (identifier) @name.definition.module) @definition.module

(call_expression
  function: [(identifier) (field_expression)] @name.reference.call) @reference.call
`

/** C# query. */
export const C_SHARP_QUERY = `
(method_declaration
  name: (identifier) @name.definition.method) @definition.method

(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

(struct_declaration
  name: (identifier) @name.definition.class) @definition.class

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

(invocation_expression
  function: [(identifier) (member_access_expression)] @name.reference.call) @reference.call
`

/** Java query. */
export const JAVA_QUERY = `
(method_declaration
  name: (identifier) @name.definition.method) @definition.method

(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

(method_invocation
  name: (identifier) @name.reference.call) @reference.call

(type_identifier) @name.reference.type
`

/** PHP query. */
export const PHP_QUERY = `
(function_definition
  name: (name) @name.definition.function) @definition.function

(method_declaration
  name: (name) @name.definition.method) @definition.method

(class_declaration
  name: (name) @name.definition.class) @definition.class

(interface_declaration
  name: (name) @name.definition.interface) @definition.interface

(function_call_expression
  function: [(name) (member_call_expression)] @name.reference.call) @reference.call
`

/** Ruby query. */
export const RUBY_QUERY = `
(method
  name: (identifier) @name.definition.method) @definition.method

(singleton_method
  name: (identifier) @name.definition.method) @definition.method

(class
  name: [(constant) (scope_resolution)] @name.definition.class) @definition.class

(module
  name: [(constant) (scope_resolution)] @name.definition.module) @definition.module

(call
  method: (identifier) @name.reference.call) @reference.call
`

/** Kotlin query. */
export const KOTLIN_QUERY = `
(function_declaration
  name: (simple_identifier) @name.definition.function) @definition.function

(class_declaration
  name: (simple_identifier) @name.definition.class) @definition.class

(call_expression
  [(simple_identifier) (navigation_expression)] @name.reference.call) @reference.call
`

/** Swift query. */
export const SWIFT_QUERY = `
(function_declaration
  name: (simple_identifier) @name.definition.function) @definition.function

(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(protocol_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(struct_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(call_expression
  [(simple_identifier) (navigation_expression)] @name.reference.call) @reference.call
`

/** Get the query source for a language. */
export function queryForLang(lang: SupportedLang): string {
  switch (lang) {
    case 'typescript':
      return TYPESCRIPT_QUERY
    case 'tsx':
      return TSX_QUERY
    case 'javascript':
      return JAVASCRIPT_QUERY
    case 'python':
      return PYTHON_QUERY
    case 'rust':
      return RUST_QUERY
    case 'go':
      return GO_QUERY
    case 'c':
      return C_QUERY
    case 'cpp':
      return CPP_QUERY
    case 'c_sharp':
      return C_SHARP_QUERY
    case 'java':
      return JAVA_QUERY
    case 'php':
      return PHP_QUERY
    case 'ruby':
      return RUBY_QUERY
    case 'kotlin':
      return KOTLIN_QUERY
    case 'swift':
      return SWIFT_QUERY
  }
}
