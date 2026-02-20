const { ConstReInit, processedError } = require('./errors');
const { awaitSeries, dumpData, functionize, findFirstDuplicateKey } = require('./utils');
const { createCaptureControls } = require('./captureGroups');
const { CAPTURE_END, CAPTURE_START, CAPTURED, COMMENT_CLOSE, } = require('./consts');
const { renderTokens } = require('./renderer');
const { symbolicCtx, isSymbolic } = require('./symbolicType.util');


const SOURCEFILE_STUB = "template.jsml";

let currentFile = "someFileName";
/**
 * Persists intermediate artifacts for debugging or inspection.
 * @example keepArtifacts('tokens', { segments: [] })
 *
 * @param {string} type - Artifact category.
 * @param {unknown} data - Artifact payload.
 * @returns {void}
 */
const keepArtifacts = (type, data) => {
    dumpData(currentFile, type, data)
}

/**
 * Creates the runtime template tag function used to evaluate template segments.
 * @example const tagFn = makeTagFn();
 *
 * @returns {(segments: TemplateStringsArray, ...args: unknown[]) => { text: string, ctx: Record<string, unknown>, toString: () => string }}
 */
const makeTagFn = () => (segments, ...args) => {

    // const fnArgs = args.filter(arg => (typeof arg === 'function'));

    const moduleScopeVars = {};
    const moduleScopeConsts = {};
    try {

        const text = segments.reduce((seg1, seg2, index) => {
            const arg = args[index - 1];

            const scopeInjection = { ...moduleScopeVars, ...moduleScopeConsts };
            const val = (typeof arg === 'function') ? arg(scopeInjection, index) : arg;
            if (!val)
                return seg1 + seg2;
            if (typeof val === "string")
                return seg1 + val + seg2;
            if (
                typeof val === "object" &&
                ({}.toString() === val.toString()) // true => val doesn't have a custom toString
            ) {
                // set scopeVars
                const { const: constCandidates = {}, ...mutableVarCandidates } = val;

                const constExists = findFirstDuplicateKey(moduleScopeConsts, { ...mutableVarCandidates, ...constCandidates });
                if (constExists) throw new ConstReInit(constExists);

                Object.assign(moduleScopeConsts, constCandidates);
                Object.assign(moduleScopeVars, mutableVarCandidates);
                return seg1 + seg2; // don't append val
            }

            // if not returned by now, return string
            return seg1 + String(val) + seg2;

        });
        return { text, ctx: { ...moduleScopeVars, ...moduleScopeConsts }, toString: () => text }
    } catch (e) {
        throw processedError(e);
    }
}


/**
 * Escapes raw backtick characters in a string for safe template literal embedding.
 * @example escapeBackticks('a`b')
 *
 * @param {string} str - Input string.
 * @returns {string}
 */
function escapeBackticks(str) {
    const char = '`';
    const escapedChar = '${"`"}';
    const segments = str.split(char);
    const [out] = segments.reduce(([output, workingSeg], seg, i) => {
        const nextSeg = workingSeg + seg;
        try {
            Function('`' + nextSeg + '`');
            output.push(nextSeg);
            return [output, '']
        } catch (e) {
            return [output, workingSeg + seg + char];
        }
    }, [[], '']);

    return out.join(escapedChar);
}

/**
 * Builds a tokenizer tag function around a template source string.
 * @example const tagFactory = tokenizer('Hi ${name}')
 *
 * @param {string} [source=''] - Raw template source.
 * @returns {(...args: unknown[]) => () => { segments: string[], statements: string[], statementPreVals: unknown[] }}
 */
