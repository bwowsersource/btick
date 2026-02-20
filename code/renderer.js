const { functionize, findFirstDuplicateKey, awaitSeries } = require("./utils");
const { CAPTURE_END, CAPTURE_START, CAPTURED, COMMENT_CLOSE, TOKEN_CAPTURE_END, TOKEN_CAPTURE_START } = require('./consts');
const { dumpData } = require('./utils');

let currentFile = "someFileName";
const keepArtifacts = (type, data) => {
    dumpData(currentFile, type, data);
}

function getTokenCapturer() {
    const openGroups = []
    const analyzeTokens = (statementVal, statementFn, nextSeg, pos) => {

        const markers = statementVal?.markers;
        const marked = (markers && Array.isArray(markers) && !!markers.length);

        if (!marked && openGroups.length) { //group open and not marked => capture
            const group = openGroups[openGroups.length - 1];
            group.tokens.push([statementFn, nextSeg]);
            return true;
        }

        if (marked) {
            if (openGroups.length && (markers.includes(TOKEN_CAPTURE_END))) {
                const tokenGroup = statementFn();
                const { tokens } = openGroups.pop();
                const segments = tokens.map(([_, seg]) => seg);
                const statementFns = tokens.map(([statement]) => statement);
                const groupOpener = statementFns.shift(); //  1st statement is group opening. Re-run it to run with `ctx` for any functions involved
                const groupStatementFn = tokenGroup(segments, statementFns, groupOpener);
                if (!openGroups.length) { // root of nest
                    return groupStatementFn;
                } else {
                    const parent = openGroups[openGroups.length - 1];
                    parent.tokens.push([groupStatementFn, nextSeg])
                }
            }
            if (markers.includes(TOKEN_CAPTURE_START)) {
                openGroups.push({ start: pos, tokens: [[statementFn, nextSeg]] })
            }
            return true;
        }
        return false;
    }
    return analyzeTokens;
}

function newCtxContext(seedCtx = {}) {
    const { const: consts = {}, ...vars } = seedCtx;
    const getCtx = () => ({ ...vars, ...consts });

    const evalArg = async (arg, readonly) => {
        const val = (typeof arg === 'function') ? arg(getCtx()) : arg;
        const result = await val;
        if (
            !readonly &&
            typeof result === "object" &&
            ({}.toString() === String(result)) // true => result doesn't have a custom `toString`
        ) {
            // set scopeVars
            const { const: constCandidates = {}, ...varCandidates } = result;

            const constExists = findFirstDuplicateKey(consts, { ...varCandidates, ...constCandidates });
            if (constExists) throw new ConstReInit(constExists);

            Object.assign(consts, constCandidates);
            Object.assign(vars, varCandidates);
        } else if (result !== undefined && result !== null && result !== false) return String(result);
        return null;
    }
    return { evalArg, getCtx };
}



async function executeStatements(statementFns, seedCtx = {}, globals) {
    const { evalArg, getCtx } = newCtxContext(seedCtx);

    const values = await awaitSeries(statementFns, async (statementFn, i) => {
        const arg = await statementFn({ ...globals, ctx: getCtx() });
        return await evalArg(arg);
    });

    return { ctx: getCtx(), values };
}

function interpolate(segments, vals) {
    // prepare

    function getGlue(out, i) {
        const val = out[i - 1];
        if (typeof val === "symbol") return "SYMBOL"
        if (!val) return '';
        return val;
    }
    return segments.reduce((seg1, seg2, i) => seg1 + getGlue(vals, i) + seg2);
}


async function renderParsedTokens({ segments, statementFns, context = {} }) {

    const out = await executeStatements(statementFns, context.ctx || {}, context);
    const text = interpolate(segments, out.values);
    return {
        text,
        ctx: out.ctx,
    };
}

async function renderTokens({ segments, statements, statementPreVals, context = {} }) {
    const analyzeToken = getTokenCapturer();

    const pairedStatements = [[null, segments[0]]];
    statements.forEach((statement, i) => {
        const nextSeg = segments[i + 1];
        const preVal = statementPreVals[i];
        const statementFn = functionize('return ' + statement, context);
        const isCaptured = analyzeToken(preVal, statementFn, nextSeg, i, statement);
        if (!isCaptured) {
            pairedStatements.push([statementFn, nextSeg])
        } else if (typeof isCaptured === "function") {
            pairedStatements.push([isCaptured, nextSeg])
        }
        return false;
    })
    const statementFns = pairedStatements.map(([fn]) => fn);
    statementFns.shift(); // first value is null

    const groupedSegments = pairedStatements.map(([_, seg]) => seg);
    return await renderParsedTokens({ statementFns, segments: groupedSegments, context });

}

module.exports = {
    renderTokens,
    renderParsedTokens,
}