# `code/index.js` module walkthrough

This module exposes the main `backtick` renderer function and a few helper exports used by the template engine.

## What this module does

`code/index.js` takes a JSML template string, tokenizes template expressions, evaluates them with controlled runtime context, and renders final output through `renderTokens`.

At a high level, it performs four phases:

1. Build runtime context (`globals`, capture controls, context-state object).
2. Tokenize template content into segments + expression statements.
3. Render tokens asynchronously.
4. Return the render output plus a `render(ctx)` helper for re-rendering with updated context state.

## Main execution path (`backtick`)

The exported async function is:

```js
backtick(template, globals = {}, devOptions = { filename: SOURCEFILE_STUB })
```

### Step-by-step

1. **Input validation**
   - Verifies `globals` is an object.
   - Example:

```js
await backtick('Hello', { user: 'Ada' }) // ✅
await backtick('Hello', null) // ❌ throws (globals must be an object)
```

2. **Create runtime helpers**
   - `tagFn = makeTagFn()` creates the template-tag executor.
   - `captureControls = createCaptureControls()` provides capture markers/handlers.
   - Example:

```js
// Internal runtime pieces created before tokenization:
const tagFn = makeTagFn()
const captureControls = createCaptureControls()
```

3. **Build execution context**
   - Context includes:
     - user globals,
     - `bt` (tag function),
     - `capture` controls,
       - `ctx` (context state object).
   - Example:

```js
const context = {
   user: 'Ada',
   bt: tagFn,
   capture: captureControls,
   ctx: {}
}
```

4. **Prepare tokenizer path**
   - `tokenizerTagfn = tokenizer(template)` creates tokenizer tag behavior.
   - `functionize(...)` builds a function that evaluates `bt\`<template>\``.
   - A symbolic context object (`symbolicCtx`) is injected during tokenization so unresolved nested lookups don’t fail while parsing.
   - Example:

```js
const template = 'Hello ${ctx.profile.name}'
const tokenizerTagfn = tokenizer(template)
// symbolicCtx allows `ctx.profile.name` shape during parse, even if not yet real data
```

5. **Tokenize**
   - Executes the tokenization function to get:
     - `segments`
     - `statements`
     - `statementPreVals`
   - Example:

```js
// For template: "Hi ${user}!"
// tokens ~= {
//   segments: ['Hi ', '!'],
//   statements: ['user'],
//   statementPreVals: ['Ada']
// }
```

6. **Render**
   - Calls `renderTokens({ ...tokens, context })` to produce final output.
   - Example:

```js
// segments ['Hi ', '!'] + statement value 'Ada' => 'Hi Ada!'
const out = await renderTokens({ ...tokens, context })
```

7. **Return API**
   - Returns render output fields plus:

```js
render: ctx => renderTokens({ ...tokens, context: { ...context, ctx } })
```

This allows re-rendering from the same tokens with updated render context state (via `ctx`).

Example:

```js
const result = await backtick('Name: ${ctx.name}', {}, { filename: 'demo.jsml' })
await result.render({ name: 'Ada' })
await result.render({ name: 'Linus' })
// same tokenization, different context-state values
```

## Internal helpers in this file

### `makeTagFn()`

Creates the core tag function used to evaluate template literal arguments.

Behavior per interpolated value:

- **Function**: called with `(scopeInjection, index)`.
- **Falsy**: skipped (segment concatenation only).
- **String**: concatenated directly.
- **Plain object**: interpreted as scope mutations:
  - `{ const: {...} }` merged into immutable module constants.
  - other keys merged into mutable module variables.
  - duplicate `const` keys throw `ConstReInit`.
- **Other types**: converted with `String(val)`.

Returns an object:

```js
{ text, ctx, toString: () => text }
```

where `ctx` is the merged mutable + const module scope.

### `tokenizer(source)`

Builds an instrumented tag function to extract expression statements from the original template source.

It reconstructs each `${...}` body robustly (including nested/braced content) by repeatedly trying to compile candidate fragments with `Function("`${...}`")` until a valid delimiter is found.

