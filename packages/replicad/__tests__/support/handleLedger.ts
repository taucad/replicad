/**
 * A handle ledger for the OpenCascade instance: every embind object that
 * reaches JavaScript from a constructor, a static function, a method or
 * `clone()` is recorded with the replicad source line that created it, and
 * `delete()` removes it. Whatever an operation created and left alive, once
 * the caller has deleted everything it was given, is a leaked handle.
 *
 * The ledger also counts deletions of a handle that was already deleted
 * (embind throws on them; the finalization registry swallows the error).
 *
 * It patches the instance in place and cannot be removed: install it once per
 * test file, on the instance the tests use.
 */
export type LedgerEntry = {
  /** OpenCascade class that returned or constructed the handle. */
  cls: string;
  /** `new Class`, `Class.method` or `Class::static`. */
  via: string;
  /** The first replicad source frame that created it. */
  site: string;
  stack: string;
};

export interface HandleLedger {
  /** Live handles created since installation. */
  readonly live: Map<object, LedgerEntry>;
  stats(): { created: number; deleted: number; live: number; doubleDeletes: number };
  snapshot(): Set<object>;
  /** Handles created after `snapshot` was taken that are still alive. */
  since(snapshot: Set<object>): LedgerEntry[];
  /** Whether a handle is known to the ledger and still alive. */
  isLive(handle: object): boolean;
}

const isHandle = (v: any): boolean =>
  v !== null &&
  typeof v === "object" &&
  typeof v.delete === "function" &&
  typeof v.isDeleted === "function";

const SKIPPED_MEMBERS = new Set([
  "constructor",
  "delete",
  "clone",
  "isDeleted",
  "isAliasOf",
  "deleteLater",
]);
const SKIPPED_PROPERTIES = new Set([
  "length",
  "name",
  "prototype",
  "arguments",
  "caller",
]);

const ledgers = new WeakMap<object, HandleLedger>();

export function installHandleLedger(
  oc: any,
  { frames = 6 }: { frames?: number } = {}
): HandleLedger {
  const existing = ledgers.get(oc);
  if (existing) return existing;

  const live = new Map<object, LedgerEntry>();
  let created = 0;
  let deleted = 0;
  let doubleDeletes = 0;

  const short = (line: string) =>
    line
      .replace(/^at /, "")
      .replace(/\(?[^\s(]*\/packages\/replicad\//, "")
      .replace(/\)$/, "");
  const siteOf = () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 40;
    const stack = new Error().stack ?? "";
    Error.stackTraceLimit = limit;
    const lines = stack
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter(
        (line) =>
          !line.includes("handleLedger") &&
          !line.includes("node_modules") &&
          !line.includes("node:")
      );
    const sources = lines.filter((line) => line.includes("/src/")).slice(0, frames);
    return {
      site: sources[0] ? short(sources[0]) : lines[0] ? short(lines[0]) : "?",
      stack: sources.map(short).join(" < "),
    };
  };
  const track = (value: any, cls: string, via: string) => {
    if (!isHandle(value) || value.isDeleted()) return value;
    if (!live.has(value)) {
      created += 1;
      live.set(value, { cls, via, ...siteOf() });
    }
    return value;
  };
  const trackResult = (result: any, cls: string, via: string) => {
    if (Array.isArray(result)) result.forEach((x) => track(x, cls, via));
    else track(result, cls, via);
    return result;
  };

  // embind's shared ClassHandle prototype owns delete, clone and isDeleted.
  const probe = new oc.gp_Pnt(0, 0, 0);
  let base = Object.getPrototypeOf(probe);
  while (base && !Object.prototype.hasOwnProperty.call(base, "delete"))
    base = Object.getPrototypeOf(base);
  probe.delete();
  const originalDelete = base.delete;
  const originalClone = base.clone;
  base.delete = function (this: any) {
    if (this.isDeleted()) doubleDeletes += 1;
    if (live.delete(this)) deleted += 1;
    return originalDelete.call(this);
  };
  base.clone = function (this: any) {
    return track(
      originalClone.call(this),
      this.constructor?.name ?? "?",
      "clone"
    );
  };

  // embind's overload dispatchers read `<owner>[name].overloadTable` when
  // called, so a wrapper exposes the original's own properties live.
  const carry = (original: any, wrapper: any) => {
    for (const key of Object.getOwnPropertyNames(original)) {
      if (SKIPPED_PROPERTIES.has(key)) continue;
      Object.defineProperty(wrapper, key, {
        get: () => original[key],
        set: (value) => {
          original[key] = value;
        },
        configurable: true,
      });
    }
    return wrapper;
  };
  const wrapped = new WeakSet<Function>();
  for (const name of Object.getOwnPropertyNames(oc)) {
    const Class = oc[name];
    if (typeof Class !== "function" || !Class.prototype || wrapped.has(Class))
      continue;
    const prototype = Class.prototype;
    if (typeof prototype.delete !== "function") continue;
    wrapped.add(Class);
    for (const member of Object.getOwnPropertyNames(prototype)) {
      if (SKIPPED_MEMBERS.has(member)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, member);
      if (!descriptor || typeof descriptor.value !== "function") continue;
      const method = descriptor.value;
      prototype[member] = carry(method, function (this: any, ...args: any[]) {
        return trackResult(method.apply(this, args), name, `${name}.${member}`);
      });
    }
    for (const member of Object.getOwnPropertyNames(Class)) {
      const descriptor = Object.getOwnPropertyDescriptor(Class, member);
      if (!descriptor || typeof descriptor.value !== "function" || !descriptor.writable)
        continue;
      const method = descriptor.value;
      Class[member] = carry(method, (...args: any[]) =>
        trackResult(method.apply(Class, args), name, `${name}::${member}`)
      );
    }
    oc[name] = new Proxy(Class, {
      construct(target, args, newTarget) {
        return track(
          Reflect.construct(target, args, newTarget),
          name,
          `new ${name}`
        );
      },
    });
  }

  const ledger: HandleLedger = {
    live,
    stats: () => ({ created, deleted, live: live.size, doubleDeletes }),
    snapshot: () => new Set(live.keys()),
    since: (snapshot) =>
      [...live.entries()]
        .filter(([handle]) => !snapshot.has(handle))
        .map(([, entry]) => entry),
    isLive: (handle) => live.has(handle),
  };
  ledgers.set(oc, ledger);
  return ledger;
}

/** Leaked handles grouped by creation site, most frequent first. */
export function summarizeLeaks(entries: LedgerEntry[], iterations = 1) {
  const groups = new Map<
    string,
    { n: number; via: string; site: string; stack: string }
  >();
  for (const entry of entries) {
    const key = `${entry.via} @ ${entry.site}`;
    const group = groups.get(key) ?? {
      n: 0,
      via: entry.via,
      site: entry.site,
      stack: entry.stack,
    };
    group.n += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.n - a.n)
    .map((group) => ({ ...group, perIteration: group.n / iterations }));
}
