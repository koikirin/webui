var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Ensure: () => Ensure,
  LocalScanner: () => LocalScanner,
  conclude: () => conclude,
  default: () => Scanner
});
module.exports = __toCommonJS(src_exports);
var import_semver = require("semver");
var import_cosmokit2 = require("cosmokit");

// src/utils.ts
var Ensure;
((Ensure2) => {
  Ensure2.array = /* @__PURE__ */ __name((value, fallback) => {
    if (!Array.isArray(value)) return fallback;
    return value.filter((x) => typeof x === "string");
  }, "array");
  Ensure2.dict = /* @__PURE__ */ __name((value, fallback) => {
    if (typeof value !== "object" || value === null) return fallback;
    return Object.entries(value).reduce((dict2, [key, value2]) => {
      if (typeof value2 === "string") dict2[key] = value2;
      return dict2;
    }, {});
  }, "dict");
  const primitive = /* @__PURE__ */ __name((type) => (value, fallback) => {
    if (typeof value !== type) return fallback;
    return value;
  }, "primitive");
  Ensure2.boolean = primitive("boolean");
  Ensure2.number = primitive("number");
  Ensure2.string = primitive("string");
})(Ensure || (Ensure = {}));
function conclude(meta) {
  const manifest = {
    hidden: Ensure.boolean(meta.koishi?.hidden),
    preview: Ensure.boolean(meta.koishi?.preview),
    insecure: Ensure.boolean(meta.koishi?.insecure),
    browser: Ensure.boolean(meta.koishi?.browser),
    category: Ensure.string(meta.koishi?.category),
    public: Ensure.array(meta.koishi?.public),
    description: Ensure.dict(meta.koishi?.description) || Ensure.string(meta.description, ""),
    locales: Ensure.array(meta.koishi?.locales, []),
    service: {
      required: Ensure.array(meta.koishi?.service?.required, []),
      optional: Ensure.array(meta.koishi?.service?.optional, []),
      implements: Ensure.array(meta.koishi?.service?.implements, [])
    }
  };
  if (typeof manifest.description === "string") {
    manifest.description = manifest.description.slice(0, 1024);
  } else if (manifest.description) {
    for (const key in manifest.description) {
      manifest.description[key] = manifest.description[key].slice(0, 1024);
    }
  }
  meta.keywords = Ensure.array(meta.keywords, []).filter((keyword) => {
    if (!keyword.includes(":")) return true;
    if (keyword === "market:hidden") {
      manifest.hidden = true;
    } else if (keyword.startsWith("required:")) {
      manifest.service.required.push(keyword.slice(9));
    } else if (keyword.startsWith("optional:")) {
      manifest.service.optional.push(keyword.slice(9));
    } else if (keyword.startsWith("impl:")) {
      manifest.service.implements.push(keyword.slice(5));
    } else if (keyword.startsWith("locale:")) {
      manifest.locales.push(keyword.slice(7));
    }
  });
  return manifest;
}
__name(conclude, "conclude");

// src/index.ts
var import_p_map = __toESM(require("p-map"));

// src/local.ts
var import_cosmokit = require("cosmokit");
var import_path = require("path");
var import_promises = require("fs/promises");
var LocalScanner = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    (0, import_cosmokit.defineProperty)(this, "cache", {});
  }
  static {
    __name(this, "LocalScanner");
  }
  cache;
  task;
  onError(reason, name) {
  }
  async _collect() {
    this.cache = {};
    let root = this.baseDir;
    const tasks = [];
    while (1) {
      tasks.push(this.loadDirectory(root));
      const parent = (0, import_path.dirname)(root);
      if (root === parent) break;
      root = parent;
    }
    await Promise.all(tasks);
    return Promise.all(Object.values(this.cache));
  }
  async collect(forced = false) {
    if (forced) delete this.task;
    this.objects = await (this.task ||= this._collect());
  }
  async loadDirectory(baseDir) {
    const base = baseDir + "/node_modules";
    const files = await (0, import_promises.readdir)(base).catch(() => []);
    for (const name of files) {
      if (name.startsWith("koishi-plugin-")) {
        this.cache[name] ||= this.loadPackage(name);
      } else if (name.startsWith("@")) {
        const base2 = base + "/" + name;
        const files2 = await (0, import_promises.readdir)(base2).catch(() => []);
        for (const name2 of files2) {
          if (name === "@koishijs" && name2.startsWith("plugin-") || name2.startsWith("koishi-plugin-")) {
            this.cache[name + "/" + name2] ||= this.loadPackage(name + "/" + name2);
          }
        }
      }
    }
  }
  async loadPackage(name) {
    try {
      return await this.parsePackage(name);
    } catch (error) {
      this.onError(error, name);
    }
  }
  async loadManifest(name) {
    const filename = require.resolve(name + "/package.json");
    const meta = JSON.parse(await (0, import_promises.readFile)(filename, "utf8"));
    meta.peerDependencies ||= {};
    meta.peerDependenciesMeta ||= {};
    return [meta, !filename.includes("node_modules")];
  }
  async parsePackage(name) {
    const [data, workspace] = await this.loadManifest(name);
    return {
      workspace,
      manifest: conclude(data),
      shortname: data.name.replace(/(koishi-|^@koishijs\/)plugin-/, ""),
      package: (0, import_cosmokit.pick)(data, [
        "name",
        "version",
        "peerDependencies",
        "peerDependenciesMeta"
      ])
    };
  }
};