Returns token data:

- `segments`: template literal static chunks
- `statements`: raw expression bodies as strings
- `statementPreVals`: original evaluated values except symbolic placeholders

Also emits token artifacts via `keepArtifacts('tokens', out)`.

### `escapeBackticks(str)`

Escapes raw backticks in plain text so they can be embedded into template literals safely.

### `applyCaptureMarker(handler, newMarkers)`

Attaches/merges capture marker metadata on a handler function via `handler.captureMarker`.

### `createCaptureGroup(handler)`

Marks a handler with opening capture metadata (`{ open: CAPTURE_START }`).

## Exported API from this module

`module.exports = backtick` with attached helpers:

- `backtick.groom(str)` → wraps `escapeBackticks`
- `backtick.createCaptureGroup(handler?)`
- `backtick.captureGroupEnd` → `{ captureMarker: { close: CAPTURE_END } }`

## Error handling

- `makeTagFn` wraps internal failures with `processedError`.
- Duplicate constant initialization triggers `ConstReInit`.
- Tokenizer throws detailed mismatch objects for delimiter/parsing failures.

## Debug/artifact behavior

`keepArtifacts(type, data)` delegates to `dumpData(currentFile, type, data)`.
Current file tracking uses `currentFile` module variable (default: `"someFileName"`).

## Notes on design

- Tokenization and rendering are intentionally split.
- Symbolic context support prevents parse-time crashes from deep context references.[^symbolic-context]
- Scope updates can happen from template expressions, enabling dynamic stateful rendering patterns.

## Context fields: defaults, usage, and customization

The runtime `context` passed through tokenization/rendering is built like this:

```js
const context = {
   ...globals,
   bt: tagFn,
   capture: captureControls,
   ctx: {}
}
```

### Standard fields

- `...globals`
   - **What is standard:** plain input data and helper values your template needs (for example `user`, `items`, `formatDate`).
   - **How it is used:** expression statements resolve names from this scope at render time.
   - **Example:** `await backtick('Hi ${user}', { user: 'Ada' })`.

- `bt`
   - **What is standard:** an internal tag function (`makeTagFn`) used to execute template-literal evaluation behavior.
   - **How it is used:** powers interpolation handling, scope mutation objects, and string coercion rules.
   - **Customization:** generally **not** user-supplied; it is replaced internally with tokenizer behavior during token extraction.

- `capture`
   - **What is standard:** control helpers from `createCaptureControls()`.
   - **How it is used:** coordinates capture groups/markers in templates and render flow.
   - **Customization:** extend behavior by using capture handlers (`backtick.createCaptureGroup(...)` and `backtick.captureGroupEnd`) rather than replacing `capture` directly.

- `ctx`
   - **What is standard:** mutable context-state object for template state (`{}` by default).
   - **How it is used:** templates can read/write context values and re-render with new context state by changing `ctx`.
   - **Example:** `result.render({ name: 'Ada' })` then `result.render({ name: 'Linus' })`.

### What should be customized most often

1. **Customize `globals` first**
    - Best place for app data and pure helpers.
    - Keep values serializable/simple where possible.

2. **Customize `ctx` per render call**
   - Use `render(ctx)` to provide updated context state between outputs without re-tokenizing.
    - Good for repeated renders of the same compiled template.

3. **Customize capture via provided APIs**
    - Prefer marker helpers over direct `context.capture` replacement.
    - Keeps compatibility with renderer/capture expectations.

### Practical guidance

- Treat `bt` and `capture` as engine-managed internals.
- Treat `globals` as your input model and helper surface.
- Treat `ctx` as render-time, replaceable state.
- `render(ctx)` updates the `ctx` field in render context; it does not replace the full context object.
- If names overlap (for example `globals.ctx`), engine fields defined later in `context` win.

[^symbolic-context]: During tokenization, the engine uses `symbolicCtx` as a safe placeholder so deep paths like `${ctx.user.profile.name}` can be parsed even before real render-time data exists.
