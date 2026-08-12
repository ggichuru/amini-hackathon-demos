// explain.ts
var Parser = class {
  constructor(src) {
    this.src = src;
  }
  src;
  i = 0;
  parse() {
    const node = this.parseAlt();
    if (this.i < this.src.length) throw new Error(`Unexpected "${this.src[this.i]}" at ${this.i}`);
    return node;
  }
  peek() {
    return this.src[this.i];
  }
  eof() {
    return this.i >= this.src.length;
  }
  parseAlt() {
    const options = [this.parseConcat()];
    while (!this.eof() && this.peek() === "|") {
      this.i++;
      options.push(this.parseConcat());
    }
    return options.length === 1 ? options[0] : { type: "alt", options };
  }
  parseConcat() {
    const parts = [];
    while (!this.eof() && this.peek() !== "|" && this.peek() !== ")") {
      parts.push(this.parseQuantified());
    }
    if (parts.length === 1) return parts[0];
    return { type: "concat", parts };
  }
  parseQuantified() {
    let atom = this.parseAtom();
    if (this.eof()) return atom;
    const c = this.peek();
    let min = null;
    let max = null;
    if (c === "+") {
      min = 1;
      max = null;
      this.i++;
    } else if (c === "*") {
      min = 0;
      max = null;
      this.i++;
    } else if (c === "?") {
      min = 0;
      max = 1;
      this.i++;
    } else if (c === "{") {
      const saved = this.i;
      const parsed = this.tryParseBrace();
      if (!parsed) {
        this.i = saved;
        return atom;
      }
      min = parsed.min;
      max = parsed.max;
    } else {
      return atom;
    }
    let lazy = false;
    if (!this.eof() && this.peek() === "?") {
      lazy = true;
      this.i++;
    }
    atom = { type: "quant", child: atom, min, max, lazy };
    return atom;
  }
  tryParseBrace() {
    this.i++;
    let digits = "";
    while (!this.eof() && /[0-9]/.test(this.peek())) digits += this.src[this.i++];
    if (digits === "") return null;
    const min = parseInt(digits, 10);
    let max = min;
    if (!this.eof() && this.peek() === ",") {
      this.i++;
      let d2 = "";
      while (!this.eof() && /[0-9]/.test(this.peek())) d2 += this.src[this.i++];
      max = d2 === "" ? null : parseInt(d2, 10);
    }
    if (this.eof() || this.peek() !== "}") return null;
    this.i++;
    return { min, max };
  }
  parseAtom() {
    const c = this.peek();
    if (c === "(") return this.parseGroup();
    if (c === "[") return this.parseSet();
    if (c === ".") {
      this.i++;
      return { type: "any" };
    }
    if (c === "^") {
      this.i++;
      return { type: "anchor", kind: "start" };
    }
    if (c === "$") {
      this.i++;
      return { type: "anchor", kind: "end" };
    }
    if (c === "\\") return this.parseEscape();
    this.i++;
    return { type: "char", value: c };
  }
  parseGroup() {
    this.i++;
    let capturing = true;
    let name;
    if (this.peek() === "?") {
      this.i++;
      if (this.peek() === ":") {
        this.i++;
        capturing = false;
      } else if (this.peek() === "<") {
        this.i++;
        let nm = "";
        while (!this.eof() && this.peek() !== ">") nm += this.src[this.i++];
        this.i++;
        name = nm;
      } else {
        this.i++;
        capturing = false;
      }
    }
    const body = this.parseAlt();
    if (this.peek() !== ")") throw new Error("Unclosed group");
    this.i++;
    return { type: "group", body, capturing, name };
  }
  parseSet() {
    this.i++;
    let negated = false;
    if (this.peek() === "^") {
      negated = true;
      this.i++;
    }
    const items = [];
    while (!this.eof() && this.peek() !== "]") {
      let ch;
      if (this.peek() === "\\") {
        this.i++;
        const e = this.src[this.i++];
        if ("dDwWsS".includes(e)) {
          items.push({ kind: "class", cls: "\\" + e });
          continue;
        }
        ch = unescapeChar(e);
      } else {
        ch = this.src[this.i++];
      }
      if (this.peek() === "-" && this.src[this.i + 1] !== "]" && this.i + 1 < this.src.length) {
        this.i++;
        let to;
        if (this.peek() === "\\") {
          this.i++;
          to = unescapeChar(this.src[this.i++]);
        } else {
          to = this.src[this.i++];
        }
        items.push({ kind: "range", from: ch, to });
      } else {
        items.push({ kind: "char", value: ch });
      }
    }
    if (this.peek() !== "]") throw new Error("Unclosed character class");
    this.i++;
    return { type: "set", negated, items };
  }
  parseEscape() {
    this.i++;
    const e = this.src[this.i++];
    if ("dDwWsS".includes(e)) return { type: "class", kind: "\\" + e };
    if (e === "b") return { type: "anchor", kind: "wordBoundary" };
    if (e === "B") return { type: "anchor", kind: "notWordBoundary" };
    return { type: "char", value: unescapeChar(e) };
  }
};
function unescapeChar(e) {
  if (e === "n") return "\n";
  if (e === "t") return "	";
  if (e === "r") return "\r";
  return e;
}
function parse(pattern) {
  return new Parser(pattern).parse();
}
function charName(ch) {
  if (ch === " ") return "a space";
  if (ch === "\n") return "a newline";
  if (ch === "	") return "a tab";
  if (ch === ".") return "a literal dot";
  if (ch === "-") return "a hyphen";
  if (ch === "@") return 'an "@" sign';
  if (ch === "_") return "an underscore";
  return `the character "${ch}"`;
}
function classPhrase(kind) {
  switch (kind) {
    case "\\d":
      return "a digit (0-9)";
    case "\\D":
      return "a non-digit";
    case "\\w":
      return "a word character (letter, digit, or underscore)";
    case "\\W":
      return "a non-word character";
    case "\\s":
      return "a whitespace character";
    case "\\S":
      return "a non-whitespace character";
    default:
      return kind;
  }
}
function setPhrase(node) {
  const parts = node.items.map((it) => {
    if (it.kind === "range") return `${it.from}-${it.to}`;
    if (it.kind === "class") return classPhrase(it.cls);
    return `"${it.value}"`;
  });
  const body = parts.join(", ");
  return node.negated ? `any character except ${body}` : `one of ${body}`;
}
function times(min, max) {
  if (max === null) {
    if (min === 0) return "zero or more times";
    if (min === 1) return "one or more times";
    return `at least ${min} times`;
  }
  if (min === 0 && max === 1) return "optionally (zero or one time)";
  if (min === max) return `exactly ${min} time${min === 1 ? "" : "s"}`;
  return `between ${min} and ${max} times`;
}
function atomPhrase(node) {
  switch (node.type) {
    case "char":
      return charName(node.value);
    case "class":
      return classPhrase(node.kind);
    case "set":
      return setPhrase(node);
    case "any":
      return "any character";
    case "anchor":
      return node.kind === "start" ? "the start of the line" : node.kind === "end" ? "the end of the line" : node.kind === "wordBoundary" ? "a word boundary" : "a non-boundary";
    case "group":
      return "a group";
    default:
      return "a pattern";
  }
}
function explainTokens(pattern) {
  let ast;
  try {
    ast = parse(pattern);
  } catch (e) {
    return [{ regex: pattern, text: `(could not parse: ${e.message})` }];
  }
  const out = [];
  walk(ast, out);
  return out;
}
function nodeSource(node) {
  switch (node.type) {
    case "char": {
      const v = node.value;
      if (v === "\n") return "\\n";
      if (v === "	") return "\\t";
      if ("\\^$.|?*+()[]{}".includes(v)) return "\\" + v;
      return v;
    }
    case "class":
      return node.kind;
    case "any":
      return ".";
    case "anchor":
      return node.kind === "start" ? "^" : node.kind === "end" ? "$" : node.kind === "wordBoundary" ? "\\b" : "\\B";
    case "set": {
      const inner = node.items.map((it) => it.kind === "range" ? `${it.from}-${it.to}` : it.kind === "class" ? it.cls : it.value).join("");
      return "[" + (node.negated ? "^" : "") + inner + "]";
    }
    case "group":
      return "(" + (node.capturing ? "" : "?:") + nodeSource(node.body) + ")";
    case "quant": {
      const q = node.max === null ? node.min === 0 ? "*" : node.min === 1 ? "+" : `{${node.min},}` : node.min === 0 && node.max === 1 ? "?" : node.min === node.max ? `{${node.min}}` : `{${node.min},${node.max}}`;
      return nodeSource(node.child) + q + (node.lazy ? "?" : "");
    }
    case "concat":
      return node.parts.map(nodeSource).join("");
    case "alt":
      return node.options.map(nodeSource).join("|");
  }
}
function walk(node, out) {
  switch (node.type) {
    case "concat":
      node.parts.forEach((p) => walk(p, out));
      break;
    case "alt":
      out.push({
        regex: nodeSource(node),
        text: "either " + node.options.map((o) => `"${nodeSource(o)}"`).join(" or ")
      });
      break;
    case "quant": {
      const childPhrase = atomPhrase(node.child);
      out.push({
        regex: nodeSource(node),
        text: `${capitalize(childPhrase)}, ${times(node.min, node.max)}`
      });
      break;
    }
    case "group":
      out.push({ regex: "(", text: node.capturing ? "start of a captured group" : "start of a group" });
      walk(node.body, out);
      out.push({ regex: ")", text: "end of the group" });
      break;
    default:
      out.push({ regex: nodeSource(node), text: capitalize(atomPhrase(node)) });
  }
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function explainSummary(pattern) {
  const tokens = explainTokens(pattern);
  if (tokens.length === 0) return "An empty pattern (matches an empty string).";
  if (tokens.length === 1) return `Matches ${lower(tokens[0].text)}.`;
  const phrases = tokens.map((t) => lower(t.text));
  return "Matches " + phrases.join(", then ") + ".";
}
function lower(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// synth.ts
function baseOf(c) {
  if (c >= "0" && c <= "9") return "digit";
  if (c >= "a" && c <= "z") return "lower";
  if (c >= "A" && c <= "Z") return "upper";
  if (/\s/.test(c)) return "space";
  return "other";
}
function escapeLiteral(c) {
  if ("\\^$.|?*+()[]{}".includes(c)) return "\\" + c;
  if (c === "\n") return "\\n";
  if (c === "	") return "\\t";
  if (c === "\r") return "\\r";
  return c;
}
function escapeInClass(c) {
  if ("\\^]".includes(c)) return "\\" + c;
  if (c === "\n") return "\\n";
  if (c === "	") return "\\t";
  if (c === "\r") return "\\r";
  return c;
}
function charSet(chars) {
  const uniq = Array.from(new Set(chars));
  const hasDash = uniq.includes("-");
  const rest = uniq.filter((c) => c !== "-").map(escapeInClass).sort();
  const body = rest.join("") + (hasDash ? "-" : "");
  return "[" + body + "]";
}
function classCandidates(chars) {
  const uniq = Array.from(new Set(chars));
  const out = [];
  const push = (rank, regex) => out.push({ rank, regex });
  const allDigit = uniq.every((c) => baseOf(c) === "digit");
  const allLower = uniq.every((c) => baseOf(c) === "lower");
  const allUpper = uniq.every((c) => baseOf(c) === "upper");
  const allLetter = uniq.every((c) => /[a-zA-Z]/.test(c));
  const allWord = uniq.every((c) => /\w/.test(c));
  const allNonSpace = uniq.every((c) => /\S/.test(c));
  if (uniq.length === 1) push(0, escapeLiteral(uniq[0]));
  if (uniq.length <= 12) push(1, charSet(uniq));
  if (allDigit) push(2, "\\d");
  if (allLower) push(2, "[a-z]");
  if (allUpper) push(2, "[A-Z]");
  if (allLetter) push(3, "[A-Za-z]");
  if (allWord) push(4, "\\w");
  if (allNonSpace) push(5, "\\S");
  push(6, ".");
  const seen = /* @__PURE__ */ new Set();
  const dedup = out.filter((o) => seen.has(o.regex) ? false : (seen.add(o.regex), true));
  dedup.sort((a, b) => a.rank - b.rank);
  return dedup.map((o) => o.regex);
}
function quantCandidates(min, max) {
  const opts = [];
  if (min === 1 && max === 1) {
    opts.push("");
  } else if (min === max) {
    opts.push(`{${min}}`);
  } else {
    opts.push(`{${min},${max}}`);
    opts.push(`{${min},}`);
  }
  if (min >= 1 && !opts.includes("+")) opts.push("+");
  return opts;
}
function segment(s) {
  const runs = [];
  for (const ch of s) {
    const b = baseOf(ch);
    const last = runs[runs.length - 1];
    if (last && last.base === b && b !== "other") last.chars += ch;
    else if (last && last.base === b && b === "other" && last.chars[last.chars.length - 1] === ch)
      last.chars += ch;
    else runs.push({ base: b, chars: ch });
  }
  return runs;
}
function coarseSegment(s) {
  const runs = [];
  for (const ch of s) {
    const raw = baseOf(ch);
    const b = raw === "digit" || raw === "lower" || raw === "upper" ? "lower" : raw;
    const last = runs[runs.length - 1];
    if (last && last.base === b && b !== "other") last.chars += ch;
    else if (last && last.base === b && b === "other" && last.chars[last.chars.length - 1] === ch)
      last.chars += ch;
    else runs.push({ base: b, chars: ch });
  }
  return runs;
}
function assemble(slots, st) {
  let out = "";
  for (let i = 0; i < slots.length; i++) out += slots[i].classOpts[st.ci[i]] + slots[i].quantOpts[st.qi[i]];
  return out;
}
function genWeight(atom) {
  if (atom === ".") return 4;
  if (atom === "\\S") return 2.5;
  if (atom === "\\w") return 0.6;
  if (atom === "\\d") return 0.3;
  if (atom === "[A-Za-z]") return 0.5;
  if (atom === "[a-z]" || atom === "[A-Z]") return 0.3;
  if (atom.startsWith("[")) return 1.2;
  return 0;
}
function costState(slots, repLen, st) {
  let c = 0;
  for (let i = 0; i < slots.length; i++) {
    const cls = slots[i].classOpts[st.ci[i]];
    const q = slots[i].quantOpts[st.qi[i]];
    c += genWeight(cls) * Math.max(1, repLen[i]);
    c += cls.length + q.length;
  }
  return c;
}
function costOf(regex) {
  let c = regex.length;
  for (let i = 0; i < regex.length; i++) {
    if (regex[i] === "." && (i === 0 || regex[i - 1] !== "\\")) c += 4;
  }
  return c;
}
function fullMatch(regex, s) {
  let re;
  try {
    re = new RegExp("^(?:" + regex + ")$");
  } catch {
    return false;
  }
  return re.test(s);
}
function keyOf(st) {
  return st.ci.join(",") + "/" + st.qi.join(",");
}
function alignSlots(positives, segmenter) {
  const segs = positives.map(segmenter);
  const skeletonOf = (runs) => runs.map((r) => r.base === "other" ? "o:" + r.chars[0] : r.base).join("|");
  const first = skeletonOf(segs[0]);
  for (const s of segs) if (skeletonOf(s) !== first) return null;
  const nSlots = segs[0].length;
  const stats = [];
  for (let i = 0; i < nSlots; i++) {
    const chars = [];
    let min = Infinity;
    let max = 0;
    for (const seg of segs) {
      const run = seg[i];
      for (const ch of run.chars) chars.push(ch);
      min = Math.min(min, run.chars.length);
      max = Math.max(max, run.chars.length);
    }
    stats.push({ chars, min, max });
  }
  return stats;
}
function slotsFromStats(stats) {
  return stats.map((s) => ({
    classOpts: classCandidates(s.chars),
    quantOpts: quantCandidates(s.min, s.max)
  }));
}
function repLenFromStats(stats) {
  return stats.map((s) => s.max);
}
function posOk(slots, st, positives) {
  const re = assemble(slots, st);
  return positives.every((p) => fullMatch(re, p));
}
function negCount(slots, st, negatives) {
  const re = assemble(slots, st);
  let n = 0;
  for (const neg of negatives) if (fullMatch(re, neg)) n++;
  return n;
}
function search(slots, repLen, positives, negatives) {
  const nSlots = slots.length;
  if (nSlots === 0) return null;
  let product = 1;
  for (const s of slots) product *= s.classOpts.length * s.quantOpts.length;
  let best = null;
  const consider = (st) => {
    if (negCount(slots, st, negatives) !== 0) return;
    if (!posOk(slots, st, positives)) return;
    const c = costState(slots, repLen, st);
    if (!best || c < best.cost) best = { regex: assemble(slots, st), cost: c };
  };
  if (product <= 4e3) {
    const ci = new Array(nSlots).fill(0);
    const qi = new Array(nSlots).fill(0);
    const sizes = slots.map((s) => s.classOpts.length * s.quantOpts.length);
    for (let n = 0; n < product; n++) {
      let rem = n;
      for (let i = 0; i < nSlots; i++) {
        const k = rem % sizes[i];
        rem = Math.floor(rem / sizes[i]);
        ci[i] = k % slots[i].classOpts.length;
        qi[i] = Math.floor(k / slots[i].classOpts.length);
      }
      consider({ ci: ci.slice(), qi: qi.slice() });
    }
    return best;
  }
  const start = {
    ci: slots.map((s) => s.classOpts.length - 1),
    qi: slots.map((s) => s.quantOpts.length - 1)
  };
  const K = 12;
  const MAX_EXPANSIONS = 8e3;
  const visited = /* @__PURE__ */ new Set([keyOf(start)]);
  let frontier = [start];
  let expansions = 0;
  consider(start);
  while (frontier.length && expansions < MAX_EXPANSIONS) {
    frontier.sort((a, b) => {
      const na = negCount(slots, a, negatives);
      const nb = negCount(slots, b, negatives);
      if (na !== nb) return na - nb;
      return costState(slots, repLen, a) - costState(slots, repLen, b);
    });
    frontier = frontier.slice(0, K);
    const next = [];
    for (const st of frontier) {
      for (let i = 0; i < nSlots; i++) {
        for (const which of ["c", "q"]) {
          const arr = which === "c" ? st.ci : st.qi;
          if (arr[i] <= 0) continue;
          const nb = { ci: st.ci.slice(), qi: st.qi.slice() };
          if (which === "c") nb.ci[i]--;
          else nb.qi[i]--;
          const k = keyOf(nb);
          if (visited.has(k)) continue;
          visited.add(k);
          expansions++;
          consider(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return best;
}
function globalSlots(positives) {
  const chars = [];
  let min = Infinity;
  let max = 0;
  for (const p of positives) {
    for (const ch of p) chars.push(ch);
    min = Math.min(min, p.length);
    max = Math.max(max, p.length);
  }
  return {
    slots: [{ classOpts: classCandidates(chars), quantOpts: quantCandidates(min, max) }],
    repLen: [max]
  };
}
function alternation(positives) {
  const uniq = Array.from(new Set(positives));
  const parts = uniq.map(
    (p) => Array.from(p).map(escapeLiteral).join("")
  );
  return parts.length === 1 ? parts[0] : "(?:" + parts.join("|") + ")";
}
function synthesize(input) {
  const positives = input.positives.filter((p) => p.length > 0);
  const negatives = input.negatives.filter((n) => n.length > 0);
  const totals = { positives: positives.length, negatives: negatives.length };
  if (positives.length === 0) {
    return {
      regex: null,
      flags: "g",
      cost: Infinity,
      strategy: "empty",
      coverage: { positives: 0, negatives: 0, total: totals }
    };
  }
  const candidates = [];
  const fineStats = alignSlots(positives, segment);
  if (fineStats) {
    const r = search(slotsFromStats(fineStats), repLenFromStats(fineStats), positives, negatives);
    if (r) candidates.push({ ...r, strategy: "fine" });
  }
  const coarseStats = alignSlots(positives, coarseSegment);
  if (coarseStats) {
    const r = search(slotsFromStats(coarseStats), repLenFromStats(coarseStats), positives, negatives);
    if (r) candidates.push({ ...r, strategy: "coarse" });
  }
  {
    const g = globalSlots(positives);
    const r = search(g.slots, g.repLen, positives, negatives);
    if (r) candidates.push({ ...r, strategy: "global" });
  }
  candidates.sort((a, b) => a.cost - b.cost);
  let chosen = candidates[0];
  if (!chosen) {
    const alt = alternation(positives);
    chosen = { regex: alt, cost: costOf(alt), strategy: "alternation" };
  }
  const posHit = positives.filter((p) => fullMatch(chosen.regex, p)).length;
  const negHit = negatives.filter((n) => fullMatch(chosen.regex, n)).length;
  return {
    regex: chosen.regex,
    flags: "g",
    cost: chosen.cost,
    strategy: chosen.strategy,
    coverage: { positives: posHit, negatives: negatives.length - negHit, total: totals }
  };
}
function isFullMatch(regex, s) {
  return fullMatch(regex, s);
}

// agent.ts
function verify(pattern, positives, negatives) {
  try {
    new RegExp("^(?:" + pattern + ")$");
  } catch {
    return { ok: false, failingPositives: [...positives], matchingNegatives: [], invalid: true };
  }
  const failingPositives = positives.filter((p) => !isFullMatch(pattern, p));
  const matchingNegatives = negatives.filter((n) => isFullMatch(pattern, n));
  return {
    ok: failingPositives.length === 0 && matchingNegatives.length === 0,
    failingPositives,
    matchingNegatives,
    invalid: false
  };
}
function literalAlternation(positives) {
  const uniq = Array.from(new Set(positives.filter((p) => p.length > 0)));
  if (uniq.length === 0) return null;
  const parts = uniq.map((p) => Array.from(p).map(escapeLiteral).join(""));
  return parts.length === 1 ? parts[0] : "(?:" + parts.join("|") + ")";
}
function solve(input, opts = {}) {
  const positives = input.positives.filter((p) => p.length > 0);
  const negatives = input.negatives.filter((n) => n.length > 0);
  const maxIterations = Math.max(1, opts.maxIterations ?? 6);
  const hasSeed = input.seed != null && input.seed.trim() !== "";
  if (positives.length === 0) {
    return {
      status: "empty",
      pattern: null,
      strategy: "empty",
      iterations: 0,
      trace: [],
      redos: null
    };
  }
  const proposers = [];
  if (hasSeed) {
    proposers.push({ action: "propose: seed pattern", strategy: "seed", gen: () => input.seed.trim() });
  }
  proposers.push({
    action: hasSeed ? "repair: re-synthesise from examples" : "propose: synthesise from examples",
    strategy: "synthesis",
    gen: () => synthesize({ positives, negatives }).regex
  });
  proposers.push({
    action: "repair: literal alternation of greens",
    strategy: "alternation",
    gen: () => literalAlternation(positives)
  });
  const trace = [];
  const tried = /* @__PURE__ */ new Set();
  let iteration = 0;
  for (const proposer of proposers) {
    if (iteration >= maxIterations) break;
    let pattern;
    try {
      pattern = proposer.gen();
    } catch {
      pattern = null;
    }
    if (pattern == null || pattern === "") continue;
    if (tried.has(pattern)) continue;
    tried.add(pattern);
    iteration++;
    const report = verify(pattern, positives, negatives);
    let note;
    if (report.invalid) note = "candidate is not a valid regular expression";
    else if (report.ok) note = `passes all ${positives.length} green and ${negatives.length} red`;
    else {
      const bits = [];
      if (report.failingPositives.length) bits.push(`${report.failingPositives.length} green not matched`);
      if (report.matchingNegatives.length) bits.push(`${report.matchingNegatives.length} red wrongly matched`);
      note = "fails: " + bits.join(", ");
    }
    trace.push({ iteration, action: proposer.action, pattern, report, note });
    if (report.ok) {
      return {
        status: "solved",
        pattern,
        strategy: proposer.strategy,
        iterations: iteration,
        trace,
        redos: analyzeReDoS(pattern)
      };
    }
  }
  return {
    status: "impossible",
    pattern: null,
    strategy: "none",
    iterations: iteration,
    trace,
    reason: `no pattern consistent with these examples was found in ${iteration} ${iteration === 1 ? "try" : "tries"} (check for a string painted both green and red)`,
    redos: null
  };
}
function isUnbounded(_min, max) {
  return max === null;
}
function containsUnboundedQuant(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "quant" && isUnbounded(node.min, node.max)) return true;
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (containsUnboundedQuant(c)) return true;
    } else if (v && typeof v === "object") {
      if (containsUnboundedQuant(v)) return true;
    }
  }
  return false;
}
function hasNestedUnbounded(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "quant" && isUnbounded(node.min, node.max)) {
    if (containsUnboundedQuant(node.child)) return true;
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (hasNestedUnbounded(c)) return true;
    } else if (v && typeof v === "object") {
      if (hasNestedUnbounded(v)) return true;
    }
  }
  return false;
}
function analyzeReDoS(pattern) {
  try {
    const ast = parse(pattern);
    if (hasNestedUnbounded(ast)) {
      return {
        safe: false,
        reason: "nested unbounded quantifier (e.g. (a+)+) \u2014 vulnerable to catastrophic backtracking"
      };
    }
    return { safe: true, reason: null };
  } catch {
    const grouped = /\(([^()]*[+*][^()]*)\)[+*]|\(([^()]*[+*][^()]*)\)\{\d+,\}/;
    if (grouped.test(pattern)) {
      return {
        safe: false,
        reason: "nested unbounded quantifier (e.g. (a+)+) \u2014 vulnerable to catastrophic backtracking"
      };
    }
    return { safe: true, reason: null };
  }
}
function detectFeatures(pattern) {
  const f = {
    backreference: false,
    lookaround: false,
    namedGroupJs: false,
    nonCapturing: false,
    shorthandClass: false
  };
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      const n = pattern[i + 1];
      if (n && /[1-9]/.test(n) && !inClass) f.backreference = true;
      if (n && /[dDwWsS]/.test(n)) f.shorthandClass = true;
      i++;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    if (inClass) continue;
    if (c === "(" && pattern[i + 1] === "?") {
      const marker = pattern[i + 2];
      if (marker === "=" || marker === "!") f.lookaround = true;
      else if (marker === ":") f.nonCapturing = true;
      else if (marker === "<") {
        const after = pattern[i + 3];
        if (after === "=" || after === "!") f.lookaround = true;
        else f.namedGroupJs = true;
      }
    }
  }
  return f;
}
function analyzeDialects(pattern) {
  const f = detectFeatures(pattern);
  const js = { dialect: "javascript", compatible: true, blockers: [], rewrites: [] };
  const py = { dialect: "python", compatible: true, blockers: [], rewrites: [] };
  if (f.namedGroupJs) py.rewrites.push("named group (?<name>) is rewritten to Python (?P<name>)");
  const go = { dialect: "go", compatible: true, blockers: [], rewrites: [] };
  if (f.backreference) go.blockers.push("Go RE2 has no backreferences (\\1)");
  if (f.lookaround) go.blockers.push("Go RE2 has no lookahead/lookbehind");
  if (f.namedGroupJs) go.rewrites.push("named group (?<name>) is rewritten to RE2 (?P<name>)");
  go.compatible = go.blockers.length === 0;
  const grep = { dialect: "grep", compatible: true, blockers: [], rewrites: [] };
  if (f.backreference) grep.blockers.push("grep -E (POSIX ERE) has no backreferences");
  if (f.lookaround) grep.blockers.push("grep -E (POSIX ERE) has no lookahead/lookbehind");
  if (f.nonCapturing) grep.rewrites.push("(?:...) is rewritten to a plain group (...) \u2014 ERE has no non-capturing groups");
  if (f.shorthandClass)
    grep.rewrites.push("\\d \\w \\s are rewritten to POSIX classes ([0-9] [[:alnum:]_] [[:space:]])");
  grep.compatible = grep.blockers.length === 0;
  return { javascript: js, python: py, go, grep };
}

// export.ts
var CASE_INSENSITIVE = (flags) => flags.includes("i");
var MULTILINE = (flags) => flags.includes("m");
function noteBlock(lines, commentPrefix) {
  if (lines.length === 0) return "";
  return lines.map((l) => `${commentPrefix} ${l}`).join("\n") + "\n";
}
function toJavaScript(pattern, flags) {
  const literal = pattern.replace(/\//g, "\\/");
  const usable = flags.replace(/[^gimsuy]/g, "");
  return [
    `const re = /${literal}/${usable};`,
    ``,
    `// find every match in \`text\``,
    `const matches = [...text.matchAll(re)].map(m => m[0]);`,
    ``,
    `// test a single string`,
    `re.test(someString);`
  ].join("\n");
}
function pyRawString(pattern) {
  const needsFallback = /(?<!\\)"/.test(pattern) || /\\$/.test(pattern);
  if (!needsFallback) return `r"${pattern}"`;
  const escaped = pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
function toPythonSyntax(pattern) {
  return pattern.replace(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g, "(?P<$1>");
}
function toPython(pattern, flags) {
  const py = toPythonSyntax(pattern);
  const rewrites = analyzeDialects(pattern).python.rewrites;
  const flagParts = [];
  if (CASE_INSENSITIVE(flags)) flagParts.push("re.IGNORECASE");
  if (MULTILINE(flags)) flagParts.push("re.MULTILINE");
  const flagArg = flagParts.length ? ", " + flagParts.join(" | ") : "";
  const pat = pyRawString(py);
  return noteBlock(rewrites, "#") + [
    `import re`,
    ``,
    `pattern = re.compile(${pat}${flagArg})`,
    ``,
    `# find every match in \`text\``,
    `matches = pattern.findall(text)`,
    ``,
    `# test a single string (anchored full match)`,
    `bool(pattern.fullmatch(some_string))`
  ].join("\n");
}
function goStringLiteral(pattern) {
  if (!pattern.includes("`")) return "`" + pattern + "`";
  const escaped = pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
function toGoSyntax(pattern) {
  return pattern.replace(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g, "(?P<$1>");
}
function toGo(pattern, flags) {
  const report = analyzeDialects(pattern).go;
  if (!report.compatible) {
    return `// \u26A0 This pattern cannot be expressed in Go's regexp package (RE2):
` + report.blockers.map((b) => `//   - ${b}`).join("\n") + `
// Use the JavaScript or Python target instead, or rewrite the pattern
// without backreferences / lookaround.`;
  }
  const body0 = toGoSyntax(pattern);
  let inline = "";
  if (CASE_INSENSITIVE(flags)) inline += "i";
  if (MULTILINE(flags)) inline += "m";
  const body = inline ? `(?${inline})` + body0 : body0;
  const lit = goStringLiteral(body);
  return noteBlock(report.rewrites, "//") + [
    `package main`,
    ``,
    `import (`,
    `	"fmt"`,
    `	"regexp"`,
    `)`,
    ``,
    `func main() {`,
    `	re := regexp.MustCompile(${lit})`,
    `	matches := re.FindAllString(text, -1)`,
    `	fmt.Println(matches)`,
    `}`
  ].join("\n");
}
function toPosixEre(pattern) {
  const noNonCap = pattern.replace(/\(\?:/g, "(");
  let out = "";
  for (let i = 0; i < noNonCap.length; i++) {
    const c = noNonCap[i];
    if (c === "\\") {
      const n = noNonCap[i + 1];
      const map = {
        d: "[0-9]",
        D: "[^0-9]",
        w: "[[:alnum:]_]",
        W: "[^[:alnum:]_]",
        s: "[[:space:]]",
        S: "[^[:space:]]"
      };
      if (n in map) {
        out += map[n];
        i++;
        continue;
      }
      out += c + (n ?? "");
      i++;
      continue;
    }
    out += c;
  }
  return out;
}
function toGrep(pattern, flags) {
  const report = analyzeDialects(pattern).grep;
  if (!report.compatible) {
    return `# \u26A0 This pattern cannot be expressed in grep -E (POSIX ERE):
` + report.blockers.map((b) => `#   - ${b}`).join("\n") + `
# Use grep -P (PCRE) if available, or the JavaScript / Python target.`;
  }
  const ere = toPosixEre(pattern);
  const single = ere.replace(/'/g, `'\\''`);
  const iflag = CASE_INSENSITIVE(flags) ? " -i" : "";
  return noteBlock(report.rewrites, "#") + `grep -E${iflag} '${single}' file.txt`;
}
function exportPattern(pattern, target, opts) {
  const flags = opts.flags ?? "";
  switch (target) {
    case "javascript":
      return toJavaScript(pattern, flags);
    case "python":
      return toPython(pattern, flags);
    case "go":
      return toGo(pattern, flags);
    case "grep":
      return toGrep(pattern, flags);
  }
}

// highlight.ts
function findMatches(text, pattern, flags = "g") {
  if (!pattern) return [];
  const g = flags.includes("g") ? flags : flags + "g";
  let re;
  try {
    re = new RegExp(pattern, g);
  } catch {
    return [];
  }
  const out = [];
  let m;
  let guard = 0;
  while ((m = re.exec(text)) !== null) {
    if (guard++ > text.length + 1e3) break;
    const start = m.index;
    const end = m.index + m[0].length;
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ start, end, text: m[0] });
  }
  return out;
}
function buildSegments(text, matches, spans) {
  const edges = /* @__PURE__ */ new Set([0, text.length]);
  for (const m of matches) {
    edges.add(m.start);
    edges.add(m.end);
  }
  for (const s of spans) {
    edges.add(s.start);
    edges.add(s.end);
  }
  const cuts = Array.from(edges).filter((e) => e >= 0 && e <= text.length).sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (a === b) continue;
    const mid = a;
    const matched = matches.some((m) => m.start <= mid && mid < m.end);
    const span = spans.find((s) => s.start <= mid && mid < s.end);
    segs.push({ text: text.slice(a, b), matched, example: span?.kind });
  }
  return segs;
}
function spansToExamples(text, spans) {
  const positives = [];
  const negatives = [];
  for (const s of spans) {
    const sub = text.slice(s.start, s.end);
    if (sub.length === 0) continue;
    (s.kind === "pos" ? positives : negatives).push(sub);
  }
  return { positives, negatives };
}
function addSpan(spans, next) {
  if (next.end <= next.start) return spans;
  const kept = spans.filter((s) => s.end <= next.start || s.start >= next.end);
  kept.push(next);
  kept.sort((a, b) => a.start - b.start);
  return kept;
}
function removeSpanAt(spans, offset) {
  return spans.filter((s) => !(s.start <= offset && offset < s.end));
}
function b64encode(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  if (typeof btoa === "function") return btoa(bin);
  return Buffer.from(bin, "binary").toString("base64");
}
function b64decode(s) {
  let bin;
  if (typeof atob === "function") bin = atob(s);
  else bin = Buffer.from(s, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function toUrlSafe(b64) {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromUrlSafe(s) {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return b;
}
function encodeState(state2) {
  const payload = {
    t: state2.text,
    s: state2.spans.map((sp) => [sp.start, sp.end - sp.start, sp.kind === "pos" ? 1 : 0]),
    f: state2.flags,
    ...state2.manualPattern ? { m: state2.manualPattern } : {}
  };
  return toUrlSafe(b64encode(JSON.stringify(payload)));
}
function decodeState(encoded) {
  if (!encoded) return null;
  try {
    const json = b64decode(fromUrlSafe(encoded));
    const p = JSON.parse(json);
    const spans = (p.s ?? []).map((tri) => ({
      start: tri[0],
      end: tri[0] + tri[1],
      kind: tri[2] === 1 ? "pos" : "neg"
    }));
    return {
      text: typeof p.t === "string" ? p.t : "",
      spans,
      flags: typeof p.f === "string" ? p.f : "g",
      manualPattern: typeof p.m === "string" ? p.m : void 0
    };
  } catch {
    return null;
  }
}

// main.ts
var SAMPLE = `Contact us: alice@example.com or bob.jones@mail.co.uk
Order #10231 shipped 2024-03-14, order #9987 shipped 2024-03-02.
Call 555-0142 or 555-9930. Invalid: 55-1, notanemail@, 2024/3/1`;
var $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};
var state = {
  text: SAMPLE,
  spans: [],
  flags: "g",
  manualPattern: void 0
};
var currentTarget = "javascript";
function offsetOf(root, node, off) {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, off);
  return r.toString().length;
}
function currentSelectionSpan(canvas) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!canvas.contains(range.startContainer) || !canvas.contains(range.endContainer)) return null;
  const a = offsetOf(canvas, range.startContainer, range.startOffset);
  const b = offsetOf(canvas, range.endContainer, range.endOffset);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  if (end <= start) return null;
  return { start, end };
}
function derive() {
  const { positives, negatives } = spansToExamples(state.text, state.spans);
  const manual = state.manualPattern != null && state.manualPattern !== "";
  if (manual) {
    return { pattern: state.manualPattern, manual: true, agent: null };
  }
  const agent = solve({ positives, negatives });
  return { pattern: agent.pattern, manual: false, agent };
}
function render() {
  const canvas = $("canvas");
  const { pattern, manual, agent } = derive();
  const { positives, negatives } = spansToExamples(state.text, state.spans);
  const matches = pattern ? findMatches(state.text, pattern, state.flags) : [];
  const segs = buildSegments(state.text, matches, state.spans);
  canvas.innerHTML = "";
  for (const seg of segs) {
    const span = document.createElement("span");
    span.textContent = seg.text;
    const cls = [];
    if (seg.example === "pos") cls.push("ex-pos");
    else if (seg.example === "neg") cls.push("ex-neg");
    if (seg.matched) cls.push("match");
    if (cls.length) span.className = cls.join(" ");
    canvas.appendChild(span);
  }
  const regexInput = $("regex");
  if (!manual) regexInput.value = pattern ?? "";
  $("stat-green").textContent = String(positives.length);
  $("stat-red").textContent = String(negatives.length);
  $("stat-matches").textContent = String(matches.length);
  const strat = $("strategy");
  if (manual) {
    strat.textContent = "strategy: manual";
  } else if (!agent || agent.status === "empty") {
    strat.textContent = "paint some text green to begin";
  } else if (agent.status === "impossible") {
    strat.textContent = "strategy: none found";
  } else {
    strat.textContent = `strategy: ${agent.strategy} \xB7 verified in ${agent.iterations} ${agent.iterations === 1 ? "iteration" : "iterations"}`;
  }
  strat.className = "strategy " + (manual ? "manual" : "");
  renderTrust(pattern, manual, agent, positives, negatives);
  renderAgent(agent, manual, positives, negatives);
  renderReDoS(pattern);
  renderDialects(pattern);
  renderExplanation(pattern);
  renderExport(pattern);
  updateHash();
}
function renderTrust(pattern, manual, agent, positives, negatives) {
  const badge = $("trust");
  if (!manual && agent && agent.status === "impossible") {
    badge.textContent = `\u2717 ${agent.reason}`;
    badge.className = "trust bad";
    return;
  }
  if (!pattern || positives.length === 0 && negatives.length === 0) {
    badge.textContent = "";
    badge.className = "trust";
    return;
  }
  const report = verify(pattern, positives, negatives);
  if (report.invalid) {
    badge.textContent = "\u26A0 not a valid regular expression";
    badge.className = "trust bad";
    return;
  }
  if (report.ok) {
    const suffix = !manual && agent && agent.status === "solved" ? ` (agent verified in ${agent.iterations} ${agent.iterations === 1 ? "iteration" : "iterations"})` : "";
    badge.textContent = `\u2713 matches all ${positives.length} green, rejects all ${negatives.length} red${suffix}`;
    badge.className = "trust ok";
  } else {
    const bits = [];
    if (report.failingPositives.length) bits.push(`misses ${report.failingPositives.length} green`);
    if (report.matchingNegatives.length) bits.push(`wrongly matches ${report.matchingNegatives.length} red`);
    badge.textContent = `\u26A0 pattern violates examples: ${bits.join(", ")}`;
    badge.className = "trust bad";
  }
}
function renderAgent(agent, manual, positives, negatives) {
  const box = $("agent");
  box.innerHTML = "";
  if (manual) {
    const p = state.manualPattern;
    if (positives.length === 0 && negatives.length === 0) return;
    const rep = verify(p, positives, negatives);
    if (rep.ok) return;
    const repaired = solve({ positives, negatives });
    const div = document.createElement("div");
    div.className = "agent-repair";
    if (repaired.status === "solved") {
      div.innerHTML = `Your pattern fails the examples. The agent found one that passes in ${repaired.iterations} ${repaired.iterations === 1 ? "iteration" : "iterations"}: `;
      const btn = document.createElement("button");
      btn.className = "ghost small";
      btn.textContent = `use /${repaired.pattern}/`;
      btn.addEventListener("click", () => {
        state.manualPattern = void 0;
        render();
      });
      div.appendChild(btn);
    } else if (repaired.status === "impossible") {
      div.textContent = `Your pattern fails the examples, and ${repaired.reason}.`;
    }
    box.appendChild(div);
    return;
  }
  if (!agent || agent.status === "empty" || agent.trace.length === 0) return;
  const details = document.createElement("details");
  details.className = "agent-trace";
  if (agent.status === "impossible") details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = agent.status === "solved" ? `agent loop \xB7 ${agent.iterations} ${agent.iterations === 1 ? "iteration" : "iterations"} to a verified pattern` : `agent loop \xB7 ${agent.iterations} ${agent.iterations === 1 ? "try" : "tries"}, no consistent pattern`;
  details.appendChild(summary);
  const ol = document.createElement("ol");
  ol.className = "trace-list";
  for (const step of agent.trace) {
    const li = document.createElement("li");
    const ok = step.report?.ok;
    li.className = ok ? "trace-ok" : "trace-fail";
    const act = document.createElement("span");
    act.className = "trace-act";
    act.textContent = step.action;
    const code = document.createElement("code");
    code.textContent = step.pattern ?? "(none)";
    const note = document.createElement("span");
    note.className = "trace-note";
    note.textContent = (ok ? "\u2713 " : "\u2717 ") + step.note;
    li.appendChild(act);
    li.appendChild(code);
    li.appendChild(note);
    ol.appendChild(li);
  }
  details.appendChild(ol);
  box.appendChild(details);
}
function renderReDoS(pattern) {
  const box = $("redos");
  if (!pattern) {
    box.textContent = "";
    box.className = "redos";
    return;
  }
  const r = analyzeReDoS(pattern);
  if (r.safe) {
    box.textContent = "";
    box.className = "redos";
  } else {
    box.textContent = `\u26A0 ReDoS risk: ${r.reason}`;
    box.className = "redos danger";
  }
}
function renderDialects(pattern) {
  const note = $("dialect-note");
  const tabs = document.querySelectorAll(".tab");
  if (!pattern) {
    note.textContent = "";
    note.className = "dialect-note";
    tabs.forEach((t) => t.classList.remove("incompat"));
    return;
  }
  const reports = analyzeDialects(pattern);
  tabs.forEach((t) => {
    const d = t.dataset.target;
    const rep2 = reports[d];
    t.classList.toggle("incompat", !rep2.compatible);
    t.title = !rep2.compatible ? "not supported here: " + rep2.blockers.join("; ") : rep2.rewrites.length ? "faithful rewrites: " + rep2.rewrites.join("; ") : "";
  });
  const rep = reports[currentTarget];
  if (!rep.compatible) {
    note.textContent = `\u2717 ${labelFor(currentTarget)} can't express this pattern: ${rep.blockers.join("; ")}`;
    note.className = "dialect-note bad";
  } else if (rep.rewrites.length) {
    note.textContent = `\u21BA rewritten for ${labelFor(currentTarget)}: ${rep.rewrites.join("; ")}`;
    note.className = "dialect-note info";
  } else {
    note.textContent = "";
    note.className = "dialect-note";
  }
}
function labelFor(t) {
  return t === "javascript" ? "JavaScript" : t === "python" ? "Python" : t === "go" ? "Go (RE2)" : "grep (ERE)";
}
function renderExplanation(pattern) {
  const list = $("explain-list");
  const summary = $("explain-summary");
  list.innerHTML = "";
  if (!pattern) {
    summary.textContent = "";
    return;
  }
  summary.textContent = explainSummary(pattern);
  for (const tok of explainTokens(pattern)) {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = tok.regex;
    const txt = document.createElement("span");
    txt.textContent = tok.text;
    li.appendChild(code);
    li.appendChild(txt);
    list.appendChild(li);
  }
}
function renderExport(pattern) {
  const out = $("export-code");
  if (!pattern) {
    out.textContent = "";
    return;
  }
  out.textContent = exportPattern(pattern, currentTarget, { flags: state.flags });
}
function updateHash() {
  const enc = encodeState(state);
  history.replaceState(null, "", "#" + enc);
}
function loadFromHash() {
  const h = location.hash.replace(/^#/, "");
  const decoded = decodeState(h);
  if (decoded) state = decoded;
}
function paint(kind) {
  const canvas = $("canvas");
  const sel = currentSelectionSpan(canvas);
  if (!sel) return;
  state.spans = addSpan(state.spans, { start: sel.start, end: sel.end, kind });
  state.manualPattern = void 0;
  window.getSelection()?.removeAllRanges();
  render();
}
function wire() {
  $("btn-green").addEventListener("click", () => paint("pos"));
  $("btn-red").addEventListener("click", () => paint("neg"));
  $("canvas").addEventListener("click", (e) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const canvas = $("canvas");
    const off = offsetOf(canvas, e.target ?? canvas, 0);
    const before = state.spans.length;
    state.spans = removeSpanAt(state.spans, off);
    if (state.spans.length !== before) {
      state.manualPattern = void 0;
      render();
    }
  });
  const textArea = $("source");
  textArea.value = state.text;
  textArea.addEventListener("input", () => {
    state.text = textArea.value;
    state.spans = state.spans.filter((s) => s.end <= state.text.length);
    render();
  });
  const regexInput = $("regex");
  regexInput.addEventListener("input", () => {
    state.manualPattern = regexInput.value;
    render();
  });
  $("btn-resynth").addEventListener("click", () => {
    state.manualPattern = void 0;
    render();
  });
  const flagI = $("flag-i");
  const flagM = $("flag-m");
  const syncFlags = () => {
    let f = "g";
    if (flagI.checked) f += "i";
    if (flagM.checked) f += "m";
    state.flags = f;
    render();
  };
  flagI.addEventListener("change", syncFlags);
  flagM.addEventListener("change", syncFlags);
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentTarget = tab.dataset.target;
      render();
    });
  });
  $("btn-copy-regex").addEventListener("click", () => copy($("regex").value, "btn-copy-regex"));
  $("btn-copy-code").addEventListener("click", () => copy($("export-code").textContent ?? "", "btn-copy-code"));
  $("btn-share").addEventListener("click", () => copy(location.href, "btn-share"));
  $("btn-clear").addEventListener("click", () => {
    state.spans = [];
    state.manualPattern = void 0;
    render();
  });
  $("btn-sample").addEventListener("click", () => {
    state = { text: SAMPLE, spans: [], flags: "g", manualPattern: void 0 };
    $("source").value = state.text;
    $("flag-i").checked = false;
    $("flag-m").checked = false;
    render();
  });
}
function copy(text, btnId) {
  const btn = $(btnId);
  const original = btn.textContent;
  const done = () => {
    btn.textContent = "copied!";
    setTimeout(() => btn.textContent = original, 1200);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
  else done();
}
function boot() {
  loadFromHash();
  wire();
  $("flag-i").checked = state.flags.includes("i");
  $("flag-m").checked = state.flags.includes("m");
  $("source").value = state.text;
  render();
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