// src/index.ts
var stopWords = [
  "koishi",
  "plugin",
  "bot",
  "coolq",
  "cqhttp"
];
var Scanner = class _Scanner {
  constructor(request) {
    this.request = request;
    (0, import_cosmokit2.defineProperty)(this, "progress", 0);
    (0, import_cosmokit2.defineProperty)(this, "cache", {});
  }
  static {
    __name(this, "Scanner");
  }
  cache;
  async search(offset, config) {
    const { step = 250, timeout = import_cosmokit2.Time.second * 30 } = config;
    const result = await this.request(`/-/v1/search?text=koishi+plugin&size=${step}&from=${offset}`, { timeout });
    this.version = result.version;
    for (const object of result.objects) {
      this.cache[object.package.name] = object;
    }
    return result.total;
  }
  async collect(config = {}) {
    const { step = 250, margin = 25, ignored = [] } = config;
    this.cache = {};
    this.time = (/* @__PURE__ */ new Date()).toUTCString();
    const total = await this.search(0, config);
    for (let offset = Object.values(this.cache).length; offset < total; offset += step - margin) {
      await this.search(offset - margin, config);
    }
    this.objects = Object.values(this.cache).filter((object) => {
      const { name, date } = object.package;
      return date && !object.ignored && !ignored.includes(name) && _Scanner.isPlugin(name);
    });
    this.total = this.objects.length;
  }
  static isPlugin(name) {
    const official = /^@koishijs\/plugin-[0-9a-z-]+$/.test(name);
    const community = /(^|\/)koishi-plugin-[0-9a-z-]+$/.test(name);
    return official || community;
  }
  static isCompatible(range, remote) {
    const { peerDependencies = {} } = remote;
    const declaredVersion = peerDependencies["koishi"];
    try {
      return declaredVersion && (0, import_semver.intersects)(range, declaredVersion);
    } catch {
    }
  }
  async process(object, range, onRegistry) {
    const { name } = object.package;
    const official = name.startsWith("@koishijs/plugin-");
    const registry = await this.request(`/${name}`);
    const compatible = Object.values(registry.versions).filter((remote) => {
      return _Scanner.isCompatible(range, remote);
    }).sort((a, b) => (0, import_semver.compare)(b.version, a.version));
    await onRegistry?.(registry, compatible);
    const versions = compatible.filter((item) => !item.deprecated);
    if (!versions.length) return;
    const latest = registry.versions[versions[0].version];
    const manifest = conclude(latest);
    const times = compatible.map((item) => registry.time[item.version]).sort();
    object.shortname = name.replace(/(koishi-|^@koishijs\/)plugin-/, "");
    object.verified = official;
    object.manifest = manifest;
    object.insecure = manifest.insecure;
    object.category = manifest.category;
    object.createdAt = times[0];
    object.updatedAt = times[times.length - 1];
    object.package.contributors ??= latest.author ? [latest.author] : [];
    object.package.keywords = (latest.keywords ?? []).map((keyword) => keyword.toLowerCase()).filter((keyword) => {
      return !keyword.includes(":") && !object.shortname.includes(keyword) && !stopWords.some((word) => keyword.includes(word));
    });
    return versions;
  }
  async analyze(config) {
    const { concurrency = 5, version, before, onSuccess, onFailure, onSkipped, onRegistry, after } = config;
    const result = await (0, import_p_map.default)(this.objects, async (object) => {
      if (object.ignored) return;
      before?.(object);
      const { name } = object.package;
      try {
        const versions = await this.process(object, version, onRegistry);
        if (versions) {
          await onSuccess?.(object, versions);
          return versions;
        } else {
          object.ignored = true;
          await onSkipped?.(name);
        }
      } catch (error) {
        object.ignored = true;
        await onFailure?.(name, error);
      } finally {
        this.progress += 1;
        after?.(object);
      }
    }, { concurrency });
    return result.filter(import_cosmokit2.isNonNullable);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Ensure,
  LocalScanner,
  conclude
});
//# sourceMappingURL=index.js.map