function tokenizer(source = '') {
    source = source.replaceAll(/\r\n/gi, '\n');

    const spyTagFn = (segs, ...args) => {
        const { statements } = args.reduce((state, arg, i) => {
            let segBefore = segs[i] + "${";
            let segAfter = "}" + segs[i + 1];
            let { remaining, statements } = state;

            const match = remaining.substring(0, segBefore.length);
            if (segBefore !== match) throw { statements, remaining: remaining.substring(0, 15) + '...', segBefore, match, segAfter, i };
            remaining = remaining.substring(segBefore.length);

            // find templateArg ending
            function findStatement(remaining, pos = 0) {
                const nextPos = remaining.indexOf(segAfter, pos + 1);
                if (nextPos == -1) throw { msg: "Failed to delimit: ", segAfter, pos, remaining: remaining.length + remaining.substring(129, segAfter.length) };
                const statementText = remaining.substring(0, nextPos);
                try {
                    // try creating a function that execute this statement as a template literal
                    Function("`${" + statementText + "}`");
                    return statementText;
                } catch (e) {
                    return findStatement(remaining, nextPos);
                }
            }

            const statement = findStatement(remaining, 0);
            remaining = remaining.substring(statement.length);
            if (remaining[0] !== '}') throw `Unexpected token ${remaining[0]} at ${source.length - remaining.length}`;
            remaining = remaining.substring(1); // strip the '}';
            statements.push(statement);

            return { remaining, statements };
        }, { remaining: source, statements: [] });

        return { segments: segs, statements, statementPreVals: args.map(arg => isSymbolic(arg) ? undefined : arg) };
    }


    return (...args) => () => {
        const out = spyTagFn(...args);
        keepArtifacts('tokens', out);
        return out;
    };
}


/**
 * Renders a JSML template with provided globals and development options.
 * @example await backtick('<h1>${name}</h1>', { name: 'World' })
 *
 * @param {string} template - Template source text.
 * @param {Record<string, unknown>} [globals={}] - Variables exposed to template scope.
 * @param {{ filename?: string }} [devOptions={ filename: SOURCEFILE_STUB }] - Render-time options.
 * @returns {Promise<{ output?: string, ctx?: Record<string, unknown>, render: (ctx: Record<string, unknown>) => Promise<unknown> }>} 
 */
const backtick = async (template, globals = {}, devOptions = {
    filename: SOURCEFILE_STUB
}) => {
    if (typeof globals !== "object") throw new Error("`globals` argument must be of type `object|undefined`");
    const tagFn = makeTagFn();
    const captureControls = createCaptureControls();
    const context = {
        ...globals,
        bt: tagFn,
        capture: captureControls,
        ctx: {},
    }


    // try {
    const tokenizerTagfn = tokenizer(template);
    const withBackticks = functionize(
        'return bt`' + template + '`; //# sourceURL=' + devOptions.filename,
        context
    );
    const tokenizeTemplate = withBackticks({ ...context, ctx: symbolicCtx, bt: tokenizerTagfn });
    const tokens = tokenizeTemplate();

    const out = await renderTokens({ ...tokens, context });
    return {
        ...out,
        render: ctx => renderTokens({
            ...tokens, context: { ...context, ...ctx }
        })
    }
    // return tagFn(tokens.segments, ...(tokens.statements).map(s => "${" + s + "}"))
    // return withBackticks(context)
    // } catch (e) {
    //     throw processedError(e, template, SOURCEFILE_STUB);
    // }
}

/**
 * Applies capture marker metadata onto a capture handler.
 * @example applyCaptureMarker(() => COMMENT_CLOSE, { open: CAPTURE_START })
 *
 * @param {Function & { captureMarker?: Record<string, string> }} handler - Capture handler function.
 * @param {Record<string, string>} newMarkers - Marker values to merge.
 * @returns {Function & { captureMarker: Record<string, string> }}
 */
function applyCaptureMarker(handler, newMarkers) {
    const markers = { ...handler.captureMarker, ...newMarkers }
    handler.captureMarker = markers;
    return handler;
}

/**
 * Creates a capture group opening handler.
 * @example const group = createCaptureGroup()
 *
 * @param {() => string} [handler=() => COMMENT_CLOSE] - Optional close marker handler.
 * @returns {Function & { captureMarker: Record<string, string> }}
 */
const createCaptureGroup = (handler = () => COMMENT_CLOSE) => {
    return applyCaptureMarker(handler, { open: CAPTURE_START });
};
backtick.groom = (str) => escapeBackticks(str);
backtick.createCaptureGroup = createCaptureGroup;
backtick.captureGroupEnd = { captureMarker: { close: CAPTURE_END } };

module.exports = backtick;