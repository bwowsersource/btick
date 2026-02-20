# btick

`btick` is a [JavaScript template-literal](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals) preprocessor for Node.js.

It evaluates `.jsml` templates and produces rendered text (example: HTML), while supporting:

- inline JavaScript expressions
- async template values
- mutable and immutable template scope (`const`)
- capture groups for custom block rendering (loops/repetition)

## Installation

### Global CLI

```bash
npm install -g btick
```

### Local project dependency

```bash
npm install btick
```

## CLI usage

The package exposes the CLI command `btick`:

```bash
btick <template-file> [args-json]
```

- `<template-file>`: required path to your template (for example, `.jsml`)
- `[args-json]`: optional JSON file whose content becomes template globals

### Examples

Minimal example:

```bash
btick resources/minimal.jsml resources/minimal.args.json
```

`resources/minimal.jsml`:

```js
<h1>Hello ${name}</h1>
<p>2 + 3 = ${2 + 3}</p>
```

`resources/minimal.args.json`:

```json
{
	"name": "World"
}
```

Render the bundled sample:

```bash
btick resources/example.jsml resources/args.json
```

Write output to a file:

```bash
btick resources/example.jsml resources/args.json > output.html
```

Run without global install:

```bash
node ./bin/index.js resources/example.jsml resources/args.json
```

Stream args through `stdin`
```bash
echo '{"name": "echo"}' | node ./bin/index.js resources/example.jsml
```

## Template basics

Templates are plain text with `${...}` expressions.

```js
<h1>Hello ${args.name}</h1>
<p>Time: ${new Date().toISOString()}</p>
```

Expressions can return:

- strings/numbers/booleans (rendered as text)
- promises (awaited)
- objects (used to update template scope)

### Scope updates

Return an object to set scope variables:

```js
${{ title: "Welcome" }}
<h1>${({ title }) => title}</h1>
```

Return `{ const: {...} }` to define immutable scope values:

```js
${{ const: { appName: "btick" } }}
<p>${({ appName }) => appName}</p>
```

Attempting to reassign a `const` key throws an error.

## Node API

```js
const fs = require('fs');
const btick = require('btick');

async function main() {
	const template = fs.readFileSync('./resources/example.jsml', 'utf8');
	const globals = { args: { name: { morning: 'Akash', evening: 'Webcrafti' } } };

	const { text, ctx, render } = await btick(template, globals);

	console.log(text);
	console.log(ctx);

	// Re-render with updated context state
	const rerendered = await render({ ...ctx, extra: 'value' });
	console.log(rerendered.text);
}

main();
```

### Exported helpers

- `btick.groom(str)`: escapes raw backticks in template text
- `btick.createCaptureGroup(handler?)`: create custom capture group markers
- `btick.captureGroupEnd`: helper marker for capture group termination

## Local example server

Start the included demo server:

```bash
npm run serve
```

Then open:

```text
http://localhost:8083/example
```

The server reads templates from `resources/*.jsml`.

## Project structure

- `bin/index.js`: CLI entrypoint (`btick`)
- `code/index.js`: main compiler/renderer API
- `code/server.js`: demo HTTP server
- `resources/example.jsml`: sample template
- `resources/args.json`: sample input args
