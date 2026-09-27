// @bun
// ../node_modules/zod/v4/core/core.js
var _a;
function $constructor(name, initializer, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: new Set
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0;i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");

class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// ../node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object, key, getter) {
  let value = undefined;
  Object.defineProperty(object, key, {
    get() {
      if (value === EVALUATING) {
        return;
      }
      if (value === undefined) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
      });
    },
    configurable: true
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== undefined) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function merge(a, b) {
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}

// ../node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error, path = []) => {
    for (const issue of error.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// ../node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// ../node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// ../node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst) => {
    var _a;
    (_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = new Set);
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join(`
`));
  }
}

// ../node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 4,
  patch: 3
};

// ../node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary) => {
            return handleCanaryResult(canary, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort
          });
          return;
        }
      }
      const url = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error;
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error;
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error;
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error;
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: undefined,
        path: [key]
      });
    }
    return;
  }
  if (result.value === undefined) {
    if (isPresent) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__")
      continue;
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = new Set);
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleUnionResults(results, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left, right]) => {
        return handleIntersectionResults(payload, left, right);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = new Map;
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  if (def.values.length === 0) {
    throw new Error("Cannot create literal schema with no valid values");
  }
  const values = new Set(def.values);
  inst._zod.values = values;
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    payload.fallback = true;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (input === undefined && (result.issues.length || result.fallback)) {
    return { issues: [], value: undefined };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, undefined]) : undefined;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const input = payload.value;
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, input));
      return handleOptionalResult(result, input);
    }
    if (payload.value === undefined) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleDefaultResult(result, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleNonOptionalResult(result, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => {
        payload.value = result.value;
        if (result.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
          payload.fallback = true;
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
      payload.fallback = true;
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues, fallback: left.fallback }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r) => handleRefineResult(r, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// ../node_modules/zod/v4/core/registries.js
var _a2;
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");

class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// ../node_modules/zod/v4/core/api.js
function _string(Class, params) {
  return new Class({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class, params) {
  return new Class({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
}
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn, params) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// ../node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: new Map,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? undefined
  };
}
function process2(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process2(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    Object.assign(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = new Map;
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema = seen.schema;
    for (const key in schema) {
      delete schema[key];
    }
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema = seen.def ?? seen.schema;
    const _cached = { ...schema };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema.allOf = schema.allOf ?? [];
        schema.allOf.push(refSchema);
      } else {
        Object.assign(schema, refSchema);
      }
      Object.assign(schema, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {}
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== undefined && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      if (seen.def.id === seen.defId)
        delete seen.def.id;
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {} else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// ../node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
};
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time") {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1)
      json.pattern = regexes[0].source;
    else if (regexes.length > 1) {
      json.allOf = [
        ...regexes.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json.type = "integer";
  else
    json.type = "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (typeof multipleOf === "number")
    json.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, _params) => {
  const def = schema._zod.def;
  const vals = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (ctx.unrepresentable === "throw") {
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
      }
    } else if (typeof val === "bigint") {
      if (ctx.unrepresentable === "throw") {
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      } else {
        vals.push(Number(val));
      }
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {} else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = process2(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  json.properties = {};
  const shape = def.shape;
  for (const key in shape) {
    json.properties[key] = process2(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    });
  }
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set([...allKeys].filter((key) => {
    const v = def.shape[key]._zod;
    if (ctx.io === "input") {
      return v.optin === undefined;
    } else {
      return v.optout === undefined;
    }
  }));
  if (requiredKeys.size > 0) {
    json.required = Array.from(requiredKeys);
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = process2(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = process2(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process2(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// ../node_modules/zod/v4/classic/iso.js
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// ../node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
    },
    addIssue: {
      value: (issue) => {
        inst.issues.push(issue);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    addIssues: {
      value: (issues) => {
        inst.issues.push(...issues);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, {
  Parent: Error
});

// ../node_modules/zod/v4/classic/parse.js
var parse3 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap;
function _installLazyMethods(inst, group, methods) {
  const proto = Object.getPrototypeOf(inst);
  let installed = _installedGroups.get(proto);
  if (!installed) {
    installed = new Set;
    _installedGroups.set(proto, installed);
  }
  if (installed.has(group))
    return;
  installed.add(group);
  for (const key in methods) {
    const fn = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: false,
      get() {
        const bound = fn.bind(this);
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: bound
        });
        return bound;
      },
      set(v) {
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: v
        });
      }
    });
  }
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.parse = (data, params) => parse3(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode(inst, data, params);
  inst.decode = (data, params) => decode(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
  _installLazyMethods(inst, "ZodType", {
    check(...chks) {
      const def = this.def;
      return this.clone(mergeDefs(def, {
        checks: [
          ...def.checks ?? [],
          ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }), { parent: true });
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def, params) {
      return clone(this, def, params);
    },
    brand() {
      return this;
    },
    register(reg, meta) {
      reg.add(this, meta);
      return this;
    },
    refine(check, params) {
      return this.check(refine(check, params));
    },
    superRefine(refinement, params) {
      return this.check(superRefine(refinement, params));
    },
    overwrite(fn) {
      return this.check(_overwrite(fn));
    },
    optional() {
      return optional(this);
    },
    exactOptional() {
      return exactOptional(this);
    },
    nullable() {
      return nullable(this);
    },
    nullish() {
      return optional(nullable(this));
    },
    nonoptional(params) {
      return nonoptional(this, params);
    },
    array() {
      return array(this);
    },
    or(arg) {
      return union([this, arg]);
    },
    and(arg) {
      return intersection(this, arg);
    },
    transform(tx) {
      return pipe(this, transform(tx));
    },
    default(d) {
      return _default(this, d);
    },
    prefault(d) {
      return prefault(this, d);
    },
    catch(params) {
      return _catch(this, params);
    },
    pipe(target) {
      return pipe(this, target);
    },
    readonly() {
      return readonly(this);
    },
    describe(description) {
      const cl = this.clone();
      globalRegistry.add(cl, { description });
      return cl;
    },
    meta(...args) {
      if (args.length === 0)
        return globalRegistry.get(this);
      const cl = this.clone();
      globalRegistry.add(cl, args[0]);
      return cl;
    },
    isOptional() {
      return this.safeParse(undefined).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(fn) {
      return fn(this);
    }
  });
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  _installLazyMethods(inst, "_ZodString", {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  });
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
  _installLazyMethods(inst, "ZodNumber", {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  });
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
  _installLazyMethods(inst, "ZodArray", {
    min(n, params) {
      return this.check(_minLength(n, params));
    },
    nonempty(params) {
      return this.check(_minLength(1, params));
    },
    max(n, params) {
      return this.check(_maxLength(n, params));
    },
    length(n, params) {
      return this.check(_length(n, params));
    },
    unwrap() {
      return this.element;
    }
  });
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  defineLazy(inst, "shape", () => {
    return def.shape;
  });
  _installLazyMethods(inst, "ZodObject", {
    keyof() {
      return _enum(Object.keys(this._zod.def.shape));
    },
    catchall(catchall) {
      return this.clone({ ...this._zod.def, catchall });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: never() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: undefined });
    },
    extend(incoming) {
      return extend(this, incoming);
    },
    safeExtend(incoming) {
      return safeExtend(this, incoming);
    },
    merge(other) {
      return merge(this, other);
    },
    pick(mask) {
      return pick(this, mask);
    },
    omit(mask) {
      return omit(this, mask);
    },
    partial(...args) {
      return partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return required(ZodNonOptional, this, args[0]);
    }
  });
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    }
    payload.value = output;
    payload.fallback = true;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
// ../node_modules/@hatch/space-sdk/dist/server-contract.js
var PRIVILEGED_CONTRACT_BRAND = "@hatch/space-sdk/privileged-contract/v1";
function definePrivilegedContracts(specs) {
  const contracts = {};
  for (const [name, spec] of Object.entries(specs)) {
    contracts[name] = {
      __brand: PRIVILEGED_CONTRACT_BRAND,
      name,
      request: spec.request,
      response: spec.response,
      ...spec.capabilities !== undefined ? { capabilities: spec.capabilities } : {},
      ...spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}
    };
  }
  return contracts;
}
var ACTION_BRAND = "@hatch/space-sdk/action/v1";
var LEGACY_ACTION_BRAND = Symbol.for("@hatch/space-sdk/action");
function createDefineAction() {
  return function defineAction(spec) {
    return {
      __brand: ACTION_BRAND,
      request: spec.request,
      response: spec.response,
      ...spec.privileged !== undefined ? { privileged: spec.privileged } : {},
      handler: spec.handler
    };
  };
}
// ../node_modules/@hatch/space-sdk/dist/index.js
var defineAction = createDefineAction();

// ../node_modules/drizzle-orm/entity.js
var entityKind = Symbol.for("drizzle:entityKind");
var hasOwnEntityKind = Symbol.for("drizzle:hasOwnEntityKind");
function is(value, type) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (value instanceof type) {
    return true;
  }
  if (!Object.prototype.hasOwnProperty.call(type, entityKind)) {
    throw new Error(`Class "${type.name ?? "<unknown>"}" doesn't look like a Drizzle entity. If this is incorrect and the class is provided by Drizzle, please report this as a bug.`);
  }
  let cls = Object.getPrototypeOf(value).constructor;
  if (cls) {
    while (cls) {
      if (entityKind in cls && cls[entityKind] === type[entityKind]) {
        return true;
      }
      cls = Object.getPrototypeOf(cls);
    }
  }
  return false;
}

// ../node_modules/drizzle-orm/column.js
class Column {
  constructor(table, config) {
    this.table = table;
    this.config = config;
    this.name = config.name;
    this.keyAsName = config.keyAsName;
    this.notNull = config.notNull;
    this.default = config.default;
    this.defaultFn = config.defaultFn;
    this.onUpdateFn = config.onUpdateFn;
    this.hasDefault = config.hasDefault;
    this.primary = config.primaryKey;
    this.isUnique = config.isUnique;
    this.uniqueName = config.uniqueName;
    this.uniqueType = config.uniqueType;
    this.dataType = config.dataType;
    this.columnType = config.columnType;
    this.generated = config.generated;
    this.generatedIdentity = config.generatedIdentity;
  }
  static [entityKind] = "Column";
  name;
  keyAsName;
  primary;
  notNull;
  default;
  defaultFn;
  onUpdateFn;
  hasDefault;
  isUnique;
  uniqueName;
  uniqueType;
  dataType;
  columnType;
  enumValues = undefined;
  generated = undefined;
  generatedIdentity = undefined;
  config;
  mapFromDriverValue(value) {
    return value;
  }
  mapToDriverValue(value) {
    return value;
  }
  shouldDisableInsert() {
    return this.config.generated !== undefined && this.config.generated.type !== "byDefault";
  }
}

// ../node_modules/drizzle-orm/column-builder.js
class ColumnBuilder {
  static [entityKind] = "ColumnBuilder";
  config;
  constructor(name, dataType, columnType) {
    this.config = {
      name,
      keyAsName: name === "",
      notNull: false,
      default: undefined,
      hasDefault: false,
      primaryKey: false,
      isUnique: false,
      uniqueName: undefined,
      uniqueType: undefined,
      dataType,
      columnType,
      generated: undefined
    };
  }
  $type() {
    return this;
  }
  notNull() {
    this.config.notNull = true;
    return this;
  }
  default(value) {
    this.config.default = value;
    this.config.hasDefault = true;
    return this;
  }
  $defaultFn(fn) {
    this.config.defaultFn = fn;
    this.config.hasDefault = true;
    return this;
  }
  $default = this.$defaultFn;
  $onUpdateFn(fn) {
    this.config.onUpdateFn = fn;
    this.config.hasDefault = true;
    return this;
  }
  $onUpdate = this.$onUpdateFn;
  primaryKey() {
    this.config.primaryKey = true;
    this.config.notNull = true;
    return this;
  }
  setName(name) {
    if (this.config.name !== "")
      return;
    this.config.name = name;
  }
}

// ../node_modules/drizzle-orm/table.utils.js
var TableName = Symbol.for("drizzle:Name");

// ../node_modules/drizzle-orm/tracing-utils.js
function iife(fn, ...args) {
  return fn(...args);
}

// ../node_modules/drizzle-orm/pg-core/columns/enum.js
var isPgEnumSym = Symbol.for("drizzle:isPgEnum");
function isPgEnum(obj) {
  return !!obj && typeof obj === "function" && isPgEnumSym in obj && obj[isPgEnumSym] === true;
}

// ../node_modules/drizzle-orm/subquery.js
class Subquery {
  static [entityKind] = "Subquery";
  constructor(sql, fields, alias, isWith = false, usedTables = []) {
    this._ = {
      brand: "Subquery",
      sql,
      selectedFields: fields,
      alias,
      isWith,
      usedTables
    };
  }
}

// ../node_modules/drizzle-orm/version.js
var version2 = "0.45.2";

// ../node_modules/drizzle-orm/tracing.js
var otel;
var rawTracer;
var tracer = {
  startActiveSpan(name, fn) {
    if (!otel) {
      return fn();
    }
    if (!rawTracer) {
      rawTracer = otel.trace.getTracer("drizzle-orm", version2);
    }
    return iife((otel2, rawTracer2) => rawTracer2.startActiveSpan(name, (span) => {
      try {
        return fn(span);
      } catch (e) {
        span.setStatus({
          code: otel2.SpanStatusCode.ERROR,
          message: e instanceof Error ? e.message : "Unknown error"
        });
        throw e;
      } finally {
        span.end();
      }
    }), otel, rawTracer);
  }
};

// ../node_modules/drizzle-orm/view-common.js
var ViewBaseConfig = Symbol.for("drizzle:ViewBaseConfig");

// ../node_modules/drizzle-orm/table.js
var Schema = Symbol.for("drizzle:Schema");
var Columns = Symbol.for("drizzle:Columns");
var ExtraConfigColumns = Symbol.for("drizzle:ExtraConfigColumns");
var OriginalName = Symbol.for("drizzle:OriginalName");
var BaseName = Symbol.for("drizzle:BaseName");
var IsAlias = Symbol.for("drizzle:IsAlias");
var ExtraConfigBuilder = Symbol.for("drizzle:ExtraConfigBuilder");
var IsDrizzleTable = Symbol.for("drizzle:IsDrizzleTable");

class Table {
  static [entityKind] = "Table";
  static Symbol = {
    Name: TableName,
    Schema,
    OriginalName,
    Columns,
    ExtraConfigColumns,
    BaseName,
    IsAlias,
    ExtraConfigBuilder
  };
  [TableName];
  [OriginalName];
  [Schema];
  [Columns];
  [ExtraConfigColumns];
  [BaseName];
  [IsAlias] = false;
  [IsDrizzleTable] = true;
  [ExtraConfigBuilder] = undefined;
  constructor(name, schema, baseName) {
    this[TableName] = this[OriginalName] = name;
    this[Schema] = schema;
    this[BaseName] = baseName;
  }
}

// ../node_modules/drizzle-orm/sql/sql.js
function isSQLWrapper(value) {
  return value !== null && value !== undefined && typeof value.getSQL === "function";
}
function mergeQueries(queries) {
  const result = { sql: "", params: [] };
  for (const query of queries) {
    result.sql += query.sql;
    result.params.push(...query.params);
    if (query.typings?.length) {
      if (!result.typings) {
        result.typings = [];
      }
      result.typings.push(...query.typings);
    }
  }
  return result;
}

class StringChunk {
  static [entityKind] = "StringChunk";
  value;
  constructor(value) {
    this.value = Array.isArray(value) ? value : [value];
  }
  getSQL() {
    return new SQL([this]);
  }
}

class SQL {
  constructor(queryChunks) {
    this.queryChunks = queryChunks;
    for (const chunk of queryChunks) {
      if (is(chunk, Table)) {
        const schemaName = chunk[Table.Symbol.Schema];
        this.usedTables.push(schemaName === undefined ? chunk[Table.Symbol.Name] : schemaName + "." + chunk[Table.Symbol.Name]);
      }
    }
  }
  static [entityKind] = "SQL";
  decoder = noopDecoder;
  shouldInlineParams = false;
  usedTables = [];
  append(query) {
    this.queryChunks.push(...query.queryChunks);
    return this;
  }
  toQuery(config) {
    return tracer.startActiveSpan("drizzle.buildSQL", (span) => {
      const query = this.buildQueryFromSourceParams(this.queryChunks, config);
      span?.setAttributes({
        "drizzle.query.text": query.sql,
        "drizzle.query.params": JSON.stringify(query.params)
      });
      return query;
    });
  }
  buildQueryFromSourceParams(chunks, _config) {
    const config = Object.assign({}, _config, {
      inlineParams: _config.inlineParams || this.shouldInlineParams,
      paramStartIndex: _config.paramStartIndex || { value: 0 }
    });
    const {
      casing,
      escapeName,
      escapeParam,
      prepareTyping,
      inlineParams,
      paramStartIndex
    } = config;
    return mergeQueries(chunks.map((chunk) => {
      if (is(chunk, StringChunk)) {
        return { sql: chunk.value.join(""), params: [] };
      }
      if (is(chunk, Name)) {
        return { sql: escapeName(chunk.value), params: [] };
      }
      if (chunk === undefined) {
        return { sql: "", params: [] };
      }
      if (Array.isArray(chunk)) {
        const result = [new StringChunk("(")];
        for (const [i, p] of chunk.entries()) {
          result.push(p);
          if (i < chunk.length - 1) {
            result.push(new StringChunk(", "));
          }
        }
        result.push(new StringChunk(")"));
        return this.buildQueryFromSourceParams(result, config);
      }
      if (is(chunk, SQL)) {
        return this.buildQueryFromSourceParams(chunk.queryChunks, {
          ...config,
          inlineParams: inlineParams || chunk.shouldInlineParams
        });
      }
      if (is(chunk, Table)) {
        const schemaName = chunk[Table.Symbol.Schema];
        const tableName = chunk[Table.Symbol.Name];
        return {
          sql: schemaName === undefined || chunk[IsAlias] ? escapeName(tableName) : escapeName(schemaName) + "." + escapeName(tableName),
          params: []
        };
      }
      if (is(chunk, Column)) {
        const columnName = casing.getColumnCasing(chunk);
        if (_config.invokeSource === "indexes") {
          return { sql: escapeName(columnName), params: [] };
        }
        const schemaName = chunk.table[Table.Symbol.Schema];
        return {
          sql: chunk.table[IsAlias] || schemaName === undefined ? escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName) : escapeName(schemaName) + "." + escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName),
          params: []
        };
      }
      if (is(chunk, View)) {
        const schemaName = chunk[ViewBaseConfig].schema;
        const viewName = chunk[ViewBaseConfig].name;
        return {
          sql: schemaName === undefined || chunk[ViewBaseConfig].isAlias ? escapeName(viewName) : escapeName(schemaName) + "." + escapeName(viewName),
          params: []
        };
      }
      if (is(chunk, Param)) {
        if (is(chunk.value, Placeholder)) {
          return { sql: escapeParam(paramStartIndex.value++, chunk), params: [chunk], typings: ["none"] };
        }
        const mappedValue = chunk.value === null ? null : chunk.encoder.mapToDriverValue(chunk.value);
        if (is(mappedValue, SQL)) {
          return this.buildQueryFromSourceParams([mappedValue], config);
        }
        if (inlineParams) {
          return { sql: this.mapInlineParam(mappedValue, config), params: [] };
        }
        let typings = ["none"];
        if (prepareTyping) {
          typings = [prepareTyping(chunk.encoder)];
        }
        return { sql: escapeParam(paramStartIndex.value++, mappedValue), params: [mappedValue], typings };
      }
      if (is(chunk, Placeholder)) {
        return { sql: escapeParam(paramStartIndex.value++, chunk), params: [chunk], typings: ["none"] };
      }
      if (is(chunk, SQL.Aliased) && chunk.fieldAlias !== undefined) {
        return { sql: escapeName(chunk.fieldAlias), params: [] };
      }
      if (is(chunk, Subquery)) {
        if (chunk._.isWith) {
          return { sql: escapeName(chunk._.alias), params: [] };
        }
        return this.buildQueryFromSourceParams([
          new StringChunk("("),
          chunk._.sql,
          new StringChunk(") "),
          new Name(chunk._.alias)
        ], config);
      }
      if (isPgEnum(chunk)) {
        if (chunk.schema) {
          return { sql: escapeName(chunk.schema) + "." + escapeName(chunk.enumName), params: [] };
        }
        return { sql: escapeName(chunk.enumName), params: [] };
      }
      if (isSQLWrapper(chunk)) {
        if (chunk.shouldOmitSQLParens?.()) {
          return this.buildQueryFromSourceParams([chunk.getSQL()], config);
        }
        return this.buildQueryFromSourceParams([
          new StringChunk("("),
          chunk.getSQL(),
          new StringChunk(")")
        ], config);
      }
      if (inlineParams) {
        return { sql: this.mapInlineParam(chunk, config), params: [] };
      }
      return { sql: escapeParam(paramStartIndex.value++, chunk), params: [chunk], typings: ["none"] };
    }));
  }
  mapInlineParam(chunk, { escapeString }) {
    if (chunk === null) {
      return "null";
    }
    if (typeof chunk === "number" || typeof chunk === "boolean") {
      return chunk.toString();
    }
    if (typeof chunk === "string") {
      return escapeString(chunk);
    }
    if (typeof chunk === "object") {
      const mappedValueAsString = chunk.toString();
      if (mappedValueAsString === "[object Object]") {
        return escapeString(JSON.stringify(chunk));
      }
      return escapeString(mappedValueAsString);
    }
    throw new Error("Unexpected param value: " + chunk);
  }
  getSQL() {
    return this;
  }
  as(alias) {
    if (alias === undefined) {
      return this;
    }
    return new SQL.Aliased(this, alias);
  }
  mapWith(decoder) {
    this.decoder = typeof decoder === "function" ? { mapFromDriverValue: decoder } : decoder;
    return this;
  }
  inlineParams() {
    this.shouldInlineParams = true;
    return this;
  }
  if(condition) {
    return condition ? this : undefined;
  }
}

class Name {
  constructor(value) {
    this.value = value;
  }
  static [entityKind] = "Name";
  brand;
  getSQL() {
    return new SQL([this]);
  }
}
function isDriverValueEncoder(value) {
  return typeof value === "object" && value !== null && "mapToDriverValue" in value && typeof value.mapToDriverValue === "function";
}
var noopDecoder = {
  mapFromDriverValue: (value) => value
};
var noopEncoder = {
  mapToDriverValue: (value) => value
};
var noopMapper = {
  ...noopDecoder,
  ...noopEncoder
};

class Param {
  constructor(value, encoder = noopEncoder) {
    this.value = value;
    this.encoder = encoder;
  }
  static [entityKind] = "Param";
  brand;
  getSQL() {
    return new SQL([this]);
  }
}
function sql(strings, ...params) {
  const queryChunks = [];
  if (params.length > 0 || strings.length > 0 && strings[0] !== "") {
    queryChunks.push(new StringChunk(strings[0]));
  }
  for (const [paramIndex, param2] of params.entries()) {
    queryChunks.push(param2, new StringChunk(strings[paramIndex + 1]));
  }
  return new SQL(queryChunks);
}
((sql2) => {
  function empty() {
    return new SQL([]);
  }
  sql2.empty = empty;
  function fromList(list) {
    return new SQL(list);
  }
  sql2.fromList = fromList;
  function raw(str) {
    return new SQL([new StringChunk(str)]);
  }
  sql2.raw = raw;
  function join(chunks, separator) {
    const result = [];
    for (const [i, chunk] of chunks.entries()) {
      if (i > 0 && separator !== undefined) {
        result.push(separator);
      }
      result.push(chunk);
    }
    return new SQL(result);
  }
  sql2.join = join;
  function identifier(value) {
    return new Name(value);
  }
  sql2.identifier = identifier;
  function placeholder2(name2) {
    return new Placeholder(name2);
  }
  sql2.placeholder = placeholder2;
  function param2(value, encoder) {
    return new Param(value, encoder);
  }
  sql2.param = param2;
})(sql || (sql = {}));
((SQL2) => {

  class Aliased {
    constructor(sql2, fieldAlias) {
      this.sql = sql2;
      this.fieldAlias = fieldAlias;
    }
    static [entityKind] = "SQL.Aliased";
    isSelectionField = false;
    getSQL() {
      return this.sql;
    }
    clone() {
      return new Aliased(this.sql, this.fieldAlias);
    }
  }
  SQL2.Aliased = Aliased;
})(SQL || (SQL = {}));

class Placeholder {
  constructor(name2) {
    this.name = name2;
  }
  static [entityKind] = "Placeholder";
  getSQL() {
    return new SQL([this]);
  }
}
var IsDrizzleView = Symbol.for("drizzle:IsDrizzleView");

class View {
  static [entityKind] = "View";
  [ViewBaseConfig];
  [IsDrizzleView] = true;
  constructor({ name: name2, schema, selectedFields, query }) {
    this[ViewBaseConfig] = {
      name: name2,
      originalName: name2,
      schema,
      selectedFields,
      query,
      isExisting: !query,
      isAlias: false
    };
  }
  getSQL() {
    return new SQL([this]);
  }
}
Column.prototype.getSQL = function() {
  return new SQL([this]);
};
Table.prototype.getSQL = function() {
  return new SQL([this]);
};
Subquery.prototype.getSQL = function() {
  return new SQL([this]);
};

// ../node_modules/drizzle-orm/utils.js
function getColumnNameAndConfig(a, b) {
  return {
    name: typeof a === "string" && a.length > 0 ? a : "",
    config: typeof a === "object" ? a : b
  };
}
var textDecoder = typeof TextDecoder === "undefined" ? null : new TextDecoder;

// ../node_modules/drizzle-orm/sql/expressions/conditions.js
function bindIfParam(value, column) {
  if (isDriverValueEncoder(column) && !isSQLWrapper(value) && !is(value, Param) && !is(value, Placeholder) && !is(value, Column) && !is(value, Table) && !is(value, View)) {
    return new Param(value, column);
  }
  return value;
}
var eq = (left, right) => {
  return sql`${left} = ${bindIfParam(right, left)}`;
};
function and(...unfilteredConditions) {
  const conditions = unfilteredConditions.filter((c) => c !== undefined);
  if (conditions.length === 0) {
    return;
  }
  if (conditions.length === 1) {
    return new SQL(conditions);
  }
  return new SQL([
    new StringChunk("("),
    sql.join(conditions, new StringChunk(" and ")),
    new StringChunk(")")
  ]);
}
function or(...unfilteredConditions) {
  const conditions = unfilteredConditions.filter((c) => c !== undefined);
  if (conditions.length === 0) {
    return;
  }
  if (conditions.length === 1) {
    return new SQL(conditions);
  }
  return new SQL([
    new StringChunk("("),
    sql.join(conditions, new StringChunk(" or ")),
    new StringChunk(")")
  ]);
}
var gte = (left, right) => {
  return sql`${left} >= ${bindIfParam(right, left)}`;
};
var lt = (left, right) => {
  return sql`${left} < ${bindIfParam(right, left)}`;
};
function isNull(value) {
  return sql`${value} is null`;
}
function like(column, value) {
  return sql`${column} like ${value}`;
}

// ../node_modules/drizzle-orm/sql/expressions/select.js
function desc(column) {
  return sql`${column} desc`;
}

// ../node_modules/fflate/esm/index.mjs
import { createRequire } from "module";
var require2 = createRequire("/");
var _a3;
var Worker;
var isMarkedAsUntransferable;
try {
  _a3 = require2("worker_threads"), Worker = _a3.Worker, isMarkedAsUntransferable = _a3.isMarkedAsUntransferable;
} catch (e) {}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]);
var fdeb = new u8([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0;i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1;i < 30; ++i) {
    for (var j = b[i];j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a3 = freb(fleb, 2);
var fl = _a3.b;
var revfl = _a3.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0;i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = function(cd, mb, r) {
  var s = cd.length;
  var i = 0;
  var l = new u16(mb);
  for (;i < s; ++i) {
    if (cd[i])
      ++l[cd[i] - 1];
  }
  var le = new u16(mb);
  for (i = 1;i < mb; ++i) {
    le[i] = le[i - 1] + l[i - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i = 0;i < s; ++i) {
      if (cd[i]) {
        var sv = i << 4 | cd[i];
        var r_1 = mb - cd[i];
        var v = le[cd[i] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1;v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i = 0;i < s; ++i) {
      if (cd[i]) {
        co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
      }
    }
  }
  return co;
};
var flt = new u8(288);
for (i = 0;i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144;i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256;i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280;i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0;i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i = 1;i < a.length; ++i) {
    if (a[i] > m)
      m = a[i];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l) {
    var bl = buf.length;
    if (l > bl) {
      var nbuf = new u8(Math.max(bl * 2, l));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, { l: lm, d: dm, m: lbt, n: dbt } = st;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i = 0;i < hcLen; ++i) {
          clt[clim[i]] = bits(dat, pos + i * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i = 0;i < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (;; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i = sym - 257, b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (;bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (;bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i = 0;i < d.length; ++i) {
    if (d[i])
      t.push({ s: i, f: d[i] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i2].f ? i0++ : i2++];
    r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i = 1;i < s; ++i) {
    if (t2[i].s > maxSym)
      maxSym = t2[i].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (;i < s; ++i) {
      var i2_1 = t2[i].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i;
    }
    for (;i >= 0 && dt; --i) {
      var i2_3 = t2[i].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i = 1;i <= s; ++i) {
    if (c[i] == cln && i != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (;cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (;cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i = 0;i < cl.length; ++i)
    l += cf[i] * cl[i];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i = 0;i < s; ++i)
    out[o + i + 4] = dat[i];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a = hTree(lf, 15), { t: dlt, l: mlb } = _a;
  var _b = hTree(df, 15), { t: ddt, l: mdb } = _b;
  var _c = lc(dlt), { c: lclt, n: nlc } = _c;
  var _d = lc(ddt), { c: lcdt, n: ndc } = _d;
  var lcfreq = new u16(19);
  for (var i = 0;i < lclt.length; ++i)
    ++lcfreq[lclt[i] & 31];
  for (var i = 0;i < lcdt.length; ++i)
    ++lcfreq[lcdt[i] & 31];
  var _e = hTree(lcfreq, 7), { t: lct, l: mlcb } = _e;
  var nlcc = 19;
  for (;nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i = 0;i < nlcc; ++i)
      wbits(out, p + 3 * i, lct[clim[i]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0;it < 2; ++it) {
      var clct = lcts[it];
      for (var i = 0;i < clct.length; ++i) {
        var len = clct[i] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i = 0;i < li; ++i) {
    var sym = syms[i];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7000)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i) {
      return (dat[i] ^ dat[i + 1] << bs1_1 ^ dat[i + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25000);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (;i + 2 < s; ++i) {
      var hv = hsh(i);
      var imod = i & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i) {
        var rem = s - i;
        if ((lc_1 > 7000 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
          li = lc_1 = eb = 0, bs = i;
          for (var j = 0;j < 286; ++j)
            lf[j] = 0;
          for (var j = 0;j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i + l] == dat[i + l - dif]) {
              var nl = 0;
              for (;nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0;j < mmd; ++j) {
                  var ti = i - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i];
          ++lf[dat[i]];
        }
      }
    }
    for (i = Math.max(i, wi);i < s; ++i) {
      syms[li++] = dat[i];
      ++lf[dat[i]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i, st.w = wi;
    }
  } else {
    for (var i = st.w || 0;i < s + lst; i += 65535) {
      var e = i + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ function() {
  var t = new Int32Array(256);
  for (var i = 0;i < 256; ++i) {
    var c = i, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i] = c;
  }
  return t;
}();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i = 0;i < d.length; ++i)
        cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var wbytes = function(d, b, v) {
  for (;v; ++b)
    d[b] = v, v >>>= 8;
};
var gzh = function(c, o) {
  var fn = o.filename;
  c[0] = 31, c[1] = 139, c[2] = 8, c[8] = o.level < 2 ? 4 : o.level == 9 ? 2 : 0, c[9] = 3;
  if (o.mtime != 0)
    wbytes(c, 4, Math.floor(new Date(o.mtime || Date.now()) / 1000));
  if (fn) {
    c[3] = 8;
    for (var i = 0;i <= fn.length; ++i)
      c[i + 10] = fn.charCodeAt(i);
  }
};
var gzs = function(d) {
  if (d[0] != 31 || d[1] != 139 || d[2] != 8)
    err(6, "invalid gzip data");
  var flg = d[3];
  var st = 10;
  if (flg & 4)
    st += (d[10] | d[11] << 8) + 2;
  for (var zs = (flg >> 3 & 1) + (flg >> 4 & 1);zs > 0; zs -= !d[st++])
    ;
  return st + (flg & 2);
};
var gzl = function(d) {
  var l = d.length;
  return (d[l - 4] | d[l - 3] << 8 | d[l - 2] << 16 | d[l - 1] << 24) >>> 0;
};
var gzhl = function(o) {
  return 10 + (o.filename ? o.filename.length + 1 : 0);
};
function gzipSync(data, opts) {
  if (!opts)
    opts = {};
  var c = crc(), l = data.length;
  c.p(data);
  var d = dopt(data, opts, gzhl(opts), 8), s = d.length;
  return gzh(d, opts), wbytes(d, s - 8, c.d()), wbytes(d, s - 4, l), d;
}
function gunzipSync(data, opts) {
  var st = gzs(data);
  if (st + 8 > data.length)
    err(6, "invalid gzip data");
  return inflt(data.subarray(st, -8), { i: 2 }, opts && opts.out || new u8(gzl(data)), opts && opts.dictionary);
}
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder;
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder;
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {}
var dutf8 = function(d) {
  for (var r = "", i = 0;; ) {
    var c = d[i++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i + eb > d.length)
      return { s: r, r: slc(d, i - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
  }
};
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i = 0;i < str.length; ++i)
      ar_1[i] = str.charCodeAt(i);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i = 0;i < l; ++i) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i = 0;i < dat.length; i += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a = dutf8(dat), { s, r } = _a;
    if (r.length)
      err(8);
    return s;
  }
}

// src/actions.ts
import { execFile } from "child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { promisify } from "util";

// ../node_modules/drizzle-orm/sqlite-core/foreign-keys.js
class ForeignKeyBuilder {
  static [entityKind] = "SQLiteForeignKeyBuilder";
  reference;
  _onUpdate;
  _onDelete;
  constructor(config, actions) {
    this.reference = () => {
      const { name, columns, foreignColumns } = config();
      return { name, columns, foreignTable: foreignColumns[0].table, foreignColumns };
    };
    if (actions) {
      this._onUpdate = actions.onUpdate;
      this._onDelete = actions.onDelete;
    }
  }
  onUpdate(action) {
    this._onUpdate = action;
    return this;
  }
  onDelete(action) {
    this._onDelete = action;
    return this;
  }
  build(table) {
    return new ForeignKey(table, this);
  }
}

class ForeignKey {
  constructor(table, builder) {
    this.table = table;
    this.reference = builder.reference;
    this.onUpdate = builder._onUpdate;
    this.onDelete = builder._onDelete;
  }
  static [entityKind] = "SQLiteForeignKey";
  reference;
  onUpdate;
  onDelete;
  getName() {
    const { name, columns, foreignColumns } = this.reference();
    const columnNames = columns.map((column) => column.name);
    const foreignColumnNames = foreignColumns.map((column) => column.name);
    const chunks = [
      this.table[TableName],
      ...columnNames,
      foreignColumns[0].table[TableName],
      ...foreignColumnNames
    ];
    return name ?? `${chunks.join("_")}_fk`;
  }
}

// ../node_modules/drizzle-orm/sqlite-core/unique-constraint.js
function uniqueKeyName(table, columns) {
  return `${table[TableName]}_${columns.join("_")}_unique`;
}

// ../node_modules/drizzle-orm/sqlite-core/columns/common.js
class SQLiteColumnBuilder extends ColumnBuilder {
  static [entityKind] = "SQLiteColumnBuilder";
  foreignKeyConfigs = [];
  references(ref, actions = {}) {
    this.foreignKeyConfigs.push({ ref, actions });
    return this;
  }
  unique(name) {
    this.config.isUnique = true;
    this.config.uniqueName = name;
    return this;
  }
  generatedAlwaysAs(as, config) {
    this.config.generated = {
      as,
      type: "always",
      mode: config?.mode ?? "virtual"
    };
    return this;
  }
  buildForeignKeys(column, table) {
    return this.foreignKeyConfigs.map(({ ref, actions }) => {
      return ((ref2, actions2) => {
        const builder = new ForeignKeyBuilder(() => {
          const foreignColumn = ref2();
          return { columns: [column], foreignColumns: [foreignColumn] };
        });
        if (actions2.onUpdate) {
          builder.onUpdate(actions2.onUpdate);
        }
        if (actions2.onDelete) {
          builder.onDelete(actions2.onDelete);
        }
        return builder.build(table);
      })(ref, actions);
    });
  }
}

class SQLiteColumn extends Column {
  constructor(table, config) {
    if (!config.uniqueName) {
      config.uniqueName = uniqueKeyName(table, [config.name]);
    }
    super(table, config);
    this.table = table;
  }
  static [entityKind] = "SQLiteColumn";
}

// ../node_modules/drizzle-orm/sqlite-core/columns/blob.js
class SQLiteBigIntBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBigIntBuilder";
  constructor(name) {
    super(name, "bigint", "SQLiteBigInt");
  }
  build(table) {
    return new SQLiteBigInt(table, this.config);
  }
}

class SQLiteBigInt extends SQLiteColumn {
  static [entityKind] = "SQLiteBigInt";
  getSQLType() {
    return "blob";
  }
  mapFromDriverValue(value) {
    if (typeof Buffer !== "undefined" && Buffer.from) {
      const buf = Buffer.isBuffer(value) ? value : value instanceof ArrayBuffer ? Buffer.from(value) : value.buffer ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value);
      return BigInt(buf.toString("utf8"));
    }
    return BigInt(textDecoder.decode(value));
  }
  mapToDriverValue(value) {
    return Buffer.from(value.toString());
  }
}

class SQLiteBlobJsonBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBlobJsonBuilder";
  constructor(name) {
    super(name, "json", "SQLiteBlobJson");
  }
  build(table) {
    return new SQLiteBlobJson(table, this.config);
  }
}

class SQLiteBlobJson extends SQLiteColumn {
  static [entityKind] = "SQLiteBlobJson";
  getSQLType() {
    return "blob";
  }
  mapFromDriverValue(value) {
    if (typeof Buffer !== "undefined" && Buffer.from) {
      const buf = Buffer.isBuffer(value) ? value : value instanceof ArrayBuffer ? Buffer.from(value) : value.buffer ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value);
      return JSON.parse(buf.toString("utf8"));
    }
    return JSON.parse(textDecoder.decode(value));
  }
  mapToDriverValue(value) {
    return Buffer.from(JSON.stringify(value));
  }
}

class SQLiteBlobBufferBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBlobBufferBuilder";
  constructor(name) {
    super(name, "buffer", "SQLiteBlobBuffer");
  }
  build(table) {
    return new SQLiteBlobBuffer(table, this.config);
  }
}

class SQLiteBlobBuffer extends SQLiteColumn {
  static [entityKind] = "SQLiteBlobBuffer";
  mapFromDriverValue(value) {
    if (Buffer.isBuffer(value)) {
      return value;
    }
    return Buffer.from(value);
  }
  getSQLType() {
    return "blob";
  }
}
function blob(a, b) {
  const { name, config } = getColumnNameAndConfig(a, b);
  if (config?.mode === "json") {
    return new SQLiteBlobJsonBuilder(name);
  }
  if (config?.mode === "bigint") {
    return new SQLiteBigIntBuilder(name);
  }
  return new SQLiteBlobBufferBuilder(name);
}

// ../node_modules/drizzle-orm/sqlite-core/columns/custom.js
class SQLiteCustomColumnBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteCustomColumnBuilder";
  constructor(name, fieldConfig, customTypeParams) {
    super(name, "custom", "SQLiteCustomColumn");
    this.config.fieldConfig = fieldConfig;
    this.config.customTypeParams = customTypeParams;
  }
  build(table) {
    return new SQLiteCustomColumn(table, this.config);
  }
}

class SQLiteCustomColumn extends SQLiteColumn {
  static [entityKind] = "SQLiteCustomColumn";
  sqlName;
  mapTo;
  mapFrom;
  constructor(table, config) {
    super(table, config);
    this.sqlName = config.customTypeParams.dataType(config.fieldConfig);
    this.mapTo = config.customTypeParams.toDriver;
    this.mapFrom = config.customTypeParams.fromDriver;
  }
  getSQLType() {
    return this.sqlName;
  }
  mapFromDriverValue(value) {
    return typeof this.mapFrom === "function" ? this.mapFrom(value) : value;
  }
  mapToDriverValue(value) {
    return typeof this.mapTo === "function" ? this.mapTo(value) : value;
  }
}
function customType(customTypeParams) {
  return (a, b) => {
    const { name, config } = getColumnNameAndConfig(a, b);
    return new SQLiteCustomColumnBuilder(name, config, customTypeParams);
  };
}

// ../node_modules/drizzle-orm/sqlite-core/columns/integer.js
class SQLiteBaseIntegerBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBaseIntegerBuilder";
  constructor(name, dataType, columnType) {
    super(name, dataType, columnType);
    this.config.autoIncrement = false;
  }
  primaryKey(config) {
    if (config?.autoIncrement) {
      this.config.autoIncrement = true;
    }
    this.config.hasDefault = true;
    return super.primaryKey();
  }
}

class SQLiteBaseInteger extends SQLiteColumn {
  static [entityKind] = "SQLiteBaseInteger";
  autoIncrement = this.config.autoIncrement;
  getSQLType() {
    return "integer";
  }
}

class SQLiteIntegerBuilder extends SQLiteBaseIntegerBuilder {
  static [entityKind] = "SQLiteIntegerBuilder";
  constructor(name) {
    super(name, "number", "SQLiteInteger");
  }
  build(table) {
    return new SQLiteInteger(table, this.config);
  }
}

class SQLiteInteger extends SQLiteBaseInteger {
  static [entityKind] = "SQLiteInteger";
}

class SQLiteTimestampBuilder extends SQLiteBaseIntegerBuilder {
  static [entityKind] = "SQLiteTimestampBuilder";
  constructor(name, mode) {
    super(name, "date", "SQLiteTimestamp");
    this.config.mode = mode;
  }
  defaultNow() {
    return this.default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`);
  }
  build(table) {
    return new SQLiteTimestamp(table, this.config);
  }
}

class SQLiteTimestamp extends SQLiteBaseInteger {
  static [entityKind] = "SQLiteTimestamp";
  mode = this.config.mode;
  mapFromDriverValue(value) {
    if (this.config.mode === "timestamp") {
      return new Date(value * 1000);
    }
    return new Date(value);
  }
  mapToDriverValue(value) {
    const unix = value.getTime();
    if (this.config.mode === "timestamp") {
      return Math.floor(unix / 1000);
    }
    return unix;
  }
}

class SQLiteBooleanBuilder extends SQLiteBaseIntegerBuilder {
  static [entityKind] = "SQLiteBooleanBuilder";
  constructor(name, mode) {
    super(name, "boolean", "SQLiteBoolean");
    this.config.mode = mode;
  }
  build(table) {
    return new SQLiteBoolean(table, this.config);
  }
}

class SQLiteBoolean extends SQLiteBaseInteger {
  static [entityKind] = "SQLiteBoolean";
  mode = this.config.mode;
  mapFromDriverValue(value) {
    return Number(value) === 1;
  }
  mapToDriverValue(value) {
    return value ? 1 : 0;
  }
}
function integer2(a, b) {
  const { name, config } = getColumnNameAndConfig(a, b);
  if (config?.mode === "timestamp" || config?.mode === "timestamp_ms") {
    return new SQLiteTimestampBuilder(name, config.mode);
  }
  if (config?.mode === "boolean") {
    return new SQLiteBooleanBuilder(name, config.mode);
  }
  return new SQLiteIntegerBuilder(name);
}

// ../node_modules/drizzle-orm/sqlite-core/columns/numeric.js
class SQLiteNumericBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteNumericBuilder";
  constructor(name) {
    super(name, "string", "SQLiteNumeric");
  }
  build(table) {
    return new SQLiteNumeric(table, this.config);
  }
}

class SQLiteNumeric extends SQLiteColumn {
  static [entityKind] = "SQLiteNumeric";
  mapFromDriverValue(value) {
    if (typeof value === "string")
      return value;
    return String(value);
  }
  getSQLType() {
    return "numeric";
  }
}

class SQLiteNumericNumberBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteNumericNumberBuilder";
  constructor(name) {
    super(name, "number", "SQLiteNumericNumber");
  }
  build(table) {
    return new SQLiteNumericNumber(table, this.config);
  }
}

class SQLiteNumericNumber extends SQLiteColumn {
  static [entityKind] = "SQLiteNumericNumber";
  mapFromDriverValue(value) {
    if (typeof value === "number")
      return value;
    return Number(value);
  }
  mapToDriverValue = String;
  getSQLType() {
    return "numeric";
  }
}

class SQLiteNumericBigIntBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteNumericBigIntBuilder";
  constructor(name) {
    super(name, "bigint", "SQLiteNumericBigInt");
  }
  build(table) {
    return new SQLiteNumericBigInt(table, this.config);
  }
}

class SQLiteNumericBigInt extends SQLiteColumn {
  static [entityKind] = "SQLiteNumericBigInt";
  mapFromDriverValue = BigInt;
  mapToDriverValue = String;
  getSQLType() {
    return "numeric";
  }
}
function numeric(a, b) {
  const { name, config } = getColumnNameAndConfig(a, b);
  const mode = config?.mode;
  return mode === "number" ? new SQLiteNumericNumberBuilder(name) : mode === "bigint" ? new SQLiteNumericBigIntBuilder(name) : new SQLiteNumericBuilder(name);
}

// ../node_modules/drizzle-orm/sqlite-core/columns/real.js
class SQLiteRealBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteRealBuilder";
  constructor(name) {
    super(name, "number", "SQLiteReal");
  }
  build(table) {
    return new SQLiteReal(table, this.config);
  }
}

class SQLiteReal extends SQLiteColumn {
  static [entityKind] = "SQLiteReal";
  getSQLType() {
    return "real";
  }
}
function real(name) {
  return new SQLiteRealBuilder(name ?? "");
}

// ../node_modules/drizzle-orm/sqlite-core/columns/text.js
class SQLiteTextBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteTextBuilder";
  constructor(name, config) {
    super(name, "string", "SQLiteText");
    this.config.enumValues = config.enum;
    this.config.length = config.length;
  }
  build(table) {
    return new SQLiteText(table, this.config);
  }
}

class SQLiteText extends SQLiteColumn {
  static [entityKind] = "SQLiteText";
  enumValues = this.config.enumValues;
  length = this.config.length;
  constructor(table, config) {
    super(table, config);
  }
  getSQLType() {
    return `text${this.config.length ? `(${this.config.length})` : ""}`;
  }
}

class SQLiteTextJsonBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteTextJsonBuilder";
  constructor(name) {
    super(name, "json", "SQLiteTextJson");
  }
  build(table) {
    return new SQLiteTextJson(table, this.config);
  }
}

class SQLiteTextJson extends SQLiteColumn {
  static [entityKind] = "SQLiteTextJson";
  getSQLType() {
    return "text";
  }
  mapFromDriverValue(value) {
    return JSON.parse(value);
  }
  mapToDriverValue(value) {
    return JSON.stringify(value);
  }
}
function text(a, b = {}) {
  const { name, config } = getColumnNameAndConfig(a, b);
  if (config.mode === "json") {
    return new SQLiteTextJsonBuilder(name);
  }
  return new SQLiteTextBuilder(name, config);
}

// ../node_modules/drizzle-orm/sqlite-core/columns/all.js
function getSQLiteColumnBuilders() {
  return {
    blob,
    customType,
    integer: integer2,
    numeric,
    real,
    text
  };
}

// ../node_modules/drizzle-orm/sqlite-core/table.js
var InlineForeignKeys = Symbol.for("drizzle:SQLiteInlineForeignKeys");

class SQLiteTable extends Table {
  static [entityKind] = "SQLiteTable";
  static Symbol = Object.assign({}, Table.Symbol, {
    InlineForeignKeys
  });
  [Table.Symbol.Columns];
  [InlineForeignKeys] = [];
  [Table.Symbol.ExtraConfigBuilder] = undefined;
}
function sqliteTableBase(name, columns, extraConfig, schema, baseName = name) {
  const rawTable = new SQLiteTable(name, schema, baseName);
  const parsedColumns = typeof columns === "function" ? columns(getSQLiteColumnBuilders()) : columns;
  const builtColumns = Object.fromEntries(Object.entries(parsedColumns).map(([name2, colBuilderBase]) => {
    const colBuilder = colBuilderBase;
    colBuilder.setName(name2);
    const column = colBuilder.build(rawTable);
    rawTable[InlineForeignKeys].push(...colBuilder.buildForeignKeys(column, rawTable));
    return [name2, column];
  }));
  const table = Object.assign(rawTable, builtColumns);
  table[Table.Symbol.Columns] = builtColumns;
  table[Table.Symbol.ExtraConfigColumns] = builtColumns;
  if (extraConfig) {
    table[SQLiteTable.Symbol.ExtraConfigBuilder] = extraConfig;
  }
  return table;
}
var sqliteTable = (name, columns, extraConfig) => {
  return sqliteTableBase(name, columns, extraConfig);
};

// ../node_modules/drizzle-orm/sqlite-core/indexes.js
class IndexBuilderOn {
  constructor(name, unique) {
    this.name = name;
    this.unique = unique;
  }
  static [entityKind] = "SQLiteIndexBuilderOn";
  on(...columns) {
    return new IndexBuilder(this.name, columns, this.unique);
  }
}

class IndexBuilder {
  static [entityKind] = "SQLiteIndexBuilder";
  config;
  constructor(name, columns, unique) {
    this.config = {
      name,
      columns,
      unique,
      where: undefined
    };
  }
  where(condition) {
    this.config.where = condition;
    return this;
  }
  build(table) {
    return new Index(this.config, table);
  }
}

class Index {
  static [entityKind] = "SQLiteIndex";
  config;
  constructor(config, table) {
    this.config = { ...config, table };
  }
}
function index(name) {
  return new IndexBuilderOn(name, false);
}
function uniqueIndex(name) {
  return new IndexBuilderOn(name, true);
}

// src/schema.ts
var clients = sqliteTable("clients", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  notes: text("notes").notNull().default(""),
  referredByClientId: integer2("referred_by_client_id"),
  tags: text("tags").notNull().default("[]"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var jobs = sqliteTable("jobs", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  clientId: integer2("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull().default(""),
  clientEmail: text("client_email").notNull().default(""),
  jobAddress: text("job_address").notNull(),
  jobType: text("job_type").notNull(),
  notes: text("notes").notNull().default(""),
  jobDate: text("job_date").notNull(),
  appointmentAt: text("appointment_at").notNull().default(""),
  amountDue: text("amount_due").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  depositAmount: text("deposit_amount").notNull().default(""),
  paymentNotes: text("payment_notes").notNull().default(""),
  galleryPick: integer2("gallery_pick", { mode: "boolean" }).notNull().default(false),
  maintenancePlanId: integer2("maintenance_plan_id"),
  maintenanceDueDate: text("maintenance_due_date"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  requiredPhotoStages: text("required_photo_stages").notNull().default("before,during,after"),
  completedAt: integer2("completed_at", { mode: "timestamp_ms" }),
  completionOverrideNote: text("completion_override_note").notNull().default(""),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
}, (table) => [
  uniqueIndex("jobs_maintenance_cycle_unique").on(table.maintenancePlanId, table.maintenanceDueDate)
]);
var photos = sqliteTable("photos", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["before", "during", "after"] }).notNull(),
  caption: text("caption").notNull().default(""),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  galleryPick: integer2("gallery_pick", { mode: "boolean" }).notNull().default(false),
  annotatedFromId: integer2("annotated_from_id"),
  excludeFromSocial: integer2("exclude_from_social", { mode: "boolean" }).notNull().default(false),
  capturedAt: integer2("captured_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var documents = sqliteTable("documents", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["contract", "change_order"] }).notNull(),
  title: text("title").notNull(),
  bodyText: text("body_text").notNull().default(""),
  originalBlobKey: text("original_blob_key"),
  originalFilename: text("original_filename").notNull().default(""),
  description: text("description").notNull().default(""),
  amount: text("amount").notNull().default(""),
  signerName: text("signer_name").notNull(),
  signatureBlobKey: text("signature_blob_key").notNull(),
  clientSignerName: text("client_signer_name").notNull().default(""),
  clientSignatureBlobKey: text("client_signature_blob_key"),
  clientSignedAt: integer2("client_signed_at", { mode: "timestamp_ms" }),
  clientSignedPdfBlobKey: text("client_signed_pdf_blob_key"),
  clientSignatureHash: text("client_signature_hash").notNull().default(""),
  clientSignedUserAgent: text("client_signed_user_agent").notNull().default(""),
  signedAt: integer2("signed_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var quotes = sqliteTable("quotes", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  clientId: integer2("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull().default(""),
  clientEmail: text("client_email").notNull().default(""),
  jobAddress: text("job_address").notNull().default(""),
  shippingAddress: text("shipping_address").notNull().default(""),
  jobType: text("job_type").notNull().default(""),
  lineItemsJson: text("line_items_json").notNull(),
  subtotal: text("subtotal").notNull().default("0"),
  discountType: text("discount_type", { enum: ["percent", "fixed"] }).notNull().default("percent"),
  discountValue: text("discount_value").notNull().default("0"),
  taxType: text("tax_type", { enum: ["percent", "fixed"] }).notNull().default("percent"),
  taxValue: text("tax_value").notNull().default("0"),
  total: text("total").notNull(),
  footnote: text("footnote").notNull().default(""),
  expiryDate: text("expiry_date").notNull().default(""),
  sentAt: text("sent_at").notNull().default(""),
  automationStatus: text("automation_status", { enum: ["awaiting", "won", "lost"] }).notNull().default("awaiting"),
  lostReason: text("lost_reason", { enum: ["price", "timing", "competitor", "no_response", "other"] }),
  lostNote: text("lost_note").notNull().default(""),
  theme: text("theme", { enum: ["classic", "modern", "bold", "minimal"] }).notNull().default("classic"),
  font: text("font", { enum: ["helvetica", "times", "courier", "palatino"] }).notNull().default("helvetica"),
  accentColor: text("accent_color").notNull().default("#1f5a4a"),
  showTaxLine: integer2("show_tax_line", { mode: "boolean" }).notNull().default(true),
  showDiscountLine: integer2("show_discount_line", { mode: "boolean" }).notNull().default(true),
  showPaidLine: integer2("show_paid_line", { mode: "boolean" }).notNull().default(true),
  showPaymentTerms: integer2("show_payment_terms", { mode: "boolean" }).notNull().default(true),
  showFooterNotes: integer2("show_footer_notes", { mode: "boolean" }).notNull().default(true),
  showLogo: integer2("show_logo", { mode: "boolean" }).notNull().default(true),
  showCompanyInfo: integer2("show_company_info", { mode: "boolean" }).notNull().default(true),
  customizeJson: text("customize_json").notNull().default("{}"),
  jobId: integer2("job_id").references(() => jobs.id, { onDelete: "set null" }),
  seriesId: integer2("series_id"),
  parentQuoteId: integer2("parent_quote_id"),
  versionNumber: integer2("version_number").notNull().default(1),
  superseded: integer2("superseded", { mode: "boolean" }).notNull().default(false),
  accepted: integer2("accepted", { mode: "boolean" }).notNull().default(false),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var invoices = sqliteTable("invoices", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  invoiceNumber: text("invoice_number").notNull().default(""),
  quoteId: integer2("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  jobId: integer2("job_id").references(() => jobs.id, { onDelete: "set null" }),
  clientId: integer2("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull().default(""),
  clientEmail: text("client_email").notNull().default(""),
  jobAddress: text("job_address").notNull().default(""),
  shippingAddress: text("shipping_address").notNull().default(""),
  jobType: text("job_type").notNull().default(""),
  lineItemsJson: text("line_items_json").notNull(),
  subtotal: text("subtotal").notNull().default("0"),
  discountType: text("discount_type", { enum: ["percent", "fixed"] }).notNull().default("percent"),
  discountValue: text("discount_value").notNull().default("0"),
  taxType: text("tax_type", { enum: ["percent", "fixed"] }).notNull().default("percent"),
  taxValue: text("tax_value").notNull().default("0"),
  total: text("total").notNull(),
  footnote: text("footnote").notNull().default(""),
  issueDate: text("issue_date").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  status: text("status", { enum: ["draft", "sent", "paid", "overdue"] }).notNull().default("draft"),
  recurringFrequency: text("recurring_frequency", { enum: ["none", "daily", "weekly", "monthly", "quarterly"] }).notNull().default("none"),
  nextDueDate: text("next_due_date").notNull().default(""),
  seriesId: integer2("series_id"),
  parentInvoiceId: integer2("parent_invoice_id"),
  recurringEndDate: text("recurring_end_date").notNull().default(""),
  recurringCancelled: integer2("recurring_cancelled", { mode: "boolean" }).notNull().default(false),
  theme: text("theme", { enum: ["classic", "modern", "bold", "minimal"] }).notNull().default("classic"),
  font: text("font", { enum: ["helvetica", "times", "courier", "palatino"] }).notNull().default("helvetica"),
  accentColor: text("accent_color").notNull().default("#1f5a4a"),
  showTaxLine: integer2("show_tax_line", { mode: "boolean" }).notNull().default(true),
  showDiscountLine: integer2("show_discount_line", { mode: "boolean" }).notNull().default(true),
  showPaidLine: integer2("show_paid_line", { mode: "boolean" }).notNull().default(true),
  showPaymentTerms: integer2("show_payment_terms", { mode: "boolean" }).notNull().default(true),
  showFooterNotes: integer2("show_footer_notes", { mode: "boolean" }).notNull().default(true),
  showLogo: integer2("show_logo", { mode: "boolean" }).notNull().default(true),
  showCompanyInfo: integer2("show_company_info", { mode: "boolean" }).notNull().default(true),
  customizeJson: text("customize_json").notNull().default("{}"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var financialDocumentSignatures = sqliteTable("financial_document_signatures", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  documentKind: text("document_kind", { enum: ["invoice", "quote"] }).notNull(),
  documentId: integer2("document_id").notNull(),
  signerName: text("signer_name").notNull(),
  signatureBlobKey: text("signature_blob_key").notNull(),
  signedAt: integer2("signed_at", { mode: "timestamp_ms" }).notNull()
}, (table) => [
  uniqueIndex("financial_document_signature_unique").on(table.documentKind, table.documentId)
]);
var punchItems = sqliteTable("punch_items", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  completed: integer2("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var punchSignoffs = sqliteTable("punch_signoffs", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  customerName: text("customer_name").notNull(),
  customerSignatureBlobKey: text("customer_signature_blob_key").notNull(),
  contractorName: text("contractor_name").notNull(),
  contractorSignatureBlobKey: text("contractor_signature_blob_key").notNull(),
  signedAt: integer2("signed_at", { mode: "timestamp_ms" }).notNull()
});
var progressUpdates = sqliteTable("progress_updates", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  dayNumber: integer2("day_number").notNull(),
  note: text("note").notNull().default(""),
  photoIdsJson: text("photo_ids_json").notNull().default("[]"),
  status: text("status", { enum: ["draft", "sent"] }).notNull().default("sent"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var settings = sqliteTable("settings", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey(),
  companyName: text("company_name").notNull(),
  licenseNumber: text("license_number").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  website: text("website").notNull().default(""),
  address: text("address").notNull().default(""),
  profileDescription: text("profile_description").notNull().default(""),
  serviceArea: text("service_area").notNull().default(""),
  facebookUrl: text("facebook_url").notNull().default(""),
  instagramUrl: text("instagram_url").notNull().default(""),
  youtubeUrl: text("youtube_url").notNull().default(""),
  reviewUrl: text("review_url").notNull().default(""),
  paymentInstructions: text("payment_instructions").notNull().default(""),
  quoteFollowUpDays: integer2("quote_follow_up_days").notNull().default(3),
  offersFreeEstimates: integer2("offers_free_estimates", { mode: "boolean" }).notNull().default(true),
  socialWatermark: integer2("social_watermark", { mode: "boolean" }).notNull().default(true),
  language: text("language", { enum: ["en", "es"] }).notNull().default("en"),
  accentColor: text("accent_color").notNull().default("#1f5a4a"),
  defaultQuoteTheme: text("default_quote_theme", { enum: ["classic", "modern", "bold", "minimal"] }).notNull().default("classic"),
  defaultDocumentFont: text("default_document_font", { enum: ["helvetica", "times", "courier", "palatino"] }).notNull().default("helvetica"),
  defaultShowTaxLine: integer2("default_show_tax_line", { mode: "boolean" }).notNull().default(true),
  defaultShowDiscountLine: integer2("default_show_discount_line", { mode: "boolean" }).notNull().default(true),
  defaultShowPaidLine: integer2("default_show_paid_line", { mode: "boolean" }).notNull().default(true),
  defaultShowPaymentTerms: integer2("default_show_payment_terms", { mode: "boolean" }).notNull().default(true),
  defaultShowFooterNotes: integer2("default_show_footer_notes", { mode: "boolean" }).notNull().default(true),
  defaultShowLogo: integer2("default_show_logo", { mode: "boolean" }).notNull().default(true),
  defaultShowCompanyInfo: integer2("default_show_company_info", { mode: "boolean" }).notNull().default(true),
  defaultCustomizeJson: text("default_customize_json").notNull().default("{}"),
  defaultFootnote: text("default_footnote").notNull().default(""),
  warrantyTerms: text("warranty_terms").notNull().default(""),
  hourlyCostRate: text("hourly_cost_rate").notNull().default("0"),
  lateFeeType: text("late_fee_type", { enum: ["flat", "percent"] }).notNull().default("percent"),
  lateFeeValue: text("late_fee_value").notNull().default("0"),
  lateFeeGraceDays: integer2("late_fee_grace_days").notNull().default(0),
  costAlertPercent: integer2("cost_alert_percent").notNull().default(80),
  paymentRemindersEnabled: integer2("payment_reminders_enabled", { mode: "boolean" }).notNull().default(true),
  onlineSignatureEnabled: integer2("online_signature_enabled", { mode: "boolean" }).notNull().default(true),
  overdueInvoiceRemindersEnabled: integer2("overdue_invoice_reminders_enabled", { mode: "boolean" }).notNull().default(true),
  overdueReminderDays: integer2("overdue_reminder_days").notNull().default(3),
  invoiceGroupBy: text("invoice_group_by", { enum: ["creation_date", "due_date", "client"] }).notNull().default("creation_date"),
  addShippingAddress: integer2("add_shipping_address", { mode: "boolean" }).notNull().default(false),
  addJobSiteAddress: integer2("add_job_site_address", { mode: "boolean" }).notNull().default(true),
  convertToQuote: integer2("convert_to_quote", { mode: "boolean" }).notNull().default(false),
  notificationsEnabled: integer2("notifications_enabled", { mode: "boolean" }).notNull().default(true),
  simpleMode: integer2("simple_mode", { mode: "boolean" }).notNull().default(true),
  logoBlobKey: text("logo_blob_key"),
  coverBlobKey: text("cover_blob_key"),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var timeEntries = sqliteTable("time_entries", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  crewMember: text("crew_member").notNull().default(""),
  startedAt: integer2("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer2("ended_at", { mode: "timestamp_ms" }),
  clockInLatitude: text("clock_in_latitude"),
  clockInLongitude: text("clock_in_longitude"),
  clockOutLatitude: text("clock_out_latitude"),
  clockOutLongitude: text("clock_out_longitude"),
  note: text("note").notNull().default(""),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var receipts = sqliteTable("receipts", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  vendor: text("vendor").notNull().default(""),
  amount: text("amount").notNull().default("0"),
  purchaseDate: text("purchase_date").notNull().default(""),
  supplierId: integer2("supplier_id"),
  note: text("note").notNull().default(""),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var crewTasks = sqliteTable("crew_tasks", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  completed: integer2("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var voiceNotes = sqliteTable("voice_notes", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  durationSeconds: integer2("duration_seconds").notNull().default(0),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var payments = sqliteTable("payments", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer2("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amount: text("amount").notNull(),
  paymentDate: text("payment_date").notNull(),
  method: text("method").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var completionCertificates = sqliteTable("completion_certificates", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  completionDate: text("completion_date").notNull(),
  warrantyTerms: text("warranty_terms").notNull().default(""),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var appointments = sqliteTable("appointments", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").references(() => jobs.id, { onDelete: "set null" }),
  clientId: integer2("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull().default(""),
  startsAt: text("starts_at").notNull(),
  notes: text("notes").notNull().default(""),
  exteriorWork: integer2("exterior_work", { mode: "boolean" }).notNull().default(false),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var leads = sqliteTable("leads", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  source: text("source").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  serviceType: text("service_type").notNull().default(""),
  preferredContactTime: text("preferred_contact_time").notNull().default(""),
  notes: text("notes").notNull().default(""),
  stage: text("stage", { enum: ["new", "contacted", "quoted", "won", "lost"] }).notNull().default("new"),
  clientId: integer2("client_id").references(() => clients.id, { onDelete: "set null" }),
  quoteId: integer2("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  projectSize: text("project_size", { enum: ["small", "medium", "large"] }).notNull().default("medium"),
  engagement: text("engagement", { enum: ["slow", "normal", "fast"] }).notNull().default("normal"),
  score: integer2("score").notNull().default(50),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var selections = sqliteTable("selections", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  item: text("item").notNull(),
  vendor: text("vendor").notNull().default(""),
  photoBlobKey: text("photo_blob_key"),
  photoFilename: text("photo_filename").notNull().default(""),
  photoContentType: text("photo_content_type").notNull().default(""),
  approvalStatus: text("approval_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  leadTimeDays: integer2("lead_time_days").notNull().default(0),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var dailyLogs = sqliteTable("daily_logs", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  logDate: text("log_date").notNull(),
  crew: text("crew").notNull().default(""),
  hours: text("hours").notNull().default("0"),
  photoIdsJson: text("photo_ids_json").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var internalNotes = sqliteTable("internal_notes", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  clientId: integer2("client_id").references(() => clients.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  reminderDate: text("reminder_date").notNull().default(""),
  completed: integer2("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var paymentMilestones = sqliteTable("payment_milestones", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  invoiceId: integer2("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  amount: text("amount").notNull().default("0"),
  percentage: text("percentage").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  status: text("status", { enum: ["pending", "paid"] }).notNull().default("pending"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var automationLogs = sqliteTable("automation_logs", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["quote_chase", "payment", "review", "reengagement", "quote_expiry", "crew"] }).notNull(),
  entityId: integer2("entity_id").notNull(),
  stage: text("stage").notNull().default(""),
  channel: text("channel", { enum: ["sms"] }).notNull().default("sms"),
  sentAt: integer2("sent_at", { mode: "timestamp_ms" }).notNull()
});
var supportReports = sqliteTable("support_reports", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["support", "problem", "question", "general", "feature"] }).notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  language: text("language", { enum: ["en", "es"] }).notNull().default("en"),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  isUnread: integer2("is_unread", { mode: "boolean" }).notNull().default(true),
  resolvedAt: integer2("resolved_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var priceBookItems = sqliteTable("price_book_items", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  unitPrice: text("unit_price").notNull().default("0"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var quoteTemplates = sqliteTable("quote_templates", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  lineItemsJson: text("line_items_json").notNull(),
  isStarter: integer2("is_starter", { mode: "boolean" }).notNull().default(false),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var mileageTrips = sqliteTable("mileage_trips", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  tripDate: text("trip_date").notNull(),
  fromLocation: text("from_location").notNull().default(""),
  toLocation: text("to_location").notNull().default(""),
  miles: text("miles").notNull().default("0"),
  jobId: integer2("job_id").references(() => jobs.id, { onDelete: "set null" }),
  purpose: text("purpose").notNull().default(""),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var businessExpenses = sqliteTable("business_expenses", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  expenseDate: text("expense_date").notNull(),
  vendor: text("vendor").notNull().default(""),
  amount: text("amount").notNull().default("0"),
  category: text("category").notNull().default("other"),
  jobId: integer2("job_id").references(() => jobs.id, { onDelete: "set null" }),
  supplierId: integer2("supplier_id"),
  note: text("note").notNull().default(""),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var subcontractors = sqliteTable("subcontractors", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  trade: text("trade").notNull().default(""),
  phone: text("phone").notNull().default(""),
  agreedAmount: text("agreed_amount").notNull().default("0"),
  paidToDate: text("paid_to_date").notNull().default("0"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var shareImages = sqliteTable("share_images", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  beforePhotoId: integer2("before_photo_id").notNull(),
  afterPhotoId: integer2("after_photo_id").notNull(),
  branded: integer2("branded", { mode: "boolean" }).notNull().default(true),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var warranties = sqliteTable("warranties", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  clientId: integer2("client_id").references(() => clients.id, { onDelete: "set null" }),
  terms: text("terms").notNull().default(""),
  startDate: text("start_date").notNull(),
  durationMonths: integer2("duration_months").notNull().default(12),
  expiryDate: text("expiry_date").notNull(),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var slideshowVideos = sqliteTable("slideshow_videos", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  caption: text("caption").notNull().default(""),
  branded: integer2("branded", { mode: "boolean" }).notNull().default(true),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var scannedDocuments = sqliteTable("scanned_documents", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  expenseId: integer2("expense_id").references(() => businessExpenses.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["receipt", "contract", "other"] }).notNull().default("receipt"),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var suppliers = sqliteTable("suppliers", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var maintenancePlans = sqliteTable("maintenance_plans", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  clientId: integer2("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull().default(""),
  title: text("title").notNull(),
  tasks: text("tasks").notNull().default(""),
  startDate: text("start_date").notNull(),
  intervalMonths: integer2("interval_months").notNull().default(12),
  nextDueDate: text("next_due_date").notNull(),
  lastJobId: integer2("last_job_id").references(() => jobs.id, { onDelete: "set null" }),
  active: integer2("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var appUsers = sqliteTable("app_users", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role", { enum: ["owner", "crew"] }).notNull().default("crew"),
  isCurrent: integer2("is_current", { mode: "boolean" }).notNull().default(false),
  active: integer2("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var adminParameters = sqliteTable("admin_parameters", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey(),
  paymentDay1: integer2("payment_day_1").notNull().default(3),
  paymentDay2: integer2("payment_day_2").notNull().default(14),
  paymentDay3: integer2("payment_day_3").notNull().default(30),
  reviewDelayDays: integer2("review_delay_days").notNull().default(1),
  reengagementMonth1: integer2("reengagement_month_1").notNull().default(6),
  reengagementMonth2: integer2("reengagement_month_2").notNull().default(12),
  quoteExpiryWarningDays: integer2("quote_expiry_warning_days").notNull().default(3),
  materialLeadTimeDays: integer2("material_lead_time_days").notNull().default(14),
  defaultTaxRate: text("default_tax_rate").notNull().default("0"),
  hourlyLaborCost: text("hourly_labor_cost").notNull().default("0"),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var portalTokens = sqliteTable("portal_tokens", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  tokenHint: text("token_hint").notNull(),
  revokedAt: integer2("revoked_at", { mode: "timestamp_ms" }),
  expiresAt: integer2("expires_at", { mode: "timestamp_ms" }),
  viewCount: integer2("view_count").notNull().default(0),
  firstViewedAt: integer2("first_viewed_at", { mode: "timestamp_ms" }),
  lastViewedAt: integer2("last_viewed_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var portalLinkEvents = sqliteTable("portal_link_events", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  linkId: integer2("link_id").notNull().references(() => portalTokens.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["view", "approve_selection", "reject_selection", "sign"] }).notNull(),
  userAgent: text("user_agent").notNull().default(""),
  occurredAt: integer2("occurred_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var rateLimitEvents = sqliteTable("rate_limit_events", {
  id: integer2("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  occurredAt: integer2("occurred_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var documentLinks = sqliteTable("document_links", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  documentKind: text("document_kind", { enum: ["invoice", "quote", "contract", "change_order"] }).notNull(),
  documentId: integer2("document_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenHint: text("token_hint").notNull(),
  expiresAt: integer2("expires_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer2("revoked_at", { mode: "timestamp_ms" }),
  viewCount: integer2("view_count").notNull().default(0),
  firstViewedAt: integer2("first_viewed_at", { mode: "timestamp_ms" }),
  lastViewedAt: integer2("last_viewed_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var documentLinkEvents = sqliteTable("document_link_events", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  linkId: integer2("link_id").notNull().references(() => documentLinks.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["view", "sign"] }).notNull(),
  userAgent: text("user_agent").notNull().default(""),
  occurredAt: integer2("occurred_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var materialCostItems = sqliteTable("material_cost_items", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  nameEn: text("name_en").notNull(),
  nameEs: text("name_es").notNull(),
  unitEn: text("unit_en").notNull(),
  unitEs: text("unit_es").notNull(),
  price: text("price").notNull().default("0.00"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var supplierQuotes = sqliteTable("supplier_quotes", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  supplierId: integer2("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  jobId: integer2("job_id").references(() => jobs.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  lineItemsJson: text("line_items_json").notNull(),
  total: text("total").notNull().default("0.00"),
  selected: integer2("selected", { mode: "boolean" }).notNull().default(false),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var purchaseOrders = sqliteTable("purchase_orders", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  supplierId: integer2("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  jobId: integer2("job_id").references(() => jobs.id, { onDelete: "set null" }),
  supplierQuoteId: integer2("supplier_quote_id").references(() => supplierQuotes.id, { onDelete: "set null" }),
  number: text("number").notNull(),
  status: text("status", { enum: ["draft", "sent", "partially_received", "received", "cancelled"] }).notNull().default("draft"),
  lineItemsJson: text("line_items_json").notNull(),
  total: text("total").notNull().default("0.00"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var equipment = sqliteTable("equipment", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default(""),
  purchaseDate: text("purchase_date").notNull().default(""),
  cost: text("cost").notNull().default("0.00"),
  serialNumber: text("serial_number").notNull().default(""),
  assignedTo: text("assigned_to").notNull().default("shop"),
  photoBlobKey: text("photo_blob_key"),
  maintenanceTask: text("maintenance_task").notNull().default(""),
  maintenanceEveryDays: integer2("maintenance_every_days").notNull().default(90),
  nextMaintenanceDate: text("next_maintenance_date").notNull().default(""),
  checkedOutAt: integer2("checked_out_at", { mode: "timestamp_ms" }),
  returnedAt: integer2("returned_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var safetyTalks = sqliteTable("safety_talks", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  topicKey: text("topic_key").notNull(),
  talkDate: text("talk_date").notNull(),
  checklistJson: text("checklist_json").notNull().default("[]"),
  acknowledgementsJson: text("acknowledgements_json").notNull().default("[]"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var incidents = sqliteTable("incidents", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  incidentDate: text("incident_date").notNull(),
  description: text("description").notNull(),
  severity: text("severity", { enum: ["near_miss", "minor", "serious"] }).notNull(),
  correctiveAction: text("corrective_action").notNull().default(""),
  photoBlobKey: text("photo_blob_key"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var credentials = sqliteTable("credentials", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  ownerType: text("owner_type", { enum: ["business", "subcontractor"] }).notNull(),
  subcontractorId: integer2("subcontractor_id").references(() => subcontractors.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  identifier: text("identifier").notNull().default(""),
  expiresOn: text("expires_on").notNull(),
  renewedAt: integer2("renewed_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var crewPayRates = sqliteTable("crew_pay_rates", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  crewMember: text("crew_member").notNull().unique(),
  hourlyRate: text("hourly_rate").notNull().default("0.00"),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var completionOverrides = sqliteTable("completion_overrides", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  jobId: integer2("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  missingStages: text("missing_stages").notNull(),
  note: text("note").notNull(),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var marketplaceListings = sqliteTable("marketplace_listings", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category", { enum: ["kitchens", "bathrooms", "plumbing", "electrical", "hvac", "roofing", "tile_flooring", "painting", "concrete", "landscaping", "handyman", "equipment", "materials", "other"] }).notNull(),
  listingType: text("listing_type", { enum: ["job", "project"] }).notNull().default("project"),
  employmentType: text("employment_type", { enum: ["full_time", "part_time", "temporary"] }).notNull().default("full_time"),
  payUnit: text("pay_unit", { enum: ["hourly", "salary"] }).notNull().default("hourly"),
  priceKind: text("price_kind", { enum: ["amount", "free", "contact"] }).notNull().default("contact"),
  price: text("price").notNull().default(""),
  originalPrice: text("original_price").notNull().default(""),
  description: text("description").notNull().default(""),
  serviceArea: text("service_area").notNull(),
  companyName: text("company_name").notNull(),
  companyPhone: text("company_phone").notNull().default(""),
  bookable: integer2("bookable", { mode: "boolean" }).notNull().default(false),
  dailyRate: text("daily_rate").notNull().default(""),
  promoted: integer2("promoted", { mode: "boolean" }).notNull().default(false),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var marketplaceListingPhotos = sqliteTable("marketplace_listing_photos", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  listingId: integer2("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sortOrder: integer2("sort_order").notNull().default(0),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var marketplaceMessages = sqliteTable("marketplace_messages", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  listingId: integer2("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  body: text("body").notNull().default(""),
  imageBlobKey: text("image_blob_key"),
  imageFilename: text("image_filename").notNull().default(""),
  imageContentType: text("image_content_type").notNull().default(""),
  sender: text("sender", { enum: ["me", "other"] }).notNull().default("me"),
  readAt: integer2("read_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var marketplaceBookingRequests = sqliteTable("marketplace_booking_requests", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  listingId: integer2("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  note: text("note").notNull().default(""),
  status: text("status", { enum: ["requested", "confirmed", "declined"] }).notNull().default("requested"),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var marketplaceRequests = sqliteTable("marketplace_requests", {
  companyId: integer2("company_id").notNull().default(1),
  id: integer2("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category", { enum: ["kitchens", "bathrooms", "plumbing", "electrical", "hvac", "roofing", "tile_flooring", "painting", "concrete", "landscaping", "handyman", "equipment", "materials", "other"] }).notNull(),
  listingType: text("listing_type", { enum: ["job", "project"] }).notNull().default("project"),
  description: text("description").notNull().default(""),
  serviceArea: text("service_area").notNull(),
  neededBy: text("needed_by").notNull().default(""),
  companyName: text("company_name").notNull(),
  companyPhone: text("company_phone").notNull().default(""),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var authUsers = sqliteTable("auth_users", {
  id: integer2("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer2("password_iterations").notNull().default(210000),
  emailVerifiedAt: integer2("email_verified_at", { mode: "timestamp_ms" }),
  companyId: integer2("company_id").notNull().default(1),
  role: text("role", { enum: ["owner"] }).notNull().default("owner"),
  tier: text("tier", { enum: ["free", "premium"] }).notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  subscriptionCurrentPeriodEnd: integer2("subscription_current_period_end", { mode: "timestamp_ms" }),
  cancelAtPeriodEnd: integer2("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
  dataClaimedAt: integer2("data_claimed_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  updatedAt: integer2("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var authSessions = sqliteTable("auth_sessions", {
  id: integer2("id").primaryKey({ autoIncrement: true }),
  userId: integer2("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  tokenType: text("token_type", { enum: ["legacy", "proof", "refresh"] }).notNull().default("legacy"),
  familyId: text("family_id"),
  replacedBy: text("replaced_by"),
  absoluteExpiresAt: integer2("absolute_expires_at", { mode: "timestamp_ms" }),
  userAgent: text("user_agent").notNull().default(""),
  ipHash: text("ip_hash").notNull().default(""),
  expiresAt: integer2("expires_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer2("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer2("revoked_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var authTokens = sqliteTable("auth_tokens", {
  id: integer2("id").primaryKey({ autoIncrement: true }),
  userId: integer2("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["verify_email", "reset_password"] }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer2("expires_at", { mode: "timestamp_ms" }).notNull(),
  consumedAt: integer2("consumed_at", { mode: "timestamp_ms" }),
  createdAt: integer2("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var authLoginAttempts = sqliteTable("auth_login_attempts", {
  id: integer2("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  attemptedAt: integer2("attempted_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var stripeWebhookEvents = sqliteTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: integer2("processed_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date)
});
var backupRuns = sqliteTable("backup_runs", {
  id: integer2("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["daily-db", "weekly-full", "manual", "monthly-verify"] }).notNull(),
  status: text("status", { enum: ["running", "ok", "failed"] }).notNull(),
  startedAt: integer2("started_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date),
  finishedAt: integer2("finished_at", { mode: "timestamp_ms" }),
  dbBytes: integer2("db_bytes"),
  blobBytes: integer2("blob_bytes"),
  totalBytes: integer2("total_bytes"),
  filePath: text("file_path"),
  offsiteSent: integer2("offsite_sent", { mode: "boolean" }).notNull().default(false),
  integrityOk: integer2("integrity_ok", { mode: "boolean" }),
  error: text("error"),
  notes: text("notes")
}, (table) => [
  index("idx_backup_runs_started").on(table.startedAt)
]);

// src/auth-email.ts
function authCodeClientResult(code, delivery) {
  return {
    emailDelivery: delivery,
    displayCode: delivery === "fallback" ? code : null
  };
}

// .generated/privileged.contract.ts
var privileged = definePrivilegedContracts({
  renderPdfPages: {
    request: object({ dataBase64: string2().min(1).max(30000000) }),
    response: object({ pagesBase64: array(string2()).max(20) }),
    capabilities: [],
    timeoutMs: 45000
  },
  sendAuthEmail: {
    request: object({
      to: string2().email().max(200),
      code: string2().regex(/^\d{6}$/),
      purpose: _enum(["verify_email", "reset_password"])
    }),
    response: object({ delivery: _enum(["sent", "fallback", "failed"]) }),
    capabilities: [],
    timeoutMs: 20000
  },
  sendBackupEmail: {
    request: object({
      to: string2().email().max(200),
      subject: string2().min(1).max(200),
      text: string2().min(1).max(20000),
      attachments: array(object({
        filename: string2().min(1).max(240),
        contentType: string2().min(1).max(120),
        dataBase64: string2().min(1).max(60000000)
      })).max(3)
    }),
    response: object({ delivery: _enum(["sent", "failed"]) }),
    capabilities: [],
    timeoutMs: 60000
  },
  sendSecurityAlert: {
    request: object({
      to: string2().email().max(200),
      subject: string2().min(1).max(200),
      text: string2().min(1).max(20000)
    }),
    response: object({ delivery: _enum(["sent", "failed"]) }),
    capabilities: [],
    timeoutMs: 20000
  },
  createStripeCheckout: {
    request: object({ userId: number2().int().positive(), companyId: number2().int().positive(), email: string2().email().max(200) }),
    response: object({ configured: boolean2(), checkoutUrl: string2().nullable(), missing: array(string2()) }),
    capabilities: [],
    timeoutMs: 20000
  },
  verifyStripeWebhook: {
    request: object({ payload: string2().min(1).max(1e6), signature: string2().min(1).max(2000) }),
    response: object({
      eventId: string2(),
      eventType: _enum(["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted", "ignored"]),
      userId: number2().int().positive().nullable(),
      customerId: string2().nullable(),
      subscriptionId: string2().nullable(),
      subscriptionStatus: string2().nullable(),
      currentPeriodEnd: number2().int().nullable(),
      cancelAtPeriodEnd: boolean2()
    }),
    capabilities: [],
    timeoutMs: 20000
  }
});

// src/actions.ts
var stageSchema = _enum(["before", "during", "after"]);
var languageSchema = _enum(["en", "es"]);
var quoteThemeSchema = _enum(["classic", "modern", "bold", "minimal"]);
var documentFontSchema = _enum(["helvetica", "times", "courier", "palatino"]);
var adjustmentTypeSchema = _enum(["percent", "fixed"]);
var invoiceStatusSchema = _enum(["draft", "sent", "paid", "overdue"]);
var documentKindSchema = _enum(["invoice", "quote", "contract", "change_order"]);
var clientSchema = object({ id: number2(), name: string2(), phone: string2(), email: string2(), address: string2(), notes: string2(), tags: array(string2()), referredByClientId: number2().nullable(), referredByName: string2().nullable(), referralCount: number2(), jobCount: number2(), quoteCount: number2(), totalInvoiced: number2(), totalPaid: number2(), balanceDue: number2(), invoiceCount: number2(), paymentPercent: number2(), createdAt: string2(), updatedAt: string2() });
var jobSchema = object({
  id: number2(),
  clientId: number2().nullable(),
  clientName: string2(),
  clientPhone: string2(),
  clientEmail: string2(),
  jobAddress: string2(),
  jobType: string2(),
  notes: string2(),
  jobDate: string2(),
  appointmentAt: string2(),
  amountDue: string2(),
  dueDate: string2(),
  depositAmount: string2(),
  paymentNotes: string2(),
  galleryPick: boolean2(),
  photoCount: number2(),
  requiredPhotoStages: array(stageSchema),
  photoCompleteness: number2(),
  completedAt: string2().nullable(),
  completionOverrideNote: string2(),
  createdAt: string2(),
  updatedAt: string2()
});
var photoSchema = object({
  id: number2(),
  jobId: number2(),
  stage: stageSchema,
  caption: string2(),
  filename: string2(),
  contentType: string2(),
  url: string2(),
  galleryPick: boolean2(),
  excludeFromSocial: boolean2(),
  annotatedFromId: number2().nullable(),
  capturedAt: string2(),
  createdAt: string2()
});
var documentSchema = object({
  id: number2(),
  jobId: number2(),
  kind: _enum(["contract", "change_order"]),
  title: string2(),
  bodyText: string2(),
  originalFilename: string2(),
  originalUrl: string2().nullable(),
  description: string2(),
  amount: string2(),
  signerName: string2(),
  signatureUrl: string2(),
  signedAt: string2(),
  clientSignerName: string2(),
  clientSignedAt: string2().nullable(),
  clientSignatureHash: string2(),
  signedPdfUrl: string2().nullable()
});
var punchItemSchema = object({ id: number2(), jobId: number2(), text: string2(), completed: boolean2() });
var punchSignoffSchema = object({ id: number2(), jobId: number2(), customerName: string2(), customerSignatureUrl: string2(), contractorName: string2(), contractorSignatureUrl: string2(), signedAt: string2() });
var progressSchema = object({ id: number2(), jobId: number2(), dayNumber: number2(), note: string2(), photoIds: array(number2()), status: _enum(["draft", "sent"]), createdAt: string2(), updatedAt: string2() });
var quoteItemSchema = object({ description: string2().trim().min(1).max(300), amount: string2().trim().min(1).max(80) });
var invoiceItemSchema = quoteItemSchema.extend({
  name: string2().trim().max(160).default(""),
  quantity: number2().min(0).max(1e5).default(1),
  discount: string2().trim().max(80).default("0"),
  unit: _enum(["none", "days", "hours"]).default("none")
});
var documentVisibilitySchema = object({ showTaxLine: boolean2(), showDiscountLine: boolean2(), showPaidLine: boolean2(), showPaymentTerms: boolean2(), showFooterNotes: boolean2(), showLogo: boolean2(), showCompanyInfo: boolean2() });
var customizeJsonSchema = string2().max(5000000).refine((value) => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}, "Invalid document customization.");
var financialFieldsSchema = object({ subtotal: string2(), discountType: adjustmentTypeSchema, discountValue: string2(), taxType: adjustmentTypeSchema, taxValue: string2(), total: string2(), footnote: string2(), theme: quoteThemeSchema, font: documentFontSchema, accentColor: string2().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape);
var quoteSchema = object({ id: number2(), clientId: number2().nullable(), clientName: string2(), clientPhone: string2(), clientEmail: string2(), jobAddress: string2(), shippingAddress: string2(), jobType: string2(), lineItems: array(quoteItemSchema), expiryDate: string2(), sentAt: string2(), automationStatus: _enum(["awaiting", "won", "lost"]), lostReason: _enum(["price", "timing", "competitor", "no_response", "other"]).nullable(), lostNote: string2(), jobId: number2().nullable(), seriesId: number2(), parentQuoteId: number2().nullable(), versionNumber: number2(), superseded: boolean2(), accepted: boolean2(), createdAt: string2(), updatedAt: string2() }).extend(financialFieldsSchema.shape);
var paymentSchema = object({ id: number2(), invoiceId: number2(), amount: string2(), paymentDate: string2(), method: string2(), note: string2(), createdAt: string2() });
var invoiceSchema = object({ id: number2(), invoiceNumber: string2(), quoteId: number2().nullable(), jobId: number2().nullable(), clientId: number2().nullable(), clientName: string2(), clientPhone: string2(), clientEmail: string2(), jobAddress: string2(), shippingAddress: string2(), jobType: string2(), lineItems: array(invoiceItemSchema), issueDate: string2(), dueDate: string2(), status: invoiceStatusSchema, recurringFrequency: _enum(["none", "daily", "weekly", "monthly", "quarterly"]), nextDueDate: string2(), seriesId: number2(), parentInvoiceId: number2().nullable(), recurringEndDate: string2(), recurringCancelled: boolean2(), paidToDate: string2(), balanceRemaining: string2(), lateFeeAccrued: string2(), totalWithLateFee: string2(), payments: array(paymentSchema), createdAt: string2(), updatedAt: string2() }).extend(financialFieldsSchema.shape);
var timeEntrySchema = object({ id: number2(), jobId: number2(), crewMember: string2(), startedAt: string2(), endedAt: string2().nullable(), note: string2(), durationSeconds: number2() });
var receiptSchema = object({ id: number2(), jobId: number2(), vendor: string2(), amount: string2(), purchaseDate: string2(), note: string2(), filename: string2(), url: string2(), createdAt: string2() });
var crewTaskSchema = object({ id: number2(), jobId: number2(), text: string2(), completed: boolean2(), createdAt: string2(), updatedAt: string2() });
var voiceNoteSchema = object({ id: number2(), jobId: number2(), title: string2(), url: string2(), durationSeconds: number2(), createdAt: string2() });
var certificateSchema = object({ id: number2(), jobId: number2(), completionDate: string2(), warrantyTerms: string2(), createdAt: string2(), updatedAt: string2() });
var settingsInputSchema = object({ companyName: string2().trim().max(180), licenseNumber: string2().trim().max(80), phone: string2().trim().max(80), email: string2().trim().email().max(200).or(literal("")), website: string2().trim().max(300), address: string2().trim().max(500), profileDescription: string2().trim().max(3000), serviceArea: string2().trim().max(500), facebookUrl: string2().trim().max(600), instagramUrl: string2().trim().max(600), youtubeUrl: string2().trim().max(600), reviewUrl: string2().trim().max(600), paymentInstructions: string2().trim().max(1500), quoteFollowUpDays: number2().int().min(1).max(60), offersFreeEstimates: boolean2(), socialWatermark: boolean2(), language: languageSchema, accentColor: string2().regex(/^#[0-9a-fA-F]{6}$/), defaultQuoteTheme: quoteThemeSchema, defaultDocumentFont: documentFontSchema, defaultShowTaxLine: boolean2(), defaultShowDiscountLine: boolean2(), defaultShowPaidLine: boolean2(), defaultShowPaymentTerms: boolean2(), defaultShowFooterNotes: boolean2(), defaultShowLogo: boolean2(), defaultShowCompanyInfo: boolean2(), defaultCustomizeJson: customizeJsonSchema, defaultFootnote: string2().trim().max(3000), warrantyTerms: string2().trim().max(5000), hourlyCostRate: string2().trim().max(80), lateFeeType: _enum(["flat", "percent"]), lateFeeValue: string2().trim().max(80), lateFeeGraceDays: number2().int().min(0).max(365), costAlertPercent: number2().int().min(50).max(100), paymentRemindersEnabled: boolean2(), onlineSignatureEnabled: boolean2(), overdueInvoiceRemindersEnabled: boolean2(), overdueReminderDays: number2().int().min(1).max(90), invoiceGroupBy: _enum(["creation_date", "due_date", "client"]), addShippingAddress: boolean2(), addJobSiteAddress: boolean2(), convertToQuote: boolean2(), notificationsEnabled: boolean2(), simpleMode: boolean2() });
var settingsSchema = settingsInputSchema.extend({ logoUrl: string2().nullable(), coverUrl: string2().nullable() });
var clientInputSchema = object({ name: string2().trim().min(1).max(160), phone: string2().trim().max(80), email: string2().trim().email().max(200).or(literal("")), address: string2().trim().max(240), notes: string2().trim().max(2000), tags: array(string2().trim().min(1).max(40)).max(12).default([]), referredByClientId: number2().int().positive().nullable().default(null) });
function normalizeClientTags(tags) {
  if (!Array.isArray(tags))
    return [];
  const seen = new Set;
  const out = [];
  for (const raw of tags) {
    if (typeof raw !== "string")
      continue;
    const tag = raw.trim();
    if (!tag || tag.length > 40)
      continue;
    const key = tag.toLowerCase();
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 12)
      break;
  }
  return out;
}
function parseClientTags(raw) {
  if (Array.isArray(raw))
    return normalizeClientTags(raw);
  if (typeof raw !== "string" || !raw)
    return [];
  try {
    return normalizeClientTags(JSON.parse(raw));
  } catch {
    return [];
  }
}
function clientBalanceDue(totalInvoiced, totalPaid) {
  return Math.max(0, Math.round((totalInvoiced - totalPaid) * 100) / 100);
}
var leadStageSchema = _enum(["new", "contacted", "quoted", "won", "lost"]);
var appointmentSchema = object({ id: number2(), jobId: number2().nullable(), clientId: number2().nullable(), clientName: string2(), clientPhone: string2(), startsAt: string2(), notes: string2(), exteriorWork: boolean2() });
var priceBookSchema = object({ id: number2(), name: string2(), description: string2(), unitPrice: string2(), createdAt: string2() });
var templateSchema = object({ id: number2(), name: string2(), lineItems: array(quoteItemSchema), isStarter: boolean2(), createdAt: string2() });
var mileageSchema = object({ id: number2(), tripDate: string2(), fromLocation: string2(), toLocation: string2(), miles: string2(), jobId: number2().nullable(), jobName: string2().nullable(), purpose: string2(), createdAt: string2() });
var expenseSchema = object({ id: number2(), expenseDate: string2(), vendor: string2(), amount: string2(), category: string2(), jobId: number2().nullable(), jobName: string2().nullable(), supplierId: number2().nullable(), note: string2(), createdAt: string2() });
var subcontractorSchema = object({ id: number2(), jobId: number2(), name: string2(), trade: string2(), phone: string2(), agreedAmount: string2(), paidToDate: string2(), balance: number2(), createdAt: string2() });
var shareImageSchema = object({ id: number2(), jobId: number2(), beforePhotoId: number2(), afterPhotoId: number2(), branded: boolean2(), filename: string2(), url: string2(), createdAt: string2() });
var leadSchema = object({ id: number2(), name: string2(), phone: string2(), email: string2(), address: string2(), serviceType: string2(), preferredContactTime: string2(), source: string2(), notes: string2(), stage: leadStageSchema, projectSize: _enum(["small", "medium", "large"]), engagement: _enum(["slow", "normal", "fast"]), score: number2(), clientId: number2().nullable(), quoteId: number2().nullable(), createdAt: string2() });
var selectionSchema = object({ id: number2(), jobId: number2(), category: string2(), item: string2(), vendor: string2(), photoUrl: string2().nullable(), approvalStatus: _enum(["pending", "approved", "rejected"]), leadTimeDays: number2(), createdAt: string2() });
var dailyLogSchema = object({ id: number2(), jobId: number2(), logDate: string2(), crew: string2(), hours: string2(), photoIds: array(number2()), notes: string2(), createdAt: string2() });
var internalNoteSchema = object({ id: number2(), jobId: number2().nullable(), clientId: number2().nullable(), note: string2(), reminderDate: string2(), completed: boolean2(), createdAt: string2() });
var milestoneSchema = object({ id: number2(), jobId: number2(), invoiceId: number2().nullable(), label: string2(), amount: string2(), percentage: string2(), dueDate: string2(), status: _enum(["pending", "paid"]), createdAt: string2() });
var marketplaceCategorySchema = _enum(["kitchens", "bathrooms", "plumbing", "electrical", "hvac", "roofing", "tile_flooring", "painting", "concrete", "landscaping", "handyman", "equipment", "materials", "other"]);
var marketplacePhotoSchema = object({ id: number2(), url: string2(), filename: string2() });
var marketplaceListingSchema = object({ id: number2(), title: string2(), category: marketplaceCategorySchema, listingType: _enum(["job", "project"]), employmentType: _enum(["full_time", "part_time", "temporary"]), payUnit: _enum(["hourly", "salary"]), priceKind: _enum(["amount", "free", "contact"]), price: string2(), originalPrice: string2(), description: string2(), serviceArea: string2(), companyName: string2(), companyPhone: string2(), bookable: boolean2(), dailyRate: string2(), promoted: boolean2(), isMine: boolean2(), photos: array(marketplacePhotoSchema), justListed: boolean2(), createdAt: string2(), updatedAt: string2() });
var marketplaceRequestSchema = object({ id: number2(), title: string2(), category: marketplaceCategorySchema, listingType: _enum(["job", "project"]), description: string2(), serviceArea: string2(), neededBy: string2(), companyName: string2(), companyPhone: string2(), createdAt: string2(), updatedAt: string2() });
var marketplaceMessageSchema = object({ id: number2(), listingId: number2(), body: string2(), imageUrl: string2().nullable(), imageFilename: string2(), sender: _enum(["me", "other"]), isRead: boolean2(), createdAt: string2() });
var marketplaceInboxRowSchema = object({ listingId: number2(), listingTitle: string2(), companyName: string2(), lastMessage: string2(), lastMessageAt: string2(), unreadCount: number2() });
var marketplaceBookingSchema = object({ id: number2(), listingId: number2(), startDate: string2(), endDate: string2(), note: string2(), status: _enum(["requested", "confirmed", "declined"]), createdAt: string2() });
function jobShape(row, photoCount = 0, photoStages = []) {
  const requiredPhotoStages = row.requiredPhotoStages.split(",").filter((stage) => stage === "before" || stage === "during" || stage === "after");
  const complete = requiredPhotoStages.filter((stage) => photoStages.includes(stage)).length;
  return { id: row.id, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, clientEmail: row.clientEmail, jobAddress: row.jobAddress, jobType: row.jobType, notes: row.notes, jobDate: row.jobDate, appointmentAt: row.appointmentAt, amountDue: row.amountDue, dueDate: row.dueDate, depositAmount: row.depositAmount, paymentNotes: row.paymentNotes, galleryPick: row.galleryPick, photoCount, requiredPhotoStages, photoCompleteness: requiredPhotoStages.length ? Math.round(complete / requiredPhotoStages.length * 100) : 100, completedAt: row.completedAt?.toISOString() ?? null, completionOverrideNote: row.completionOverrideNote, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function normalizedPhone(value) {
  return value.replace(/\D/g, "");
}
function normalizeMoney(value, emptyValue = "") {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned)
    return emptyValue;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount))
    throw new Error("Enter a valid amount.");
  return amount.toFixed(2);
}
function normalizeLineItems(items) {
  return items.map((item) => ({
    name: item.name?.trim() ?? "",
    description: item.description.trim(),
    amount: normalizeMoney(item.amount, "0.00"),
    quantity: Number.isFinite(item.quantity) ? Math.max(0, item.quantity ?? 1) : 1,
    discount: normalizeMoney(item.discount ?? "0", "0.00"),
    unit: item.unit ?? "none"
  }));
}
async function upsertClient(ctx, input) {
  const db = ctx.db();
  const rows = await db.select().from(clients);
  const phone = normalizedPhone(input.phone);
  const match = rows.find((c) => input.clientId ? c.id === input.clientId : phone && normalizedPhone(c.phone) === phone || c.name.trim().toLowerCase() === input.name.trim().toLowerCase());
  const now = new Date;
  if (match) {
    await db.update(clients).set({ name: input.name, phone: input.phone, email: input.email, address: input.address, updatedAt: now }).where(eq(clients.id, match.id));
    return match.id;
  }
  const made = await db.insert(clients).values({ name: input.name, phone: input.phone, email: input.email, address: input.address, notes: "", createdAt: now, updatedAt: now }).returning({ id: clients.id });
  return made[0]?.id ?? null;
}
async function hashPortalToken(token) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
async function hashLinkToken(token) {
  return hashPortalToken(token);
}
async function documentLinkTargetExists(ctx, kind, id) {
  const db = ctx.db();
  if (kind === "invoice")
    return !!(await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, id)).limit(1))[0];
  if (kind === "quote")
    return !!(await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, id)).limit(1))[0];
  const doc = (await db.select({ kind: documents.kind }).from(documents).where(eq(documents.id, id)).limit(1))[0];
  return !!doc && doc.kind === kind;
}
async function getActiveDocumentLinkRow(ctx, kind, id) {
  const db = ctx.db();
  const rows = await db.select().from(documentLinks).where(and(eq(documentLinks.documentKind, kind), eq(documentLinks.documentId, id), isNull(documentLinks.revokedAt))).orderBy(desc(documentLinks.createdAt));
  return rows[0] ?? null;
}
async function resolveDocumentLinkToken(ctx, token) {
  const db = ctx.db();
  const hash = await hashLinkToken(token);
  const link = (await db.select().from(documentLinks).where(eq(documentLinks.tokenHash, hash)).limit(1))[0];
  if (!link || link.revokedAt)
    throw new Error("This link is no longer active.");
  if (link.expiresAt.getTime() < Date.now())
    throw new Error("This link has expired. Please ask for a new one.");
  return link;
}
var PORTAL_RATE_LIMIT_IP_PER_MIN = 30;
var PORTAL_RATE_LIMIT_TOKEN_PER_MIN = 120;
var PORTAL_VIEW_EVENT_THROTTLE_MS = 60 * 60000;
function portalMeta(ctx) {
  return ctx;
}
async function checkPortalRateLimit(ctx, tokenHash) {
  const db = ctx.db();
  const now = Date.now();
  const ip = (portalMeta(ctx).clientIp ?? "").trim() || "unknown";
  await db.delete(rateLimitEvents).where(lt(rateLimitEvents.occurredAt, new Date(now - 3600000)));
  const windowStart = new Date(now - 60000);
  const [ipHits, tokenHits] = await Promise.all([
    db.select({ id: rateLimitEvents.id }).from(rateLimitEvents).where(and(eq(rateLimitEvents.scope, "portal:ip"), eq(rateLimitEvents.key, ip), gte(rateLimitEvents.occurredAt, windowStart))),
    db.select({ id: rateLimitEvents.id }).from(rateLimitEvents).where(and(eq(rateLimitEvents.scope, "portal:token"), eq(rateLimitEvents.key, tokenHash), gte(rateLimitEvents.occurredAt, windowStart)))
  ]);
  if (ipHits.length >= PORTAL_RATE_LIMIT_IP_PER_MIN || tokenHits.length >= PORTAL_RATE_LIMIT_TOKEN_PER_MIN) {
    throw new Error("Too many requests. Try again shortly.");
  }
  await db.batch([
    db.insert(rateLimitEvents).values({ scope: "portal:ip", key: ip, occurredAt: new Date }),
    db.insert(rateLimitEvents).values({ scope: "portal:token", key: tokenHash, occurredAt: new Date })
  ]);
}
async function requirePortalAccess(ctx, token, opts) {
  const db = ctx.db();
  const hash = await hashPortalToken(token);
  await checkPortalRateLimit(ctx, hash);
  const access = (await db.select().from(portalTokens).where(eq(portalTokens.tokenHash, hash)).limit(1))[0];
  if (!access || access.revokedAt)
    throw new Error("This portal link is no longer active.");
  if (access.expiresAt && access.expiresAt.getTime() < Date.now())
    throw new Error("This portal link has expired. Ask your contractor for a new one.");
  if (opts.logView) {
    const now = new Date;
    await db.update(portalTokens).set({ viewCount: access.viewCount + 1, firstViewedAt: access.firstViewedAt ?? now, lastViewedAt: now }).where(eq(portalTokens.id, access.id));
    const lastView = (await db.select({ occurredAt: portalLinkEvents.occurredAt }).from(portalLinkEvents).where(and(eq(portalLinkEvents.linkId, access.id), eq(portalLinkEvents.eventType, "view"))).orderBy(desc(portalLinkEvents.occurredAt)).limit(1))[0];
    if (!lastView || now.getTime() - lastView.occurredAt.getTime() >= PORTAL_VIEW_EVENT_THROTTLE_MS) {
      await db.insert(portalLinkEvents).values({ linkId: access.id, eventType: "view", userAgent: (portalMeta(ctx).userAgent ?? "").slice(0, 300), occurredAt: now });
    }
  }
  return access;
}
async function logPortalEvent(ctx, linkId, eventType) {
  const db = ctx.db();
  await db.insert(portalLinkEvents).values({ linkId, eventType, userAgent: (portalMeta(ctx).userAgent ?? "").slice(0, 300), occurredAt: new Date });
}
function advanceRecurringDate(value, frequency) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime()))
    throw new Error("Enter a valid recurring date.");
  if (frequency === "daily")
    date.setDate(date.getDate() + 1);
  else if (frequency === "weekly")
    date.setDate(date.getDate() + 7);
  else
    date.setMonth(date.getMonth() + (frequency === "quarterly" ? 3 : 1));
  return date.toISOString().slice(0, 10);
}
function quoteDiff(previous, next) {
  const before = JSON.parse(previous.lineItemsJson);
  const after = JSON.parse(next.lineItemsJson);
  const beforeMap = new Map(before.map((item) => [item.description.trim().toLowerCase(), Number(item.amount)]));
  const afterMap = new Map(after.map((item) => [item.description.trim().toLowerCase(), Number(item.amount)]));
  const added = after.filter((item) => !beforeMap.has(item.description.trim().toLowerCase())).map((item) => item.description);
  const removed = before.filter((item) => !afterMap.has(item.description.trim().toLowerCase())).map((item) => item.description);
  const priceChanges = after.flatMap((item) => {
    const old = beforeMap.get(item.description.trim().toLowerCase());
    return old !== undefined && old !== Number(item.amount) ? [`${item.description}: ${old.toFixed(2)} \u2192 ${Number(item.amount).toFixed(2)}`] : [];
  });
  return { added, removed, priceChanges, totalChange: (Number(next.total) - Number(previous.total)).toFixed(2) };
}
function quoteShape(q) {
  return { id: q.id, clientId: q.clientId, clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, jobAddress: q.jobAddress, shippingAddress: q.shippingAddress, jobType: q.jobType, lineItems: JSON.parse(q.lineItemsJson), subtotal: q.subtotal, discountType: q.discountType, discountValue: q.discountValue, taxType: q.taxType, taxValue: q.taxValue, total: q.total, footnote: q.footnote, expiryDate: q.expiryDate, sentAt: q.sentAt, automationStatus: q.automationStatus, lostReason: q.lostReason, lostNote: q.lostNote, theme: q.theme, font: q.font, accentColor: q.accentColor, showTaxLine: q.showTaxLine, showDiscountLine: q.showDiscountLine, showPaidLine: q.showPaidLine, showPaymentTerms: q.showPaymentTerms, showFooterNotes: q.showFooterNotes, showLogo: q.showLogo, showCompanyInfo: q.showCompanyInfo, customizeJson: q.customizeJson, jobId: q.jobId, seriesId: q.seriesId ?? q.id, parentQuoteId: q.parentQuoteId, versionNumber: q.versionNumber, superseded: q.superseded, accepted: q.accepted, createdAt: q.createdAt.toISOString(), updatedAt: q.updatedAt.toISOString() };
}
function invoiceShape(row, paymentRows = [], fee = { type: "flat", value: 0, graceDays: 0 }) {
  const paid = paymentRows.reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0);
  const total = Number(row.total.replace(/[^0-9.-]/g, "") || 0);
  const due = row.dueDate ? new Date(`${row.dueDate}T12:00:00`).getTime() : 0;
  const daysLate = due ? Math.floor((Date.now() - due) / 86400000) - fee.graceDays : 0;
  const monthsLate = Math.max(0, Math.ceil(daysLate / 30));
  const lateFee = row.status !== "paid" && monthsLate > 0 ? fee.type === "percent" ? total * fee.value / 100 * monthsLate : fee.value : 0;
  return { id: row.id, invoiceNumber: row.invoiceNumber || `INV-${String(row.id).padStart(4, "0")}`, quoteId: row.quoteId, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, clientEmail: row.clientEmail, jobAddress: row.jobAddress, shippingAddress: row.shippingAddress, jobType: row.jobType, lineItems: normalizeLineItems(JSON.parse(row.lineItemsJson)), subtotal: row.subtotal, discountType: row.discountType, discountValue: row.discountValue, taxType: row.taxType, taxValue: row.taxValue, total: row.total, footnote: row.footnote, issueDate: row.issueDate, dueDate: row.dueDate, status: row.status, recurringFrequency: row.recurringFrequency, nextDueDate: row.nextDueDate, seriesId: row.seriesId ?? row.id, parentInvoiceId: row.parentInvoiceId, recurringEndDate: row.recurringEndDate, recurringCancelled: row.recurringCancelled, paidToDate: paid.toFixed(2), balanceRemaining: Math.max(0, total + lateFee - paid).toFixed(2), lateFeeAccrued: lateFee.toFixed(2), totalWithLateFee: (total + lateFee).toFixed(2), payments: paymentRows.map((p) => ({ id: p.id, invoiceId: p.invoiceId, amount: p.amount, paymentDate: p.paymentDate, method: p.method, note: p.note, createdAt: p.createdAt.toISOString() })), theme: row.theme, font: row.font, accentColor: row.accentColor, showTaxLine: row.showTaxLine, showDiscountLine: row.showDiscountLine, showPaidLine: row.showPaidLine, showPaymentTerms: row.showPaymentTerms, showFooterNotes: row.showFooterNotes, showLogo: row.showLogo, showCompanyInfo: row.showCompanyInfo, customizeJson: row.customizeJson, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
async function marketplaceListingShape(ctx, row, photoRows) {
  const photos2 = await Promise.all(photoRows.filter((photo) => photo.listingId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map(async (photo) => ({ id: photo.id, url: await ctx.blobs.getUrl(photo.blobKey), filename: photo.filename })));
  return { id: row.id, title: row.title, category: row.category, listingType: row.listingType, employmentType: row.employmentType, payUnit: row.payUnit, priceKind: row.priceKind, price: row.price, originalPrice: row.originalPrice, description: row.description, serviceArea: row.serviceArea, companyName: row.companyName, companyPhone: row.companyPhone, bookable: row.bookable, dailyRate: row.dailyRate, promoted: row.promoted, isMine: row.companyId === workspaceIdentity(ctx).workspaceCompanyId, photos: photos2, justListed: Date.now() - row.createdAt.getTime() < 7 * 86400000, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function marketplaceRequestShape(row) {
  return { id: row.id, title: row.title, category: row.category, listingType: row.listingType, description: row.description, serviceArea: row.serviceArea, neededBy: row.neededBy, companyName: row.companyName, companyPhone: row.companyPhone, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
var BACKUP_TABLES = [
  "clients",
  "jobs",
  "photos",
  "documents",
  "quotes",
  "invoices",
  "financial_document_signatures",
  "punch_items",
  "punch_signoffs",
  "progress_updates",
  "settings",
  "time_entries",
  "receipts",
  "crew_tasks",
  "voice_notes",
  "payments",
  "completion_certificates",
  "appointments",
  "leads",
  "selections",
  "daily_logs",
  "internal_notes",
  "payment_milestones",
  "automation_logs",
  "support_reports",
  "price_book_items",
  "quote_templates",
  "mileage_trips",
  "business_expenses",
  "subcontractors",
  "share_images",
  "warranties",
  "slideshow_videos",
  "scanned_documents",
  "suppliers",
  "maintenance_plans",
  "app_users",
  "admin_parameters",
  "portal_tokens",
  "material_cost_items",
  "supplier_quotes",
  "purchase_orders",
  "equipment",
  "safety_talks",
  "incidents",
  "credentials",
  "crew_pay_rates",
  "completion_overrides",
  "marketplace_listings",
  "marketplace_listing_photos",
  "marketplace_requests",
  "marketplace_messages",
  "marketplace_booking_requests",
  "document_links",
  "document_link_events"
];
function sqlValue(value) {
  if (value === null)
    return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Backup contains an invalid number.");
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}
function validBackup(value) {
  if (!value || typeof value !== "object")
    return false;
  const candidate = value;
  return (candidate.format === "crewkat-backup" || candidate.format === "fieldhq-backup") && candidate.version === 1 && typeof candidate.tables === "object" && candidate.tables !== null && typeof candidate.blobs === "object" && candidate.blobs !== null;
}
async function createBackup(ctx) {
  const db = ctx.db();
  const tables = {};
  const blobKeys = new Set;
  for (const table of BACKUP_TABLES) {
    const rows = await db.all(sql.raw(`SELECT * FROM "${table}"`));
    tables[table] = rows;
    for (const row of rows)
      for (const [column, value] of Object.entries(row)) {
        if (column.endsWith("_blob_key") && typeof value === "string" && value)
          blobKeys.add(value);
      }
  }
  return { format: "crewkat-backup", version: 1, createdAt: new Date().toISOString(), tables, blobs: {} };
}
async function restoreBackup(ctx, backup) {
  const db = ctx.db();
  const allowedTables = new Set(BACKUP_TABLES);
  for (const table of Object.keys(backup.tables))
    if (!allowedTables.has(table))
      throw new Error("This backup contains an unknown data section.");
  for (const table of BACKUP_TABLES)
    if (!Array.isArray(backup.tables[table]))
      throw new Error("This backup is incomplete.");
  const allowedColumns = new Map;
  for (const table of BACKUP_TABLES) {
    const columns = await db.all(sql.raw(`PRAGMA table_info("${table}")`));
    allowedColumns.set(table, new Set(columns.map((column) => column.name)));
    for (const row of backup.tables[table] ?? []) {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error("This backup contains an invalid record.");
      for (const [column, value] of Object.entries(row)) {
        if (!allowedColumns.get(table)?.has(column))
          throw new Error("This backup was made by an incompatible version.");
        if (value !== null && typeof value !== "string" && typeof value !== "number")
          throw new Error("This backup contains an invalid value.");
      }
    }
  }
  for (const [key, blob] of Object.entries(backup.blobs)) {
    if (!key || typeof blob?.dataBase64 !== "string" || typeof blob?.contentType !== "string")
      throw new Error("This backup contains an invalid attachment.");
    await ctx.blobs.put(key, Buffer.from(blob.dataBase64, "base64"), { contentType: blob.contentType });
  }
  await db.run(sql.raw("PRAGMA foreign_keys = OFF"));
  await db.run(sql.raw("BEGIN IMMEDIATE"));
  try {
    for (const table of [...BACKUP_TABLES].reverse())
      await db.run(sql.raw(`DELETE FROM "${table}"`));
    for (const table of BACKUP_TABLES) {
      for (const row of backup.tables[table] ?? []) {
        const entries = Object.entries(row);
        if (!entries.length)
          continue;
        const columns = entries.map(([column]) => `"${column}"`).join(",");
        const values = entries.map(([, value]) => sqlValue(value)).join(",");
        await db.run(sql.raw(`INSERT INTO "${table}" (${columns}) VALUES (${values})`));
      }
    }
    await db.run(sql.raw("COMMIT"));
  } catch (error) {
    await db.run(sql.raw("ROLLBACK"));
    throw error;
  } finally {
    await db.run(sql.raw("PRAGMA foreign_keys = ON"));
  }
  ctx.invalidateQueries();
}
var AUTH_SESSION_DAYS = 30;
var AUTH_CODE_MINUTES = 30;
var AUTH_PASSWORD_ITERATIONS = 210000;
var AUTH_PROOF_MINUTES = 15;
var AUTH_REFRESH_DAYS = 30;
var AUTH_REFRESH_ROTATE_MINUTES = 60;
var AUTH_REFRESH_REUSE_GRACE_MS = 120000;
var AUTH_REFRESH_RATE_LIMIT = 10;
var authEnvelopeSchema = object({ _sessionToken: string2().min(32).max(300) });
var authUserSchema = object({ id: number2(), name: string2(), email: string2(), companyId: number2(), role: literal("owner"), tier: _enum(["free", "premium"]) });
var authCodeDeliverySchema = _enum(["sent", "fallback", "failed"]);
function authMeta(ctx) {
  return ctx;
}
function cookieSecure(ctx) {
  return authMeta(ctx).isProdCookie === true;
}
var REFRESH_COOKIE_NAME_DEV = "crewkat_rt";
var REFRESH_COOKIE_NAME_PROD = "__Host-crewkat_rt";
function refreshCookieName(secure) {
  return secure ? REFRESH_COOKIE_NAME_PROD : REFRESH_COOKIE_NAME_DEV;
}
function refreshCookieHeader(secure, token) {
  return `${refreshCookieName(secure)}=${token}; Path=/; Max-Age=${AUTH_REFRESH_DAYS * 24 * 60 * 60}; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}
function clearRefreshCookieHeader(secure) {
  return `${refreshCookieName(secure)}=; Path=/; Max-Age=0; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}
var refreshAttempts = new Map;
function refreshRateLimited(key) {
  const now = Date.now();
  const windowStart = now - 60000;
  const times = (refreshAttempts.get(key) ?? []).filter((t) => t >= windowStart);
  times.push(now);
  refreshAttempts.set(key, times);
  if (refreshAttempts.size > 1e4)
    refreshAttempts.clear();
  return times.length > AUTH_REFRESH_RATE_LIMIT;
}
async function issueSession(ctx, userId) {
  const meta = authMeta(ctx);
  const db = ctx.db();
  const now = new Date;
  const familyId = crypto.randomUUID();
  const proof = randomHex(48);
  const proofExpiresAt = new Date(now.getTime() + AUTH_PROOF_MINUTES * 60000);
  await db.insert(authSessions).values({
    userId,
    tokenHash: await sha256(proof),
    tokenType: "proof",
    familyId,
    expiresAt: proofExpiresAt,
    lastSeenAt: now,
    createdAt: now,
    userAgent: (meta.userAgent ?? "").slice(0, 300),
    ipHash: meta.ipHash ?? ""
  });
  const refreshToken = randomHex(48);
  const absoluteExpiresAt = new Date(now.getTime() + AUTH_REFRESH_DAYS * 24 * 60 * 60000);
  await db.insert(authSessions).values({
    userId,
    tokenHash: await sha256(refreshToken),
    tokenType: "refresh",
    familyId,
    absoluteExpiresAt,
    expiresAt: absoluteExpiresAt,
    lastSeenAt: now,
    createdAt: now,
    userAgent: (meta.userAgent ?? "").slice(0, 300),
    ipHash: meta.ipHash ?? ""
  });
  return { proof, proofExpiresAt, setCookies: [refreshCookieHeader(cookieSecure(ctx), refreshToken)] };
}
async function requireSession(ctx, token) {
  const db = ctx.db();
  const session = (await db.select().from(authSessions).where(eq(authSessions.tokenHash, await sha256(token))).limit(1))[0];
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now())
    throw new Error("Your session has expired. Sign in again.");
  if (session.tokenType === "refresh")
    throw new Error("Sign in to continue.");
  const user = (await db.select().from(authUsers).where(eq(authUsers.id, session.userId)).limit(1))[0];
  if (!user?.emailVerifiedAt)
    throw new Error("Sign in to continue.");
  const stale = Date.now() - session.lastSeenAt.getTime() > 5 * 60000;
  if (stale && session.tokenType === "legacy") {
    await db.update(authSessions).set({ lastSeenAt: new Date, expiresAt: new Date(Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60000) }).where(eq(authSessions.id, session.id));
  } else if (stale) {
    await db.update(authSessions).set({ lastSeenAt: new Date }).where(eq(authSessions.id, session.id));
  }
  return user;
}
async function revokeSessionFamily(db, familyId, userId) {
  const now = new Date;
  if (familyId) {
    await db.update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)));
  } else {
    await db.update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.userId, userId), eq(authSessions.tokenType, "legacy"), isNull(authSessions.revokedAt)));
  }
}
async function issueProofForRefresh(ctx, db, refreshRow, rotate) {
  const meta = authMeta(ctx);
  const now = new Date;
  const proof = randomHex(48);
  const proofExpiresAt = new Date(now.getTime() + AUTH_PROOF_MINUTES * 60000);
  await db.insert(authSessions).values({
    userId: refreshRow.userId,
    tokenHash: await sha256(proof),
    tokenType: "proof",
    familyId: refreshRow.familyId,
    expiresAt: proofExpiresAt,
    lastSeenAt: now,
    createdAt: now,
    userAgent: (meta.userAgent ?? "").slice(0, 300),
    ipHash: meta.ipHash ?? ""
  });
  if (!rotate)
    return { proof, proofExpiresAt, setCookies: [] };
  const successor = randomHex(48);
  await db.batch([
    db.update(authSessions).set({ revokedAt: now, replacedBy: await sha256(successor) }).where(eq(authSessions.id, refreshRow.id)),
    db.insert(authSessions).values({
      userId: refreshRow.userId,
      tokenHash: await sha256(successor),
      tokenType: "refresh",
      familyId: refreshRow.familyId,
      absoluteExpiresAt: refreshRow.absoluteExpiresAt,
      expiresAt: refreshRow.absoluteExpiresAt ?? new Date(now.getTime() + AUTH_REFRESH_DAYS * 24 * 60 * 60000),
      lastSeenAt: now,
      createdAt: now,
      userAgent: (meta.userAgent ?? "").slice(0, 300),
      ipHash: meta.ipHash ?? ""
    })
  ]);
  return { proof, proofExpiresAt, setCookies: [refreshCookieHeader(cookieSecure(ctx), successor)] };
}
function normalizedEmail(value) {
  return value.trim().toLowerCase();
}
function randomHex(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values).map((value) => value.toString(16).padStart(2, "0")).join("");
}
function randomCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(value % 1e6).padStart(6, "0");
}
async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((item) => item.toString(16).padStart(2, "0")).join("");
}
async function derivePassword(password, saltHex, iterations) {
  const salt = Uint8Array.from(saltHex.match(/.{1,2}/g) ?? [], (value) => Number.parseInt(value, 16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  return Array.from(new Uint8Array(bits)).map((item) => item.toString(16).padStart(2, "0")).join("");
}
function authUserShape(row) {
  return { id: row.id, name: row.name, email: row.email, companyId: row.companyId, role: "owner", tier: row.tier };
}
async function issueAuthCode(ctx, userId, purpose) {
  const db = ctx.db();
  const now = new Date;
  const recent = (await db.select({ createdAt: authTokens.createdAt }).from(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose))).orderBy(desc(authTokens.createdAt)).limit(1))[0];
  if (recent && now.getTime() - recent.createdAt.getTime() < 60000)
    throw new Error("Please wait one minute before requesting another code.");
  const code = randomCode();
  await db.update(authTokens).set({ consumedAt: now }).where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.consumedAt)));
  await db.insert(authTokens).values({ userId, purpose, tokenHash: await sha256(code), expiresAt: new Date(now.getTime() + AUTH_CODE_MINUTES * 60000), createdAt: now });
  return code;
}
async function deliverAuthCode(ctx, email, code, purpose) {
  const result = await ctx.executePrivileged(privileged.sendAuthEmail, { to: email, code, purpose });
  return authCodeClientResult(code, result.delivery);
}
var GLOBAL_MARKETPLACE_READ_TABLES = new Set([
  marketplaceListings,
  marketplaceListingPhotos,
  marketplaceRequests,
  marketplaceMessages
]);
function wrapScopedQuery(target, scope, state = { applied: false }) {
  return new Proxy(target, {
    get(current, property) {
      if (property === "where")
        return (condition) => {
          state.applied = true;
          return wrapScopedQuery(current.where(and(scope, condition)), scope, state);
        };
      if (property === "then" || property === "execute" || property === "all" || property === "get") {
        const scoped = state.applied ? current : current.where(scope);
        state.applied = true;
        const value = Reflect.get(scoped, property);
        return typeof value === "function" ? value.bind(scoped) : value;
      }
      const value = Reflect.get(current, property);
      if (typeof value !== "function")
        return value;
      return (...args) => wrapScopedQuery(value.apply(current, args), scope, state);
    }
  });
}
function workspaceDb(rawDb, companyId) {
  return new Proxy(rawDb, {
    get(target, property) {
      if (property === "select")
        return (...selectionArgs) => {
          const selectBuilder = target.select(...selectionArgs);
          return new Proxy(selectBuilder, {
            get(selectTarget, selectProperty) {
              if (selectProperty !== "from") {
                const value = Reflect.get(selectTarget, selectProperty);
                return typeof value === "function" ? value.bind(selectTarget) : value;
              }
              return (table) => {
                const query = selectTarget.from(table);
                const companyColumn = table?.companyId;
                if (!companyColumn || GLOBAL_MARKETPLACE_READ_TABLES.has(table))
                  return query;
                return wrapScopedQuery(query, eq(companyColumn, companyId));
              };
            }
          });
        };
      if (property === "insert")
        return (table) => {
          const insertBuilder = target.insert(table);
          const companyColumn = table?.companyId;
          if (!companyColumn)
            return insertBuilder;
          return new Proxy(insertBuilder, {
            get(insertTarget, insertProperty) {
              if (insertProperty !== "values") {
                const value = Reflect.get(insertTarget, insertProperty);
                return typeof value === "function" ? value.bind(insertTarget) : value;
              }
              return (values) => insertTarget.values(Array.isArray(values) ? values.map((value) => ({ companyId, ...value })) : { companyId, ...values });
            }
          });
        };
      if (property === "update" || property === "delete")
        return (table) => {
          const builder = target[property](table);
          const companyColumn = table?.companyId;
          return companyColumn ? wrapScopedQuery(builder, eq(companyColumn, companyId)) : builder;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
function withWorkspace(ctx, user) {
  const scoped = Object.create(ctx);
  Object.defineProperties(scoped, {
    db: { value: () => workspaceDb(ctx.db(), user.companyId) },
    workspaceCompanyId: { value: user.companyId },
    workspaceUserId: { value: user.id },
    workspaceTier: { value: user.tier }
  });
  return scoped;
}
function workspaceIdentity(ctx) {
  const scoped = ctx;
  if (!scoped.workspaceCompanyId || !scoped.workspaceUserId)
    throw new Error("Sign in to continue.");
  return scoped;
}
var BACKUP_DIR_NAME = "backups";
var BACKUP_RESEND_LIMIT_BYTES = 40000000;
var execFileAsync = promisify(execFile);
function backupConfig() {
  const int = (value, fallback) => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    alertEmail: (process.env.BACKUP_ALERT_EMAIL || "").trim(),
    hour: Math.min(23, Math.max(0, int(process.env.BACKUP_HOUR, 3))),
    diskCapMB: Math.max(128, int(process.env.BACKUP_DISK_CAP_MB, 1024)),
    fullSizeAlertMB: Math.max(5, int(process.env.BACKUP_FULL_SIZE_ALERT_MB, 30))
  };
}
function utcStamp(date = new Date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
async function sendBackupAlert(ctx, cfg, subject, text) {
  if (!cfg.alertEmail) {
    console.error(`[crewkat][backup] ALERT (no BACKUP_ALERT_EMAIL configured): ${subject}
${text}`);
    return;
  }
  try {
    await ctx.executePrivileged(privileged.sendBackupEmail, { to: cfg.alertEmail, subject, text, attachments: [] });
  } catch (error) {
    console.error("[crewkat][backup] alert email failed:", error);
  }
}
async function pruneBackups(dir, cfg, notes) {
  let entries = [];
  try {
    const names = await readdir(dir);
    for (const name of names) {
      if (!/^app-\d{8}-\d{6}-[0-9a-f]{6}\.db$/.test(name) && !/^crewkat-full-\d{8}-\d{6}\.tar\.gz$/.test(name))
        continue;
      const path = join(dir, name);
      const st = await stat(path);
      if (st.isFile())
        entries.push({ name, path, mtimeMs: st.mtimeMs, size: st.size });
    }
  } catch {
    return;
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const dailies = entries.filter((e) => e.name.endsWith(".db"));
  const weeklies = entries.filter((e) => e.name.endsWith(".tar.gz"));
  const keep = new Set([...dailies.slice(0, 7), ...weeklies.slice(0, 4)].map((e) => e.path));
  const protectedPaths = new Set([...dailies.slice(0, 1), ...weeklies.slice(0, 1)].map((e) => e.path));
  const cap = cfg.diskCapMB * 1024 * 1024;
  let total = entries.filter((e) => keep.has(e.path)).reduce((sum, e) => sum + e.size, 0);
  const capVictims = entries.filter((e) => keep.has(e.path) && !protectedPaths.has(e.path)).sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const victim of capVictims) {
    if (total <= cap)
      break;
    await rm(victim.path, { force: true });
    keep.delete(victim.path);
    total -= victim.size;
    notes.push(`Pruned ${victim.name} (disk cap).`);
  }
  for (const entry of entries) {
    if (keep.has(entry.path))
      continue;
    await rm(entry.path, { force: true });
    notes.push(`Pruned ${entry.name} (retention).`);
  }
}
async function performBackup(ctx, kind, notes = "") {
  const cfg = backupConfig();
  const db = ctx.db();
  const dir = join(ctx.spaceDir, BACKUP_DIR_NAME);
  const startedAt = new Date;
  let runId = null;
  const fail = async (error) => {
    if (runId) {
      await db.update(backupRuns).set({ status: "failed", finishedAt: new Date, error: error.slice(0, 2000) }).where(eq(backupRuns.id, runId));
    }
    await sendBackupAlert(ctx, cfg, `[Crewkat backup] backup FAILED (${kind})`, `An automated Crewkat backup failed.

Kind: ${kind}
Time: ${new Date().toISOString()}
Error: ${error}
Backup run row: ${runId ?? "n/a"}

Open Crewkat \u2192 Settings \u2192 Backups to retry manually.`);
    return { ok: false, runId, kind, filePath: null, totalBytes: null, offsiteSent: false, integrityOk: false, error };
  };
  try {
    await mkdir(dir, { recursive: true });
    const claimed = await db.insert(backupRuns).values({ kind, status: "running", startedAt, notes: notes || null }).returning({ id: backupRuns.id });
    runId = claimed[0]?.id ?? null;
    if (!runId)
      throw new Error("Could not claim a backup run row.");
    const stamp = utcStamp(startedAt);
    const snapshotName = `app-${stamp}-${crypto.randomUUID().slice(0, 6)}.db`;
    if (!/^app-\d{8}-\d{6}-[0-9a-f]{6}\.db$/.test(snapshotName))
      throw new Error("Invalid snapshot name.");
    const snapshotPath = join(dir, snapshotName);
    const escapedSnapshot = snapshotPath.replace(/'/g, "''");
    await db.run(sql.raw(`VACUUM INTO '${escapedSnapshot}'`));
    const dbBytes = (await stat(snapshotPath)).size;
    let integrityOk = false;
    await db.run(sql.raw(`ATTACH DATABASE '${escapedSnapshot}' AS __snap`));
    try {
      const check = await db.all(sql.raw(`PRAGMA __snap.integrity_check`));
      integrityOk = (check ?? []).every((row) => String(row.integrity_check).toLowerCase() === "ok");
      const counts = await db.all(sql.raw(`SELECT 'jobs' AS t, (SELECT count(*) FROM main.jobs) AS live, (SELECT count(*) FROM __snap.jobs) AS snap ` + `UNION ALL SELECT 'invoices', (SELECT count(*) FROM main.invoices), (SELECT count(*) FROM __snap.invoices) ` + `UNION ALL SELECT 'auth_users', (SELECT count(*) FROM main.auth_users), (SELECT count(*) FROM __snap.auth_users)`));
      const mismatched = (counts ?? []).filter((row) => Number(row.live) !== Number(row.snap));
      if (!integrityOk)
        throw new Error("Snapshot integrity_check did not return ok.");
      if (mismatched.length > 0)
        throw new Error(`Row-count mismatch in snapshot: ${mismatched.map((row) => String(row.t)).join(", ")}.`);
    } finally {
      await db.run(sql.raw(`DETACH DATABASE __snap`));
    }
    let totalBytes = dbBytes;
    let blobBytes = null;
    let tarPath = null;
    let filePath = snapshotPath;
    if (kind === "weekly-full" || kind === "manual") {
      const tarName = `crewkat-full-${stamp}.tar.gz`;
      tarPath = join(dir, tarName);
      await mkdir(join(ctx.spaceDir, "blobs"), { recursive: true });
      await execFileAsync("tar", ["-czf", tarPath, "-C", dir, snapshotName, "-C", ctx.spaceDir, "blobs"]);
      totalBytes = (await stat(tarPath)).size;
      blobBytes = Math.max(0, totalBytes - dbBytes);
      filePath = tarPath;
    }
    const pruneNotes = [];
    await pruneBackups(dir, cfg, pruneNotes);
    let offsiteSent = false;
    const dateLabel = startedAt.toISOString().slice(0, 10);
    if (cfg.alertEmail) {
      const attachments = [{
        filename: snapshotName,
        contentType: "application/x-sqlite3",
        dataBase64: (await readFile(snapshotPath)).toString("base64")
      }];
      let subject = `[Crewkat backup] ${dateLabel} \u2014 app.db (${formatBytes(dbBytes)}) OK`;
      let text = `Automated Crewkat backup completed.

` + `Kind: ${kind}
` + `Snapshot: ${snapshotName} (${formatBytes(dbBytes)})
` + `Integrity check: ok
` + `Row counts: jobs / invoices / auth_users match the live database.
` + `
Restore: extract the attachment, verify it with PRAGMA integrity_check, and copy it over /data/app.db while the service is suspended. Full procedure: DEPLOY-RUNBOOK.md section 10.`;
      if (tarPath && totalBytes < BACKUP_RESEND_LIMIT_BYTES) {
        attachments.push({
          filename: basename(tarPath),
          contentType: "application/gzip",
          dataBase64: (await readFile(tarPath)).toString("base64")
        });
        subject = `[Crewkat backup] ${dateLabel} \u2014 full (${formatBytes(totalBytes)}) OK`;
        text += `
Full snapshot: ${basename(tarPath)} (${formatBytes(totalBytes)}) \u2014 database plus all job photos/blobs.`;
      } else if (tarPath) {
        text += `
Full snapshot: ${basename(tarPath)} (${formatBytes(totalBytes)}) was NOT emailed (over the ${formatBytes(BACKUP_RESEND_LIMIT_BYTES)} email limit) \u2014 it is retained on the server disk.`;
      }
      const delivery = await ctx.executePrivileged(privileged.sendBackupEmail, { to: cfg.alertEmail, subject, text, attachments });
      offsiteSent = delivery.delivery === "sent";
      if (!offsiteSent)
        pruneNotes.push("Offsite email failed to send.");
    }
    if (tarPath && totalBytes >= cfg.fullSizeAlertMB * 1024 * 1024) {
      await sendBackupAlert(ctx, cfg, `[Crewkat backup] weekly full is ${formatBytes(totalBytes)}`, `The weekly full snapshot has reached ${formatBytes(totalBytes)} (alert threshold ${cfg.fullSizeAlertMB} MB).
Email offsite stops working at ${formatBytes(BACKUP_RESEND_LIMIT_BYTES)}.
Set up the S3 offsite option (see dev-briefs/automated-backups.md section 2.5) before then.`);
      pruneNotes.push(`Size alert sent (${formatBytes(totalBytes)}).`);
    }
    await db.update(backupRuns).set({
      status: "ok",
      finishedAt: new Date,
      dbBytes,
      blobBytes,
      totalBytes,
      filePath,
      offsiteSent,
      integrityOk: true,
      notes: pruneNotes.join(" ") || null
    }).where(eq(backupRuns.id, runId));
    return { ok: true, runId, kind, filePath, totalBytes, offsiteSent, integrityOk: true, error: null };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
async function performMonthlyVerify(ctx, cfg) {
  const db = ctx.db();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const recent = await db.select({ id: backupRuns.id }).from(backupRuns).where(and(eq(backupRuns.kind, "monthly-verify"), eq(backupRuns.status, "ok"), gte(backupRuns.startedAt, thirtyDaysAgo))).limit(1);
  if (recent.length > 0)
    return;
  const claimed = await db.insert(backupRuns).values({ kind: "monthly-verify", status: "running", startedAt: new Date }).returning({ id: backupRuns.id });
  const runId = claimed[0]?.id ?? null;
  const fail = async (error) => {
    if (runId)
      await db.update(backupRuns).set({ status: "failed", finishedAt: new Date, error: error.slice(0, 2000) }).where(eq(backupRuns.id, runId));
    await sendBackupAlert(ctx, cfg, "[Crewkat backup] monthly restore test FAILED", `The automated monthly restore test failed \u2014 backups may not be restorable.

Time: ${new Date().toISOString()}
Error: ${error}

Investigate before the next weekly run.`);
  };
  let workDir = null;
  try {
    const latest = await db.select().from(backupRuns).where(and(eq(backupRuns.kind, "weekly-full"), eq(backupRuns.status, "ok"))).orderBy(desc(backupRuns.startedAt)).limit(1);
    const tarPath = latest[0]?.filePath;
    if (!tarPath)
      throw new Error("No successful weekly full backup found to verify.");
    workDir = await mkdtemp(join(tmpdir(), "crewkat-restore-test-"));
    await execFileAsync("tar", ["-xzf", tarPath, "-C", workDir]);
    const dbName = (await readdir(workDir)).find((n) => /^app-\d{8}-\d{6}-[0-9a-f]{6}\.db$/.test(n));
    if (!dbName)
      throw new Error("Extracted archive is missing the database snapshot.");
    const escapedDb = join(workDir, dbName).replace(/'/g, "''");
    await db.run(sql.raw(`ATTACH DATABASE '${escapedDb}' AS __verify`));
    try {
      const check = await db.all(sql.raw(`PRAGMA __verify.integrity_check`));
      const ok = (check ?? []).every((row) => String(row.integrity_check).toLowerCase() === "ok");
      if (!ok)
        throw new Error("Restored snapshot integrity_check failed.");
      const counts = await db.all(sql.raw(`SELECT 'jobs' AS t, (SELECT count(*) FROM main.jobs) AS live, (SELECT count(*) FROM __verify.jobs) AS snap ` + `UNION ALL SELECT 'invoices', (SELECT count(*) FROM main.invoices), (SELECT count(*) FROM __verify.invoices)`));
      const mismatched = (counts ?? []).filter((row) => Number(row.live) !== Number(row.snap));
      if (mismatched.length > 0)
        throw new Error("Row counts differ between the live DB and the restored snapshot.");
      const keys = await db.all(sql.raw(`SELECT blob_key AS k FROM main.photos WHERE blob_key IS NOT NULL AND blob_key != '' ORDER BY RANDOM() LIMIT 5`));
      const missing = [];
      for (const row of keys ?? []) {
        const key = String(row.k);
        if (!key || key.includes(".."))
          continue;
        try {
          await stat(join(workDir, "blobs", key));
        } catch {
          missing.push(key);
        }
      }
      if (missing.length > 0)
        throw new Error(`Restored archive is missing ${missing.length} blob file(s).`);
    } finally {
      await db.run(sql.raw(`DETACH DATABASE __verify`));
    }
    if (runId) {
      await db.update(backupRuns).set({ status: "ok", finishedAt: new Date, integrityOk: true, notes: "Monthly restore test passed: latest weekly full extracts, integrity_check ok, row counts match, 5 random blob keys present." }).where(eq(backupRuns.id, runId));
    }
  } catch (error) {
    await fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (workDir)
      await rm(workDir, { recursive: true, force: true });
  }
}
var backupInProgress = false;
var lastMissedRunAlertAt = 0;
async function checkMissedRuns(ctx, cfg) {
  const db = ctx.db();
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000);
  const recentOk = await db.select({ id: backupRuns.id }).from(backupRuns).where(and(eq(backupRuns.status, "ok"), gte(backupRuns.startedAt, cutoff))).limit(1);
  if (recentOk.length === 0 && Date.now() - lastMissedRunAlertAt > 24 * 3600 * 1000) {
    lastMissedRunAlertAt = Date.now();
    await sendBackupAlert(ctx, cfg, "[Crewkat backup] no successful backup in 48h", `The backup scheduler is running but no backup has succeeded in the last 48 hours.
Check Crewkat \u2192 Settings \u2192 Backups for failed runs and investigate.`);
  }
}
async function runScheduledBackup(ctx) {
  const cfg = backupConfig();
  if (!cfg.alertEmail) {
    console.error("[crewkat][backup] BACKUP_ALERT_EMAIL is not set \u2014 automated backups are disabled. Set it in the Render env vars.");
    return { ran: false };
  }
  if (backupInProgress)
    return { ran: false };
  const db = ctx.db();
  const now = new Date;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todays = await db.select({ id: backupRuns.id }).from(backupRuns).where(gte(backupRuns.startedAt, dayStart)).limit(1);
  if (todays.length > 0)
    return { ran: false };
  if (now.getUTCHours() < cfg.hour)
    return { ran: false };
  backupInProgress = true;
  try {
    const kind = now.getUTCDay() === 0 ? "weekly-full" : "daily-db";
    const result = await performBackup(ctx, kind);
    if (result.ok && kind === "weekly-full")
      await performMonthlyVerify(ctx, cfg);
    await checkMissedRuns(ctx, cfg);
    return { ran: true, kind, ok: result.ok };
  } finally {
    backupInProgress = false;
  }
}
async function recoverStaleBackupRuns(ctx) {
  const db = ctx.db();
  const stale = await db.select({ id: backupRuns.id }).from(backupRuns).where(eq(backupRuns.status, "running"));
  for (const row of stale) {
    await db.update(backupRuns).set({ status: "failed", finishedAt: new Date, error: "Server restarted mid-run; marked failed at startup." }).where(eq(backupRuns.id, row.id));
  }
  return stale.length;
}
var BaseActions = {
  getAuthBootstrap: defineAction({
    request: object({}),
    response: object({ hasAccount: boolean2(), ownerClaimAvailable: boolean2(), recordCounts: object({ jobs: number2(), clients: number2(), invoices: number2() }) }),
    async handler(ctx) {
      const db = ctx.db();
      const users = await db.select({ id: authUsers.id }).from(authUsers).limit(1);
      if (users.length)
        return { hasAccount: true, ownerClaimAvailable: false, recordCounts: { jobs: 0, clients: 0, invoices: 0 } };
      const [jobRows, clientRows, invoiceRows] = await Promise.all([
        db.select({ id: jobs.id }).from(jobs),
        db.select({ id: clients.id }).from(clients),
        db.select({ id: invoices.id }).from(invoices)
      ]);
      return { hasAccount: false, ownerClaimAvailable: true, recordCounts: { jobs: jobRows.length, clients: clientRows.length, invoices: invoiceRows.length } };
    }
  }),
  signUp: defineAction({
    request: object({ name: string2().trim().min(2).max(120), email: string2().trim().email().max(200), password: string2().min(10).max(200) }),
    response: object({ ok: literal(true), email: string2(), verificationCode: string2().length(6).nullable(), emailDelivery: authCodeDeliverySchema, existingDataClaimed: boolean2() }),
    privileged: [privileged.sendAuthEmail],
    async handler(ctx, args) {
      const db = ctx.db();
      const users = await db.select({ id: authUsers.id, companyId: authUsers.companyId }).from(authUsers);
      const email = normalizedEmail(args.email);
      const duplicate = (await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email)).limit(1))[0];
      if (duplicate)
        throw new Error("An account with this email already exists. Sign in instead.");
      const salt = randomHex(16);
      const now = new Date;
      const firstAccount = users.length === 0;
      const companyId = firstAccount ? 1 : Math.max(1, ...users.map((user) => user.companyId)) + 1;
      const counts = firstAccount ? await Promise.all([db.select({ id: jobs.id }).from(jobs), db.select({ id: clients.id }).from(clients), db.select({ id: invoices.id }).from(invoices)]) : [[], [], []];
      const made = (await db.insert(authUsers).values({ name: args.name.trim(), email, passwordHash: await derivePassword(args.password, salt, AUTH_PASSWORD_ITERATIONS), passwordSalt: salt, passwordIterations: AUTH_PASSWORD_ITERATIONS, companyId, role: "owner", tier: firstAccount ? "premium" : "free", subscriptionStatus: firstAccount ? "founder" : "inactive", createdAt: now, updatedAt: now }).returning({ id: authUsers.id }))[0];
      if (!made)
        throw new Error("The account could not be created.");
      const code = await issueAuthCode(ctx, made.id, "verify_email");
      const delivery = await deliverAuthCode(ctx, email, code, "verify_email");
      return { ok: true, email, verificationCode: delivery.displayCode, emailDelivery: delivery.emailDelivery, existingDataClaimed: counts.some((rows) => rows.length > 0) };
    }
  }),
  verifyEmail: defineAction({
    request: object({ email: string2().trim().email().max(200), code: string2().regex(/^\d{6}$/) }),
    response: object({ ok: literal(true) }),
    async handler(ctx, args) {
      const db = ctx.db();
      const user = (await db.select().from(authUsers).where(eq(authUsers.email, normalizedEmail(args.email))).limit(1))[0];
      if (!user)
        throw new Error("That verification code is not valid.");
      const tokens = await db.select().from(authTokens).where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, "verify_email"), isNull(authTokens.consumedAt))).orderBy(desc(authTokens.createdAt));
      const token = tokens[0];
      if (!token || token.expiresAt.getTime() <= Date.now() || token.tokenHash !== await sha256(args.code))
        throw new Error("That verification code is invalid or expired.");
      const now = new Date;
      await db.batch([db.update(authTokens).set({ consumedAt: now }).where(eq(authTokens.id, token.id)), db.update(authUsers).set({ emailVerifiedAt: now, dataClaimedAt: now, updatedAt: now }).where(eq(authUsers.id, user.id))]);
      return { ok: true };
    }
  }),
  resendVerification: defineAction({
    request: object({ email: string2().trim().email().max(200) }),
    response: object({ ok: literal(true), verificationCode: string2().length(6).nullable(), emailDelivery: authCodeDeliverySchema }),
    privileged: [privileged.sendAuthEmail],
    async handler(ctx, args) {
      const email = normalizedEmail(args.email);
      const user = (await ctx.db().select().from(authUsers).where(eq(authUsers.email, email)).limit(1))[0];
      if (!user || user.emailVerifiedAt)
        return { ok: true, verificationCode: null, emailDelivery: "sent" };
      const code = await issueAuthCode(ctx, user.id, "verify_email");
      const delivery = await deliverAuthCode(ctx, email, code, "verify_email");
      return { ok: true, verificationCode: delivery.displayCode, emailDelivery: delivery.emailDelivery };
    }
  }),
  login: defineAction({
    request: object({ email: string2().trim().email().max(200), password: string2().min(1).max(200) }),
    response: object({ sessionToken: string2(), expiresAt: string2(), user: authUserSchema, setCookies: array(string2()) }),
    async handler(ctx, args) {
      const db = ctx.db();
      const email = normalizedEmail(args.email);
      const cutoff = Date.now() - 15 * 60000;
      const attempts = await db.select().from(authLoginAttempts).where(eq(authLoginAttempts.email, email)).orderBy(desc(authLoginAttempts.attemptedAt));
      if (attempts.filter((row) => row.attemptedAt.getTime() >= cutoff).length >= 5)
        throw new Error("Too many sign-in attempts. Try again in 15 minutes.");
      const user = (await db.select().from(authUsers).where(eq(authUsers.email, email)).limit(1))[0];
      const valid = user ? await derivePassword(args.password, user.passwordSalt, user.passwordIterations) === user.passwordHash : false;
      if (!user || !valid) {
        await db.insert(authLoginAttempts).values({ email, attemptedAt: new Date });
        throw new Error("Email or password is incorrect.");
      }
      if (!user.emailVerifiedAt)
        throw new Error("Verify your email before signing in.");
      await db.delete(authLoginAttempts).where(eq(authLoginAttempts.email, email));
      const session = await issueSession(ctx, user.id);
      return { sessionToken: session.proof, expiresAt: session.proofExpiresAt.toISOString(), user: authUserShape(user), setCookies: session.setCookies };
    }
  }),
  refreshSession: defineAction({
    request: object({}),
    response: object({ sessionToken: string2(), expiresAt: string2(), user: authUserSchema, setCookies: array(string2()) }),
    async handler(ctx) {
      const meta = authMeta(ctx);
      const db = ctx.db();
      if (refreshRateLimited(meta.ipHash ?? "unknown"))
        throw new Error("Too many requests. Try again in a minute.");
      const presented = meta.refreshToken;
      if (!presented)
        throw new Error("Sign in to continue.");
      const presentedHash = await sha256(presented);
      const row = (await db.select().from(authSessions).where(eq(authSessions.tokenHash, presentedHash)).limit(1))[0];
      if (!row || row.tokenType !== "refresh")
        throw new Error("Sign in to continue.");
      const now = Date.now();
      if (row.revokedAt) {
        if (row.replacedBy && now - row.revokedAt.getTime() <= AUTH_REFRESH_REUSE_GRACE_MS) {
          const successor = (await db.select().from(authSessions).where(eq(authSessions.tokenHash, row.replacedBy)).limit(1))[0];
          if (successor && !successor.revokedAt && successor.expiresAt.getTime() > now) {
            const user = (await db.select().from(authUsers).where(eq(authUsers.id, successor.userId)).limit(1))[0];
            if (!user?.emailVerifiedAt)
              throw new Error("Sign in to continue.");
            const issued = await issueProofForRefresh(ctx, db, successor, false);
            return { sessionToken: issued.proof, expiresAt: issued.proofExpiresAt.toISOString(), user: authUserShape(user), setCookies: issued.setCookies };
          }
        }
        if (row.replacedBy) {
          await revokeSessionFamily(db, row.familyId, row.userId);
          const user = (await db.select({ id: authUsers.id, email: authUsers.email, name: authUsers.name }).from(authUsers).where(eq(authUsers.id, row.userId)).limit(1))[0];
          if (user?.email) {
            const when = new Date(now).toISOString();
            try {
              await ctx.executePrivileged(privileged.sendSecurityAlert, {
                to: user.email,
                subject: "Crewkat security alert: signed out everywhere",
                text: `Hi ${user.name || "there"},

We spotted activity that looked like a stolen sign-in token for your Crewkat account (${when}). As a precaution we've signed you out on all devices.

If that was you, just sign in again. If not, we recommend changing your password right away.

\u2014 The Crewkat team`
              });
            } catch {}
          }
          throw new Error("We spotted unusual sign-in activity and signed you out on all devices. Sign in again.");
        }
        throw new Error("Sign in to continue.");
      }
      if (row.expiresAt.getTime() <= now || row.absoluteExpiresAt && row.absoluteExpiresAt.getTime() <= now)
        throw new Error("Your session has expired. Sign in again.");
      const user = (await db.select().from(authUsers).where(eq(authUsers.id, row.userId)).limit(1))[0];
      if (!user?.emailVerifiedAt)
        throw new Error("Sign in to continue.");
      const rotate = now - row.createdAt.getTime() >= AUTH_REFRESH_ROTATE_MINUTES * 60000;
      const issued = await issueProofForRefresh(ctx, db, row, rotate);
      return { sessionToken: issued.proof, expiresAt: issued.proofExpiresAt.toISOString(), user: authUserShape(user), setCookies: issued.setCookies };
    }
  }),
  logout: defineAction({
    request: object({ _sessionToken: string2().min(32).max(300).optional() }),
    response: object({ ok: literal(true), setCookies: array(string2()) }),
    async handler(ctx, args) {
      const db = ctx.db();
      const meta = authMeta(ctx);
      let revoked = false;
      if (meta.refreshToken) {
        const row = (await db.select().from(authSessions).where(eq(authSessions.tokenHash, await sha256(meta.refreshToken))).limit(1))[0];
        if (row?.tokenType === "refresh") {
          await revokeSessionFamily(db, row.familyId, row.userId);
          revoked = true;
        }
      }
      if (!revoked && args._sessionToken) {
        const row = (await db.select().from(authSessions).where(eq(authSessions.tokenHash, await sha256(args._sessionToken))).limit(1))[0];
        if (row) {
          await revokeSessionFamily(db, row.familyId, row.userId);
          revoked = true;
        }
      }
      return { ok: true, setCookies: [clearRefreshCookieHeader(cookieSecure(ctx))] };
    }
  }),
  getAuthSession: defineAction({
    request: authEnvelopeSchema,
    response: object({ user: authUserSchema.nullable() }),
    async handler(ctx, args) {
      try {
        const user = await requireSession(ctx, args._sessionToken);
        return { user: authUserShape(user) };
      } catch {
        return { user: null };
      }
    }
  }),
  getSubscription: defineAction({
    request: object({}),
    response: object({ tier: _enum(["free", "premium"]), status: string2(), cancelAtPeriodEnd: boolean2(), currentPeriodEnd: string2().nullable() }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const user = (await ctx.db().select().from(authUsers).where(eq(authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user)
        throw new Error("Sign in to continue.");
      return { tier: user.tier, status: user.subscriptionStatus, cancelAtPeriodEnd: user.cancelAtPeriodEnd, currentPeriodEnd: user.subscriptionCurrentPeriodEnd?.toISOString() ?? null };
    }
  }),
  startPremiumCheckout: defineAction({
    request: object({}),
    response: object({ configured: boolean2(), checkoutUrl: string2().nullable(), missing: array(string2()) }),
    privileged: [privileged.createStripeCheckout],
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const user = (await ctx.db().select().from(authUsers).where(eq(authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user)
        throw new Error("Sign in to continue.");
      if (user.tier === "premium")
        return { configured: true, checkoutUrl: null, missing: [] };
      return await ctx.executePrivileged(privileged.createStripeCheckout, { userId: user.id, companyId: user.companyId, email: user.email });
    }
  }),
  handleStripeWebhook: defineAction({
    request: object({ payload: string2().min(1).max(1e6), signature: string2().min(1).max(2000) }),
    response: object({ ok: literal(true), duplicate: boolean2(), processed: boolean2() }),
    privileged: [privileged.verifyStripeWebhook],
    async handler(ctx, args) {
      const event = await ctx.executePrivileged(privileged.verifyStripeWebhook, args);
      const db = ctx.db();
      if ((await db.select({ id: stripeWebhookEvents.id }).from(stripeWebhookEvents).where(eq(stripeWebhookEvents.id, event.eventId)).limit(1))[0])
        return { ok: true, duplicate: true, processed: false };
      if (event.eventType === "ignored") {
        await db.insert(stripeWebhookEvents).values({ id: event.eventId, type: event.eventType, processedAt: new Date });
        return { ok: true, duplicate: false, processed: false };
      }
      let user = event.userId ? (await db.select().from(authUsers).where(eq(authUsers.id, event.userId)).limit(1))[0] : undefined;
      if (!user && event.subscriptionId)
        user = (await db.select().from(authUsers).where(eq(authUsers.stripeSubscriptionId, event.subscriptionId)).limit(1))[0];
      if (!user && event.customerId)
        user = (await db.select().from(authUsers).where(eq(authUsers.stripeCustomerId, event.customerId)).limit(1))[0];
      if (!user)
        throw new Error("Stripe event did not match a Crewkat account.");
      const end = event.currentPeriodEnd ? new Date(event.currentPeriodEnd * 1000) : null;
      if (event.eventType === "customer.subscription.deleted") {
        await db.update(authUsers).set({ tier: "free", subscriptionStatus: event.subscriptionStatus ?? "canceled", cancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: end, stripeCustomerId: event.customerId ?? user.stripeCustomerId, stripeSubscriptionId: event.subscriptionId ?? user.stripeSubscriptionId, updatedAt: new Date }).where(eq(authUsers.id, user.id));
      } else {
        const active = event.eventType === "checkout.session.completed" || ["active", "trialing", "past_due"].includes(event.subscriptionStatus ?? "");
        await db.update(authUsers).set({ tier: active ? "premium" : "free", subscriptionStatus: event.subscriptionStatus ?? (active ? "active" : user.subscriptionStatus), cancelAtPeriodEnd: event.cancelAtPeriodEnd, subscriptionCurrentPeriodEnd: end ?? user.subscriptionCurrentPeriodEnd, stripeCustomerId: event.customerId ?? user.stripeCustomerId, stripeSubscriptionId: event.subscriptionId ?? user.stripeSubscriptionId, updatedAt: new Date }).where(eq(authUsers.id, user.id));
      }
      await db.insert(stripeWebhookEvents).values({ id: event.eventId, type: event.eventType, processedAt: new Date });
      ctx.invalidateQueries();
      return { ok: true, duplicate: false, processed: true };
    }
  }),
  requestPasswordReset: defineAction({
    request: object({ email: string2().trim().email().max(200) }),
    response: object({ ok: literal(true), resetCode: string2().length(6).nullable(), emailDelivery: authCodeDeliverySchema }),
    privileged: [privileged.sendAuthEmail],
    async handler(ctx, args) {
      const email = normalizedEmail(args.email);
      const user = (await ctx.db().select().from(authUsers).where(eq(authUsers.email, email)).limit(1))[0];
      if (!user)
        return { ok: true, resetCode: null, emailDelivery: "sent" };
      const code = await issueAuthCode(ctx, user.id, "reset_password");
      const delivery = await deliverAuthCode(ctx, email, code, "reset_password");
      return { ok: true, resetCode: delivery.displayCode, emailDelivery: delivery.emailDelivery };
    }
  }),
  resetPassword: defineAction({
    request: object({ email: string2().trim().email().max(200), code: string2().regex(/^\d{6}$/), password: string2().min(10).max(200) }),
    response: object({ ok: literal(true) }),
    async handler(ctx, args) {
      const db = ctx.db();
      const user = (await db.select().from(authUsers).where(eq(authUsers.email, normalizedEmail(args.email))).limit(1))[0];
      if (!user)
        throw new Error("That reset code is invalid or expired.");
      const tokens = await db.select().from(authTokens).where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, "reset_password"), isNull(authTokens.consumedAt))).orderBy(desc(authTokens.createdAt));
      const token = tokens[0];
      if (!token || token.expiresAt.getTime() <= Date.now() || token.tokenHash !== await sha256(args.code))
        throw new Error("That reset code is invalid or expired.");
      const now = new Date;
      const salt = randomHex(16);
      await db.batch([db.update(authTokens).set({ consumedAt: now }).where(eq(authTokens.id, token.id)), db.update(authUsers).set({ passwordHash: await derivePassword(args.password, salt, AUTH_PASSWORD_ITERATIONS), passwordSalt: salt, passwordIterations: AUTH_PASSWORD_ITERATIONS, updatedAt: now }).where(eq(authUsers.id, user.id)), db.update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.userId, user.id), isNull(authSessions.revokedAt)))]);
      return { ok: true };
    }
  }),
  listClients: defineAction({ request: object({ search: string2().max(120).default("") }), response: object({ clients: array(clientSchema) }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(clients).orderBy(sql`"clients"."name" COLLATE NOCASE ASC`);
    const jobs2 = await db.select({ clientId: jobs.clientId }).from(jobs);
    const quotes2 = await db.select({ clientId: quotes.clientId }).from(quotes);
    const invoices2 = await db.select({ id: invoices.id, clientId: invoices.clientId, total: invoices.total }).from(invoices);
    const payments2 = await db.select({ invoiceId: payments.invoiceId, amount: payments.amount }).from(payments);
    const term = args.search.trim().toLowerCase();
    return { clients: rows.filter((c) => !term || [c.name, c.phone, c.email, c.address, parseClientTags(c.tags).join(" ")].some((v) => v.toLowerCase().includes(term))).map((c) => {
      const clientInvoices = invoices2.filter((invoice) => invoice.clientId === c.id);
      const invoiceIds = new Set(clientInvoices.map((invoice) => invoice.id));
      const totalInvoiced = clientInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
      const totalPaid = payments2.filter((payment) => invoiceIds.has(payment.invoiceId)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      return { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes, tags: parseClientTags(c.tags), referredByClientId: c.referredByClientId, referredByName: rows.find((r) => r.id === c.referredByClientId)?.name ?? null, referralCount: rows.filter((r) => r.referredByClientId === c.id).length, jobCount: jobs2.filter((j) => j.clientId === c.id).length, quoteCount: quotes2.filter((q) => q.clientId === c.id).length, totalInvoiced, totalPaid, balanceDue: clientBalanceDue(totalInvoiced, totalPaid), invoiceCount: clientInvoices.length, paymentPercent: totalInvoiced > 0 ? Math.min(100, Math.round(totalPaid / totalInvoiced * 100)) : 0, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
    }) };
  } }),
  getClient: defineAction({ request: object({ id: number2().int().positive() }), response: object({ client: clientSchema.nullable(), jobs: array(jobSchema), quotes: array(quoteSchema) }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(clients);
    const c = rows.find((row) => row.id === args.id);
    if (!c)
      return { client: null, jobs: [], quotes: [] };
    const jobs2 = await db.select().from(jobs).where(eq(jobs.clientId, c.id)).orderBy(desc(jobs.jobDate));
    const photos2 = await db.select().from(photos);
    const quotes2 = await db.select().from(quotes).where(eq(quotes.clientId, c.id)).orderBy(desc(quotes.createdAt));
    const invoices2 = await db.select({ id: invoices.id, total: invoices.total }).from(invoices).where(eq(invoices.clientId, c.id));
    const invoiceIds = new Set(invoices2.map((invoice) => invoice.id));
    const payments2 = await db.select({ invoiceId: payments.invoiceId, amount: payments.amount }).from(payments);
    const totalInvoiced = invoices2.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const totalPaid = payments2.filter((payment) => invoiceIds.has(payment.invoiceId)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return { client: { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes, tags: parseClientTags(c.tags), referredByClientId: c.referredByClientId, referredByName: rows.find((r) => r.id === c.referredByClientId)?.name ?? null, referralCount: rows.filter((r) => r.referredByClientId === c.id).length, jobCount: jobs2.length, quoteCount: quotes2.length, totalInvoiced, totalPaid, balanceDue: clientBalanceDue(totalInvoiced, totalPaid), invoiceCount: invoices2.length, paymentPercent: totalInvoiced > 0 ? Math.min(100, Math.round(totalPaid / totalInvoiced * 100)) : 0, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }, jobs: jobs2.map((j) => {
      const jobPhotos = photos2.filter((p) => p.jobId === j.id);
      return jobShape(j, jobPhotos.length, jobPhotos.map((p) => p.stage));
    }), quotes: quotes2.map(quoteShape) };
  } }),
  saveClient: defineAction({ request: clientInputSchema.extend({ id: number2().int().positive().nullable() }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const now = new Date;
    const tags = JSON.stringify(normalizeClientTags(args.tags));
    if (args.id) {
      await db.update(clients).set({ name: args.name, phone: args.phone, email: args.email, address: args.address, notes: args.notes, tags, referredByClientId: args.referredByClientId, updatedAt: now }).where(eq(clients.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(clients).values({ name: args.name, phone: args.phone, email: args.email, address: args.address, notes: args.notes, tags, referredByClientId: args.referredByClientId, createdAt: now, updatedAt: now }).returning({ id: clients.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save client.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteClient: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(clients).where(eq(clients.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  listJobs: defineAction({ request: object({ search: string2().max(120).default("") }), response: object({ jobs: array(jobSchema) }), async handler(ctx, args) {
    const db = ctx.db();
    const term = args.search.trim();
    const rows = await db.select().from(jobs).where(term ? or(like(jobs.clientName, `%${term}%`), like(jobs.jobAddress, `%${term}%`), like(jobs.jobType, `%${term}%`)) : undefined).orderBy(desc(jobs.jobDate), desc(jobs.id));
    const counts = await db.select({ jobId: photos.jobId, id: photos.id, stage: photos.stage }).from(photos);
    const map = new Map;
    const stages = new Map;
    for (const item of counts) {
      map.set(item.jobId, (map.get(item.jobId) ?? 0) + 1);
      stages.set(item.jobId, [...stages.get(item.jobId) ?? [], item.stage]);
    }
    return { jobs: rows.map((row) => jobShape(row, map.get(row.id) ?? 0, stages.get(row.id) ?? [])) };
  } }),
  getJob: defineAction({ request: object({ id: number2().int().positive() }), response: object({ job: jobSchema.nullable(), photos: array(photoSchema), documents: array(documentSchema), punchItems: array(punchItemSchema), punchSignoff: punchSignoffSchema.nullable(), progressUpdates: array(progressSchema), timeEntries: array(timeEntrySchema), receipts: array(receiptSchema), crewTasks: array(crewTaskSchema), voiceNotes: array(voiceNoteSchema), certificate: certificateSchema.nullable() }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(jobs).where(eq(jobs.id, args.id)).limit(1);
    const row = rows[0];
    if (!row)
      return { job: null, photos: [], documents: [], punchItems: [], punchSignoff: null, progressUpdates: [], timeEntries: [], receipts: [], crewTasks: [], voiceNotes: [], certificate: null };
    const [photoRows, documentRows, punchRows, signoffRows, progressRows, timeRows, receiptRows, crewRows, voiceRows, certificateRows] = await Promise.all([
      db.select().from(photos).where(eq(photos.jobId, args.id)).orderBy(photos.createdAt, photos.id),
      db.select().from(documents).where(eq(documents.jobId, args.id)).orderBy(desc(documents.signedAt)),
      db.select().from(punchItems).where(eq(punchItems.jobId, args.id)).orderBy(punchItems.id),
      db.select().from(punchSignoffs).where(eq(punchSignoffs.jobId, args.id)).orderBy(desc(punchSignoffs.signedAt)).limit(1),
      db.select().from(progressUpdates).where(eq(progressUpdates.jobId, args.id)).orderBy(desc(progressUpdates.createdAt)),
      db.select().from(timeEntries).where(eq(timeEntries.jobId, args.id)).orderBy(desc(timeEntries.startedAt)),
      db.select().from(receipts).where(eq(receipts.jobId, args.id)).orderBy(desc(receipts.createdAt)),
      db.select().from(crewTasks).where(eq(crewTasks.jobId, args.id)).orderBy(crewTasks.id),
      db.select().from(voiceNotes).where(eq(voiceNotes.jobId, args.id)).orderBy(desc(voiceNotes.createdAt)),
      db.select().from(completionCertificates).where(eq(completionCertificates.jobId, args.id)).orderBy(desc(completionCertificates.createdAt)).limit(1)
    ]);
    const hydratedPhotos = await Promise.all(photoRows.map(async (p) => ({ id: p.id, jobId: p.jobId, stage: p.stage, caption: p.caption, filename: p.filename, contentType: p.contentType, url: await ctx.blobs.getUrl(p.blobKey), galleryPick: p.galleryPick, excludeFromSocial: p.excludeFromSocial, annotatedFromId: p.annotatedFromId, capturedAt: (p.capturedAt ?? p.createdAt).toISOString(), createdAt: p.createdAt.toISOString() })));
    const hydratedDocs = await Promise.all(documentRows.map(async (d) => ({ id: d.id, jobId: d.jobId, kind: d.kind, title: d.title, bodyText: d.bodyText, originalFilename: d.originalFilename, originalUrl: d.originalBlobKey ? await ctx.blobs.getUrl(d.originalBlobKey) : null, description: d.description, amount: d.amount, signerName: d.signerName, signatureUrl: await ctx.blobs.getUrl(d.signatureBlobKey), signedAt: d.signedAt.toISOString(), clientSignerName: d.clientSignerName, clientSignedAt: d.clientSignedAt?.toISOString() ?? null, clientSignatureHash: d.clientSignatureHash, signedPdfUrl: d.clientSignedPdfBlobKey ? await ctx.blobs.getUrl(d.clientSignedPdfBlobKey) : null })));
    const signoff = signoffRows[0];
    const receiptData = await Promise.all(receiptRows.map(async (p) => ({ id: p.id, jobId: p.jobId, vendor: p.vendor, amount: p.amount, purchaseDate: p.purchaseDate, note: p.note, filename: p.filename, url: await ctx.blobs.getUrl(p.blobKey), createdAt: p.createdAt.toISOString() })));
    const voiceData = await Promise.all(voiceRows.map(async (p) => ({ id: p.id, jobId: p.jobId, title: p.title, url: await ctx.blobs.getUrl(p.blobKey), durationSeconds: p.durationSeconds, createdAt: p.createdAt.toISOString() })));
    const cert = certificateRows[0];
    return { job: jobShape(row, hydratedPhotos.length, photoRows.map((photo) => photo.stage)), photos: hydratedPhotos, documents: hydratedDocs, punchItems: punchRows.map((p) => ({ id: p.id, jobId: p.jobId, text: p.text, completed: p.completed })), punchSignoff: signoff ? { id: signoff.id, jobId: signoff.jobId, customerName: signoff.customerName, customerSignatureUrl: await ctx.blobs.getUrl(signoff.customerSignatureBlobKey), contractorName: signoff.contractorName, contractorSignatureUrl: await ctx.blobs.getUrl(signoff.contractorSignatureBlobKey), signedAt: signoff.signedAt.toISOString() } : null, progressUpdates: progressRows.map((p) => ({ id: p.id, jobId: p.jobId, dayNumber: p.dayNumber, note: p.note, photoIds: JSON.parse(p.photoIdsJson), status: p.status, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.getTime() > 0 ? p.updatedAt.toISOString() : p.createdAt.toISOString() })), timeEntries: timeRows.map((p) => ({ id: p.id, jobId: p.jobId, crewMember: p.crewMember, startedAt: p.startedAt.toISOString(), endedAt: p.endedAt?.toISOString() ?? null, note: p.note, durationSeconds: Math.max(0, Math.floor(((p.endedAt ?? new Date).getTime() - p.startedAt.getTime()) / 1000)) })), receipts: receiptData, crewTasks: crewRows.map((p) => ({ id: p.id, jobId: p.jobId, text: p.text, completed: p.completed, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })), voiceNotes: voiceData, certificate: cert ? { id: cert.id, jobId: cert.jobId, completionDate: cert.completionDate, warrantyTerms: cert.warrantyTerms, createdAt: cert.createdAt.toISOString(), updatedAt: cert.updatedAt.toISOString() } : null };
  } }),
  createJob: defineAction({ request: object({ clientId: number2().int().positive().nullable().default(null), clientName: string2().trim().min(1).max(160), clientPhone: string2().trim().max(80).default(""), clientEmail: string2().trim().email().max(200).or(literal("")).default(""), jobAddress: string2().trim().min(1).max(240), jobType: string2().trim().min(1).max(120), notes: string2().trim().max(3000).default(""), jobDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentAt: string2().max(40).default(""), amountDue: string2().trim().max(80).default(""), dueDate: string2().max(10).default(""), depositAmount: string2().trim().max(80).default(""), paymentNotes: string2().trim().max(1000).default("") }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const now = new Date;
    const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress });
    const rows = await db.insert(jobs).values({ ...args, clientId, amountDue: normalizeMoney(args.amountDue), depositAmount: normalizeMoney(args.depositAmount), createdAt: now, updatedAt: now }).returning({ id: jobs.id });
    const made = rows[0];
    if (!made)
      throw new Error("The job could not be saved.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  updateJob: defineAction({ request: object({ id: number2().int().positive(), clientId: number2().int().positive().nullable(), clientName: string2().trim().min(1).max(160), clientPhone: string2().trim().max(80), clientEmail: string2().trim().email().max(200).or(literal("")), jobAddress: string2().trim().min(1).max(240), jobType: string2().trim().min(1).max(120), notes: string2().trim().max(3000), jobDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentAt: string2().max(40), amountDue: string2().trim().max(80), dueDate: string2().max(10), depositAmount: string2().trim().max(80), paymentNotes: string2().trim().max(1000), galleryPick: boolean2() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const { id, ...values } = args;
    const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress });
    await ctx.db().update(jobs).set({ ...values, clientId, amountDue: normalizeMoney(args.amountDue), depositAmount: normalizeMoney(args.depositAmount), updatedAt: new Date }).where(eq(jobs.id, id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  setJobClient: defineAction({ request: object({ jobId: number2().int().positive(), clientId: number2().int().positive().nullable() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    if (args.clientId === null) {
      await db.update(jobs).set({ clientId: null, updatedAt: new Date }).where(eq(jobs.id, args.jobId));
    } else {
      const selected = (await db.select().from(clients).where(eq(clients.id, args.clientId)).limit(1))[0];
      if (!selected)
        throw new Error("Client not found.");
      await db.update(jobs).set({ clientId: selected.id, clientName: selected.name, clientPhone: selected.phone, clientEmail: selected.email, updatedAt: new Date }).where(eq(jobs.id, args.jobId));
    }
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  updateJobInfo: defineAction({ request: object({ jobId: number2().int().positive(), notes: string2().trim().max(3000), jobDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentAt: string2().max(40), depositAmount: string2().trim().max(80), paymentNotes: string2().trim().max(1000) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const { jobId, ...values } = args;
    await ctx.db().update(jobs).set({ ...values, depositAmount: normalizeMoney(args.depositAmount), updatedAt: new Date }).where(eq(jobs.id, jobId));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  linkInvoiceToJob: defineAction({ request: object({ invoiceId: number2().int().positive(), jobId: number2().int().positive().nullable() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const invoice = (await db.select().from(invoices).where(eq(invoices.id, args.invoiceId)).limit(1))[0];
    if (!invoice)
      throw new Error("Invoice not found.");
    if (args.jobId === null) {
      await db.update(invoices).set({ jobId: null, updatedAt: new Date }).where(eq(invoices.id, args.invoiceId));
    } else {
      const job = (await db.select().from(jobs).where(eq(jobs.id, args.jobId)).limit(1))[0];
      if (!job)
        throw new Error("Job not found.");
      await db.update(invoices).set({ jobId: job.id, clientId: job.clientId, clientName: job.clientName, clientPhone: job.clientPhone, clientEmail: job.clientEmail, jobAddress: job.jobAddress, jobType: job.jobType, updatedAt: new Date }).where(eq(invoices.id, args.invoiceId));
    }
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  listDocuments: defineAction({ request: object({}), response: object({ documents: array(documentSchema) }), async handler(ctx) {
    const rows = await ctx.db().select().from(documents).orderBy(desc(documents.signedAt));
    const documents2 = await Promise.all(rows.map(async (d) => ({ id: d.id, jobId: d.jobId, kind: d.kind, title: d.title, bodyText: d.bodyText, originalFilename: d.originalFilename, originalUrl: d.originalBlobKey ? await ctx.blobs.getUrl(d.originalBlobKey) : null, description: d.description, amount: d.amount, signerName: d.signerName, signatureUrl: await ctx.blobs.getUrl(d.signatureBlobKey), signedAt: d.signedAt.toISOString(), clientSignerName: d.clientSignerName, clientSignedAt: d.clientSignedAt?.toISOString() ?? null, clientSignatureHash: d.clientSignatureHash, signedPdfUrl: d.clientSignedPdfBlobKey ? await ctx.blobs.getUrl(d.clientSignedPdfBlobKey) : null })));
    return { documents: documents2 };
  } }),
  linkDocumentToJob: defineAction({ request: object({ documentId: number2().int().positive(), jobId: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const job = (await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, args.jobId)).limit(1))[0];
    if (!job)
      throw new Error("Job not found.");
    await db.update(documents).set({ jobId: args.jobId }).where(eq(documents.id, args.documentId));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  addPhoto: defineAction({ request: object({ jobId: number2().int().positive(), stage: stageSchema, caption: string2().trim().max(500).default(""), filename: string2().min(1).max(240), contentType: _enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), capturedAt: string2().datetime(), dataBase64: string2().min(1).max(30000000), annotatedFromId: number2().int().positive().nullable().default(null) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const key = `jobs/${args.jobId}/${crypto.randomUUID()}`;
    await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType });
    const rows = await db.insert(photos).values({ jobId: args.jobId, stage: args.stage, caption: args.caption, blobKey: key, filename: args.filename, contentType: args.contentType, capturedAt: new Date(args.capturedAt), annotatedFromId: args.annotatedFromId }).returning({ id: photos.id });
    const made = rows[0];
    if (!made) {
      await ctx.blobs.delete(key);
      throw new Error("The photo could not be saved.");
    }
    await db.update(jobs).set({ updatedAt: new Date }).where(eq(jobs.id, args.jobId));
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  updatePhoto: defineAction({ request: object({ id: number2().int().positive(), caption: string2().trim().max(500), stage: stageSchema, galleryPick: boolean2() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(photos).set({ caption: args.caption, stage: args.stage, galleryPick: args.galleryPick }).where(eq(photos.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  togglePhotoSocial: defineAction({ request: object({ id: number2().int().positive(), excludeFromSocial: boolean2() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(photos).set({ excludeFromSocial: args.excludeFromSocial }).where(eq(photos.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  deletePhoto: defineAction({ request: object({ id: number2().int().positive(), jobId: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select({ blobKey: photos.blobKey }).from(photos).where(and(eq(photos.id, args.id), eq(photos.jobId, args.jobId))).limit(1);
    const row = rows[0];
    if (row) {
      await db.delete(photos).where(eq(photos.id, args.id));
      await ctx.blobs.delete(row.blobKey);
    }
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveDocument: defineAction({ request: object({ jobId: number2().int().positive(), kind: _enum(["contract", "change_order"]), title: string2().trim().min(1).max(200), bodyText: string2().max(1e5).default(""), originalFilename: string2().max(240).default(""), originalDataBase64: string2().max(30000000).default(""), description: string2().max(3000).default(""), amount: string2().max(80).default(""), signerName: string2().trim().min(1).max(160), signatureDataBase64: string2().min(1).max(5000000), signedAt: string2().datetime() }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    let originalBlobKey = null;
    if (args.originalDataBase64) {
      originalBlobKey = `documents/${args.jobId}/${crypto.randomUUID()}.pdf`;
      await ctx.blobs.put(originalBlobKey, Buffer.from(args.originalDataBase64, "base64"), { contentType: "application/pdf" });
    }
    const signatureBlobKey = `signatures/${args.jobId}/${crypto.randomUUID()}.png`;
    await ctx.blobs.put(signatureBlobKey, Buffer.from(args.signatureDataBase64, "base64"), { contentType: "image/png" });
    const rows = await db.insert(documents).values({ jobId: args.jobId, kind: args.kind, title: args.title, bodyText: args.bodyText, originalBlobKey, originalFilename: args.originalFilename, description: args.description, amount: normalizeMoney(args.amount), signerName: args.signerName, signatureBlobKey, signedAt: new Date(args.signedAt), createdAt: new Date }).returning({ id: documents.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save document.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  addPunchItem: defineAction({ request: object({ jobId: number2().int().positive(), text: string2().trim().min(1).max(500) }), response: object({ id: number2() }), async handler(ctx, args) {
    const rows = await ctx.db().insert(punchItems).values(args).returning({ id: punchItems.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save item.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  togglePunchItem: defineAction({ request: object({ id: number2().int().positive(), completed: boolean2() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(punchItems).set({ completed: args.completed }).where(eq(punchItems.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  deletePunchItem: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(punchItems).where(eq(punchItems.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  savePunchSignoff: defineAction({ request: object({ jobId: number2().int().positive(), customerName: string2().trim().min(1).max(160), customerSignatureDataBase64: string2().min(1).max(5000000), contractorName: string2().trim().min(1).max(160), contractorSignatureDataBase64: string2().min(1).max(5000000), signedAt: string2().datetime() }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const customerKey = `punch/${args.jobId}/${crypto.randomUUID()}-customer.png`;
    const contractorKey = `punch/${args.jobId}/${crypto.randomUUID()}-contractor.png`;
    await Promise.all([ctx.blobs.put(customerKey, Buffer.from(args.customerSignatureDataBase64, "base64"), { contentType: "image/png" }), ctx.blobs.put(contractorKey, Buffer.from(args.contractorSignatureDataBase64, "base64"), { contentType: "image/png" })]);
    const rows = await db.insert(punchSignoffs).values({ jobId: args.jobId, customerName: args.customerName, customerSignatureBlobKey: customerKey, contractorName: args.contractorName, contractorSignatureBlobKey: contractorKey, signedAt: new Date(args.signedAt) }).returning({ id: punchSignoffs.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save sign-off.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  saveProgressUpdate: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), jobId: number2().int().positive(), dayNumber: number2().int().min(1).max(999), note: string2().trim().max(3000), photoIds: array(number2().int().positive()).max(12), status: _enum(["draft", "sent"]) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    if (args.status === "sent" && args.photoIds.length) {
      const rows = await db.select().from(photos);
      const selected = rows.filter((p) => args.photoIds.includes(p.id) && p.jobId === args.jobId);
      if (selected.length !== args.photoIds.length || selected.some((p) => p.excludeFromSocial))
        throw new Error("A photo marked Not for social cannot be shared.");
    }
    const now = new Date;
    if (args.id) {
      await db.update(progressUpdates).set({ dayNumber: args.dayNumber, note: args.note, photoIdsJson: JSON.stringify(args.photoIds), status: args.status, updatedAt: now }).where(and(eq(progressUpdates.id, args.id), eq(progressUpdates.jobId, args.jobId)));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(progressUpdates).values({ jobId: args.jobId, dayNumber: args.dayNumber, note: args.note, photoIdsJson: JSON.stringify(args.photoIds), status: args.status, createdAt: now, updatedAt: now }).returning({ id: progressUpdates.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save update.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteProgressUpdate: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(progressUpdates).where(eq(progressUpdates.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  listQuotes: defineAction({ request: object({}), response: object({ quotes: array(quoteSchema) }), async handler(ctx) {
    const rows = await ctx.db().select().from(quotes).orderBy(desc(quotes.createdAt));
    return { quotes: rows.map(quoteShape) };
  } }),
  saveQuote: defineAction({ request: object({ clientId: number2().int().positive().nullable().default(null), clientName: string2().trim().min(1).max(160), clientPhone: string2().trim().max(80), clientEmail: string2().trim().email().max(200).or(literal("")), jobAddress: string2().trim().max(240), shippingAddress: string2().trim().max(240).default(""), jobType: string2().trim().max(120), lineItems: array(quoteItemSchema).min(1).max(50), subtotal: string2().max(80), discountType: adjustmentTypeSchema, discountValue: string2().max(80), taxType: adjustmentTypeSchema, taxValue: string2().max(80), total: string2().max(80), footnote: string2().max(3000), expiryDate: string2().max(10), sentAt: string2().max(10), theme: quoteThemeSchema, font: documentFontSchema, accentColor: string2().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: object({ id: number2() }), async handler(ctx, args) {
    const now = new Date;
    const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress });
    const rows = await ctx.db().insert(quotes).values({ ...args, clientId, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), subtotal: normalizeMoney(args.subtotal, "0.00"), discountValue: normalizeMoney(args.discountValue, "0.00"), taxValue: normalizeMoney(args.taxValue, "0.00"), total: normalizeMoney(args.total, "0.00"), createdAt: now, updatedAt: now }).returning({ id: quotes.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save quote.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  convertQuoteToJob: defineAction({ request: object({ id: number2().int().positive() }), response: object({ jobId: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(quotes).where(eq(quotes.id, args.id)).limit(1);
    const q = rows[0];
    if (!q)
      throw new Error("Quote not found.");
    if (q.jobId)
      return { jobId: q.jobId };
    const now = new Date;
    const madeRows = await db.insert(jobs).values({ clientId: q.clientId, clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, jobAddress: q.jobAddress || "Address pending", jobType: q.jobType || "Quoted work", notes: `Converted from quote #${q.id}`, jobDate: now.toISOString().slice(0, 10), amountDue: q.total, createdAt: now, updatedAt: now }).returning({ id: jobs.id });
    const made = madeRows[0];
    if (!made)
      throw new Error("Could not create job.");
    await db.update(quotes).set({ jobId: made.id, updatedAt: now }).where(eq(quotes.id, q.id));
    ctx.invalidateQueries();
    return { jobId: made.id };
  } }),
  listInvoices: defineAction({ request: object({}), response: object({ invoices: array(invoiceSchema) }), async handler(ctx) {
    const db = ctx.db();
    const rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt));
    const payments2 = await db.select().from(payments).orderBy(desc(payments.paymentDate));
    const setting = (await db.select().from(settings).where(eq(settings.id, 1)).limit(1))[0];
    const fee = { type: setting?.lateFeeType ?? "flat", value: Number(setting?.lateFeeValue ?? 0), graceDays: setting?.lateFeeGraceDays ?? 0 };
    return { invoices: rows.map((row) => invoiceShape(row, payments2.filter((p) => p.invoiceId === row.id), fee)) };
  } }),
  saveInvoice: defineAction({ request: object({ invoiceNumber: string2().trim().max(40).default(""), quoteId: number2().int().positive().nullable().default(null), jobId: number2().int().positive().nullable().default(null), clientId: number2().int().positive().nullable().default(null), clientName: string2().trim().min(1).max(160), clientPhone: string2().trim().max(80), clientEmail: string2().trim().email().max(200).or(literal("")), jobAddress: string2().trim().max(240), shippingAddress: string2().trim().max(240).default(""), jobType: string2().trim().max(120), lineItems: array(invoiceItemSchema).min(1).max(50), subtotal: string2().max(80), discountType: adjustmentTypeSchema, discountValue: string2().max(80), taxType: adjustmentTypeSchema, taxValue: string2().max(80), total: string2().max(80), footnote: string2().max(3000), issueDate: string2().max(10), dueDate: string2().max(10), status: invoiceStatusSchema, recurringFrequency: _enum(["none", "daily", "weekly", "monthly", "quarterly"]).default("none"), nextDueDate: string2().max(10).default(""), recurringEndDate: string2().max(10).default(""), theme: quoteThemeSchema, font: documentFontSchema, accentColor: string2().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: object({ id: number2() }), async handler(ctx, args) {
    const now = new Date;
    const db = ctx.db();
    const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress });
    const existing = await db.select({ id: invoices.id }).from(invoices);
    const nextNumber = `INV-${String(Math.max(0, ...existing.map((row) => row.id)) + 1).padStart(4, "0")}`;
    const rows = await db.insert(invoices).values({ ...args, invoiceNumber: args.invoiceNumber || nextNumber, clientId, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), subtotal: normalizeMoney(args.subtotal, "0.00"), discountValue: normalizeMoney(args.discountValue, "0.00"), taxValue: normalizeMoney(args.taxValue, "0.00"), total: normalizeMoney(args.total, "0.00"), createdAt: now, updatedAt: now }).returning({ id: invoices.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save invoice.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  convertQuoteToInvoice: defineAction({ request: object({ id: number2().int().positive() }), response: object({ invoiceId: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const requested = (await db.select().from(quotes).where(eq(quotes.id, args.id)).limit(1))[0];
    if (!requested)
      throw new Error("Quote not found.");
    const seriesId = requested.seriesId ?? requested.id;
    const versions = (await db.select().from(quotes)).filter((q) => (q.seriesId ?? q.id) === seriesId);
    const q = [...versions].filter((v) => v.accepted).sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
    if (!q)
      throw new Error("Quote not found.");
    const prior = (await db.select().from(invoices).where(eq(invoices.quoteId, q.id)).limit(1))[0];
    if (prior)
      return { invoiceId: prior.id };
    const now = new Date;
    const madeRows = await db.insert(invoices).values({ quoteId: q.id, jobId: q.jobId, clientId: q.clientId, clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, jobAddress: q.jobAddress, shippingAddress: q.shippingAddress, jobType: q.jobType, lineItemsJson: q.lineItemsJson, subtotal: q.subtotal, discountType: q.discountType, discountValue: q.discountValue, taxType: q.taxType, taxValue: q.taxValue, total: q.total, footnote: q.footnote, issueDate: now.toISOString().slice(0, 10), dueDate: "", status: "draft", theme: q.theme, font: q.font, accentColor: q.accentColor, showTaxLine: q.showTaxLine, showDiscountLine: q.showDiscountLine, showPaidLine: q.showPaidLine, showPaymentTerms: q.showPaymentTerms, showFooterNotes: q.showFooterNotes, showLogo: q.showLogo, showCompanyInfo: q.showCompanyInfo, customizeJson: q.customizeJson, createdAt: now, updatedAt: now }).returning({ id: invoices.id });
    const made = madeRows[0];
    if (!made)
      throw new Error("Could not create invoice.");
    ctx.invalidateQueries();
    return { invoiceId: made.id };
  } }),
  updateInvoiceStatus: defineAction({ request: object({ id: number2().int().positive(), status: invoiceStatusSchema }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(invoices).set({ status: args.status, updatedAt: new Date }).where(eq(invoices.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  toggleInvoicePaid: defineAction({ request: object({ id: number2().int().positive(), paid: boolean2() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const row = (await db.select().from(invoices).where(eq(invoices.id, args.id)).limit(1))[0];
    if (!row)
      throw new Error("Invoice not found.");
    const auto = (await db.select().from(payments).where(eq(payments.invoiceId, args.id))).filter((p) => p.note === "__paid_toggle__");
    if (args.paid) {
      if (!auto.length) {
        const all = await db.select().from(payments).where(eq(payments.invoiceId, args.id));
        const paid = all.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const balance = Math.max(0, Number(row.total || 0) - paid);
        if (balance > 0)
          await db.insert(payments).values({ invoiceId: args.id, amount: balance.toFixed(2), paymentDate: new Date().toISOString().slice(0, 10), method: "Marked paid", note: "__paid_toggle__", createdAt: new Date });
      }
      await db.update(invoices).set({ status: "paid", updatedAt: new Date }).where(eq(invoices.id, args.id));
    } else {
      for (const payment of auto)
        await db.delete(payments).where(eq(payments.id, payment.id));
      await db.update(invoices).set({ status: "draft", updatedAt: new Date }).where(eq(invoices.id, args.id));
    }
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  duplicateInvoice: defineAction({ request: object({ id: number2().int().positive() }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const row = (await db.select().from(invoices).where(eq(invoices.id, args.id)).limit(1))[0];
    if (!row)
      throw new Error("Invoice not found.");
    const now = new Date;
    const made = await db.insert(invoices).values({ ...row, id: undefined, quoteId: null, status: "draft", issueDate: now.toISOString().slice(0, 10), dueDate: "", recurringFrequency: "none", nextDueDate: "", seriesId: null, parentInvoiceId: row.id, recurringEndDate: "", recurringCancelled: false, createdAt: now, updatedAt: now }).returning({ id: invoices.id });
    const next = made[0];
    if (!next)
      throw new Error("Could not duplicate invoice.");
    ctx.invalidateQueries();
    return { id: next.id };
  } }),
  duplicateQuote: defineAction({ request: object({ id: number2().int().positive() }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const row = (await db.select().from(quotes).where(eq(quotes.id, args.id)).limit(1))[0];
    if (!row)
      throw new Error("Estimate not found.");
    const now = new Date;
    const made = await db.insert(quotes).values({ ...row, id: undefined, jobId: null, seriesId: null, parentQuoteId: row.id, versionNumber: 1, superseded: false, accepted: false, sentAt: "", automationStatus: "awaiting", lostReason: null, lostNote: "", createdAt: now, updatedAt: now }).returning({ id: quotes.id });
    const next = made[0];
    if (!next)
      throw new Error("Could not duplicate estimate.");
    ctx.invalidateQueries();
    return { id: next.id };
  } }),
  updateInvoiceDocument: defineAction({ request: object({ id: number2().int().positive(), invoiceNumber: string2().trim().min(1).max(40).optional(), issueDate: string2().max(10).optional(), dueDate: string2().max(10).optional(), lineItems: array(invoiceItemSchema).min(1).max(50), discountType: adjustmentTypeSchema, discountValue: string2().max(80), taxType: adjustmentTypeSchema, taxValue: string2().max(80), subtotal: string2().max(80), total: string2().max(80), footnote: string2().max(3000) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const { id, ...values } = args;
    await ctx.db().update(invoices).set({ ...values, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), subtotal: normalizeMoney(args.subtotal, "0.00"), discountValue: normalizeMoney(args.discountValue, "0.00"), taxValue: normalizeMoney(args.taxValue, "0.00"), total: normalizeMoney(args.total, "0.00"), updatedAt: new Date }).where(eq(invoices.id, id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  updateQuoteDocument: defineAction({ request: object({ id: number2().int().positive(), lineItems: array(quoteItemSchema).min(1).max(50), discountType: adjustmentTypeSchema, discountValue: string2().max(80), taxType: adjustmentTypeSchema, taxValue: string2().max(80), subtotal: string2().max(80), total: string2().max(80), footnote: string2().max(3000) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const { id, ...values } = args;
    await ctx.db().update(quotes).set({ ...values, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), subtotal: normalizeMoney(args.subtotal, "0.00"), discountValue: normalizeMoney(args.discountValue, "0.00"), taxValue: normalizeMoney(args.taxValue, "0.00"), total: normalizeMoney(args.total, "0.00"), updatedAt: new Date }).where(eq(quotes.id, id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  deleteInvoice: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const sigs = await db.select().from(financialDocumentSignatures).where(and(eq(financialDocumentSignatures.documentKind, "invoice"), eq(financialDocumentSignatures.documentId, args.id)));
    for (const sig of sigs)
      await ctx.blobs.delete(sig.signatureBlobKey);
    await db.delete(financialDocumentSignatures).where(and(eq(financialDocumentSignatures.documentKind, "invoice"), eq(financialDocumentSignatures.documentId, args.id)));
    await db.delete(invoices).where(eq(invoices.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  deleteQuote: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const sigs = await db.select().from(financialDocumentSignatures).where(and(eq(financialDocumentSignatures.documentKind, "quote"), eq(financialDocumentSignatures.documentId, args.id)));
    for (const sig of sigs)
      await ctx.blobs.delete(sig.signatureBlobKey);
    await db.delete(financialDocumentSignatures).where(and(eq(financialDocumentSignatures.documentKind, "quote"), eq(financialDocumentSignatures.documentId, args.id)));
    await db.delete(quotes).where(eq(quotes.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  getFinancialSignature: defineAction({ request: object({ kind: _enum(["invoice", "quote"]), id: number2().int().positive() }), response: object({ signature: object({ signerName: string2(), signedAt: string2(), url: string2() }).nullable() }), async handler(ctx, args) {
    const rows = await ctx.db().select().from(financialDocumentSignatures).where(and(eq(financialDocumentSignatures.documentKind, args.kind), eq(financialDocumentSignatures.documentId, args.id))).limit(1);
    const row = rows[0];
    return { signature: row ? { signerName: row.signerName, signedAt: row.signedAt.toISOString(), url: await ctx.blobs.getUrl(row.signatureBlobKey) } : null };
  } }),
  saveFinancialSignature: defineAction({ request: object({ kind: _enum(["invoice", "quote"]), id: number2().int().positive(), signerName: string2().trim().min(1).max(160), signatureDataBase64: string2().min(1).max(5000000) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const exists = args.kind === "invoice" ? (await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, args.id)).limit(1))[0] : (await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, args.id)).limit(1))[0];
    if (!exists)
      throw new Error("Document not found.");
    const prior = (await db.select().from(financialDocumentSignatures).where(and(eq(financialDocumentSignatures.documentKind, args.kind), eq(financialDocumentSignatures.documentId, args.id))).limit(1))[0];
    if (prior) {
      await db.delete(financialDocumentSignatures).where(eq(financialDocumentSignatures.id, prior.id));
      await ctx.blobs.delete(prior.signatureBlobKey);
    }
    const key = `financial-signatures/${args.kind}/${args.id}/${crypto.randomUUID()}.png`;
    await ctx.blobs.put(key, Buffer.from(args.signatureDataBase64, "base64"), { contentType: "image/png" });
    await db.insert(financialDocumentSignatures).values({ documentKind: args.kind, documentId: args.id, signerName: args.signerName, signatureBlobKey: key, signedAt: new Date });
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  updateQuoteDesign: defineAction({ request: object({ id: number2().int().positive(), theme: quoteThemeSchema, font: documentFontSchema, accentColor: string2().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const { id, customizeJson, ...design } = args;
    await ctx.db().update(quotes).set({ ...design, customizeJson, updatedAt: new Date }).where(eq(quotes.id, id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  updateInvoiceDesign: defineAction({ request: object({ id: number2().int().positive(), theme: quoteThemeSchema, font: documentFontSchema, accentColor: string2().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const { id, customizeJson, ...design } = args;
    await ctx.db().update(invoices).set({ ...design, customizeJson, updatedAt: new Date }).where(eq(invoices.id, id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveDocumentDesignDefault: defineAction({ request: object({ theme: quoteThemeSchema, font: documentFontSchema, accentColor: string2().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const values = { defaultQuoteTheme: args.theme, defaultDocumentFont: args.font, accentColor: args.accentColor, defaultShowTaxLine: args.showTaxLine, defaultShowDiscountLine: args.showDiscountLine, defaultShowPaidLine: args.showPaidLine, defaultShowPaymentTerms: args.showPaymentTerms, defaultShowFooterNotes: args.showFooterNotes, defaultShowLogo: args.showLogo, defaultShowCompanyInfo: args.showCompanyInfo, defaultCustomizeJson: args.customizeJson, updatedAt: new Date };
    const current = await db.select({ id: settings.id }).from(settings).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1);
    if (current[0])
      await db.update(settings).set(values).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId));
    else
      await db.insert(settings).values({ companyName: "", ...values });
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  startTimer: defineAction({ request: object({ jobId: number2().int().positive(), crewMember: string2().trim().max(160).default(""), note: string2().trim().max(500).default("") }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const active = await db.select().from(timeEntries).where(and(eq(timeEntries.jobId, args.jobId))).orderBy(desc(timeEntries.startedAt));
    const existing = active.find((row) => !row.endedAt);
    if (existing)
      return { id: existing.id };
    const rows = await db.insert(timeEntries).values({ jobId: args.jobId, crewMember: args.crewMember, startedAt: new Date, note: args.note, createdAt: new Date }).returning({ id: timeEntries.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not start timer.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  stopTimer: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(timeEntries).set({ endedAt: new Date }).where(eq(timeEntries.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  deleteTimeEntry: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(timeEntries).where(eq(timeEntries.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  addReceipt: defineAction({ request: object({ jobId: number2().int().positive(), vendor: string2().trim().max(160), amount: string2().trim().min(1).max(80), purchaseDate: string2().max(10), note: string2().trim().max(1000), filename: string2().min(1).max(240), contentType: _enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: string2().min(1).max(20000000) }), response: object({ id: number2() }), async handler(ctx, args) {
    const key = `receipts/${args.jobId}/${crypto.randomUUID()}`;
    await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType });
    const rows = await ctx.db().insert(receipts).values({ jobId: args.jobId, vendor: args.vendor, amount: normalizeMoney(args.amount, "0.00"), purchaseDate: args.purchaseDate, note: args.note, blobKey: key, filename: args.filename, contentType: args.contentType, createdAt: new Date }).returning({ id: receipts.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save receipt.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteReceipt: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(receipts).where(eq(receipts.id, args.id)).limit(1);
    const row = rows[0];
    if (row) {
      await db.delete(receipts).where(eq(receipts.id, args.id));
      await ctx.blobs.delete(row.blobKey);
    }
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveCrewTask: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), jobId: number2().int().positive(), text: string2().trim().min(1).max(500), completed: boolean2().default(false) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    if (args.id) {
      await db.update(crewTasks).set({ text: args.text, completed: args.completed, updatedAt: new Date }).where(eq(crewTasks.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(crewTasks).values({ jobId: args.jobId, text: args.text, completed: args.completed, createdAt: new Date, updatedAt: new Date }).returning({ id: crewTasks.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save task.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteCrewTask: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(crewTasks).where(eq(crewTasks.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  addVoiceNote: defineAction({ request: object({ jobId: number2().int().positive(), title: string2().trim().max(160), filename: string2().min(1).max(240), contentType: string2().min(1).max(100), durationSeconds: number2().int().min(0).max(3600), dataBase64: string2().min(1).max(20000000) }), response: object({ id: number2() }), async handler(ctx, args) {
    const key = `voice/${args.jobId}/${crypto.randomUUID()}`;
    await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType });
    const rows = await ctx.db().insert(voiceNotes).values({ jobId: args.jobId, title: args.title, blobKey: key, filename: args.filename, contentType: args.contentType, durationSeconds: args.durationSeconds, createdAt: new Date }).returning({ id: voiceNotes.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save voice note.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteVoiceNote: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(voiceNotes).where(eq(voiceNotes.id, args.id)).limit(1);
    const row = rows[0];
    if (row) {
      await db.delete(voiceNotes).where(eq(voiceNotes.id, args.id));
      await ctx.blobs.delete(row.blobKey);
    }
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  addPayment: defineAction({ request: object({ invoiceId: number2().int().positive(), amount: string2().trim().min(1).max(80), paymentDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), method: string2().trim().max(80), note: string2().trim().max(500) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.insert(payments).values({ ...args, amount: normalizeMoney(args.amount, "0.00"), createdAt: new Date }).returning({ id: payments.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save payment.");
    const invoiceRows = await db.select().from(invoices).where(eq(invoices.id, args.invoiceId)).limit(1);
    const inv = invoiceRows[0];
    if (inv) {
      const payments2 = await db.select().from(payments).where(eq(payments.invoiceId, inv.id));
      const paid = payments2.reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0);
      const total = Number(inv.total.replace(/[^0-9.-]/g, "") || 0);
      if (paid >= total && total > 0)
        await db.update(invoices).set({ status: "paid", updatedAt: new Date }).where(eq(invoices.id, inv.id));
    }
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deletePayment: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(payments).where(eq(payments.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  updateInvoiceRecurrence: defineAction({ request: object({ id: number2().int().positive(), recurringFrequency: _enum(["none", "daily", "weekly", "monthly", "quarterly"]), nextDueDate: string2().max(10), recurringEndDate: string2().max(10).default("") }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const row = (await db.select().from(invoices).where(eq(invoices.id, args.id)).limit(1))[0];
    if (!row)
      throw new Error("Invoice not found.");
    await db.update(invoices).set({ recurringFrequency: args.recurringFrequency, nextDueDate: args.recurringFrequency === "none" ? "" : args.nextDueDate, recurringEndDate: args.recurringFrequency === "none" ? "" : args.recurringEndDate, recurringCancelled: args.recurringFrequency === "none", seriesId: row.seriesId ?? row.id, parentInvoiceId: null, updatedAt: new Date }).where(eq(invoices.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  cancelRecurringInvoice: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(invoices).set({ recurringCancelled: true, recurringFrequency: "none", nextDueDate: "", updatedAt: new Date }).where(eq(invoices.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  generateRecurringInvoice: defineAction({ request: object({ id: number2().int().positive() }), response: object({ invoiceId: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const row = (await db.select().from(invoices).where(eq(invoices.id, args.id)).limit(1))[0];
    if (!row || row.recurringFrequency === "none" || row.recurringCancelled)
      throw new Error("Recurring invoice not found.");
    const issue = row.nextDueDate || new Date().toISOString().slice(0, 10);
    if (row.recurringEndDate && issue > row.recurringEndDate)
      throw new Error("Recurring series has ended.");
    const seriesId = row.seriesId ?? row.id;
    const existing = (await db.select().from(invoices)).find((i) => i.seriesId === seriesId && i.issueDate === issue && i.parentInvoiceId === row.id);
    if (existing)
      return { invoiceId: existing.id };
    const next = advanceRecurringDate(issue, row.recurringFrequency);
    const madeRows = await db.insert(invoices).values({ quoteId: null, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, clientEmail: row.clientEmail, jobAddress: row.jobAddress, jobType: row.jobType, lineItemsJson: row.lineItemsJson, subtotal: row.subtotal, discountType: row.discountType, discountValue: row.discountValue, taxType: row.taxType, taxValue: row.taxValue, total: row.total, footnote: row.footnote, issueDate: issue, dueDate: issue, status: "draft", recurringFrequency: "none", nextDueDate: "", seriesId, parentInvoiceId: row.id, theme: row.theme, font: row.font, accentColor: row.accentColor, customizeJson: row.customizeJson, createdAt: new Date, updatedAt: new Date }).returning({ id: invoices.id });
    const made = madeRows[0];
    if (!made)
      throw new Error("Could not generate invoice.");
    const ended = Boolean(row.recurringEndDate && next > row.recurringEndDate);
    await db.update(invoices).set({ nextDueDate: ended ? "" : next, recurringCancelled: ended, recurringFrequency: ended ? "none" : row.recurringFrequency, updatedAt: new Date }).where(eq(invoices.id, row.id));
    ctx.invalidateQueries();
    return { invoiceId: made.id };
  } }),
  processRecurringInvoices: defineAction({ request: object({ runDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/).default("") }), response: object({ generated: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const today = args.runDate || new Date().toISOString().slice(0, 10);
    const rows = await db.select().from(invoices);
    let generated = 0;
    for (const row of rows.filter((i) => i.parentInvoiceId === null && i.recurringFrequency !== "none" && !i.recurringCancelled && i.nextDueDate && i.nextDueDate <= today)) {
      const issue = row.nextDueDate;
      if (row.recurringEndDate && issue > row.recurringEndDate) {
        await db.update(invoices).set({ recurringFrequency: "none", recurringCancelled: true, nextDueDate: "", updatedAt: new Date }).where(eq(invoices.id, row.id));
        continue;
      }
      const seriesId = row.seriesId ?? row.id;
      const existing = rows.find((i) => i.seriesId === seriesId && i.issueDate === issue && i.parentInvoiceId === row.id);
      if (!existing) {
        await db.insert(invoices).values({ quoteId: null, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, clientEmail: row.clientEmail, jobAddress: row.jobAddress, jobType: row.jobType, lineItemsJson: row.lineItemsJson, subtotal: row.subtotal, discountType: row.discountType, discountValue: row.discountValue, taxType: row.taxType, taxValue: row.taxValue, total: row.total, footnote: row.footnote, issueDate: issue, dueDate: issue, status: "draft", recurringFrequency: "none", nextDueDate: "", seriesId, parentInvoiceId: row.id, theme: row.theme, font: row.font, accentColor: row.accentColor, customizeJson: row.customizeJson, createdAt: new Date, updatedAt: new Date });
        generated++;
      }
      const next = advanceRecurringDate(issue, row.recurringFrequency === "none" ? "monthly" : row.recurringFrequency);
      const ended = Boolean(row.recurringEndDate && next > row.recurringEndDate);
      await db.update(invoices).set({ nextDueDate: ended ? "" : next, recurringCancelled: ended, recurringFrequency: ended ? "none" : row.recurringFrequency, updatedAt: new Date }).where(eq(invoices.id, row.id));
    }
    if (generated)
      ctx.invalidateQueries();
    return { generated };
  } }),
  saveCertificate: defineAction({ request: object({ jobId: number2().int().positive(), completionDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), warrantyTerms: string2().trim().max(5000) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(completionCertificates).where(eq(completionCertificates.jobId, args.jobId)).limit(1);
    const row = rows[0];
    let id;
    if (row) {
      await db.update(completionCertificates).set({ completionDate: args.completionDate, warrantyTerms: args.warrantyTerms, updatedAt: new Date }).where(eq(completionCertificates.id, row.id));
      id = row.id;
    } else {
      const madeRows = await db.insert(completionCertificates).values({ ...args, createdAt: new Date, updatedAt: new Date }).returning({ id: completionCertificates.id });
      const made = madeRows[0];
      if (!made)
        throw new Error("Could not save certificate.");
      id = made.id;
    }
    const job = (await db.select().from(jobs).where(eq(jobs.id, args.jobId)).limit(1))[0];
    const existing = (await db.select().from(warranties).where(eq(warranties.jobId, args.jobId)).limit(1))[0];
    const expiry = new Date(`${args.completionDate}T12:00:00`);
    expiry.setMonth(expiry.getMonth() + 12);
    const warranty = { clientId: job?.clientId ?? null, terms: args.warrantyTerms, startDate: args.completionDate, durationMonths: 12, expiryDate: expiry.toISOString().slice(0, 10), updatedAt: new Date };
    if (existing)
      await db.update(warranties).set(warranty).where(eq(warranties.id, existing.id));
    else
      await db.insert(warranties).values({ jobId: args.jobId, ...warranty, createdAt: new Date });
    ctx.invalidateQueries();
    return { id };
  } }),
  listAppointments: defineAction({ request: object({}), response: object({ appointments: array(appointmentSchema) }), async handler(ctx) {
    const rows = await ctx.db().select().from(appointments).orderBy(appointments.startsAt);
    return { appointments: rows.map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, startsAt: row.startsAt, notes: row.notes, exteriorWork: row.exteriorWork })) };
  } }),
  saveAppointment: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), jobId: number2().int().positive().nullable().default(null), clientId: number2().int().positive().nullable().default(null), clientName: string2().trim().min(1).max(160), clientPhone: string2().trim().max(80), startsAt: string2().min(1).max(40), notes: string2().trim().max(2000), exteriorWork: boolean2().default(false) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const now = new Date;
    if (args.id) {
      await db.update(appointments).set({ jobId: args.jobId, clientId: args.clientId, clientName: args.clientName, clientPhone: args.clientPhone, startsAt: args.startsAt, notes: args.notes, exteriorWork: args.exteriorWork, updatedAt: now }).where(eq(appointments.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(appointments).values({ jobId: args.jobId, clientId: args.clientId, clientName: args.clientName, clientPhone: args.clientPhone, startsAt: args.startsAt, notes: args.notes, exteriorWork: args.exteriorWork, createdAt: now, updatedAt: now }).returning({ id: appointments.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save appointment.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteAppointment: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(appointments).where(eq(appointments.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  listLeads: defineAction({ request: object({}), response: object({ leads: array(leadSchema), winRate: number2() }), async handler(ctx) {
    const rows = await ctx.db().select().from(leads).orderBy(desc(leads.score), desc(leads.updatedAt));
    const decided = rows.filter((row) => row.stage === "won" || row.stage === "lost");
    const won = decided.filter((row) => row.stage === "won").length;
    return { leads: rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, email: row.email, address: row.address, serviceType: row.serviceType, preferredContactTime: row.preferredContactTime, source: row.source, notes: row.notes, stage: row.stage, projectSize: row.projectSize, engagement: row.engagement, score: row.score, clientId: row.clientId, quoteId: row.quoteId, createdAt: row.createdAt.toISOString() })), winRate: decided.length ? Math.round(won / decided.length * 100) : 0 };
  } }),
  saveLead: defineAction({ request: object({ name: string2().trim().min(1).max(160), phone: string2().trim().max(80), source: string2().trim().max(160), notes: string2().trim().max(2000), projectSize: _enum(["small", "medium", "large"]).default("medium"), engagement: _enum(["slow", "normal", "fast"]).default("normal"), serviceType: string2().trim().max(120).default("") }), response: object({ id: number2(), score: number2() }), async handler(ctx, args) {
    const source = args.source.toLowerCase();
    const service = args.serviceType.toLowerCase();
    const score = Math.min(100, (args.projectSize === "large" ? 35 : args.projectSize === "medium" ? 24 : 12) + (args.engagement === "fast" ? 30 : args.engagement === "normal" ? 18 : 8) + (/referral|google|website/.test(source) ? 20 : 10) + (/kitchen|bath|addition|remodel|paint/.test(service) ? 15 : 8));
    const rows = await ctx.db().insert(leads).values({ ...args, score, stage: "new", createdAt: new Date, updatedAt: new Date }).returning({ id: leads.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save lead.");
    ctx.invalidateQueries();
    return { id: made.id, score };
  } }),
  updateLeadStage: defineAction({ request: object({ id: number2().int().positive(), stage: leadStageSchema }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(leads).set({ stage: args.stage, updatedAt: new Date }).where(eq(leads.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  prepareLeadQuote: defineAction({ request: object({ id: number2().int().positive() }), response: object({ clientId: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(leads).where(eq(leads.id, args.id)).limit(1);
    const lead = rows[0];
    if (!lead)
      throw new Error("Lead not found.");
    const clientId = await upsertClient(ctx, { clientId: lead.clientId, name: lead.name, phone: lead.phone, email: "", address: "" });
    if (!clientId)
      throw new Error("Could not create client.");
    await db.update(leads).set({ clientId, stage: "quoted", updatedAt: new Date }).where(eq(leads.id, lead.id));
    ctx.invalidateQueries();
    return { clientId };
  } }),
  getJobOperations: defineAction({ request: object({ jobId: number2().int().positive() }), response: object({ selections: array(selectionSchema), dailyLogs: array(dailyLogSchema), internalNotes: array(internalNoteSchema), milestones: array(milestoneSchema), profitability: object({ quoted: number2(), invoiced: number2(), variance: number2(), variancePercent: number2().nullable(), materials: number2(), expenses: number2(), subcontractors: number2(), laborHours: number2(), laborCost: number2(), profit: number2(), margin: number2() }) }), async handler(ctx, args) {
    const db = ctx.db();
    const [selectionRows, logRows, noteRows, milestoneRows, invoiceRows, receiptRows, timeRows, settingRows, expenseRows, subcontractorRows, jobQuoteRows] = await Promise.all([db.select().from(selections).where(eq(selections.jobId, args.jobId)).orderBy(desc(selections.createdAt)), db.select().from(dailyLogs).where(eq(dailyLogs.jobId, args.jobId)).orderBy(desc(dailyLogs.logDate)), db.select().from(internalNotes).where(eq(internalNotes.jobId, args.jobId)).orderBy(desc(internalNotes.createdAt)), db.select().from(paymentMilestones).where(eq(paymentMilestones.jobId, args.jobId)).orderBy(paymentMilestones.id), db.select().from(invoices).where(eq(invoices.jobId, args.jobId)), db.select().from(receipts).where(eq(receipts.jobId, args.jobId)), db.select().from(timeEntries).where(eq(timeEntries.jobId, args.jobId)), db.select().from(settings).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1), db.select().from(businessExpenses).where(eq(businessExpenses.jobId, args.jobId)), db.select().from(subcontractors).where(eq(subcontractors.jobId, args.jobId)), db.select().from(quotes).where(eq(quotes.jobId, args.jobId))]);
    const now = Date.now();
    const invoiced = invoiceRows.reduce((sum, row) => sum + Number(row.total.replace(/[^0-9.-]/g, "") || 0), 0);
    const quoted = jobQuoteRows.reduce((sum, row) => sum + Number(row.total.replace(/[^0-9.-]/g, "") || 0), 0);
    const materials = receiptRows.reduce((sum, row) => sum + Number(row.amount.replace(/[^0-9.-]/g, "") || 0), 0);
    const laborHours = timeRows.reduce((sum, row) => sum + Math.max(0, ((row.endedAt?.getTime() ?? now) - row.startedAt.getTime()) / 3600000), 0);
    const laborCost = laborHours * Number(settingRows[0]?.hourlyCostRate.replace(/[^0-9.-]/g, "") || 0);
    const expenses = expenseRows.reduce((sum, row) => sum + Number(row.amount.replace(/[^0-9.-]/g, "") || 0), 0);
    const subcontractors2 = subcontractorRows.reduce((sum, row) => sum + Number(row.agreedAmount.replace(/[^0-9.-]/g, "") || 0), 0);
    const profit = invoiced - materials - laborCost - expenses - subcontractors2;
    return { selections: await Promise.all(selectionRows.map(async (row) => ({ id: row.id, jobId: row.jobId, category: row.category, item: row.item, vendor: row.vendor, photoUrl: row.photoBlobKey ? await ctx.blobs.getUrl(row.photoBlobKey) : null, approvalStatus: row.approvalStatus, leadTimeDays: row.leadTimeDays, createdAt: row.createdAt.toISOString() }))), dailyLogs: logRows.map((row) => ({ id: row.id, jobId: row.jobId, logDate: row.logDate, crew: row.crew, hours: row.hours, photoIds: JSON.parse(row.photoIdsJson), notes: row.notes, createdAt: row.createdAt.toISOString() })), internalNotes: noteRows.map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, note: row.note, reminderDate: row.reminderDate, completed: row.completed, createdAt: row.createdAt.toISOString() })), milestones: milestoneRows.map((row) => ({ id: row.id, jobId: row.jobId, invoiceId: row.invoiceId, label: row.label, amount: row.amount, percentage: row.percentage, dueDate: row.dueDate, status: row.status, createdAt: row.createdAt.toISOString() })), profitability: { quoted, invoiced, variance: invoiced - quoted, variancePercent: quoted > 0 ? (invoiced - quoted) / quoted * 100 : null, materials, expenses, subcontractors: subcontractors2, laborHours, laborCost, profit, margin: invoiced > 0 ? profit / invoiced * 100 : 0 } };
  } }),
  saveSelection: defineAction({ request: object({ jobId: number2().int().positive(), category: string2().trim().min(1).max(160), item: string2().trim().min(1).max(300), vendor: string2().trim().max(160), approvalStatus: _enum(["pending", "approved", "rejected"]), leadTimeDays: number2().int().min(0).max(730).default(0), photoFilename: string2().max(240).default(""), photoContentType: _enum(["", "image/jpeg", "image/png", "image/webp"]), photoDataBase64: string2().max(20000000).default("") }), response: object({ id: number2() }), async handler(ctx, args) {
    let photoBlobKey = null;
    if (args.photoDataBase64 && args.photoContentType) {
      photoBlobKey = `selections/${args.jobId}/${crypto.randomUUID()}`;
      await ctx.blobs.put(photoBlobKey, Buffer.from(args.photoDataBase64, "base64"), { contentType: args.photoContentType });
    }
    const rows = await ctx.db().insert(selections).values({ jobId: args.jobId, category: args.category, item: args.item, vendor: args.vendor, approvalStatus: args.approvalStatus, leadTimeDays: args.leadTimeDays, photoBlobKey, photoFilename: args.photoFilename, photoContentType: args.photoContentType, createdAt: new Date, updatedAt: new Date }).returning({ id: selections.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save selection.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  updateSelectionStatus: defineAction({ request: object({ id: number2().int().positive(), approvalStatus: _enum(["pending", "approved", "rejected"]) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(selections).set({ approvalStatus: args.approvalStatus, updatedAt: new Date }).where(eq(selections.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveDailyLog: defineAction({ request: object({ jobId: number2().int().positive(), logDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), crew: string2().trim().max(1000), hours: string2().trim().max(80), photoIds: array(number2().int().positive()).max(24), notes: string2().trim().max(5000) }), response: object({ id: number2() }), async handler(ctx, args) {
    const rows = await ctx.db().insert(dailyLogs).values({ jobId: args.jobId, logDate: args.logDate, crew: args.crew, hours: args.hours, photoIdsJson: JSON.stringify(args.photoIds), notes: args.notes, createdAt: new Date, updatedAt: new Date }).returning({ id: dailyLogs.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save daily log.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  saveInternalNote: defineAction({ request: object({ jobId: number2().int().positive().nullable().default(null), clientId: number2().int().positive().nullable().default(null), note: string2().trim().min(1).max(5000), reminderDate: string2().max(10) }), response: object({ id: number2() }), async handler(ctx, args) {
    const rows = await ctx.db().insert(internalNotes).values({ ...args, completed: false, createdAt: new Date, updatedAt: new Date }).returning({ id: internalNotes.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save note.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  toggleInternalNote: defineAction({ request: object({ id: number2().int().positive(), completed: boolean2() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(internalNotes).set({ completed: args.completed, updatedAt: new Date }).where(eq(internalNotes.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveMilestone: defineAction({ request: object({ jobId: number2().int().positive(), label: string2().trim().min(1).max(160), amount: string2().trim().max(80), percentage: string2().trim().max(80), dueDate: string2().max(10) }), response: object({ id: number2() }), async handler(ctx, args) {
    const rows = await ctx.db().insert(paymentMilestones).values({ ...args, amount: normalizeMoney(args.amount, "0.00"), status: "pending", createdAt: new Date, updatedAt: new Date }).returning({ id: paymentMilestones.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save milestone.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  updateMilestoneStatus: defineAction({ request: object({ id: number2().int().positive(), status: _enum(["pending", "paid"]) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(paymentMilestones).set({ status: args.status, updatedAt: new Date }).where(eq(paymentMilestones.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  invoiceMilestone: defineAction({ request: object({ id: number2().int().positive() }), response: object({ invoiceId: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const milestones = await db.select().from(paymentMilestones).where(eq(paymentMilestones.id, args.id)).limit(1);
    const milestone = milestones[0];
    if (!milestone)
      throw new Error("Milestone not found.");
    if (milestone.invoiceId)
      return { invoiceId: milestone.invoiceId };
    const jobs2 = await db.select().from(jobs).where(eq(jobs.id, milestone.jobId)).limit(1);
    const job = jobs2[0];
    if (!job)
      throw new Error("Job not found.");
    const settingRows = await db.select().from(settings).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1);
    const setting = settingRows[0];
    const amount = milestone.amount || "0";
    const now = new Date;
    const rows = await db.insert(invoices).values({ jobId: job.id, clientId: job.clientId, clientName: job.clientName, clientPhone: job.clientPhone, clientEmail: job.clientEmail, jobAddress: job.jobAddress, jobType: job.jobType, lineItemsJson: JSON.stringify([{ description: milestone.label, amount }]), subtotal: amount, total: amount, issueDate: now.toISOString().slice(0, 10), dueDate: milestone.dueDate, status: "draft", theme: setting?.defaultQuoteTheme ?? "classic", font: setting?.defaultDocumentFont ?? "helvetica", accentColor: setting?.accentColor ?? "#1f5a4a", createdAt: now, updatedAt: now }).returning({ id: invoices.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not create invoice.");
    await db.update(paymentMilestones).set({ invoiceId: made.id, updatedAt: now }).where(eq(paymentMilestones.id, milestone.id));
    ctx.invalidateQueries();
    return { invoiceId: made.id };
  } }),
  getDashboard: defineAction({ request: object({}), response: object({ revenueMonth: number2(), expensesMonth: number2(), actualProfitMonth: number2(), outstanding: number2(), hoursWeek: number2(), winRate: number2(), appointments: array(appointmentSchema), overdueCount: number2(), quoteFollowupCount: number2(), reminders: array(internalNoteSchema) }), async handler(ctx) {
    const db = ctx.db();
    const [invoiceRows, paymentRows, timeRows, leadRows, appointmentRows, noteRows, quoteRows, settingRows, expenseRows] = await Promise.all([db.select().from(invoices), db.select().from(payments), db.select().from(timeEntries), db.select().from(leads), db.select().from(appointments).orderBy(appointments.startsAt), db.select().from(internalNotes).orderBy(internalNotes.reminderDate), db.select().from(quotes), db.select().from(settings).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1), db.select().from(businessExpenses)]);
    const now = new Date;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const revenueMonth = paymentRows.filter((p) => new Date(`${p.paymentDate}T12:00:00`).getTime() >= monthStart).reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0);
    const expensesMonth = expenseRows.filter((row) => new Date(`${row.expenseDate}T12:00:00`).getTime() >= monthStart).reduce((sum, row) => sum + Number(row.amount.replace(/[^0-9.-]/g, "") || 0), 0);
    const outstanding = invoiceRows.reduce((sum, invoice) => {
      const paid = paymentRows.filter((p) => p.invoiceId === invoice.id).reduce((s, p) => s + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0);
      return sum + Math.max(0, Number(invoice.total.replace(/[^0-9.-]/g, "") || 0) - paid);
    }, 0);
    const day = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (day + 6) % 7);
    weekStart.setHours(0, 0, 0, 0);
    const hoursWeek = timeRows.filter((row) => row.startedAt >= weekStart).reduce((sum, row) => sum + Math.max(0, ((row.endedAt?.getTime() ?? now.getTime()) - row.startedAt.getTime()) / 3600000), 0);
    const decided = leadRows.filter((row) => row.stage === "won" || row.stage === "lost");
    const winRate = decided.length ? Math.round(decided.filter((row) => row.stage === "won").length / decided.length * 100) : 0;
    const today = now.toISOString().slice(0, 10);
    const followDays = settingRows[0]?.quoteFollowUpDays ?? 3;
    const quoteFollowupCount = quoteRows.filter((q) => !q.jobId && q.sentAt && Math.floor((now.getTime() - new Date(`${q.sentAt}T00:00:00`).getTime()) / 86400000) >= followDays).length;
    return { revenueMonth, expensesMonth, actualProfitMonth: revenueMonth - expensesMonth, outstanding, hoursWeek, winRate, appointments: appointmentRows.filter((row) => row.startsAt.slice(0, 10) >= today).slice(0, 6).map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, startsAt: row.startsAt, notes: row.notes, exteriorWork: row.exteriorWork })), overdueCount: invoiceRows.filter((row) => row.status !== "paid" && row.dueDate && row.dueDate < today).length, quoteFollowupCount, reminders: noteRows.filter((row) => !row.completed && row.reminderDate && row.reminderDate <= today).map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, note: row.note, reminderDate: row.reminderDate, completed: row.completed, createdAt: row.createdAt.toISOString() })) };
  } }),
  getAutomationCenter: defineAction({
    request: object({ today: string2().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    response: object({
      appointments: array(appointmentSchema),
      quoteChase: array(object({ id: number2(), clientName: string2(), clientPhone: string2(), total: string2(), daysWaiting: number2(), score: number2(), expiryDate: string2() })),
      paymentEscalations: array(object({ id: number2(), clientName: string2(), clientPhone: string2(), balance: number2(), dueDate: string2(), daysOverdue: number2(), stage: number2(), lastSentAt: string2().nullable() })),
      materials: array(object({ selectionId: number2(), jobId: number2(), clientName: string2(), category: string2(), item: string2(), jobDate: string2(), orderByDate: string2(), daysUntil: number2(), leadTimeDays: number2() })),
      quoteExpiry: array(object({ id: number2(), clientName: string2(), clientPhone: string2(), total: string2(), expiryDate: string2(), daysUntil: number2() })),
      reviews: array(object({ jobId: number2(), clientName: string2(), clientPhone: string2(), jobType: string2(), dueDate: string2() })),
      reengagement: array(object({ jobId: number2(), clientName: string2(), clientPhone: string2(), jobType: string2(), months: number2(), dueDate: string2() })),
      reminders: array(internalNoteSchema),
      crew: array(object({ jobId: number2(), clientName: string2(), jobType: string2(), jobAddress: string2(), startsAt: string2(), tasks: array(string2()) }))
    }),
    async handler(ctx, args) {
      const db = ctx.db();
      const [appointmentRows, quoteRows, invoiceRows, paymentRows, selectionRows, jobRows, certificateRows, noteRows, crewRows, logRows, parameterRows] = await Promise.all([
        db.select().from(appointments),
        db.select().from(quotes),
        db.select().from(invoices),
        db.select().from(payments),
        db.select().from(selections),
        db.select().from(jobs),
        db.select().from(completionCertificates),
        db.select().from(internalNotes),
        db.select().from(crewTasks),
        db.select().from(automationLogs),
        db.select().from(adminParameters).where(eq(adminParameters.id, 1)).limit(1)
      ]);
      const parameter = parameterRows[0];
      const paymentDay1 = parameter?.paymentDay1 ?? 3;
      const paymentDay2 = parameter?.paymentDay2 ?? 14;
      const paymentDay3 = parameter?.paymentDay3 ?? 30;
      const reviewDelay = parameter?.reviewDelayDays ?? 1;
      const reengagementMonths = [parameter?.reengagementMonth1 ?? 6, parameter?.reengagementMonth2 ?? 12];
      const expiryWarning = parameter?.quoteExpiryWarningDays ?? 3;
      const defaultLeadTime = parameter?.materialLeadTimeDays ?? 14;
      const base = new Date(`${args.today}T12:00:00`);
      const dayMs = 86400000;
      const dayDiff = (date) => Math.floor((new Date(`${date}T12:00:00`).getTime() - base.getTime()) / dayMs);
      const addMonths = (date, months) => {
        const d = new Date(`${date}T12:00:00`);
        d.setMonth(d.getMonth() + months);
        return d.toISOString().slice(0, 10);
      };
      const wasSent = (kind, entityId, stage) => logRows.some((l) => l.kind === kind && l.entityId === entityId && l.stage === stage);
      const quoteChase = quoteRows.filter((q) => q.automationStatus === "awaiting" && Boolean(q.sentAt)).map((q) => {
        const days = Math.max(0, -dayDiff(q.sentAt));
        return { id: q.id, clientName: q.clientName, clientPhone: q.clientPhone, total: q.total, daysWaiting: days, score: Number(q.total.replace(/[^0-9.-]/g, "") || 0) * days, expiryDate: q.expiryDate };
      }).filter((q) => q.daysWaiting > 0).sort((a, b) => b.score - a.score);
      const paymentEscalations = invoiceRows.filter((i) => i.status !== "paid" && Boolean(i.dueDate) && dayDiff(i.dueDate) <= -paymentDay1).map((i) => {
        const paid = paymentRows.filter((p) => p.invoiceId === i.id).reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0);
        const days = -dayDiff(i.dueDate);
        const stage = days >= paymentDay3 ? paymentDay3 : days >= paymentDay2 ? paymentDay2 : paymentDay1;
        const latest = logRows.filter((l) => l.kind === "payment" && l.entityId === i.id && l.stage === String(stage)).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
        return { id: i.id, clientName: i.clientName, clientPhone: i.clientPhone, balance: Math.max(0, Number(i.total.replace(/[^0-9.-]/g, "") || 0) - paid), dueDate: i.dueDate, daysOverdue: days, stage, lastSentAt: latest?.sentAt.toISOString() ?? null };
      }).filter((i) => i.balance > 0).sort((a, b) => b.daysOverdue - a.daysOverdue);
      const materials = selectionRows.map((s) => {
        const job = jobRows.find((j) => j.id === s.jobId);
        if (!job)
          return null;
        const leadTimeDays = s.leadTimeDays > 0 ? s.leadTimeDays : defaultLeadTime;
        const order = new Date(`${job.jobDate}T12:00:00`);
        order.setDate(order.getDate() - leadTimeDays);
        const orderByDate = order.toISOString().slice(0, 10);
        return { selectionId: s.id, jobId: s.jobId, clientName: job.clientName, category: s.category, item: s.item, jobDate: job.jobDate, orderByDate, daysUntil: dayDiff(orderByDate), leadTimeDays };
      }).filter((v) => v !== null).filter((v) => v.daysUntil <= 14).sort((a, b) => a.daysUntil - b.daysUntil);
      const quoteExpiry = quoteRows.filter((q) => q.automationStatus === "awaiting" && Boolean(q.expiryDate)).map((q) => ({ id: q.id, clientName: q.clientName, clientPhone: q.clientPhone, total: q.total, expiryDate: q.expiryDate, daysUntil: dayDiff(q.expiryDate) })).filter((q) => q.daysUntil <= expiryWarning).sort((a, b) => a.daysUntil - b.daysUntil);
      const reviews = certificateRows.map((c) => {
        const job = jobRows.find((j) => j.id === c.jobId);
        if (!job)
          return null;
        const d = new Date(`${c.completionDate}T12:00:00`);
        d.setDate(d.getDate() + reviewDelay);
        const dueDate = d.toISOString().slice(0, 10);
        return { jobId: job.id, clientName: job.clientName, clientPhone: job.clientPhone, jobType: job.jobType, dueDate };
      }).filter((v) => v !== null).filter((v) => v.dueDate <= args.today && !wasSent("review", v.jobId, "next_day"));
      const reengagement = certificateRows.flatMap((c) => {
        const job = jobRows.find((j) => j.id === c.jobId);
        if (!job)
          return [];
        return reengagementMonths.map((months) => ({ jobId: job.id, clientName: job.clientName, clientPhone: job.clientPhone, jobType: job.jobType, months, dueDate: addMonths(c.completionDate, months) }));
      }).filter((v) => v.dueDate <= args.today && !wasSent("reengagement", v.jobId, String(v.months)));
      const appointments2 = appointmentRows.filter((a) => a.startsAt.slice(0, 10) === args.today).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((a) => ({ id: a.id, jobId: a.jobId, clientId: a.clientId, clientName: a.clientName, clientPhone: a.clientPhone, startsAt: a.startsAt, notes: a.notes, exteriorWork: a.exteriorWork }));
      const crew = appointments2.flatMap((a) => {
        const job = jobRows.find((j) => j.id === a.jobId);
        if (!job)
          return [];
        return [{ jobId: job.id, clientName: job.clientName, jobType: job.jobType, jobAddress: job.jobAddress, startsAt: a.startsAt, tasks: crewRows.filter((t) => t.jobId === job.id && !t.completed).map((t) => t.text) }];
      });
      const reminders = noteRows.filter((n) => !n.completed && Boolean(n.reminderDate) && n.reminderDate <= args.today).map((n) => ({ id: n.id, jobId: n.jobId, clientId: n.clientId, note: n.note, reminderDate: n.reminderDate, completed: n.completed, createdAt: n.createdAt.toISOString() }));
      return { appointments: appointments2, quoteChase, paymentEscalations, materials, quoteExpiry, reviews, reengagement, reminders, crew };
    }
  }),
  logAutomationSend: defineAction({ request: object({ kind: _enum(["quote_chase", "payment", "review", "reengagement", "quote_expiry", "crew"]), entityId: number2().int().positive(), stage: string2().max(40) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().insert(automationLogs).values({ ...args, channel: "sms", sentAt: new Date });
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  updateQuoteAutomationStatus: defineAction({ request: object({ id: number2().int().positive(), status: _enum(["awaiting", "won", "lost"]), lostReason: _enum(["price", "timing", "competitor", "no_response", "other"]).nullable().default(null), lostNote: string2().trim().max(1000).default("") }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(quotes).set({ automationStatus: args.status, lostReason: args.status === "lost" ? args.lostReason : null, lostNote: args.status === "lost" ? args.lostNote : "", updatedAt: new Date }).where(eq(quotes.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  updateSelectionLeadTime: defineAction({ request: object({ id: number2().int().positive(), leadTimeDays: number2().int().min(0).max(730) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(selections).set({ leadTimeDays: args.leadTimeDays, updatedAt: new Date }).where(eq(selections.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  renewQuote: defineAction({ request: object({ id: number2().int().positive(), today: string2().regex(/^\d{4}-\d{2}-\d{2}$/) }), response: object({ ok: literal(true), expiryDate: string2() }), async handler(ctx, args) {
    const d = new Date(`${args.today}T12:00:00`);
    d.setDate(d.getDate() + 30);
    const expiryDate = d.toISOString().slice(0, 10);
    await ctx.db().update(quotes).set({ expiryDate, automationStatus: "awaiting", updatedAt: new Date }).where(eq(quotes.id, args.id));
    ctx.invalidateQueries();
    return { ok: true, expiryDate };
  } }),
  getGrowthToolkit: defineAction({
    request: object({}),
    response: object({ priceBook: array(priceBookSchema), templates: array(templateSchema), mileage: array(mileageSchema), expenses: array(expenseSchema), jobs: array(object({ id: number2(), label: string2() })), monthlyMileage: number2(), monthlyExpenses: number2(), estimateActual: array(object({ jobId: number2(), clientName: string2(), jobType: string2(), quoted: number2(), invoiced: number2(), variance: number2(), variancePercent: number2().nullable() })) }),
    async handler(ctx) {
      const db = ctx.db();
      let templateRows = await db.select().from(quoteTemplates).orderBy(quoteTemplates.name);
      if (templateRows.length === 0) {
        const now = new Date;
        await db.insert(quoteTemplates).values([
          { name: "Kitchen remodel", isStarter: true, lineItemsJson: JSON.stringify([{ description: "Demolition and site protection", amount: "" }, { description: "Cabinet installation", amount: "" }, { description: "Countertop installation", amount: "" }, { description: "Plumbing and electrical finish", amount: "" }, { description: "Final cleanup", amount: "" }]), createdAt: now, updatedAt: now },
          { name: "Bathroom remodel", isStarter: true, lineItemsJson: JSON.stringify([{ description: "Demolition and waterproofing", amount: "" }, { description: "Tile installation", amount: "" }, { description: "Vanity and fixture installation", amount: "" }, { description: "Plumbing and electrical finish", amount: "" }, { description: "Final cleanup", amount: "" }]), createdAt: now, updatedAt: now },
          { name: "Painting", isStarter: true, lineItemsJson: JSON.stringify([{ description: "Surface preparation and protection", amount: "" }, { description: "Primer where required", amount: "" }, { description: "Two finish coats", amount: "" }, { description: "Touch-ups and cleanup", amount: "" }]), createdAt: now, updatedAt: now }
        ]);
        templateRows = await db.select().from(quoteTemplates).orderBy(quoteTemplates.name);
      }
      const [priceRows, mileageRows, expenseRows, jobRows, quoteRows, invoiceRows] = await Promise.all([db.select().from(priceBookItems).orderBy(priceBookItems.name), db.select().from(mileageTrips).orderBy(desc(mileageTrips.tripDate)), db.select().from(businessExpenses).orderBy(desc(businessExpenses.expenseDate)), db.select().from(jobs).orderBy(desc(jobs.jobDate)), db.select().from(quotes), db.select().from(invoices)]);
      const month = new Date().toISOString().slice(0, 7);
      const jobLabel = (id) => id ? jobRows.find((job) => job.id === id)?.clientName ?? null : null;
      const estimateActual = jobRows.map((job) => {
        const quoted = quoteRows.filter((q) => q.jobId === job.id).reduce((sum, q) => sum + Number(q.total.replace(/[^0-9.-]/g, "") || 0), 0);
        const invoiced = invoiceRows.filter((i) => i.jobId === job.id).reduce((sum, i) => sum + Number(i.total.replace(/[^0-9.-]/g, "") || 0), 0);
        const variance = invoiced - quoted;
        return { jobId: job.id, clientName: job.clientName, jobType: job.jobType, quoted, invoiced, variance, variancePercent: quoted > 0 ? variance / quoted * 100 : null };
      }).filter((row) => row.quoted > 0 || row.invoiced > 0);
      return { priceBook: priceRows.map((row) => ({ id: row.id, name: row.name, description: row.description, unitPrice: row.unitPrice, createdAt: row.createdAt.toISOString() })), templates: templateRows.map((row) => ({ id: row.id, name: row.name, lineItems: JSON.parse(row.lineItemsJson), isStarter: row.isStarter, createdAt: row.createdAt.toISOString() })), mileage: mileageRows.map((row) => ({ id: row.id, tripDate: row.tripDate, fromLocation: row.fromLocation, toLocation: row.toLocation, miles: row.miles, jobId: row.jobId, jobName: jobLabel(row.jobId), purpose: row.purpose, createdAt: row.createdAt.toISOString() })), expenses: expenseRows.map((row) => ({ id: row.id, expenseDate: row.expenseDate, vendor: row.vendor, amount: row.amount, category: row.category, jobId: row.jobId, jobName: jobLabel(row.jobId), supplierId: row.supplierId, note: row.note, createdAt: row.createdAt.toISOString() })), jobs: jobRows.map((job) => ({ id: job.id, label: `${job.clientName} \xB7 ${job.jobType}` })), monthlyMileage: mileageRows.filter((row) => row.tripDate.startsWith(month)).reduce((sum, row) => sum + Number(row.miles.replace(/[^0-9.-]/g, "") || 0), 0), monthlyExpenses: expenseRows.filter((row) => row.expenseDate.startsWith(month)).reduce((sum, row) => sum + Number(row.amount.replace(/[^0-9.-]/g, "") || 0), 0), estimateActual };
    }
  }),
  savePriceBookItem: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), name: string2().trim().min(1).max(160), description: string2().trim().max(500), unitPrice: string2().trim().max(80) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const now = new Date;
    if (args.id) {
      await db.update(priceBookItems).set({ name: args.name, description: args.description, unitPrice: normalizeMoney(args.unitPrice, "0.00"), updatedAt: now }).where(eq(priceBookItems.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(priceBookItems).values({ name: args.name, description: args.description, unitPrice: normalizeMoney(args.unitPrice, "0.00"), createdAt: now, updatedAt: now }).returning({ id: priceBookItems.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save price book item.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deletePriceBookItem: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(priceBookItems).where(eq(priceBookItems.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveQuoteTemplate: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), name: string2().trim().min(1).max(160), lineItems: array(quoteItemSchema).min(1).max(50) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const now = new Date;
    if (args.id) {
      await db.update(quoteTemplates).set({ name: args.name, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), isStarter: false, updatedAt: now }).where(eq(quoteTemplates.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(quoteTemplates).values({ name: args.name, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), isStarter: false, createdAt: now, updatedAt: now }).returning({ id: quoteTemplates.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save template.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteQuoteTemplate: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(quoteTemplates).where(eq(quoteTemplates.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveMileageTrip: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), tripDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), fromLocation: string2().trim().max(240), toLocation: string2().trim().max(240), miles: string2().trim().min(1).max(40), jobId: number2().int().positive().nullable().default(null), purpose: string2().trim().max(500) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    if (args.id) {
      await db.update(mileageTrips).set({ tripDate: args.tripDate, fromLocation: args.fromLocation, toLocation: args.toLocation, miles: args.miles, jobId: args.jobId, purpose: args.purpose }).where(eq(mileageTrips.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(mileageTrips).values({ tripDate: args.tripDate, fromLocation: args.fromLocation, toLocation: args.toLocation, miles: args.miles, jobId: args.jobId, purpose: args.purpose, createdAt: new Date }).returning({ id: mileageTrips.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save trip.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteMileageTrip: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(mileageTrips).where(eq(mileageTrips.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveBusinessExpense: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), expenseDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), vendor: string2().trim().max(160), amount: string2().trim().min(1).max(80), category: string2().trim().min(1).max(80), jobId: number2().int().positive().nullable().default(null), supplierId: number2().int().positive().nullable().default(null), note: string2().trim().max(1000) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    if (args.id) {
      await db.update(businessExpenses).set({ expenseDate: args.expenseDate, vendor: args.vendor, amount: normalizeMoney(args.amount, "0.00"), category: args.category, jobId: args.jobId, supplierId: args.supplierId, note: args.note }).where(eq(businessExpenses.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(businessExpenses).values({ expenseDate: args.expenseDate, vendor: args.vendor, amount: normalizeMoney(args.amount, "0.00"), category: args.category, jobId: args.jobId, supplierId: args.supplierId, note: args.note, createdAt: new Date }).returning({ id: businessExpenses.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save expense.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteBusinessExpense: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(businessExpenses).where(eq(businessExpenses.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  listSubcontractors: defineAction({ request: object({ jobId: number2().int().positive() }), response: object({ subcontractors: array(subcontractorSchema), totalAgreed: number2(), totalPaid: number2(), totalBalance: number2() }), async handler(ctx, args) {
    const rows = await ctx.db().select().from(subcontractors).where(eq(subcontractors.jobId, args.jobId)).orderBy(subcontractors.name);
    const subcontractors2 = rows.map((row) => {
      const agreed = Number(row.agreedAmount.replace(/[^0-9.-]/g, "") || 0);
      const paid = Number(row.paidToDate.replace(/[^0-9.-]/g, "") || 0);
      return { id: row.id, jobId: row.jobId, name: row.name, trade: row.trade, phone: row.phone, agreedAmount: row.agreedAmount, paidToDate: row.paidToDate, balance: Math.max(0, agreed - paid), createdAt: row.createdAt.toISOString() };
    });
    return { subcontractors: subcontractors2, totalAgreed: subcontractors2.reduce((s, r) => s + Number(r.agreedAmount.replace(/[^0-9.-]/g, "") || 0), 0), totalPaid: subcontractors2.reduce((s, r) => s + Number(r.paidToDate.replace(/[^0-9.-]/g, "") || 0), 0), totalBalance: subcontractors2.reduce((s, r) => s + r.balance, 0) };
  } }),
  saveSubcontractor: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), jobId: number2().int().positive(), name: string2().trim().min(1).max(160), trade: string2().trim().max(120), phone: string2().trim().max(80), agreedAmount: string2().trim().max(80), paidToDate: string2().trim().max(80) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const now = new Date;
    if (args.id) {
      await db.update(subcontractors).set({ name: args.name, trade: args.trade, phone: args.phone, agreedAmount: normalizeMoney(args.agreedAmount, "0.00"), paidToDate: normalizeMoney(args.paidToDate, "0.00"), updatedAt: now }).where(eq(subcontractors.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(subcontractors).values({ jobId: args.jobId, name: args.name, trade: args.trade, phone: args.phone, agreedAmount: normalizeMoney(args.agreedAmount, "0.00"), paidToDate: normalizeMoney(args.paidToDate, "0.00"), createdAt: now, updatedAt: now }).returning({ id: subcontractors.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save subcontractor.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteSubcontractor: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(subcontractors).where(eq(subcontractors.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveShareImage: defineAction({ request: object({ jobId: number2().int().positive(), beforePhotoId: number2().int().positive(), afterPhotoId: number2().int().positive(), branded: boolean2(), filename: string2().min(1).max(240), dataBase64: string2().min(1).max(30000000) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const photoRows = await db.select().from(photos);
    const requested = photoRows.filter((p) => p.jobId === args.jobId && (p.id === args.beforePhotoId || p.id === args.afterPhotoId));
    if (requested.length !== 2 || requested.some((p) => p.excludeFromSocial))
      throw new Error("A photo marked Not for social cannot be exported.");
    const key = `share-images/${args.jobId}/${crypto.randomUUID()}.jpg`;
    await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: "image/jpeg" });
    const rows = await ctx.db().insert(shareImages).values({ jobId: args.jobId, beforePhotoId: args.beforePhotoId, afterPhotoId: args.afterPhotoId, branded: args.branded, blobKey: key, filename: args.filename, createdAt: new Date }).returning({ id: shareImages.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save comparison.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteShareImage: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const row = (await db.select().from(shareImages).where(eq(shareImages.id, args.id)).limit(1))[0];
    if (row) {
      await db.delete(shareImages).where(eq(shareImages.id, row.id));
      await ctx.blobs.delete(row.blobKey);
    }
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  listShareImages: defineAction({ request: object({ jobId: number2().int().positive() }), response: object({ images: array(shareImageSchema) }), async handler(ctx, args) {
    const rows = await ctx.db().select().from(shareImages).where(eq(shareImages.jobId, args.jobId)).orderBy(desc(shareImages.createdAt));
    return { images: await Promise.all(rows.map(async (row) => ({ id: row.id, jobId: row.jobId, beforePhotoId: row.beforePhotoId, afterPhotoId: row.afterPhotoId, branded: row.branded, filename: row.filename, url: await ctx.blobs.getUrl(row.blobKey), createdAt: row.createdAt.toISOString() }))) };
  } }),
  getWeatherOutlook: defineAction({ request: object({ appointmentId: number2().int().positive() }), response: object({ available: boolean2(), location: string2(), date: string2(), summary: string2(), precipitationChance: number2().nullable(), high: number2().nullable(), low: number2().nullable(), unit: string2(), rainLikely: boolean2(), asOf: string2(), source: string2() }), async handler(ctx, args) {
    const db = ctx.db();
    const appointments2 = await db.select().from(appointments).where(eq(appointments.id, args.appointmentId)).limit(1);
    const appointment = appointments2[0];
    if (!appointment || !appointment.exteriorWork)
      return { available: false, location: "", date: "", summary: "", precipitationChance: null, high: null, low: null, unit: "\xB0F", rainLikely: false, asOf: new Date().toISOString(), source: "" };
    const jobs2 = appointment.jobId ? await db.select().from(jobs).where(eq(jobs.id, appointment.jobId)).limit(1) : [];
    const location = jobs2[0]?.jobAddress || appointment.clientName;
    try {
      const result = await ctx.tool.weather(`${location} weather forecast for ${appointment.startsAt.slice(0, 10)}`, { since: appointment.startsAt.slice(0, 10), until: appointment.startsAt.slice(0, 10), language_code: "en" });
      const day = result.content.forecast_days.find((item) => item.date === appointment.startsAt.slice(0, 10)) ?? result.content.forecast_days[0];
      const chance = day?.precipitation_chance ?? null;
      const summary = day?.summary ?? result.content.summary;
      return { available: Boolean(day), location: result.content.location || location, date: appointment.startsAt.slice(0, 10), summary, precipitationChance: chance, high: day?.high ?? null, low: day?.low ?? null, unit: result.content.conditions.unit, rainLikely: (chance ?? 0) >= 40 || /rain|storm|shower/i.test(summary), asOf: new Date().toISOString(), source: result.content.sources[0]?.title ?? "Weather forecast" };
    } catch {
      return { available: false, location, date: appointment.startsAt.slice(0, 10), summary: "", precipitationChance: null, high: null, low: null, unit: "\xB0F", rainLikely: false, asOf: new Date().toISOString(), source: "" };
    }
  } }),
  getExpansionSuite: defineAction({ request: object({ today: string2().regex(/^\d{4}-\d{2}-\d{2}$/) }), response: object({
    jobs: array(object({ id: number2(), label: string2(), clientId: number2().nullable(), clientName: string2(), clientPhone: string2() })),
    clients: array(object({ id: number2(), name: string2(), phone: string2() })),
    warranties: array(object({ id: number2(), jobId: number2(), jobLabel: string2(), clientName: string2(), clientPhone: string2(), terms: string2(), startDate: string2(), durationMonths: number2(), expiryDate: string2(), status: _enum(["active", "expiring", "expired"]) })),
    lossReport: array(object({ reason: string2(), count: number2(), value: number2() })),
    crewHours: array(object({ crewMember: string2(), jobId: number2(), jobLabel: string2(), hours: number2() })),
    suppliers: array(object({ id: number2(), name: string2(), category: string2(), phone: string2(), email: string2(), notes: string2(), orderCount: number2(), orderTotal: number2() })),
    plans: array(object({ id: number2(), clientId: number2().nullable(), clientName: string2(), clientPhone: string2(), title: string2(), tasks: string2(), startDate: string2(), intervalMonths: number2(), nextDueDate: string2(), lastJobId: number2().nullable(), active: boolean2() })),
    scans: array(object({ id: number2(), jobId: number2().nullable(), expenseId: number2().nullable(), title: string2(), kind: _enum(["receipt", "contract", "other"]), filename: string2(), url: string2(), createdAt: string2() })),
    videos: array(object({ id: number2(), jobId: number2(), jobLabel: string2(), caption: string2(), branded: boolean2(), filename: string2(), contentType: string2(), url: string2(), createdAt: string2() }))
  }), async handler(ctx, args) {
    const db = ctx.db();
    const [jobRows, clientRows, warrantyRows, quoteRows, timeRows, supplierRows, expenseRows, receiptRows, planRows, scanRows, videoRows] = await Promise.all([db.select().from(jobs), db.select().from(clients), db.select().from(warranties), db.select().from(quotes), db.select().from(timeEntries), db.select().from(suppliers), db.select().from(businessExpenses), db.select().from(receipts), db.select().from(maintenancePlans), db.select().from(scannedDocuments), db.select().from(slideshowVideos)]);
    const jobLabel = (id) => {
      const j = jobRows.find((x) => x.id === id);
      return j ? `${j.clientName} \xB7 ${j.jobType}` : `Job #${id}`;
    };
    const today = new Date(`${args.today}T12:00:00`).getTime();
    const lossKeys = ["price", "timing", "competitor", "no_response", "other"];
    const weekStart = new Date(`${args.today}T12:00:00`);
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + 6) % 7);
    weekStart.setHours(0, 0, 0, 0);
    return { jobs: jobRows.map((j) => ({ id: j.id, label: jobLabel(j.id), clientId: j.clientId, clientName: j.clientName, clientPhone: j.clientPhone })), clients: clientRows.map((c) => ({ id: c.id, name: c.name, phone: c.phone })), warranties: warrantyRows.map((w) => {
      const j = jobRows.find((x) => x.id === w.jobId);
      const days = Math.ceil((new Date(`${w.expiryDate}T12:00:00`).getTime() - today) / 86400000);
      return { id: w.id, jobId: w.jobId, jobLabel: jobLabel(w.jobId), clientName: j?.clientName ?? "", clientPhone: j?.clientPhone ?? "", terms: w.terms, startDate: w.startDate, durationMonths: w.durationMonths, expiryDate: w.expiryDate, status: days < 0 ? "expired" : days <= 60 ? "expiring" : "active" };
    }), lossReport: lossKeys.map((reason) => {
      const rows = quoteRows.filter((q) => q.automationStatus === "lost" && q.lostReason === reason);
      return { reason, count: rows.length, value: rows.reduce((s, q) => s + Number(q.total.replace(/[^0-9.-]/g, "") || 0), 0) };
    }), crewHours: timeRows.filter((t) => t.startedAt >= weekStart).map((t) => ({ crewMember: t.crewMember || "Unassigned", jobId: t.jobId, jobLabel: jobLabel(t.jobId), hours: Math.max(0, ((t.endedAt?.getTime() ?? Date.now()) - t.startedAt.getTime()) / 3600000) })), suppliers: supplierRows.map((s) => {
      const orders = [...expenseRows.filter((e) => e.supplierId === s.id).map((e) => e.amount), ...receiptRows.filter((r) => r.supplierId === s.id).map((r) => r.amount)];
      return { id: s.id, name: s.name, category: s.category, phone: s.phone, email: s.email, notes: s.notes, orderCount: orders.length, orderTotal: orders.reduce((n, v) => n + Number(v.replace(/[^0-9.-]/g, "") || 0), 0) };
    }), plans: planRows.map((p) => ({ id: p.id, clientId: p.clientId, clientName: p.clientName, clientPhone: p.clientPhone, title: p.title, tasks: p.tasks, startDate: p.startDate, intervalMonths: p.intervalMonths, nextDueDate: p.nextDueDate, lastJobId: p.lastJobId, active: p.active })), scans: await Promise.all(scanRows.map(async (s) => ({ id: s.id, jobId: s.jobId, expenseId: s.expenseId, title: s.title, kind: s.kind, filename: s.filename, url: await ctx.blobs.getUrl(s.blobKey), createdAt: s.createdAt.toISOString() }))), videos: await Promise.all(videoRows.map(async (v) => ({ id: v.id, jobId: v.jobId, jobLabel: jobLabel(v.jobId), caption: v.caption, branded: v.branded, filename: v.filename, contentType: v.contentType, url: await ctx.blobs.getUrl(v.blobKey), createdAt: v.createdAt.toISOString() }))) };
  } }),
  saveWarranty: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), jobId: number2().int().positive(), terms: string2().trim().max(5000), startDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), durationMonths: number2().int().min(1).max(240) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const job = (await db.select().from(jobs).where(eq(jobs.id, args.jobId)).limit(1))[0];
    const d = new Date(`${args.startDate}T12:00:00`);
    d.setMonth(d.getMonth() + args.durationMonths);
    const values = { jobId: args.jobId, clientId: job?.clientId ?? null, terms: args.terms, startDate: args.startDate, durationMonths: args.durationMonths, expiryDate: d.toISOString().slice(0, 10), updatedAt: new Date };
    if (args.id) {
      await db.update(warranties).set(values).where(eq(warranties.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(warranties).values({ ...values, createdAt: new Date }).returning({ id: warranties.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save warranty.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  saveSupplier: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), name: string2().trim().min(1).max(160), category: string2().trim().max(120), phone: string2().trim().max(80), email: string2().trim().email().or(literal("")), notes: string2().trim().max(2000) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const now = new Date;
    if (args.id) {
      await db.update(suppliers).set({ name: args.name, category: args.category, phone: args.phone, email: args.email, notes: args.notes, updatedAt: now }).where(eq(suppliers.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(suppliers).values({ ...args, id: undefined, createdAt: now, updatedAt: now }).returning({ id: suppliers.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save supplier.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  saveMaintenancePlan: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), clientId: number2().int().positive().nullable().default(null), clientName: string2().trim().min(1).max(160), clientPhone: string2().trim().max(80), title: string2().trim().min(1).max(200), tasks: string2().trim().max(3000), startDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), intervalMonths: number2().int().min(1).max(120), active: boolean2().default(true) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const d = new Date(`${args.startDate}T12:00:00`);
    d.setMonth(d.getMonth() + args.intervalMonths);
    const values = { clientId: args.clientId, clientName: args.clientName, clientPhone: args.clientPhone, title: args.title, tasks: args.tasks, startDate: args.startDate, intervalMonths: args.intervalMonths, nextDueDate: d.toISOString().slice(0, 10), active: args.active, updatedAt: new Date };
    if (args.id) {
      await db.update(maintenancePlans).set(values).where(eq(maintenancePlans.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(maintenancePlans).values({ ...values, lastJobId: null, createdAt: new Date }).returning({ id: maintenancePlans.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save plan.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  completeMaintenancePlan: defineAction({
    request: object({ id: number2().int().positive() }),
    response: object({ jobId: number2() }),
    async handler(ctx, args) {
      const db = ctx.db();
      const plan = (await db.select().from(maintenancePlans).where(eq(maintenancePlans.id, args.id)).limit(1))[0];
      if (!plan)
        throw new Error("Plan not found.");
      const today = new Date().toISOString().slice(0, 10);
      if (plan.lastJobId && plan.nextDueDate > today)
        return { jobId: plan.lastJobId };
      const cycleDueDate = plan.nextDueDate;
      const existing = (await db.select().from(jobs).where(and(eq(jobs.maintenancePlanId, plan.id), eq(jobs.maintenanceDueDate, cycleDueDate))).limit(1))[0];
      const now = new Date;
      const inserted = existing ? [] : await db.insert(jobs).values({
        clientId: plan.clientId,
        clientName: plan.clientName,
        clientPhone: plan.clientPhone,
        jobAddress: "Address pending",
        jobType: plan.title,
        notes: plan.tasks,
        jobDate: cycleDueDate,
        maintenancePlanId: plan.id,
        maintenanceDueDate: cycleDueDate,
        createdAt: now,
        updatedAt: now
      }).onConflictDoNothing().returning({ id: jobs.id });
      const made = existing ?? inserted[0] ?? (await db.select().from(jobs).where(and(eq(jobs.maintenancePlanId, plan.id), eq(jobs.maintenanceDueDate, cycleDueDate))).limit(1))[0];
      if (!made)
        throw new Error("Could not create maintenance job.");
      const next = new Date(`${cycleDueDate}T12:00:00`);
      next.setMonth(next.getMonth() + plan.intervalMonths);
      await db.update(maintenancePlans).set({ lastJobId: made.id, nextDueDate: next.toISOString().slice(0, 10), updatedAt: now }).where(and(eq(maintenancePlans.id, plan.id), eq(maintenancePlans.nextDueDate, cycleDueDate)));
      ctx.invalidateQueries();
      return { jobId: made.id };
    }
  }),
  saveScannedDocument: defineAction({
    request: object({
      jobId: number2().int().positive().nullable().default(null),
      expenseId: number2().int().positive().nullable().default(null),
      title: string2().trim().min(1).max(200),
      kind: _enum(["receipt", "contract", "other"]),
      filename: string2().min(1).max(240),
      dataBase64: string2().min(1).max(30000000),
      expenseDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/).or(literal("")).default(""),
      vendor: string2().trim().max(160).default(""),
      amount: string2().trim().max(80).default(""),
      category: string2().trim().max(80).default("materials"),
      note: string2().trim().max(1000).default("")
    }),
    response: object({ id: number2(), expenseId: number2().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db();
      let expenseId = args.kind === "receipt" ? args.expenseId : null;
      let createdExpenseId = null;
      if (args.kind === "receipt" && !expenseId) {
        if (!args.expenseDate || !args.amount)
          throw new Error("Receipt date and amount are required.");
        const expenseRows = await db.insert(businessExpenses).values({
          expenseDate: args.expenseDate,
          vendor: args.vendor || args.title,
          amount: normalizeMoney(args.amount, "0.00"),
          category: args.category || "materials",
          jobId: args.jobId,
          supplierId: null,
          note: args.note,
          createdAt: new Date
        }).returning({ id: businessExpenses.id });
        createdExpenseId = expenseRows[0]?.id ?? null;
        expenseId = createdExpenseId;
        if (!expenseId)
          throw new Error("Could not create expense from receipt.");
      }
      if (expenseId) {
        const expense = (await db.select({ id: businessExpenses.id }).from(businessExpenses).where(eq(businessExpenses.id, expenseId)).limit(1))[0];
        if (!expense)
          throw new Error("Expense not found.");
      }
      const key = `scans/${args.jobId ?? "general"}/${crypto.randomUUID()}.pdf`;
      await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: "application/pdf" });
      try {
        const rows = await db.insert(scannedDocuments).values({ jobId: args.jobId, expenseId, title: args.title, kind: args.kind, blobKey: key, filename: args.filename, createdAt: new Date }).returning({ id: scannedDocuments.id });
        const made = rows[0];
        if (!made)
          throw new Error("Could not save scan.");
        ctx.invalidateQueries();
        return { id: made.id, expenseId };
      } catch (error) {
        await ctx.blobs.delete(key);
        if (createdExpenseId)
          await db.delete(businessExpenses).where(eq(businessExpenses.id, createdExpenseId));
        throw error;
      }
    }
  }),
  saveSlideshowVideo: defineAction({ request: object({ jobId: number2().int().positive(), caption: string2().trim().max(2000), branded: boolean2(), filename: string2().min(1).max(240), contentType: string2().max(100), dataBase64: string2().min(1).max(80000000), photoIds: array(number2().int().positive()).min(1).max(100) }), response: object({ id: number2() }), async handler(ctx, args) {
    const photoRows = await ctx.db().select().from(photos);
    const requested = photoRows.filter((p) => args.photoIds.includes(p.id) && p.jobId === args.jobId);
    if (requested.length !== args.photoIds.length || requested.some((p) => p.excludeFromSocial))
      throw new Error("A photo marked Not for social cannot be exported.");
    const key = `slideshows/${args.jobId}/${crypto.randomUUID()}`;
    await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType });
    const rows = await ctx.db().insert(slideshowVideos).values({ jobId: args.jobId, caption: args.caption, branded: args.branded, blobKey: key, filename: args.filename, contentType: args.contentType, createdAt: new Date }).returning({ id: slideshowVideos.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save video.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  getTaxExport: defineAction({ request: object({ year: number2().int().min(2000).max(2100) }), response: object({ rows: array(object({ month: string2(), type: _enum(["revenue", "expense", "materials"]), category: string2(), date: string2(), description: string2(), amount: number2() })) }), async handler(ctx, args) {
    const db = ctx.db();
    const [payments2, invoices2, expenses, receipts2, jobs2] = await Promise.all([db.select().from(payments), db.select().from(invoices), db.select().from(businessExpenses), db.select().from(receipts), db.select().from(jobs)]);
    const prefix = String(args.year);
    const rows = [...payments2.filter((p) => p.paymentDate.startsWith(prefix)).map((p) => {
      const inv = invoices2.find((i) => i.id === p.invoiceId);
      return { month: p.paymentDate.slice(0, 7), type: "revenue", category: p.method || "payment", date: p.paymentDate, description: inv ? `${inv.clientName} \xB7 ${inv.jobType}` : `Invoice #${p.invoiceId}`, amount: Number(p.amount.replace(/[^0-9.-]/g, "") || 0) };
    }), ...expenses.filter((e) => e.expenseDate.startsWith(prefix)).map((e) => ({ month: e.expenseDate.slice(0, 7), type: "expense", category: e.category, date: e.expenseDate, description: [e.vendor, e.note].filter(Boolean).join(" \xB7 "), amount: Number(e.amount.replace(/[^0-9.-]/g, "") || 0) })), ...receipts2.filter((r) => r.purchaseDate.startsWith(prefix)).map((r) => ({ month: r.purchaseDate.slice(0, 7), type: "materials", category: "job materials", date: r.purchaseDate, description: `${r.vendor}${jobs2.find((j) => j.id === r.jobId) ? ` \xB7 ${jobs2.find((j) => j.id === r.jobId)?.clientName}` : ""}`, amount: Number(r.amount.replace(/[^0-9.-]/g, "") || 0) }))];
    return { rows: rows.sort((a, b) => a.date.localeCompare(b.date)) };
  } }),
  getDocumentParameters: defineAction({ request: object({}), response: object({ defaultTaxRate: string2() }), async handler(ctx) {
    const row = (await ctx.db().select().from(adminParameters).where(eq(adminParameters.id, 1)).limit(1))[0];
    return { defaultTaxRate: row?.defaultTaxRate ?? "0" };
  } }),
  getAdminConsole: defineAction({
    request: object({ table: string2().max(80).default("jobs") }),
    response: object({
      allowed: boolean2(),
      currentUser: object({ id: number2(), name: string2(), role: _enum(["owner", "crew"]) }).nullable(),
      inbox: array(object({ id: number2(), kind: _enum(["support", "problem", "question", "general", "feature"]), subject: string2(), message: string2(), language: languageSchema, status: _enum(["open", "resolved"]), isUnread: boolean2(), createdAt: string2(), resolvedAt: string2().nullable() })),
      users: array(object({ id: number2(), name: string2(), role: _enum(["owner", "crew"]), isCurrent: boolean2(), active: boolean2(), createdAt: string2() })),
      parameters: object({ paymentDay1: number2(), paymentDay2: number2(), paymentDay3: number2(), reviewDelayDays: number2(), reengagementMonth1: number2(), reengagementMonth2: number2(), quoteExpiryWarningDays: number2(), materialLeadTimeDays: number2(), defaultTaxRate: string2(), hourlyLaborCost: string2() }),
      tables: array(object({ key: string2(), count: number2() })),
      recentRows: array(object({ id: string2(), title: string2(), detail: string2(), date: string2() }))
    }),
    async handler(ctx, args) {
      const db = ctx.db();
      let userRows = await db.select().from(appUsers).orderBy(appUsers.id);
      if (userRows.length === 0) {
        await db.insert(appUsers).values({ name: "Danny", role: "owner", isCurrent: true, active: true, createdAt: new Date, updatedAt: new Date });
        userRows = await db.select().from(appUsers).orderBy(appUsers.id);
      }
      const current = userRows.find((user) => user.isCurrent && user.active) ?? null;
      if (!current || current.role !== "owner")
        return { allowed: false, currentUser: current ? { id: current.id, name: current.name, role: current.role } : null, inbox: [], users: [], parameters: { paymentDay1: 3, paymentDay2: 14, paymentDay3: 30, reviewDelayDays: 1, reengagementMonth1: 6, reengagementMonth2: 12, quoteExpiryWarningDays: 3, materialLeadTimeDays: 14, defaultTaxRate: "0", hourlyLaborCost: "0" }, tables: [], recentRows: [] };
      let parameter = (await db.select().from(adminParameters).where(eq(adminParameters.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1))[0];
      if (!parameter) {
        await db.insert(adminParameters).values({ updatedAt: new Date });
        parameter = (await db.select().from(adminParameters).where(eq(adminParameters.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1))[0];
      }
      if (!parameter)
        throw new Error("Admin parameters are unavailable.");
      const collections = await Promise.all([
        db.select().from(clients),
        db.select().from(jobs),
        db.select().from(photos),
        db.select().from(documents),
        db.select().from(quotes),
        db.select().from(invoices),
        db.select().from(punchItems),
        db.select().from(punchSignoffs),
        db.select().from(progressUpdates),
        db.select().from(settings),
        db.select().from(timeEntries),
        db.select().from(receipts),
        db.select().from(crewTasks),
        db.select().from(voiceNotes),
        db.select().from(payments),
        db.select().from(completionCertificates),
        db.select().from(appointments),
        db.select().from(leads),
        db.select().from(selections),
        db.select().from(dailyLogs),
        db.select().from(internalNotes),
        db.select().from(paymentMilestones),
        db.select().from(automationLogs),
        db.select().from(supportReports),
        db.select().from(priceBookItems),
        db.select().from(quoteTemplates),
        db.select().from(mileageTrips),
        db.select().from(businessExpenses),
        db.select().from(subcontractors),
        db.select().from(shareImages),
        db.select().from(warranties),
        db.select().from(slideshowVideos),
        db.select().from(scannedDocuments),
        db.select().from(suppliers),
        db.select().from(maintenancePlans),
        db.select().from(appUsers),
        db.select().from(adminParameters)
      ]);
      const keys = ["clients", "jobs", "photos", "documents", "quotes", "invoices", "punch_items", "punch_signoffs", "progress_updates", "settings", "time_entries", "receipts", "crew_tasks", "voice_notes", "payments", "completion_certificates", "appointments", "leads", "selections", "daily_logs", "internal_notes", "payment_milestones", "automation_logs", "support_reports", "price_book_items", "quote_templates", "mileage_trips", "business_expenses", "subcontractors", "share_images", "warranties", "slideshow_videos", "scanned_documents", "suppliers", "maintenance_plans", "app_users", "admin_parameters"];
      const tables = keys.map((key, index) => ({ key, count: collections[index]?.length ?? 0 }));
      const selectedIndex = keys.indexOf(args.table);
      const selected = selectedIndex >= 0 ? collections[selectedIndex] ?? [] : [];
      const recentRows = selected.slice(-8).reverse().map((value, index) => {
        const row = value;
        const id = String(row.id ?? index + 1);
        const title = String(row.name ?? row.clientName ?? row.title ?? row.subject ?? row.item ?? row.label ?? row.jobType ?? `${args.table.replaceAll("_", " ")} #${id}`);
        const detail = String(row.status ?? row.stage ?? row.kind ?? row.role ?? row.vendor ?? row.category ?? row.phone ?? row.email ?? "Stored record");
        const rawDate = row.updatedAt ?? row.createdAt ?? row.paymentDate ?? row.issueDate ?? row.jobDate ?? row.startsAt ?? row.expenseDate ?? row.tripDate ?? "";
        const date = rawDate instanceof Date ? rawDate.toISOString() : String(rawDate);
        return { id, title, detail, date };
      });
      const inboxRows = await db.select().from(supportReports).orderBy(desc(supportReports.createdAt));
      return {
        allowed: true,
        currentUser: { id: current.id, name: current.name, role: current.role },
        inbox: inboxRows.map((row) => ({ id: row.id, kind: row.kind, subject: row.subject, message: row.message, language: row.language, status: row.status, isUnread: row.isUnread, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null })),
        users: userRows.map((row) => ({ id: row.id, name: row.name, role: row.role, isCurrent: row.isCurrent, active: row.active, createdAt: row.createdAt.toISOString() })),
        parameters: { paymentDay1: parameter.paymentDay1, paymentDay2: parameter.paymentDay2, paymentDay3: parameter.paymentDay3, reviewDelayDays: parameter.reviewDelayDays, reengagementMonth1: parameter.reengagementMonth1, reengagementMonth2: parameter.reengagementMonth2, quoteExpiryWarningDays: parameter.quoteExpiryWarningDays, materialLeadTimeDays: parameter.materialLeadTimeDays, defaultTaxRate: parameter.defaultTaxRate, hourlyLaborCost: parameter.hourlyLaborCost },
        tables,
        recentRows
      };
    }
  }),
  updateSupportReport: defineAction({ request: object({ id: number2().int().positive(), status: _enum(["open", "resolved"]), isUnread: boolean2() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const current = (await db.select().from(appUsers).where(eq(appUsers.isCurrent, true)).limit(1))[0];
    if (!current || current.role !== "owner")
      throw new Error("Owner access required.");
    await db.update(supportReports).set({ status: args.status, isUnread: args.isUnread, resolvedAt: args.status === "resolved" ? new Date : null, updatedAt: new Date }).where(eq(supportReports.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  addAppUser: defineAction({ request: object({ name: string2().trim().min(1).max(160), role: _enum(["owner", "crew"]) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const current = (await db.select().from(appUsers).where(eq(appUsers.isCurrent, true)).limit(1))[0];
    if (!current || current.role !== "owner")
      throw new Error("Owner access required.");
    const rows = await db.insert(appUsers).values({ name: args.name, role: args.role, isCurrent: false, active: true, createdAt: new Date, updatedAt: new Date }).returning({ id: appUsers.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not add user.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  updateAppUser: defineAction({ request: object({ id: number2().int().positive(), role: _enum(["owner", "crew"]), active: boolean2() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const current = (await db.select().from(appUsers).where(eq(appUsers.isCurrent, true)).limit(1))[0];
    if (!current || current.role !== "owner")
      throw new Error("Owner access required.");
    await db.update(appUsers).set({ role: args.role, active: args.active, updatedAt: new Date }).where(eq(appUsers.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  updateAdminParameters: defineAction({ request: object({ paymentDay1: number2().int().min(1).max(365), paymentDay2: number2().int().min(1).max(365), paymentDay3: number2().int().min(1).max(365), reviewDelayDays: number2().int().min(0).max(90), reengagementMonth1: number2().int().min(1).max(120), reengagementMonth2: number2().int().min(1).max(120), quoteExpiryWarningDays: number2().int().min(0).max(90), materialLeadTimeDays: number2().int().min(0).max(730), defaultTaxRate: string2().trim().max(20), hourlyLaborCost: string2().trim().max(80) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    if (!(args.paymentDay1 < args.paymentDay2 && args.paymentDay2 < args.paymentDay3))
      throw new Error("Payment days must increase.");
    if (!(args.reengagementMonth1 < args.reengagementMonth2))
      throw new Error("Re-engagement months must increase.");
    const db = ctx.db();
    const current = (await db.select().from(appUsers).where(eq(appUsers.isCurrent, true)).limit(1))[0];
    if (!current || current.role !== "owner")
      throw new Error("Owner access required.");
    const exists = (await db.select().from(adminParameters).where(eq(adminParameters.id, 1)).limit(1))[0];
    if (exists)
      await db.update(adminParameters).set({ ...args, updatedAt: new Date }).where(eq(adminParameters.id, 1));
    else
      await db.insert(adminParameters).values({ id: 1, ...args, updatedAt: new Date });
    const setting = (await db.select().from(settings).where(eq(settings.id, 1)).limit(1))[0];
    if (setting)
      await db.update(settings).set({ hourlyCostRate: args.hourlyLaborCost, updatedAt: new Date }).where(eq(settings.id, 1));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  createPortalLink: defineAction({ request: object({ jobId: number2().int().positive(), expiresInDays: union([literal(30), literal(90), literal(365), literal(0)]).default(90) }), response: object({ token: string2(), route: string2(), expiresAt: string2().nullable() }), async handler(ctx, args) {
    const db = ctx.db();
    const job = (await db.select().from(jobs).where(eq(jobs.id, args.jobId)).limit(1))[0];
    if (!job)
      throw new Error("Job not found.");
    const token = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
    const hash = await hashPortalToken(token);
    await db.update(portalTokens).set({ revokedAt: new Date }).where(and(eq(portalTokens.jobId, args.jobId), isNull(portalTokens.revokedAt)));
    const expiresAt = args.expiresInDays === 0 ? null : new Date(Date.now() + args.expiresInDays * 86400000);
    await db.insert(portalTokens).values({ jobId: args.jobId, tokenHash: hash, tokenHint: token.slice(-6), expiresAt, createdAt: new Date });
    ctx.invalidateQueries();
    return { token, route: `#portal=${encodeURIComponent(token)}`, expiresAt: expiresAt?.toISOString() ?? null };
  } }),
  revokePortalLink: defineAction({ request: object({ jobId: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(portalTokens).set({ revokedAt: new Date }).where(and(eq(portalTokens.jobId, args.jobId), isNull(portalTokens.revokedAt)));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  getPortalLinkInfo: defineAction({ request: object({ jobId: number2().int().positive() }), response: object({ link: object({ hint: string2(), expiresAt: string2().nullable(), expired: boolean2(), viewCount: number2(), firstViewedAt: string2().nullable(), lastViewedAt: string2().nullable(), createdAt: string2() }).nullable() }), async handler(ctx, args) {
    const db = ctx.db();
    const link = (await db.select().from(portalTokens).where(and(eq(portalTokens.jobId, args.jobId), isNull(portalTokens.revokedAt))).orderBy(desc(portalTokens.createdAt)).limit(1))[0];
    if (!link)
      return { link: null };
    return { link: { hint: link.tokenHint, expiresAt: link.expiresAt?.toISOString() ?? null, expired: link.expiresAt ? link.expiresAt.getTime() < Date.now() : false, viewCount: link.viewCount, firstViewedAt: link.firstViewedAt?.toISOString() ?? null, lastViewedAt: link.lastViewedAt?.toISOString() ?? null, createdAt: link.createdAt.toISOString() } };
  } }),
  rotatePortalLink: defineAction({ request: object({ jobId: number2().int().positive(), expiresInDays: union([literal(30), literal(90), literal(365), literal(0)]).default(90) }), response: object({ token: string2(), route: string2(), expiresAt: string2().nullable() }), async handler(ctx, args) {
    const db = ctx.db();
    const job = (await db.select().from(jobs).where(eq(jobs.id, args.jobId)).limit(1))[0];
    if (!job)
      throw new Error("Job not found.");
    const token = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
    const hash = await hashPortalToken(token);
    const now = new Date;
    const expiresAt = args.expiresInDays === 0 ? null : new Date(now.getTime() + args.expiresInDays * 86400000);
    await db.batch([db.update(portalTokens).set({ revokedAt: now }).where(and(eq(portalTokens.jobId, args.jobId), isNull(portalTokens.revokedAt))), db.insert(portalTokens).values({ jobId: args.jobId, tokenHash: hash, tokenHint: token.slice(-6), expiresAt, createdAt: now })]);
    ctx.invalidateQueries();
    return { token, route: `#portal=${encodeURIComponent(token)}`, expiresAt: expiresAt?.toISOString() ?? null };
  } }),
  getPortalData: defineAction({ request: object({ token: string2().min(32).max(200) }), response: object({ job: object({ id: number2(), clientName: string2(), jobType: string2(), jobAddress: string2() }), photos: array(object({ id: number2(), stage: stageSchema, caption: string2(), url: string2() })), appointments: array(object({ id: number2(), startsAt: string2(), notes: string2() })), selections: array(selectionSchema), changeOrders: array(object({ id: number2(), title: string2(), description: string2(), amount: string2(), originalUrl: string2().nullable(), clientSignerName: string2(), clientSignedAt: string2().nullable() })) }), async handler(ctx, args) {
    const db = ctx.db();
    const access = await requirePortalAccess(ctx, args.token, { logView: true });
    const job = (await db.select().from(jobs).where(eq(jobs.id, access.jobId)).limit(1))[0];
    if (!job)
      throw new Error("Job not found.");
    const [photos2, appointments2, selections2, documents2] = await Promise.all([db.select().from(photos).where(eq(photos.jobId, job.id)).orderBy(photos.createdAt), db.select().from(appointments).where(eq(appointments.jobId, job.id)).orderBy(appointments.startsAt), db.select().from(selections).where(eq(selections.jobId, job.id)).orderBy(selections.id), db.select().from(documents).where(eq(documents.jobId, job.id)).orderBy(desc(documents.createdAt))]);
    const today = new Date().toISOString();
    return { job: { id: job.id, clientName: job.clientName, jobType: job.jobType, jobAddress: job.jobAddress }, photos: await Promise.all(photos2.filter((p) => !p.excludeFromSocial).map(async (p) => ({ id: p.id, stage: p.stage, caption: p.caption, url: await ctx.blobs.getUrl(p.blobKey) }))), appointments: appointments2.filter((a) => a.startsAt >= today).map((a) => ({ id: a.id, startsAt: a.startsAt, notes: a.notes })), selections: await Promise.all(selections2.map(async (s) => ({ id: s.id, jobId: s.jobId, category: s.category, item: s.item, vendor: s.vendor, photoUrl: s.photoBlobKey ? await ctx.blobs.getUrl(s.photoBlobKey) : null, approvalStatus: s.approvalStatus, leadTimeDays: s.leadTimeDays, createdAt: s.createdAt.toISOString() }))), changeOrders: await Promise.all(documents2.filter((d) => d.kind === "change_order").map(async (d) => ({ id: d.id, title: d.title, description: d.description, amount: d.amount, originalUrl: d.originalBlobKey ? await ctx.blobs.getUrl(d.originalBlobKey) : null, clientSignerName: d.clientSignerName, clientSignedAt: d.clientSignedAt?.toISOString() ?? null }))) };
  } }),
  portalUpdateSelection: defineAction({ request: object({ token: string2().min(32).max(200), selectionId: number2().int().positive(), status: _enum(["approved", "rejected"]) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const access = await requirePortalAccess(ctx, args.token, { logView: false });
    const selection = (await db.select().from(selections).where(eq(selections.id, args.selectionId)).limit(1))[0];
    if (!selection || selection.jobId !== access.jobId)
      throw new Error("Selection not found.");
    await db.update(selections).set({ approvalStatus: args.status }).where(eq(selections.id, selection.id));
    await logPortalEvent(ctx, access.id, args.status === "approved" ? "approve_selection" : "reject_selection");
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  portalSignChangeOrder: defineAction({ request: object({ token: string2().min(32).max(200), documentId: number2().int().positive(), signerName: string2().trim().min(1).max(160), signatureDataBase64: string2().min(1).max(5000000) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const access = await requirePortalAccess(ctx, args.token, { logView: false });
    const document = (await db.select().from(documents).where(eq(documents.id, args.documentId)).limit(1))[0];
    if (!document || document.jobId !== access.jobId || document.kind !== "change_order")
      throw new Error("Change order not found.");
    if (document.clientSignedAt)
      return { ok: true };
    const key = `client-signatures/${access.jobId}/${crypto.randomUUID()}.png`;
    await ctx.blobs.put(key, Buffer.from(args.signatureDataBase64, "base64"), { contentType: "image/png" });
    await db.update(documents).set({ clientSignerName: args.signerName, clientSignatureBlobKey: key, clientSignedAt: new Date }).where(eq(documents.id, document.id));
    await logPortalEvent(ctx, access.id, "sign");
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  createDocumentLink: defineAction({ request: object({ kind: documentKindSchema, id: number2().int().positive() }), response: object({ token: string2(), hint: string2(), expiresAt: string2() }), async handler(ctx, args) {
    const db = ctx.db();
    if (!await documentLinkTargetExists(ctx, args.kind, args.id))
      throw new Error("Document not found.");
    const token = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
    const hash = await hashLinkToken(token);
    const now = new Date;
    const expiresAt = new Date(now.getTime() + 30 * 86400000);
    await db.update(documentLinks).set({ revokedAt: now }).where(and(eq(documentLinks.documentKind, args.kind), eq(documentLinks.documentId, args.id), isNull(documentLinks.revokedAt)));
    await db.insert(documentLinks).values({ documentKind: args.kind, documentId: args.id, tokenHash: hash, tokenHint: token.slice(-6), expiresAt, createdAt: now });
    ctx.invalidateQueries();
    return { token, hint: token.slice(-6), expiresAt: expiresAt.toISOString() };
  } }),
  getDocumentLinkInfo: defineAction({ request: object({ kind: documentKindSchema, id: number2().int().positive() }), response: object({ link: object({ hint: string2(), expiresAt: string2(), expired: boolean2(), viewCount: number2(), firstViewedAt: string2().nullable(), lastViewedAt: string2().nullable(), createdAt: string2() }).nullable() }), async handler(ctx, args) {
    const link = await getActiveDocumentLinkRow(ctx, args.kind, args.id);
    if (!link)
      return { link: null };
    return { link: { hint: link.tokenHint, expiresAt: link.expiresAt.toISOString(), expired: link.expiresAt.getTime() < Date.now(), viewCount: link.viewCount, firstViewedAt: link.firstViewedAt?.toISOString() ?? null, lastViewedAt: link.lastViewedAt?.toISOString() ?? null, createdAt: link.createdAt.toISOString() } };
  } }),
  revokeDocumentLink: defineAction({ request: object({ kind: documentKindSchema, id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(documentLinks).set({ revokedAt: new Date }).where(and(eq(documentLinks.documentKind, args.kind), eq(documentLinks.documentId, args.id), isNull(documentLinks.revokedAt)));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  resolveDocumentLink: defineAction({ request: object({ token: string2().min(64).max(200), userAgent: string2().max(500).default("") }), response: object({ kind: documentKindSchema, documentId: number2(), signable: boolean2(), alreadySigned: boolean2(), company: object({ name: string2(), phone: string2(), email: string2(), website: string2(), licenseNumber: string2(), logoUrl: string2().nullable() }), title: string2(), clientName: string2(), jobAddress: string2(), jobType: string2(), lineItems: array(object({ description: string2(), amount: string2() })), subtotal: string2(), total: string2(), dateLabel: string2(), dateValue: string2(), footnote: string2(), bodyText: string2(), description: string2(), amount: string2(), contractorSignerName: string2(), linkExpiresAt: string2() }), async handler(ctx, args) {
    const db = ctx.db();
    const link = await resolveDocumentLinkToken(ctx, args.token);
    const now = new Date;
    await db.update(documentLinks).set({ viewCount: link.viewCount + 1, firstViewedAt: link.firstViewedAt ?? now, lastViewedAt: now }).where(eq(documentLinks.id, link.id));
    await db.insert(documentLinkEvents).values({ linkId: link.id, eventType: "view", userAgent: args.userAgent.slice(0, 300), occurredAt: now });
    const settings2 = (await db.select().from(settings).where(eq(settings.id, 1)).limit(1))[0];
    const company = { name: settings2?.companyName ?? "", phone: settings2?.phone ?? "", email: settings2?.email ?? "", website: settings2?.website ?? "", licenseNumber: settings2?.licenseNumber ?? "", logoUrl: settings2?.logoBlobKey ? await ctx.blobs.getUrl(settings2.logoBlobKey) : null };
    const base = { kind: link.documentKind, documentId: link.documentId, signable: false, alreadySigned: false, company, title: "", clientName: "", jobAddress: "", jobType: "", lineItems: [], subtotal: "", total: "", dateLabel: "", dateValue: "", footnote: "", bodyText: "", description: "", amount: "", contractorSignerName: "", linkExpiresAt: link.expiresAt.toISOString() };
    if (link.documentKind === "invoice") {
      const row = (await db.select().from(invoices).where(eq(invoices.id, link.documentId)).limit(1))[0];
      if (!row)
        throw new Error("This document is no longer available.");
      return { ...base, title: `Invoice #${row.id}`, clientName: row.clientName, jobAddress: row.jobAddress, jobType: row.jobType, lineItems: JSON.parse(row.lineItemsJson), subtotal: row.subtotal, total: row.total, dateLabel: "Due date", dateValue: row.dueDate, footnote: row.footnote };
    }
    if (link.documentKind === "quote") {
      const row = (await db.select().from(quotes).where(eq(quotes.id, link.documentId)).limit(1))[0];
      if (!row)
        throw new Error("This document is no longer available.");
      return { ...base, title: `Estimate #${row.id}`, clientName: row.clientName, jobAddress: row.jobAddress, jobType: row.jobType, lineItems: JSON.parse(row.lineItemsJson), subtotal: row.subtotal, total: row.total, dateLabel: "Valid until", dateValue: row.expiryDate, footnote: row.footnote };
    }
    const doc = (await db.select().from(documents).where(eq(documents.id, link.documentId)).limit(1))[0];
    if (!doc || doc.kind !== link.documentKind)
      throw new Error("This document is no longer available.");
    const job = (await db.select().from(jobs).where(eq(jobs.id, doc.jobId)).limit(1))[0];
    return { ...base, signable: true, alreadySigned: !!doc.clientSignedAt, title: doc.title, clientName: job?.clientName ?? "", jobAddress: job?.jobAddress ?? "", jobType: job?.jobType ?? "", bodyText: doc.bodyText, description: doc.description, amount: doc.amount, contractorSignerName: doc.signerName, dateLabel: "Signed", dateValue: doc.signedAt.toISOString().slice(0, 10) };
  } }),
  submitDocumentSignature: defineAction({ request: object({ token: string2().min(64).max(200), signerName: string2().trim().min(1).max(160), signatureDataBase64: string2().min(1).max(5000000), signedPdfDataBase64: string2().min(1).max(30000000), userAgent: string2().max(500).default("") }), response: object({ ok: literal(true), signedAt: string2() }), async handler(ctx, args) {
    const db = ctx.db();
    const link = await resolveDocumentLinkToken(ctx, args.token);
    if (link.documentKind !== "contract" && link.documentKind !== "change_order")
      throw new Error("This document cannot be signed.");
    const doc = (await db.select().from(documents).where(eq(documents.id, link.documentId)).limit(1))[0];
    if (!doc || doc.kind !== link.documentKind)
      throw new Error("This document is no longer available.");
    if (doc.clientSignedAt)
      throw new Error("This document was already signed.");
    const pdfBytes = Buffer.from(args.signedPdfDataBase64, "base64");
    if (pdfBytes.length < 100)
      throw new Error("The signed file looks invalid.");
    const digest = await crypto.subtle.digest("SHA-256", pdfBytes);
    const hash = Array.from(new Uint8Array(digest)).map((v) => v.toString(16).padStart(2, "0")).join("");
    const now = new Date;
    const sigKey = `client-signatures/${doc.jobId}/${crypto.randomUUID()}.png`;
    const pdfKey = `client-signed-pdfs/${doc.jobId}/${crypto.randomUUID()}.pdf`;
    await ctx.blobs.put(sigKey, Buffer.from(args.signatureDataBase64, "base64"), { contentType: "image/png" });
    await ctx.blobs.put(pdfKey, pdfBytes, { contentType: "application/pdf" });
    await db.update(documents).set({ clientSignerName: args.signerName, clientSignatureBlobKey: sigKey, clientSignedAt: now, clientSignedPdfBlobKey: pdfKey, clientSignatureHash: hash, clientSignedUserAgent: args.userAgent.slice(0, 300) }).where(eq(documents.id, doc.id));
    await db.insert(documentLinkEvents).values({ linkId: link.id, eventType: "sign", userAgent: args.userAgent.slice(0, 300), occurredAt: now });
    ctx.invalidateQueries();
    return { ok: true, signedAt: now.toISOString() };
  } }),
  submitEstimateRequest: defineAction({ request: object({ name: string2().trim().min(2).max(160), phone: string2().trim().min(7).max(40), email: string2().trim().email().max(200), address: string2().trim().min(5).max(240), serviceType: string2().trim().min(2).max(120), projectDetails: string2().trim().min(10).max(3000), preferredContactTime: string2().trim().max(120), company: string2().max(0).default("") }), response: object({ id: number2() }), async handler(ctx, args) {
    if (args.company)
      throw new Error("Request rejected.");
    const db = ctx.db();
    const digits = normalizedPhone(args.phone);
    if (digits.length < 10)
      throw new Error("Enter a valid phone number.");
    const recent = await db.select().from(leads).orderBy(desc(leads.createdAt));
    const cutoff = Date.now() - 86400000;
    const duplicates = recent.filter((l) => l.source === "website form" && l.createdAt.getTime() >= cutoff && (normalizedPhone(l.phone) === digits || l.email.toLowerCase() === args.email.toLowerCase()));
    if (duplicates.length >= 3)
      throw new Error("Too many recent requests. Please call the office.");
    const rows = await db.insert(leads).values({ name: args.name, phone: args.phone, email: args.email, address: args.address, serviceType: args.serviceType, preferredContactTime: args.preferredContactTime, source: "website form", notes: args.projectDetails, stage: "new", createdAt: new Date, updatedAt: new Date }).returning({ id: leads.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not submit request.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  updateJobSiteLocation: defineAction({ request: object({ jobId: number2().int().positive(), latitude: number2().min(-90).max(90), longitude: number2().min(-180).max(180) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(jobs).set({ latitude: String(args.latitude), longitude: String(args.longitude), updatedAt: new Date }).where(eq(jobs.id, args.jobId));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  suggestJobsByLocation: defineAction({ request: object({ latitude: number2().min(-90).max(90), longitude: number2().min(-180).max(180) }), response: object({ jobs: array(object({ id: number2(), label: string2(), distanceMiles: number2() })) }), async handler(ctx, args) {
    const rows = await ctx.db().select().from(jobs);
    const rad = (value) => value * Math.PI / 180;
    const miles = (lat, lon) => {
      const dLat = rad(lat - args.latitude), dLon = rad(lon - args.longitude);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(args.latitude)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
      return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    return { jobs: rows.flatMap((j) => {
      const lat = Number(j.latitude), lon = Number(j.longitude);
      return Number.isFinite(lat) && Number.isFinite(lon) ? [{ id: j.id, label: `${j.clientName} \xB7 ${j.jobType}`, distanceMiles: Math.round(miles(lat, lon) * 10) / 10 }] : [];
    }).sort((a, b) => a.distanceMiles - b.distanceMiles).slice(0, 5) };
  } }),
  clockInCrew: defineAction({ request: object({ jobId: number2().int().positive(), crewMember: string2().trim().min(1).max(160), latitude: number2().min(-90).max(90).nullable(), longitude: number2().min(-180).max(180).nullable(), note: string2().trim().max(500).default("") }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const active = (await db.select().from(timeEntries).orderBy(desc(timeEntries.startedAt))).find((t) => !t.endedAt && t.crewMember.toLowerCase() === args.crewMember.toLowerCase());
    if (active)
      return { id: active.id };
    const rows = await db.insert(timeEntries).values({ jobId: args.jobId, crewMember: args.crewMember, startedAt: new Date, clockInLatitude: args.latitude === null ? null : String(args.latitude), clockInLongitude: args.longitude === null ? null : String(args.longitude), note: args.note, createdAt: new Date }).returning({ id: timeEntries.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not clock in.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  clockOutCrew: defineAction({ request: object({ id: number2().int().positive(), latitude: number2().min(-90).max(90).nullable(), longitude: number2().min(-180).max(180).nullable() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(timeEntries).set({ endedAt: new Date, clockOutLatitude: args.latitude === null ? null : String(args.latitude), clockOutLongitude: args.longitude === null ? null : String(args.longitude) }).where(eq(timeEntries.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  getCrewClockStatus: defineAction({ request: object({}), response: object({ active: array(object({ id: number2(), jobId: number2(), jobLabel: string2(), crewMember: string2(), startedAt: string2(), hours: number2(), missingGps: boolean2(), overTwelveHours: boolean2() })), flagged: array(object({ id: number2(), jobId: number2(), jobLabel: string2(), crewMember: string2(), startedAt: string2(), hours: number2(), missingGps: boolean2(), overTwelveHours: boolean2() })) }), async handler(ctx) {
    const db = ctx.db();
    const [entries, jobs2] = await Promise.all([db.select().from(timeEntries).orderBy(desc(timeEntries.startedAt)), db.select().from(jobs)]);
    const now = Date.now();
    const shape = (entry) => {
      const hours = Math.max(0, ((entry.endedAt?.getTime() ?? now) - entry.startedAt.getTime()) / 3600000);
      const job = jobs2.find((j) => j.id === entry.jobId);
      return { id: entry.id, jobId: entry.jobId, jobLabel: job ? `${job.clientName} \xB7 ${job.jobType}` : `Job #${entry.jobId}`, crewMember: entry.crewMember || "Unassigned", startedAt: entry.startedAt.toISOString(), hours, missingGps: !entry.clockInLatitude || !entry.clockInLongitude, overTwelveHours: hours > 12 };
    };
    return { active: entries.filter((e) => !e.endedAt).map(shape), flagged: entries.filter((e) => (e.endedAt?.getTime() ?? now) - e.startedAt.getTime() > 43200000).map(shape).slice(0, 20) };
  } }),
  updateQuoteVersion: defineAction({ request: object({ id: number2().int().positive(), lineItems: array(quoteItemSchema), subtotal: string2().max(80), total: string2().max(80) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const row = (await db.select().from(quotes).where(eq(quotes.id, args.id)).limit(1))[0];
    if (!row)
      throw new Error("Quote not found.");
    if (row.superseded || row.accepted || row.sentAt)
      throw new Error("Only an unsent version can be edited.");
    await db.update(quotes).set({ lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), subtotal: normalizeMoney(args.subtotal), total: normalizeMoney(args.total), updatedAt: new Date }).where(eq(quotes.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  createQuoteVersion: defineAction({ request: object({ id: number2().int().positive() }), response: object({ id: number2(), versionNumber: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const source = (await db.select().from(quotes).where(eq(quotes.id, args.id)).limit(1))[0];
    if (!source)
      throw new Error("Quote not found.");
    const seriesId = source.seriesId ?? source.id;
    const versions = (await db.select().from(quotes)).filter((q) => (q.seriesId ?? q.id) === seriesId);
    const versionNumber = Math.max(...versions.map((q) => q.versionNumber), 0) + 1;
    const now = new Date;
    const rows = await db.insert(quotes).values({ clientId: source.clientId, clientName: source.clientName, clientPhone: source.clientPhone, clientEmail: source.clientEmail, jobAddress: source.jobAddress, jobType: source.jobType, lineItemsJson: source.lineItemsJson, subtotal: source.subtotal, discountType: source.discountType, discountValue: source.discountValue, taxType: source.taxType, taxValue: source.taxValue, total: source.total, footnote: source.footnote, expiryDate: source.expiryDate, sentAt: "", automationStatus: "awaiting", lostReason: null, lostNote: "", theme: source.theme, font: source.font, accentColor: source.accentColor, showTaxLine: source.showTaxLine, showDiscountLine: source.showDiscountLine, showPaidLine: source.showPaidLine, showPaymentTerms: source.showPaymentTerms, showFooterNotes: source.showFooterNotes, showLogo: source.showLogo, showCompanyInfo: source.showCompanyInfo, jobId: source.jobId, seriesId, parentQuoteId: source.id, versionNumber, superseded: false, accepted: false, createdAt: now, updatedAt: now }).returning({ id: quotes.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not create quote version.");
    ctx.invalidateQueries();
    return { id: made.id, versionNumber };
  } }),
  sendQuoteVersion: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const quote = (await db.select().from(quotes).where(eq(quotes.id, args.id)).limit(1))[0];
    if (!quote)
      throw new Error("Quote not found.");
    const seriesId = quote.seriesId ?? quote.id;
    const versions = (await db.select().from(quotes)).filter((q) => (q.seriesId ?? q.id) === seriesId);
    for (const version of versions)
      await db.update(quotes).set({ superseded: version.id !== quote.id, updatedAt: new Date }).where(eq(quotes.id, version.id));
    await db.update(quotes).set({ sentAt: new Date().toISOString().slice(0, 10), superseded: false, updatedAt: new Date }).where(eq(quotes.id, quote.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  acceptQuoteVersion: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const quote = (await db.select().from(quotes).where(eq(quotes.id, args.id)).limit(1))[0];
    if (!quote)
      throw new Error("Quote not found.");
    const seriesId = quote.seriesId ?? quote.id;
    const versions = (await db.select().from(quotes)).filter((q) => (q.seriesId ?? q.id) === seriesId);
    for (const version of versions)
      await db.update(quotes).set({ accepted: version.id === quote.id, superseded: version.id !== quote.id, updatedAt: new Date }).where(eq(quotes.id, version.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  getQuoteVersions: defineAction({ request: object({ id: number2().int().positive() }), response: object({ versions: array(quoteSchema), diffs: array(object({ fromVersion: number2(), toVersion: number2(), added: array(string2()), removed: array(string2()), priceChanges: array(string2()), totalChange: string2() })) }), async handler(ctx, args) {
    const db = ctx.db();
    const quote = (await db.select().from(quotes).where(eq(quotes.id, args.id)).limit(1))[0];
    if (!quote)
      return { versions: [], diffs: [] };
    const seriesId = quote.seriesId ?? quote.id;
    const versions = (await db.select().from(quotes)).filter((q) => (q.seriesId ?? q.id) === seriesId).sort((a, b) => a.versionNumber - b.versionNumber);
    return { versions: versions.map(quoteShape), diffs: versions.slice(1).map((next, index) => {
      const previous = versions[index];
      if (!previous)
        return { fromVersion: next.versionNumber - 1, toVersion: next.versionNumber, added: [], removed: [], priceChanges: [], totalChange: "0.00" };
      return { fromVersion: previous.versionNumber, toVersion: next.versionNumber, ...quoteDiff(previous, next) };
    }) };
  } }),
  listMaterialCosts: defineAction({ request: object({}), response: object({ items: array(object({ id: number2(), nameEn: string2(), nameEs: string2(), unitEn: string2(), unitEs: string2(), price: string2(), updatedAt: string2() })), lastUpdated: string2().nullable() }), async handler(ctx) {
    const rows = await ctx.db().select().from(materialCostItems).orderBy(materialCostItems.nameEn);
    return { items: rows.map((r) => ({ id: r.id, nameEn: r.nameEn, nameEs: r.nameEs, unitEn: r.unitEn, unitEs: r.unitEs, price: r.price, updatedAt: r.updatedAt.toISOString() })), lastUpdated: rows.length ? new Date(Math.max(...rows.map((r) => r.updatedAt.getTime()))).toISOString() : null };
  } }),
  saveMaterialCost: defineAction({ request: object({ id: number2().int().positive().nullable().default(null), nameEn: string2().trim().min(1).max(160), nameEs: string2().trim().min(1).max(160), unitEn: string2().trim().min(1).max(80), unitEs: string2().trim().min(1).max(80), price: string2().trim().min(1).max(80) }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const now = new Date;
    const price = normalizeMoney(args.price, "0.00");
    if (args.id) {
      await db.update(materialCostItems).set({ nameEn: args.nameEn, nameEs: args.nameEs, unitEn: args.unitEn, unitEs: args.unitEs, price, updatedAt: now }).where(eq(materialCostItems.id, args.id));
      ctx.invalidateQueries();
      return { id: args.id };
    }
    const rows = await db.insert(materialCostItems).values({ nameEn: args.nameEn, nameEs: args.nameEs, unitEn: args.unitEn, unitEs: args.unitEs, price, createdAt: now, updatedAt: now }).returning({ id: materialCostItems.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save material.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  deleteMaterialCost: defineAction({ request: object({ id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().delete(materialCostItems).where(eq(materialCostItems.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  getFieldIntelligence: defineAction({ request: object({ today: string2().regex(/^\d{4}-\d{2}-\d{2}$/), periodStart: string2().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: string2().regex(/^\d{4}-\d{2}-\d{2}$/) }), response: object({
    jobs: array(object({ id: number2(), label: string2() })),
    suppliers: array(object({ id: number2(), name: string2() })),
    supplierQuotes: array(object({ id: number2(), supplierId: number2(), supplierName: string2(), jobId: number2().nullable(), title: string2(), lineItems: array(object({ description: string2(), qty: number2(), unitPrice: string2() })), total: string2(), selected: boolean2() })),
    purchaseOrders: array(object({ id: number2(), supplierId: number2(), supplierName: string2(), jobId: number2().nullable(), jobLabel: string2().nullable(), number: string2(), status: _enum(["draft", "sent", "partially_received", "received", "cancelled"]), lineItems: array(object({ description: string2(), qty: number2(), unitPrice: string2(), receivedQty: number2() })), total: string2() })),
    equipment: array(object({ id: number2(), name: string2(), category: string2(), purchaseDate: string2(), cost: string2(), serialNumber: string2(), assignedTo: string2(), photoUrl: string2().nullable(), maintenanceTask: string2(), maintenanceEveryDays: number2(), nextMaintenanceDate: string2(), checkedOutAt: string2().nullable(), returnedAt: string2().nullable(), maintenanceDue: boolean2() })),
    safetyTalks: array(object({ id: number2(), jobId: number2(), jobLabel: string2(), topicKey: string2(), talkDate: string2(), checklist: array(string2()), acknowledgements: array(string2()) })),
    incidents: array(object({ id: number2(), jobId: number2(), jobLabel: string2(), incidentDate: string2(), description: string2(), severity: _enum(["near_miss", "minor", "serious"]), correctiveAction: string2(), photoUrl: string2().nullable() })),
    safetyStreak: number2(),
    credentials: array(object({ id: number2(), ownerType: _enum(["business", "subcontractor"]), subcontractorId: number2().nullable(), ownerLabel: string2(), kind: string2(), identifier: string2(), expiresOn: string2(), daysRemaining: number2() })),
    payroll: array(object({ crewMember: string2(), hours: number2(), hourlyRate: string2(), grossPay: string2() })),
    costAlerts: array(object({ jobId: number2(), jobLabel: string2(), quoted: number2(), cost: number2(), percent: number2(), level: _enum(["warning", "urgent"]) })),
    today: object({ poAwaiting: number2(), maintenanceDue: number2(), credentialWarnings: number2(), hotLeads: number2(), costAlerts: number2() })
  }), async handler(ctx, args) {
    const db = ctx.db();
    const [jobs2, suppliers2, quotes2, pos, equipment2, talks, incidents2, credentials2, rates, times, receipts2, expenses, subs, jobQuotes, leads2, settings2] = await Promise.all([db.select().from(jobs), db.select().from(suppliers), db.select().from(supplierQuotes).orderBy(desc(supplierQuotes.createdAt)), db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)), db.select().from(equipment).orderBy(equipment.name), db.select().from(safetyTalks).orderBy(desc(safetyTalks.talkDate)), db.select().from(incidents).orderBy(desc(incidents.incidentDate)), db.select().from(credentials).orderBy(credentials.expiresOn), db.select().from(crewPayRates), db.select().from(timeEntries), db.select().from(receipts), db.select().from(businessExpenses), db.select().from(subcontractors), db.select().from(quotes), db.select().from(leads), db.select().from(settings).where(eq(settings.id, 1)).limit(1)]);
    const jobLabel = (id) => {
      const j = jobs2.find((x) => x.id === id);
      return j ? `${j.clientName} \xB7 ${j.jobType}` : null;
    };
    const parseItems = (value) => JSON.parse(value);
    const day = (value) => Math.ceil((new Date(`${value}T12:00:00`).getTime() - new Date(`${args.today}T12:00:00`).getTime()) / 86400000);
    const payroll = Array.from(new Set(times.map((t) => t.crewMember.trim()).filter(Boolean))).map((crewMember) => {
      const hours = times.filter((t) => t.crewMember.trim() === crewMember && t.startedAt.toISOString().slice(0, 10) >= args.periodStart && t.startedAt.toISOString().slice(0, 10) <= args.periodEnd).reduce((sum, t) => sum + Math.max(0, ((t.endedAt?.getTime() ?? Date.now()) - t.startedAt.getTime()) / 3600000), 0);
      const hourlyRate = rates.find((r) => r.crewMember.toLowerCase() === crewMember.toLowerCase())?.hourlyRate ?? "0.00";
      return { crewMember, hours, hourlyRate, grossPay: (hours * Number(hourlyRate)).toFixed(2) };
    });
    const threshold = settings2[0]?.costAlertPercent ?? 80;
    const costAlerts = jobs2.flatMap((job) => {
      const latest = [...jobQuotes].filter((q) => q.jobId === job.id && (!q.superseded || q.accepted)).sort((a, b) => b.versionNumber - a.versionNumber)[0];
      const quoted = Number(latest?.total ?? job.amountDue ?? 0);
      const labor = times.filter((t) => t.jobId === job.id).reduce((s, t) => s + Math.max(0, ((t.endedAt?.getTime() ?? Date.now()) - t.startedAt.getTime()) / 3600000) * Number(settings2[0]?.hourlyCostRate ?? 0), 0);
      const cost = receipts2.filter((r) => r.jobId === job.id).reduce((s, r) => s + Number(r.amount), 0) + expenses.filter((e) => e.jobId === job.id).reduce((s, e) => s + Number(e.amount), 0) + subs.filter((s) => s.jobId === job.id).reduce((a, s) => a + Number(s.agreedAmount), 0) + labor;
      const percent = quoted > 0 ? cost / quoted * 100 : 0;
      return percent >= threshold ? [{ jobId: job.id, jobLabel: jobLabel(job.id) ?? `Job #${job.id}`, quoted, cost, percent, level: percent >= 100 ? "urgent" : "warning" }] : [];
    });
    const lastIncident = incidents2.map((i) => new Date(`${i.incidentDate}T12:00:00`).getTime()).sort((a, b) => b - a)[0];
    const firstTalk = talks.map((t) => new Date(`${t.talkDate}T12:00:00`).getTime()).sort((a, b) => a - b)[0];
    const streakStart = lastIncident ?? firstTalk;
    const safetyStreak = streakStart === undefined ? 0 : Math.max(0, Math.floor((new Date(`${args.today}T12:00:00`).getTime() - streakStart) / 86400000));
    const credentialData = credentials2.map((c) => ({ id: c.id, ownerType: c.ownerType, subcontractorId: c.subcontractorId, ownerLabel: c.ownerType === "business" ? "Business" : subs.find((s) => s.id === c.subcontractorId)?.name ?? "Subcontractor", kind: c.kind, identifier: c.identifier, expiresOn: c.expiresOn, daysRemaining: day(c.expiresOn) }));
    return { jobs: jobs2.map((j) => ({ id: j.id, label: jobLabel(j.id) ?? `Job #${j.id}` })), suppliers: suppliers2.map((s) => ({ id: s.id, name: s.name })), supplierQuotes: quotes2.map((q) => ({ id: q.id, supplierId: q.supplierId, supplierName: suppliers2.find((s) => s.id === q.supplierId)?.name ?? "Supplier", jobId: q.jobId, title: q.title, lineItems: parseItems(q.lineItemsJson).map((i) => ({ description: i.description, qty: i.qty, unitPrice: i.unitPrice })), total: q.total, selected: q.selected })), purchaseOrders: pos.map((p) => ({ id: p.id, supplierId: p.supplierId, supplierName: suppliers2.find((s) => s.id === p.supplierId)?.name ?? "Supplier", jobId: p.jobId, jobLabel: jobLabel(p.jobId), number: p.number, status: p.status, lineItems: parseItems(p.lineItemsJson).map((i) => ({ ...i, receivedQty: i.receivedQty ?? 0 })), total: p.total })), equipment: await Promise.all(equipment2.map(async (e) => ({ id: e.id, name: e.name, category: e.category, purchaseDate: e.purchaseDate, cost: e.cost, serialNumber: e.serialNumber, assignedTo: e.assignedTo, photoUrl: e.photoBlobKey ? await ctx.blobs.getUrl(e.photoBlobKey) : null, maintenanceTask: e.maintenanceTask, maintenanceEveryDays: e.maintenanceEveryDays, nextMaintenanceDate: e.nextMaintenanceDate, checkedOutAt: e.checkedOutAt?.toISOString() ?? null, returnedAt: e.returnedAt?.toISOString() ?? null, maintenanceDue: Boolean(e.nextMaintenanceDate && e.nextMaintenanceDate <= args.today) }))), safetyTalks: talks.map((t) => ({ id: t.id, jobId: t.jobId, jobLabel: jobLabel(t.jobId) ?? `Job #${t.jobId}`, topicKey: t.topicKey, talkDate: t.talkDate, checklist: JSON.parse(t.checklistJson), acknowledgements: JSON.parse(t.acknowledgementsJson) })), incidents: await Promise.all(incidents2.map(async (i) => ({ id: i.id, jobId: i.jobId, jobLabel: jobLabel(i.jobId) ?? `Job #${i.jobId}`, incidentDate: i.incidentDate, description: i.description, severity: i.severity, correctiveAction: i.correctiveAction, photoUrl: i.photoBlobKey ? await ctx.blobs.getUrl(i.photoBlobKey) : null }))), safetyStreak, credentials: credentialData, payroll, costAlerts, today: { poAwaiting: pos.filter((p) => p.status === "sent" || p.status === "partially_received").length, maintenanceDue: equipment2.filter((e) => e.nextMaintenanceDate && e.nextMaintenanceDate <= args.today).length, credentialWarnings: credentialData.filter((c) => c.daysRemaining <= 60).length, hotLeads: leads2.filter((l) => l.stage !== "won" && l.stage !== "lost" && l.score >= 75).length, costAlerts: costAlerts.length } };
  } }),
  saveSupplierQuote: defineAction({ request: object({ supplierId: number2().int().positive(), jobId: number2().int().positive().nullable(), title: string2().trim().min(1).max(160), lineItems: array(object({ description: string2().trim().min(1).max(300), qty: number2().positive().max(1e5), unitPrice: string2().max(80) })).min(1).max(100) }), response: object({ id: number2() }), async handler(ctx, args) {
    const items = args.lineItems.map((i) => ({ ...i, unitPrice: normalizeMoney(i.unitPrice, "0.00") }));
    const total = items.reduce((s, i) => s + i.qty * Number(i.unitPrice), 0).toFixed(2);
    const rows = await ctx.db().insert(supplierQuotes).values({ supplierId: args.supplierId, jobId: args.jobId, title: args.title, lineItemsJson: JSON.stringify(items), total, createdAt: new Date }).returning({ id: supplierQuotes.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save supplier quote.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  createPurchaseOrder: defineAction({ request: object({ supplierQuoteId: number2().int().positive() }), response: object({ id: number2() }), async handler(ctx, args) {
    const db = ctx.db();
    const quote = (await db.select().from(supplierQuotes).where(eq(supplierQuotes.id, args.supplierQuoteId)).limit(1))[0];
    if (!quote)
      throw new Error("Supplier quote not found.");
    const competing = (await db.select().from(supplierQuotes)).filter((candidate) => candidate.jobId === quote.jobId && candidate.title.trim().toLowerCase() === quote.title.trim().toLowerCase());
    for (const candidate of competing)
      await db.update(supplierQuotes).set({ selected: false }).where(eq(supplierQuotes.id, candidate.id));
    await db.update(supplierQuotes).set({ selected: true }).where(eq(supplierQuotes.id, quote.id));
    const items = JSON.parse(quote.lineItemsJson).map((i) => ({ ...i, receivedQty: 0 }));
    const rows = await db.insert(purchaseOrders).values({ supplierId: quote.supplierId, jobId: quote.jobId, supplierQuoteId: quote.id, number: `PO-${Date.now().toString().slice(-8)}`, status: "draft", lineItemsJson: JSON.stringify(items), total: quote.total, createdAt: new Date, updatedAt: new Date }).returning({ id: purchaseOrders.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not create purchase order.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  updatePurchaseOrderStatus: defineAction({ request: object({ id: number2().int().positive(), status: _enum(["draft", "sent", "cancelled"]) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(purchaseOrders).set({ status: args.status, updatedAt: new Date }).where(eq(purchaseOrders.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  receivePurchaseOrder: defineAction({ request: object({ id: number2().int().positive(), received: array(number2().min(0).max(1e5)) }), response: object({ status: _enum(["partially_received", "received"]), expenseAmount: string2() }), async handler(ctx, args) {
    const db = ctx.db();
    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, args.id)).limit(1))[0];
    if (!po)
      throw new Error("Purchase order not found.");
    if (po.status === "cancelled")
      throw new Error("Cancelled purchase orders cannot be received.");
    const items = JSON.parse(po.lineItemsJson);
    let delta = 0;
    const next = items.map((item, index) => {
      const target = Math.min(item.qty, args.received[index] ?? item.receivedQty ?? 0);
      delta += Math.max(0, target - (item.receivedQty ?? 0)) * Number(item.unitPrice);
      return { ...item, receivedQty: target };
    });
    const complete = next.every((i) => i.receivedQty >= i.qty);
    const status = complete ? "received" : "partially_received";
    await db.update(purchaseOrders).set({ status, lineItemsJson: JSON.stringify(next), updatedAt: new Date }).where(eq(purchaseOrders.id, po.id));
    if (delta > 0 && po.jobId) {
      const supplier = (await db.select().from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1))[0];
      await db.insert(businessExpenses).values({ expenseDate: new Date().toISOString().slice(0, 10), vendor: supplier?.name ?? "Supplier", amount: delta.toFixed(2), category: "materials", jobId: po.jobId, supplierId: po.supplierId, note: `Received ${po.number}`, createdAt: new Date });
    }
    ctx.invalidateQueries();
    return { status, expenseAmount: delta.toFixed(2) };
  } }),
  saveEquipment: defineAction({ request: object({ name: string2().trim().min(1).max(160), category: string2().trim().max(120), purchaseDate: string2().max(10), cost: string2().max(80), serialNumber: string2().trim().max(160), assignedTo: string2().trim().max(160), maintenanceTask: string2().trim().max(300), maintenanceEveryDays: number2().int().min(1).max(3650), nextMaintenanceDate: string2().max(10), photoFilename: string2().max(240).default(""), photoContentType: _enum(["", "image/jpeg", "image/png", "image/webp"]).default(""), photoDataBase64: string2().max(20000000).default("") }), response: object({ id: number2() }), async handler(ctx, args) {
    let photoBlobKey = null;
    if (args.photoDataBase64 && args.photoContentType) {
      photoBlobKey = `equipment/${crypto.randomUUID()}`;
      await ctx.blobs.put(photoBlobKey, Buffer.from(args.photoDataBase64, "base64"), { contentType: args.photoContentType });
    }
    const { photoFilename: _f, photoContentType: _t, photoDataBase64: _d, ...values } = args;
    const rows = await ctx.db().insert(equipment).values({ ...values, cost: normalizeMoney(args.cost, "0.00"), photoBlobKey, createdAt: new Date, updatedAt: new Date }).returning({ id: equipment.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save equipment.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  setEquipmentCheckout: defineAction({ request: object({ id: number2().int().positive(), assignedTo: string2().trim().min(1).max(160), returned: boolean2() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(equipment).set(args.returned ? { assignedTo: "shop", returnedAt: new Date, updatedAt: new Date } : { assignedTo: args.assignedTo, checkedOutAt: new Date, returnedAt: null, updatedAt: new Date }).where(eq(equipment.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  completeEquipmentMaintenance: defineAction({ request: object({ id: number2().int().positive() }), response: object({ nextMaintenanceDate: string2() }), async handler(ctx, args) {
    const db = ctx.db();
    const item = (await db.select().from(equipment).where(eq(equipment.id, args.id)).limit(1))[0];
    if (!item)
      throw new Error("Equipment not found.");
    const next = new Date;
    next.setDate(next.getDate() + item.maintenanceEveryDays);
    const nextMaintenanceDate = next.toISOString().slice(0, 10);
    await db.update(equipment).set({ nextMaintenanceDate, updatedAt: new Date }).where(eq(equipment.id, args.id));
    ctx.invalidateQueries();
    return { nextMaintenanceDate };
  } }),
  saveSafetyTalk: defineAction({ request: object({ jobId: number2().int().positive(), topicKey: _enum(["ladder", "ppe", "electrical", "heat", "silica", "fall"]), talkDate: string2().max(10), checklist: array(string2().max(300)).max(20), acknowledgements: array(string2().trim().min(1).max(160)).min(1).max(30) }), response: object({ id: number2() }), async handler(ctx, args) {
    const rows = await ctx.db().insert(safetyTalks).values({ jobId: args.jobId, topicKey: args.topicKey, talkDate: args.talkDate, checklistJson: JSON.stringify(args.checklist), acknowledgementsJson: JSON.stringify(args.acknowledgements), createdAt: new Date }).returning({ id: safetyTalks.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save safety talk.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  saveIncident: defineAction({ request: object({ jobId: number2().int().positive(), incidentDate: string2().max(10), description: string2().trim().min(1).max(3000), severity: _enum(["near_miss", "minor", "serious"]), correctiveAction: string2().trim().max(3000), photoContentType: _enum(["", "image/jpeg", "image/png", "image/webp"]).default(""), photoDataBase64: string2().max(20000000).default("") }), response: object({ id: number2() }), async handler(ctx, args) {
    let photoBlobKey = null;
    if (args.photoDataBase64 && args.photoContentType) {
      photoBlobKey = `incidents/${crypto.randomUUID()}`;
      await ctx.blobs.put(photoBlobKey, Buffer.from(args.photoDataBase64, "base64"), { contentType: args.photoContentType });
    }
    const { photoContentType: _t, photoDataBase64: _d, ...values } = args;
    const rows = await ctx.db().insert(incidents).values({ ...values, photoBlobKey, createdAt: new Date }).returning({ id: incidents.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save incident.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  saveCredential: defineAction({ request: object({ ownerType: _enum(["business", "subcontractor"]), subcontractorId: number2().int().positive().nullable(), kind: string2().trim().min(1).max(160), identifier: string2().trim().max(160), expiresOn: string2().max(10) }), response: object({ id: number2() }), async handler(ctx, args) {
    const rows = await ctx.db().insert(credentials).values({ ...args, createdAt: new Date, updatedAt: new Date }).returning({ id: credentials.id });
    const made = rows[0];
    if (!made)
      throw new Error("Could not save credential.");
    ctx.invalidateQueries();
    return { id: made.id };
  } }),
  renewCredential: defineAction({ request: object({ id: number2().int().positive(), expiresOn: string2().max(10) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    await ctx.db().update(credentials).set({ expiresOn: args.expiresOn, renewedAt: new Date, updatedAt: new Date }).where(eq(credentials.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  saveCrewPayRate: defineAction({ request: object({ crewMember: string2().trim().min(1).max(160), hourlyRate: string2().max(80) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const current = (await db.select().from(crewPayRates).where(eq(crewPayRates.crewMember, args.crewMember)).limit(1))[0];
    if (current)
      await db.update(crewPayRates).set({ hourlyRate: normalizeMoney(args.hourlyRate, "0.00"), updatedAt: new Date }).where(eq(crewPayRates.id, current.id));
    else
      await db.insert(crewPayRates).values({ crewMember: args.crewMember, hourlyRate: normalizeMoney(args.hourlyRate, "0.00"), updatedAt: new Date });
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  setJobPhotoRequirements: defineAction({ request: object({ jobId: number2().int().positive(), requiredStages: array(stageSchema).max(3) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const ordered = ["before", "during", "after"].filter((stage) => args.requiredStages.includes(stage));
    await ctx.db().update(jobs).set({ requiredPhotoStages: ordered.join(","), updatedAt: new Date }).where(eq(jobs.id, args.jobId));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  completeJob: defineAction({ request: object({ jobId: number2().int().positive(), overrideNote: string2().trim().max(1000).default("") }), response: object({ ok: literal(true), missingStages: array(stageSchema) }), async handler(ctx, args) {
    const db = ctx.db();
    const job = (await db.select().from(jobs).where(eq(jobs.id, args.jobId)).limit(1))[0];
    if (!job)
      throw new Error("Job not found.");
    const photos2 = await db.select().from(photos).where(eq(photos.jobId, args.jobId));
    const required = job.requiredPhotoStages.split(",").filter((s) => s === "before" || s === "during" || s === "after");
    const missingStages = required.filter((s) => !photos2.some((p) => p.stage === s));
    if (missingStages.length && !args.overrideNote)
      throw new Error("Add an override note for missing required photos.");
    await db.update(jobs).set({ completedAt: new Date, completionOverrideNote: args.overrideNote, updatedAt: new Date }).where(eq(jobs.id, args.jobId));
    if (missingStages.length)
      await db.insert(completionOverrides).values({ jobId: args.jobId, missingStages: missingStages.join(","), note: args.overrideNote, createdAt: new Date });
    ctx.invalidateQueries();
    return { ok: true, missingStages };
  } }),
  deleteFieldTestRecord: defineAction({ request: object({ kind: _enum(["supplier_quote", "purchase_order", "equipment", "safety_talk", "incident", "credential", "lead", "crew_pay_rate", "supplier"]), id: number2().int().positive() }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    if (args.kind === "supplier_quote")
      await db.delete(supplierQuotes).where(eq(supplierQuotes.id, args.id));
    else if (args.kind === "purchase_order") {
      const row = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, args.id)).limit(1))[0];
      if (row)
        await db.delete(businessExpenses).where(eq(businessExpenses.note, `Received ${row.number}`));
      await db.delete(purchaseOrders).where(eq(purchaseOrders.id, args.id));
    } else if (args.kind === "equipment")
      await db.delete(equipment).where(eq(equipment.id, args.id));
    else if (args.kind === "safety_talk")
      await db.delete(safetyTalks).where(eq(safetyTalks.id, args.id));
    else if (args.kind === "incident")
      await db.delete(incidents).where(eq(incidents.id, args.id));
    else if (args.kind === "lead")
      await db.delete(leads).where(eq(leads.id, args.id));
    else if (args.kind === "crew_pay_rate")
      await db.delete(crewPayRates).where(eq(crewPayRates.id, args.id));
    else if (args.kind === "supplier")
      await db.delete(suppliers).where(eq(suppliers.id, args.id));
    else
      await db.delete(credentials).where(eq(credentials.id, args.id));
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  renderPdfPreview: defineAction({
    request: object({ dataBase64: string2().min(1).max(30000000) }),
    response: object({ pagesBase64: array(string2()).max(20) }),
    privileged: [privileged.renderPdfPages],
    async handler(ctx, args) {
      return ctx.executePrivileged(privileged.renderPdfPages, args);
    }
  }),
  exportBackup: defineAction({
    request: object({}),
    response: object({ filename: string2(), dataBase64: string2(), tableCount: number2(), recordCount: number2(), attachments: array(object({ key: string2(), url: string2(), contentType: string2() })), createdAt: string2() }),
    async handler(ctx) {
      const backup = await createBackup(ctx);
      const attachments = [];
      const seen = new Set;
      for (const rows of Object.values(backup.tables))
        for (const row of rows)
          for (const [column, value] of Object.entries(row)) {
            if (!column.endsWith("_blob_key") || typeof value !== "string" || !value || seen.has(value))
              continue;
            seen.add(value);
            const metadata = await ctx.blobs.head(value);
            if (metadata)
              attachments.push({ key: value, url: await ctx.blobs.getUrl(value), contentType: metadata.contentType || "application/octet-stream" });
          }
      const compressed = gzipSync(strToU8(JSON.stringify(backup)), { level: 6 });
      const date = backup.createdAt.slice(0, 10);
      return { filename: `crewkat-backup-${date}.crewkat`, dataBase64: Buffer.from(compressed).toString("base64"), tableCount: BACKUP_TABLES.length, recordCount: Object.values(backup.tables).reduce((sum, rows) => sum + rows.length, 0), attachments, createdAt: backup.createdAt };
    }
  }),
  restoreBackup: defineAction({
    request: object({ dataBase64: string2().min(1).max(200000000) }),
    response: object({ ok: literal(true), recordCount: number2(), attachmentCount: number2(), restoredAt: string2() }),
    async handler(ctx, args) {
      let parsed;
      try {
        const compressed = Buffer.from(args.dataBase64, "base64");
        if (compressed.byteLength > 150000000)
          throw new Error("Backup is too large.");
        const text = strFromU8(gunzipSync(compressed));
        if (text.length > 300000000)
          throw new Error("Backup is too large.");
        parsed = JSON.parse(text);
      } catch {
        throw new Error("This is not a valid Crewkat backup file.");
      }
      if (!validBackup(parsed))
        throw new Error("This is not a compatible Crewkat backup file.");
      await restoreBackup(ctx, parsed);
      return { ok: true, recordCount: Object.values(parsed.tables).reduce((sum, rows) => sum + rows.length, 0), attachmentCount: Object.keys(parsed.blobs).length, restoredAt: new Date().toISOString() };
    }
  }),
  verifyBackupRoundTrip: defineAction({
    request: object({}),
    response: object({ ok: literal(true), restored: literal(true), testRecordRemoved: literal(true) }),
    async handler(ctx) {
      const db = ctx.db();
      const marker = `Crewkat backup test ${crypto.randomUUID()}`;
      const blobKey = `backup-test/${crypto.randomUUID()}.txt`;
      const testBytes = Buffer.from("Crewkat backup attachment test", "utf8");
      const inserted = await db.insert(clients).values({ name: marker, notes: "Automatic backup test", createdAt: new Date, updatedAt: new Date }).returning({ id: clients.id });
      const id = inserted[0]?.id;
      if (!id)
        throw new Error("Could not create the temporary backup test record.");
      try {
        const backup = await createBackup(ctx);
        backup.blobs[blobKey] = { contentType: "text/plain", dataBase64: testBytes.toString("base64") };
        await db.delete(clients).where(eq(clients.id, id));
        await restoreBackup(ctx, backup);
        const restored = (await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1))[0];
        const restoredBlob = await ctx.blobs.head(blobKey);
        if (!restored || restoredBlob?.sizeBytes !== testBytes.byteLength)
          throw new Error("Backup restore did not recover the test data and attachment.");
        await db.delete(clients).where(eq(clients.id, id));
        await ctx.blobs.delete(blobKey);
        ctx.invalidateQueries();
        return { ok: true, restored: true, testRecordRemoved: true };
      } catch (error) {
        await db.delete(clients).where(eq(clients.id, id));
        await ctx.blobs.delete(blobKey).catch(() => {});
        throw error;
      }
    }
  }),
  runAutomatedBackup: defineAction({
    request: object({ note: string2().trim().max(500).default("") }),
    response: object({
      ok: boolean2(),
      runId: number2().nullable(),
      kind: string2(),
      filePath: string2().nullable(),
      totalBytes: number2().nullable(),
      offsiteSent: boolean2(),
      integrityOk: boolean2(),
      error: string2().nullable()
    }),
    async handler(ctx, args) {
      if (backupInProgress)
        throw new Error("A backup is already running. Try again in a few minutes.");
      backupInProgress = true;
      try {
        const result = await performBackup(ctx, "manual", args.note);
        if (!result.ok)
          throw new Error(result.error || "Backup failed.");
        ctx.invalidateQueries();
        return {
          ok: true,
          runId: result.runId,
          kind: result.kind,
          filePath: result.filePath,
          totalBytes: result.totalBytes,
          offsiteSent: result.offsiteSent,
          integrityOk: result.integrityOk,
          error: null
        };
      } finally {
        backupInProgress = false;
      }
    }
  }),
  getBackupStatus: defineAction({
    request: object({}),
    response: object({
      configured: boolean2(),
      backupHourUtc: number2(),
      runs: array(object({
        id: number2(),
        kind: string2(),
        status: string2(),
        startedAt: string2(),
        finishedAt: string2().nullable(),
        totalBytes: number2().nullable(),
        offsiteSent: boolean2(),
        integrityOk: boolean2().nullable(),
        error: string2().nullable(),
        notes: string2().nullable()
      }))
    }),
    async handler(ctx) {
      const cfg = backupConfig();
      const db = ctx.db();
      const rows = await db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(10);
      return {
        configured: Boolean(cfg.alertEmail),
        backupHourUtc: cfg.hour,
        runs: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          status: row.status,
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.finishedAt?.toISOString() ?? null,
          totalBytes: row.totalBytes,
          offsiteSent: row.offsiteSent,
          integrityOk: row.integrityOk,
          error: row.error,
          notes: row.notes
        }))
      };
    }
  }),
  listMarketplaceListings: defineAction({
    request: object({ search: string2().trim().max(120).default(""), category: marketplaceCategorySchema.nullable().default(null), serviceArea: string2().trim().max(120).default("") }),
    response: object({ listings: array(marketplaceListingSchema) }),
    async handler(ctx, args) {
      const db = ctx.db();
      const rows = await db.select().from(marketplaceListings).orderBy(desc(marketplaceListings.promoted), desc(marketplaceListings.createdAt));
      const photoRows = await db.select().from(marketplaceListingPhotos).orderBy(marketplaceListingPhotos.sortOrder);
      const search = args.search.toLowerCase();
      const area = args.serviceArea.toLowerCase();
      const categoryTerms = { kitchens: "kitchen cabinet carpenter", bathrooms: "bathroom shower", plumbing: "plumbing plumber", electrical: "electrical electrician", hvac: "hvac air conditioning", roofing: "roof roofers roofing", tile_flooring: "tile flooring floor installer", painting: "painting painter", concrete: "concrete masonry", landscaping: "landscaping lawn", handyman: "handyman repair", equipment: "equipment trailer rental", materials: "materials supplies", other: "other" };
      const filtered = rows.filter((row) => (!args.category || row.category === args.category) && (!search || [row.title, row.description, row.companyName, row.serviceArea, categoryTerms[row.category]].some((value) => value.toLowerCase().includes(search))) && (!area || row.serviceArea.toLowerCase().includes(area)));
      return { listings: await Promise.all(filtered.map((row) => marketplaceListingShape(ctx, row, photoRows))) };
    }
  }),
  getMarketplaceListing: defineAction({
    request: object({ id: number2().int().positive() }),
    response: object({ listing: marketplaceListingSchema.nullable() }),
    async handler(ctx, args) {
      const db = ctx.db();
      const row = (await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, args.id)).limit(1))[0];
      if (!row)
        return { listing: null };
      const photoRows = await db.select().from(marketplaceListingPhotos).where(eq(marketplaceListingPhotos.listingId, row.id)).orderBy(marketplaceListingPhotos.sortOrder);
      return { listing: await marketplaceListingShape(ctx, row, photoRows) };
    }
  }),
  createMarketplaceListing: defineAction({
    request: object({
      title: string2().trim().min(1).max(180),
      category: marketplaceCategorySchema,
      listingType: _enum(["job", "project"]),
      employmentType: _enum(["full_time", "part_time", "temporary"]),
      payUnit: _enum(["hourly", "salary"]),
      priceKind: _enum(["amount", "free", "contact"]),
      price: string2().trim().max(80),
      originalPrice: string2().trim().max(80),
      description: string2().trim().max(5000),
      serviceArea: string2().trim().min(1).max(160),
      companyName: string2().trim().min(1).max(180),
      companyPhone: string2().trim().max(80),
      bookable: boolean2().default(false),
      dailyRate: string2().trim().max(80).default(""),
      photos: array(object({ filename: string2().min(1).max(240), contentType: _enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: string2().min(1).max(30000000) })).max(8)
    }),
    response: object({ id: number2() }),
    async handler(ctx, args) {
      if (args.priceKind === "amount" && !args.price.trim())
        throw new Error("Enter a price or choose Contact for price.");
      if (args.bookable && !args.dailyRate.trim())
        throw new Error("Enter a daily rate for this bookable listing.");
      const identity = workspaceIdentity(ctx);
      const db = ctx.db();
      const now = new Date;
      if (identity.workspaceTier === "free") {
        const mine = await db.select({ id: marketplaceListings.id }).from(marketplaceListings).where(eq(marketplaceListings.companyId, identity.workspaceCompanyId));
        if (mine.length >= 5)
          throw new Error("Your free plan includes 5 Marketplace listings. Upgrade to Premium for more.");
      }
      const made = (await db.insert(marketplaceListings).values({ title: args.title, category: args.category, listingType: args.listingType, employmentType: args.employmentType, payUnit: args.payUnit, priceKind: args.priceKind, price: args.priceKind === "amount" ? normalizeMoney(args.price) : "", originalPrice: args.priceKind === "amount" ? normalizeMoney(args.originalPrice) : "", description: args.description, serviceArea: args.serviceArea, companyName: args.companyName, companyPhone: args.companyPhone, bookable: args.bookable, dailyRate: args.bookable ? normalizeMoney(args.dailyRate) : "", createdAt: now, updatedAt: now }).returning({ id: marketplaceListings.id }))[0];
      if (!made)
        throw new Error("The listing could not be saved.");
      const storedKeys = [];
      try {
        for (const [index, photo] of args.photos.entries()) {
          const key = `marketplace/${made.id}/${crypto.randomUUID()}-${photo.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
          await ctx.blobs.put(key, Buffer.from(photo.dataBase64, "base64"), { contentType: photo.contentType });
          storedKeys.push(key);
          await db.insert(marketplaceListingPhotos).values({ listingId: made.id, blobKey: key, filename: photo.filename, contentType: photo.contentType, sortOrder: index, createdAt: now });
        }
      } catch (error) {
        await db.delete(marketplaceListings).where(eq(marketplaceListings.id, made.id));
        await Promise.all(storedKeys.map((key) => ctx.blobs.delete(key).catch(() => {})));
        throw error;
      }
      ctx.invalidateQueries();
      return { id: made.id };
    }
  }),
  updateMarketplaceListing: defineAction({
    request: object({
      id: number2().int().positive(),
      title: string2().trim().min(1).max(180),
      category: marketplaceCategorySchema,
      listingType: _enum(["job", "project"]),
      employmentType: _enum(["full_time", "part_time", "temporary"]),
      payUnit: _enum(["hourly", "salary"]),
      priceKind: _enum(["amount", "free", "contact"]),
      price: string2().trim().max(80),
      originalPrice: string2().trim().max(80),
      description: string2().trim().max(5000),
      serviceArea: string2().trim().min(1).max(160),
      companyName: string2().trim().min(1).max(180),
      companyPhone: string2().trim().max(80),
      bookable: boolean2().default(false),
      dailyRate: string2().trim().max(80).default(""),
      replacePhotos: boolean2().default(false),
      photos: array(object({ filename: string2().min(1).max(240), contentType: _enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: string2().min(1).max(30000000) })).max(8)
    }),
    response: object({ id: number2() }),
    async handler(ctx, args) {
      if (args.priceKind === "amount" && !args.price.trim())
        throw new Error("Enter a price or choose Contact for price.");
      if (args.bookable && !args.dailyRate.trim())
        throw new Error("Enter a daily rate for this bookable listing.");
      const db = ctx.db();
      const existing = (await db.select().from(marketplaceListings).where(and(eq(marketplaceListings.id, args.id), eq(marketplaceListings.companyId, workspaceIdentity(ctx).workspaceCompanyId))).limit(1))[0];
      if (!existing)
        throw new Error("You can only edit your own listings.");
      const oldPhotos = args.replacePhotos ? await db.select().from(marketplaceListingPhotos).where(eq(marketplaceListingPhotos.listingId, args.id)) : [];
      const now = new Date;
      const newPhotos = [];
      try {
        if (args.replacePhotos) {
          for (const [index, photo] of args.photos.entries()) {
            const key = `marketplace/${args.id}/${crypto.randomUUID()}-${photo.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
            await ctx.blobs.put(key, Buffer.from(photo.dataBase64, "base64"), { contentType: photo.contentType });
            newPhotos.push({ blobKey: key, filename: photo.filename, contentType: photo.contentType, sortOrder: index });
          }
        }
        await db.update(marketplaceListings).set({ title: args.title, category: args.category, listingType: args.listingType, employmentType: args.employmentType, payUnit: args.payUnit, priceKind: args.priceKind, price: args.priceKind === "amount" ? normalizeMoney(args.price) : "", originalPrice: args.priceKind === "amount" ? normalizeMoney(args.originalPrice) : "", description: args.description, serviceArea: args.serviceArea, companyName: args.companyName, companyPhone: args.companyPhone, bookable: args.bookable, dailyRate: args.bookable ? normalizeMoney(args.dailyRate) : "", updatedAt: now }).where(eq(marketplaceListings.id, args.id));
        if (args.replacePhotos) {
          await db.delete(marketplaceListingPhotos).where(eq(marketplaceListingPhotos.listingId, args.id));
          for (const photo of newPhotos)
            await db.insert(marketplaceListingPhotos).values({ listingId: args.id, ...photo, createdAt: now });
          await Promise.all(oldPhotos.map((photo) => ctx.blobs.delete(photo.blobKey).catch(() => {})));
        }
      } catch (error) {
        await Promise.all(newPhotos.map((photo) => ctx.blobs.delete(photo.blobKey).catch(() => {})));
        throw error;
      }
      ctx.invalidateQueries();
      return { id: args.id };
    }
  }),
  deleteMarketplaceListing: defineAction({
    request: object({ id: number2().int().positive() }),
    response: object({ ok: literal(true) }),
    async handler(ctx, args) {
      const db = ctx.db();
      const listing = (await db.select({ id: marketplaceListings.id }).from(marketplaceListings).where(and(eq(marketplaceListings.id, args.id), eq(marketplaceListings.companyId, workspaceIdentity(ctx).workspaceCompanyId))).limit(1))[0];
      if (!listing)
        throw new Error("You can only delete your own listings.");
      const photos2 = await db.select({ blobKey: marketplaceListingPhotos.blobKey }).from(marketplaceListingPhotos).where(eq(marketplaceListingPhotos.listingId, args.id));
      const messages = await db.select({ blobKey: marketplaceMessages.imageBlobKey }).from(marketplaceMessages).where(eq(marketplaceMessages.listingId, args.id));
      await db.delete(marketplaceListings).where(eq(marketplaceListings.id, args.id));
      await Promise.all([...photos2.map((item) => item.blobKey), ...messages.map((item) => item.blobKey).filter((key) => Boolean(key))].map((key) => ctx.blobs.delete(key).catch(() => {})));
      ctx.invalidateQueries();
      return { ok: true };
    }
  }),
  listMarketplaceMessages: defineAction({
    request: object({ listingId: number2().int().positive() }),
    response: object({ messages: array(marketplaceMessageSchema) }),
    async handler(ctx, args) {
      const rows = await ctx.db().select().from(marketplaceMessages).where(eq(marketplaceMessages.listingId, args.listingId)).orderBy(marketplaceMessages.createdAt);
      return { messages: await Promise.all(rows.map(async (row) => ({ id: row.id, listingId: row.listingId, body: row.body, imageUrl: row.imageBlobKey ? await ctx.blobs.getUrl(row.imageBlobKey) : null, imageFilename: row.imageFilename, sender: row.sender, isRead: row.sender === "me" || row.readAt !== null, createdAt: row.createdAt.toISOString() }))) };
    }
  }),
  getMarketplaceInbox: defineAction({
    request: object({}),
    response: object({ unreadCount: number2(), conversations: array(marketplaceInboxRowSchema) }),
    async handler(ctx) {
      const db = ctx.db();
      const [messages, listings] = await Promise.all([
        db.select().from(marketplaceMessages).orderBy(desc(marketplaceMessages.createdAt)),
        db.select({ id: marketplaceListings.id, title: marketplaceListings.title, companyName: marketplaceListings.companyName, companyId: marketplaceListings.companyId }).from(marketplaceListings)
      ]);
      const listingById = new Map(listings.map((listing) => [listing.id, listing]));
      const grouped = new Map;
      const myCompanyId = workspaceIdentity(ctx).workspaceCompanyId;
      for (const message of messages) {
        const listing = listingById.get(message.listingId);
        if (!listing || listing.companyId !== myCompanyId)
          continue;
        const existing = grouped.get(message.listingId);
        const unread = message.sender === "other" && message.readAt === null ? 1 : 0;
        if (!existing) {
          grouped.set(message.listingId, {
            listingId: message.listingId,
            listingTitle: listing.title,
            companyName: listing.companyName,
            lastMessage: message.body || (message.imageBlobKey ? "Photo" : "Message"),
            lastMessageAt: message.createdAt.toISOString(),
            unreadCount: unread
          });
        } else {
          existing.unreadCount += unread;
        }
      }
      const conversations = [...grouped.values()].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      return { unreadCount: conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0), conversations };
    }
  }),
  markMarketplaceThreadRead: defineAction({
    request: object({ listingId: number2().int().positive() }),
    response: object({ ok: literal(true) }),
    async handler(ctx, args) {
      const db = ctx.db();
      const listing = (await db.select({ companyId: marketplaceListings.companyId }).from(marketplaceListings).where(eq(marketplaceListings.id, args.listingId)).limit(1))[0];
      if (listing && listing.companyId === workspaceIdentity(ctx).workspaceCompanyId) {
        await db.update(marketplaceMessages).set({ readAt: new Date }).where(and(eq(marketplaceMessages.listingId, args.listingId), eq(marketplaceMessages.sender, "other"), isNull(marketplaceMessages.readAt)));
      }
      ctx.invalidateQueries();
      return { ok: true };
    }
  }),
  sendMarketplaceMessage: defineAction({
    request: object({ listingId: number2().int().positive(), body: string2().trim().max(3000), image: object({ filename: string2().min(1).max(240), contentType: _enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: string2().min(1).max(30000000) }).nullable(), sender: _enum(["me", "other"]).default("me") }),
    response: object({ id: number2() }),
    async handler(ctx, args) {
      if (!args.body && !args.image)
        throw new Error("Write a message or add a photo.");
      const db = ctx.db();
      const listing = (await db.select({ id: marketplaceListings.id, companyId: marketplaceListings.companyId }).from(marketplaceListings).where(eq(marketplaceListings.id, args.listingId)).limit(1))[0];
      if (!listing)
        throw new Error("This listing is no longer available.");
      const isOwner = listing.companyId === workspaceIdentity(ctx).workspaceCompanyId;
      const sender = isOwner ? "me" : "other";
      const key = args.image ? `marketplace/messages/${args.listingId}/${crypto.randomUUID()}-${args.image.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}` : null;
      if (args.image && key)
        await ctx.blobs.put(key, Buffer.from(args.image.dataBase64, "base64"), { contentType: args.image.contentType });
      try {
        const made = (await db.insert(marketplaceMessages).values({ companyId: listing.companyId, listingId: args.listingId, body: args.body, imageBlobKey: key, imageFilename: args.image?.filename ?? "", imageContentType: args.image?.contentType ?? "", sender, readAt: isOwner ? new Date : null, createdAt: new Date }).returning({ id: marketplaceMessages.id }))[0];
        if (!made)
          throw new Error("The message could not be saved.");
        ctx.invalidateQueries();
        return { id: made.id };
      } catch (error) {
        if (key)
          await ctx.blobs.delete(key).catch(() => {});
        throw error;
      }
    }
  }),
  createMarketplaceBooking: defineAction({
    request: object({ listingId: number2().int().positive(), startDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: string2().regex(/^\d{4}-\d{2}-\d{2}$/), note: string2().trim().max(2000) }),
    response: object({ id: number2() }),
    async handler(ctx, args) {
      if (args.endDate < args.startDate)
        throw new Error("End date must be on or after the start date.");
      const db = ctx.db();
      const listing = (await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, args.listingId)).limit(1))[0];
      if (!listing?.bookable)
        throw new Error("This listing is not available for booking.");
      const made = (await db.insert(marketplaceBookingRequests).values({ ...args, status: "requested", createdAt: new Date }).returning({ id: marketplaceBookingRequests.id }))[0];
      if (!made)
        throw new Error("The booking request could not be saved.");
      ctx.invalidateQueries();
      return { id: made.id };
    }
  }),
  listMarketplaceBookings: defineAction({
    request: object({ listingId: number2().int().positive().nullable().default(null) }),
    response: object({ bookings: array(marketplaceBookingSchema) }),
    async handler(ctx, args) {
      const rows = await ctx.db().select().from(marketplaceBookingRequests).orderBy(desc(marketplaceBookingRequests.createdAt));
      return { bookings: rows.filter((row) => !args.listingId || row.listingId === args.listingId).map((row) => ({ id: row.id, listingId: row.listingId, startDate: row.startDate, endDate: row.endDate, note: row.note, status: row.status, createdAt: row.createdAt.toISOString() })) };
    }
  }),
  listMarketplaceRequests: defineAction({ request: object({}), response: object({ requests: array(marketplaceRequestSchema) }), async handler(ctx) {
    const rows = await ctx.db().select().from(marketplaceRequests).orderBy(desc(marketplaceRequests.createdAt));
    return { requests: rows.map(marketplaceRequestShape) };
  } }),
  createMarketplaceRequest: defineAction({
    request: object({ title: string2().trim().min(1).max(180), category: marketplaceCategorySchema, listingType: _enum(["job", "project"]), description: string2().trim().max(5000), serviceArea: string2().trim().min(1).max(160), neededBy: string2().trim().max(80), companyName: string2().trim().min(1).max(180), companyPhone: string2().trim().max(80) }),
    response: object({ id: number2() }),
    async handler(ctx, args) {
      const now = new Date;
      const made = (await ctx.db().insert(marketplaceRequests).values({ ...args, createdAt: now, updatedAt: now }).returning({ id: marketplaceRequests.id }))[0];
      if (!made)
        throw new Error("The request could not be saved.");
      ctx.invalidateQueries();
      return { id: made.id };
    }
  }),
  submitSupportReport: defineAction({ request: object({ kind: _enum(["support", "problem", "question", "general", "feature"]), subject: string2().trim().min(1).max(160), message: string2().trim().min(1).max(5000), language: languageSchema }), response: object({ id: number2(), sentAt: string2() }), async handler(ctx, args) {
    const now = new Date;
    const rows = await ctx.db().insert(supportReports).values({ ...args, status: "open", isUnread: true, createdAt: now, updatedAt: now }).returning({ id: supportReports.id });
    const made = rows[0];
    if (!made)
      throw new Error("The report could not be saved.");
    ctx.invalidateQueries();
    return { id: made.id, sentAt: now.toISOString() };
  } }),
  getSettings: defineAction({ request: object({}), response: settingsSchema, async handler(ctx) {
    const rows = await ctx.db().select().from(settings).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1);
    const row = rows[0];
    if (!row)
      return { companyName: "", licenseNumber: "", phone: "", email: "", website: "", address: "", profileDescription: "", serviceArea: "", facebookUrl: "", instagramUrl: "", youtubeUrl: "", reviewUrl: "", paymentInstructions: "", quoteFollowUpDays: 3, offersFreeEstimates: true, socialWatermark: true, language: "en", accentColor: "#1f5a4a", defaultQuoteTheme: "classic", defaultDocumentFont: "helvetica", defaultShowTaxLine: true, defaultShowDiscountLine: true, defaultShowPaidLine: true, defaultShowPaymentTerms: true, defaultShowFooterNotes: true, defaultShowLogo: true, defaultShowCompanyInfo: true, defaultCustomizeJson: "{}", defaultFootnote: "", warrantyTerms: "", hourlyCostRate: "0", lateFeeType: "percent", lateFeeValue: "0", lateFeeGraceDays: 0, costAlertPercent: 80, paymentRemindersEnabled: true, onlineSignatureEnabled: true, overdueInvoiceRemindersEnabled: true, overdueReminderDays: 3, invoiceGroupBy: "creation_date", addShippingAddress: false, addJobSiteAddress: true, convertToQuote: false, notificationsEnabled: true, simpleMode: true, logoUrl: null, coverUrl: null };
    return { companyName: row.companyName, licenseNumber: row.licenseNumber, phone: row.phone, email: row.email, website: row.website, address: row.address, profileDescription: row.profileDescription, serviceArea: row.serviceArea, facebookUrl: row.facebookUrl, instagramUrl: row.instagramUrl, youtubeUrl: row.youtubeUrl, reviewUrl: row.reviewUrl, paymentInstructions: row.paymentInstructions, quoteFollowUpDays: row.quoteFollowUpDays, offersFreeEstimates: row.offersFreeEstimates, socialWatermark: row.socialWatermark, language: row.language, accentColor: row.accentColor, defaultQuoteTheme: row.defaultQuoteTheme, defaultDocumentFont: row.defaultDocumentFont, defaultShowTaxLine: row.defaultShowTaxLine, defaultShowDiscountLine: row.defaultShowDiscountLine, defaultShowPaidLine: row.defaultShowPaidLine, defaultShowPaymentTerms: row.defaultShowPaymentTerms, defaultShowFooterNotes: row.defaultShowFooterNotes, defaultShowLogo: row.defaultShowLogo, defaultShowCompanyInfo: row.defaultShowCompanyInfo, defaultCustomizeJson: row.defaultCustomizeJson, defaultFootnote: row.defaultFootnote, warrantyTerms: row.warrantyTerms, hourlyCostRate: row.hourlyCostRate, lateFeeType: row.lateFeeType, lateFeeValue: row.lateFeeValue, lateFeeGraceDays: row.lateFeeGraceDays, costAlertPercent: row.costAlertPercent, paymentRemindersEnabled: row.paymentRemindersEnabled, onlineSignatureEnabled: row.onlineSignatureEnabled, overdueInvoiceRemindersEnabled: row.overdueInvoiceRemindersEnabled, overdueReminderDays: row.overdueReminderDays, invoiceGroupBy: row.invoiceGroupBy, addShippingAddress: row.addShippingAddress, addJobSiteAddress: row.addJobSiteAddress, convertToQuote: row.convertToQuote, notificationsEnabled: row.notificationsEnabled, simpleMode: row.simpleMode, logoUrl: row.logoBlobKey ? await ctx.blobs.getUrl(row.logoBlobKey) : null, coverUrl: row.coverBlobKey ? await ctx.blobs.getUrl(row.coverBlobKey) : null };
  } }),
  updateSettings: defineAction({ request: settingsInputSchema, response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select({ id: settings.id }).from(settings).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1);
    if (rows[0])
      await db.update(settings).set({ ...args, hourlyCostRate: normalizeMoney(args.hourlyCostRate, "0.00"), lateFeeValue: normalizeMoney(args.lateFeeValue, "0.00"), updatedAt: new Date }).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId));
    else
      await db.insert(settings).values({ ...args, hourlyCostRate: normalizeMoney(args.hourlyCostRate, "0.00"), lateFeeValue: normalizeMoney(args.lateFeeValue, "0.00"), updatedAt: new Date });
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  uploadLogo: defineAction({ request: object({ filename: string2().min(1).max(240), contentType: _enum(["image/jpeg", "image/png"]), dataBase64: string2().min(1).max(1e7) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(settings).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1);
    const old = rows[0];
    const key = `branding/${crypto.randomUUID()}-${args.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType });
    if (old)
      await db.update(settings).set({ logoBlobKey: key, updatedAt: new Date }).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId));
    else
      await db.insert(settings).values({ companyName: "", logoBlobKey: key, updatedAt: new Date });
    if (old?.logoBlobKey)
      await ctx.blobs.delete(old.logoBlobKey);
    ctx.invalidateQueries();
    return { ok: true };
  } }),
  uploadCompanyCover: defineAction({ request: object({ filename: string2().min(1).max(240), contentType: _enum(["image/jpeg", "image/png"]), dataBase64: string2().min(1).max(14000000) }), response: object({ ok: literal(true) }), async handler(ctx, args) {
    const db = ctx.db();
    const rows = await db.select().from(settings).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1);
    const old = rows[0];
    const key = `branding/covers/${crypto.randomUUID()}-${args.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType });
    if (old)
      await db.update(settings).set({ coverBlobKey: key, updatedAt: new Date }).where(eq(settings.companyId, workspaceIdentity(ctx).workspaceCompanyId));
    else
      await db.insert(settings).values({ companyName: "", coverBlobKey: key, updatedAt: new Date });
    if (old?.coverBlobKey)
      await ctx.blobs.delete(old.coverBlobKey);
    ctx.invalidateQueries();
    return { ok: true };
  } })
};
var PUBLIC_ACTIONS = new Set([
  "getAuthBootstrap",
  "signUp",
  "verifyEmail",
  "resendVerification",
  "login",
  "refreshSession",
  "logout",
  "getAuthSession",
  "requestPasswordReset",
  "resetPassword",
  "handleStripeWebhook",
  "getPortalData",
  "portalUpdateSelection",
  "portalSignChangeOrder",
  "resolveDocumentLink",
  "submitDocumentSignature",
  "submitEstimateRequest"
]);
var PREMIUM_ACTIONS = new Set([
  "getAutomationCenter",
  "logAutomationSend",
  "updateQuoteAutomationStatus",
  "updateSelectionLeadTime",
  "renewQuote",
  "getGrowthToolkit",
  "savePriceBookItem",
  "deletePriceBookItem",
  "saveQuoteTemplate",
  "deleteQuoteTemplate",
  "saveMileageTrip",
  "deleteMileageTrip",
  "saveBusinessExpense",
  "deleteBusinessExpense",
  "listSubcontractors",
  "saveSubcontractor",
  "deleteSubcontractor",
  "saveShareImage",
  "deleteShareImage",
  "listShareImages",
  "getWeatherOutlook",
  "getExpansionSuite",
  "saveWarranty",
  "saveSupplier",
  "saveMaintenancePlan",
  "completeMaintenancePlan",
  "saveScannedDocument",
  "saveSlideshowVideo",
  "getTaxExport",
  "getDocumentParameters",
  "getAdminConsole",
  "updateSupportReport",
  "addAppUser",
  "updateAppUser",
  "updateAdminParameters",
  "createPortalLink",
  "revokePortalLink",
  "getPortalLinkInfo",
  "rotatePortalLink",
  "createDocumentLink",
  "getDocumentLinkInfo",
  "revokeDocumentLink",
  "updateJobSiteLocation",
  "suggestJobsByLocation",
  "setJobClient",
  "updateJobInfo",
  "linkInvoiceToJob",
  "listDocuments",
  "linkDocumentToJob",
  "clockInCrew",
  "clockOutCrew",
  "getCrewClockStatus",
  "updateQuoteVersion",
  "createQuoteVersion",
  "sendQuoteVersion",
  "acceptQuoteVersion",
  "getQuoteVersions",
  "listMaterialCosts",
  "saveMaterialCost",
  "deleteMaterialCost",
  "getFieldIntelligence",
  "saveSupplierQuote",
  "createPurchaseOrder",
  "updatePurchaseOrderStatus",
  "receivePurchaseOrder",
  "saveEquipment",
  "setEquipmentCheckout",
  "completeEquipmentMaintenance",
  "saveSafetyTalk",
  "saveIncident",
  "saveCredential",
  "renewCredential",
  "saveCrewPayRate",
  "setJobPhotoRequirements",
  "completeJob",
  "deleteFieldTestRecord",
  "exportBackup",
  "restoreBackup",
  "verifyBackupRoundTrip"
]);
function protectActions(actions) {
  const entries = Object.entries(actions).map(([name, action]) => {
    if (PUBLIC_ACTIONS.has(name))
      return [name, action];
    const original = action.handler;
    const protectedAction = {
      ...action,
      request: action.request.and(authEnvelopeSchema),
      handler: async (ctx, args) => {
        const envelope = authEnvelopeSchema.parse(args);
        const user = await requireSession(ctx, envelope._sessionToken);
        if (PREMIUM_ACTIONS.has(name) && user.tier !== "premium")
          throw new Error("Premium required. Upgrade to unlock this Pro tool.");
        return original(withWorkspace(ctx, user), args);
      }
    };
    return [name, protectedAction];
  });
  return Object.fromEntries(entries);
}
var Actions = protectActions(BaseActions);
export {
  Actions,
  performBackup,
  performMonthlyVerify,
  recoverStaleBackupRuns,
  runScheduledBackup
};
