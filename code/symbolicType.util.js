

const marker = Symbol();
function symbolicType() {
    let type = "unknown";
    let value = undefined;
    let targetObj = Object.assign(function Symbolic() { }, { [marker]: true });

    const recordAccess = (accessType, input) => {
        if ('apply' === accessType || 'construct' === accessType) {
            type = ({ 'apply': 'function', 'construct': 'class' })[accessType]
            value = () => symbolicType();
            return value();
        }
        if (accessType === "get" || accessType === "set") {
            const [key, val] = input;
            if ("__typeDef" === key) return { type, targetObj }
            if ("unknown" === type) {
                type = 'object'
            } else if ("get" === accessType && targetObj[key]) return targetObj[key];
            const value = symbolicType();
            targetObj = Object.assign(targetObj, { [key]: value })
            return value;
        }

    }
    return new Proxy(targetObj, {
        apply: () => recordAccess('apply'),
        construct: () => recordAccess('construct'),
        get: (t, key) => recordAccess('get', [key, null]),
        set: (t, key, val) => recordAccess('get', [key, val]),
        defineProperty: (t, key, { value }) => recordAccess('get', [key, value]),

        getOwnPropertyDescriptor: (t, key) => Object.getOwnPropertyDescriptor(t, key),
        deleteProperty: (t, key) => Object.deleteProperty(t.value, key),
        getPrototypeOf: () => symbolicType,

    });
}
const symbolicCtx = symbolicType();
module.exports = {
    symbolicCtx,
    isSymbolic(val) {
        return !!Object.getOwnPropertyDescriptor(val||{},marker)
    }
};