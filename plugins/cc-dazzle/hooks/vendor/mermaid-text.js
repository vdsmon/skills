// node_modules/beautiful-mermaid/src/multiline-utils.ts
function ut(t) {
  return (t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t).replace(/<br\s*\/?>/gi, `
`).replace(/\\n/g, `
`).replace(/<\/?(?:sub|sup|small|mark)\s*>/gi, "").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(?<!\*)\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g, "<i>$1</i>").replace(/~~(.+?)~~/g, "<s>$1</s>");
}

// node_modules/beautiful-mermaid/src/parser.ts
function ze(t) {
  let e = t.split(`
`).map((o) => o.trim()).filter((o) => o.length > 0 && !o.startsWith("%%"));
  if (e.length === 0)
    throw new Error("Empty mermaid diagram");
  let n = e[0];
  return /^stateDiagram(-v2)?\s*$/i.test(n) ? wr(e) : Cr(e);
}
function Cr(t) {
  let e = t[0].match(/^(?:graph|flowchart)\s+(TD|TB|LR|BT|RL)\s*$/i);
  if (!e)
    throw new Error(`Invalid mermaid header: "${t[0]}". Expected "graph TD", "flowchart LR", "stateDiagram-v2", etc.`);
  let o = {
    direction: e[1].toUpperCase(),
    nodes: /* @__PURE__ */ new Map(),
    edges: [],
    subgraphs: [],
    classDefs: /* @__PURE__ */ new Map(),
    classAssignments: /* @__PURE__ */ new Map(),
    nodeStyles: /* @__PURE__ */ new Map(),
    linkStyles: /* @__PURE__ */ new Map()
  }, a = [];
  for (let r = 1; r < t.length; r++) {
    let i = t[r], s = i.match(/^classDef\s+(\w+)\s+(.+)$/);
    if (s) {
      let u = s[1], g = s[2], m = ne(g);
      o.classDefs.set(u, m);
      continue;
    }
    let c = i.match(/^class\s+([\w,-]+)\s+(\w+)$/);
    if (c) {
      let u = c[1].split(",").map((m) => m.trim()), g = c[2];
      for (let m of u)
        o.classAssignments.set(m, g);
      continue;
    }
    let f = i.match(/^style\s+([\w,-]+)\s+(.+)$/);
    if (f) {
      let u = f[1].split(",").map((m) => m.trim()), g = ne(f[2]);
      for (let m of u)
        o.nodeStyles.set(m, { ...o.nodeStyles.get(m), ...g });
      continue;
    }
    let d = i.match(/^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/);
    if (d) {
      let u = d[1].trim(), g = ne(d[2]);
      if (u === "default")
        o.linkStyles.set("default", { ...o.linkStyles.get("default"), ...g });
      else {
        let m = u.split(",").map((x) => parseInt(x.trim(), 10));
        for (let x of m)
          isNaN(x) || o.linkStyles.set(x, { ...o.linkStyles.get(x), ...g });
      }
      continue;
    }
    let h = i.match(/^direction\s+(TD|TB|LR|BT|RL)\s*$/i);
    if (h && a.length > 0) {
      a[a.length - 1].direction = h[1].toUpperCase();
      continue;
    }
    let l = i.match(/^subgraph\s+(.+)$/);
    if (l) {
      let u = l[1].trim(), g = u.match(/^([\w-]+)\s*\[(.+)\]$/), m, x;
      g ? (m = g[1], x = ut(g[2])) : (x = ut(u), m = u.replace(/\s+/g, "_").replace(/[^\w]/g, ""));
      let w = { id: m, label: x, nodeIds: [], children: [] };
      a.push(w);
      continue;
    }
    if (i === "end") {
      let u = a.pop();
      u && (a.length > 0 ? a[a.length - 1].children.push(u) : o.subgraphs.push(u));
      continue;
    }
    Dr(i, o, a);
  }
  return o;
}
function wr(t) {
  let e = {
    direction: "TD",
    nodes: /* @__PURE__ */ new Map(),
    edges: [],
    subgraphs: [],
    classDefs: /* @__PURE__ */ new Map(),
    classAssignments: /* @__PURE__ */ new Map(),
    nodeStyles: /* @__PURE__ */ new Map(),
    linkStyles: /* @__PURE__ */ new Map()
  }, n = [], o = /* @__PURE__ */ new Set(), a = 0, r = 0;
  for (let i = 1; i < t.length; i++) {
    let s = t[i], c = s.match(/^direction\s+(TD|TB|LR|BT|RL)\s*$/i);
    if (c) {
      n.length > 0 ? n[n.length - 1].direction = c[1].toUpperCase() : e.direction = c[1].toUpperCase();
      continue;
    }
    let f = s.match(/^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/);
    if (f) {
      let g = f[1].trim(), m = ne(f[2]);
      if (g === "default")
        e.linkStyles.set("default", { ...e.linkStyles.get("default"), ...m });
      else {
        let x = g.split(",").map((w) => parseInt(w.trim(), 10));
        for (let w of x)
          isNaN(w) || e.linkStyles.set(w, { ...e.linkStyles.get(w), ...m });
      }
      continue;
    }
    let d = s.match(/^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}]+)\s*\{$/u);
    if (d) {
      let g = d[1] ?? d[2], m = d[2], x = { id: m, label: g, nodeIds: [], children: [] };
      n.push(x), o.add(m), e.nodes.delete(m);
      continue;
    }
    if (s === "}") {
      let g = n.pop();
      g && (n.length > 0 ? n[n.length - 1].children.push(g) : e.subgraphs.push(g));
      continue;
    }
    let h = s.match(/^state\s+"([^"]+)"\s+as\s+([\w\p{L}]+)\s*$/u);
    if (h) {
      let g = ut(h[1]), m = h[2];
      Vt(e, n, { id: m, label: g, shape: "rounded" });
      continue;
    }
    let l = s.match(/^(\[\*\]|[\w\p{L}-]+)\s*(-->)\s*(\[\*\]|[\w\p{L}-]+)(?:\s*:\s*(.+))?$/u);
    if (l) {
      let g = l[1], m = l[3], x = l[4]?.trim(), w = x ? ut(x) : void 0;
      g === "[*]" ? (a++, g = `_start${a > 1 ? a : ""}`, Vt(e, n, { id: g, label: "", shape: "state-start" })) : o.has(g) || We(e, n, g), m === "[*]" ? (r++, m = `_end${r > 1 ? r : ""}`, Vt(e, n, { id: m, label: "", shape: "state-end" })) : o.has(m) || We(e, n, m), e.edges.push({
        source: g,
        target: m,
        label: w,
        style: "solid",
        hasArrowStart: !1,
        hasArrowEnd: !0
      });
      continue;
    }
    let u = s.match(/^([\w\p{L}-]+)\s*:\s*(.+)$/u);
    if (u) {
      let g = u[1], m = ut(u[2].trim());
      Vt(e, n, { id: g, label: m, shape: "rounded" });
      continue;
    }
  }
  return e;
}
function Vt(t, e, n) {
  if (!t.nodes.has(n.id) && t.nodes.set(n.id, n), e.length > 0) {
    let a = e[e.length - 1];
    a.nodeIds.includes(n.id) || a.nodeIds.push(n.id);
  }
}
function We(t, e, n) {
  if (!t.nodes.has(n))
    Vt(t, e, { id: n, label: n, shape: "rounded" });
  else if (e.length > 0) {
    let o = e[e.length - 1];
    o.nodeIds.includes(n) || o.nodeIds.push(n);
  }
}
function ne(t) {
  let e = t.replace(/;\s*$/, ""), n = {};
  for (let o of e.split(",")) {
    let a = o.indexOf(":");
    if (a > 0) {
      let r = o.slice(0, a).trim(), i = o.slice(a + 1).trim();
      r && i && (n[r] = i);
    }
  }
  return n;
}
var Mr = /^(<)?(-->|-.->|==>|---|-\.-|===)(?:\|([^|]*)\|)?/, Ar = /^(<)?(--|-\.|==)\s+(.+?)\s+(-->|---|\.\->|-\.\-|==>|===)/, vr = [
  // Triple delimiters (must be first)
  { regex: /^((?:\w|-(?![-.>]))+)\(\(\((.+?)\)\)\)/, shape: "doublecircle" },
  // A(((text)))
  // Double delimiters with mixed brackets
  { regex: /^((?:\w|-(?![-.>]))+)\(\[(.+?)\]\)/, shape: "stadium" },
  // A([text])
  { regex: /^((?:\w|-(?![-.>]))+)\(\((.+?)\)\)/, shape: "circle" },
  // A((text))
  { regex: /^((?:\w|-(?![-.>]))+)\[\[(.+?)\]\]/, shape: "subroutine" },
  // A[[text]]
  { regex: /^((?:\w|-(?![-.>]))+)\[\((.+?)\)\]/, shape: "cylinder" },
  // A[(text)]
  // Trapezoid variants — must come before plain [text]
  { regex: /^((?:\w|-(?![-.>]))+)\[\/(.+?)\\\]/, shape: "trapezoid" },
  // A[/text\]
  { regex: /^((?:\w|-(?![-.>]))+)\[\\(.+?)\/\]/, shape: "trapezoid-alt" },
  // A[\text/]
  // Asymmetric flag shape
  { regex: /^((?:\w|-(?![-.>]))+)>(.+?)\]/, shape: "asymmetric" },
  // A>text]
  // Double curly braces (hexagon) — must come before single {text}
  { regex: /^((?:\w|-(?![-.>]))+)\{\{(.+?)\}\}/, shape: "hexagon" },
  // A{{text}}
  // Single-char delimiters (last — most common, least specific)
  { regex: /^((?:\w|-(?![-.>]))+)\[(.+?)\]/, shape: "rectangle" },
  // A[text]
  { regex: /^((?:\w|-(?![-.>]))+)\((.+?)\)/, shape: "rounded" },
  // A(text)
  { regex: /^((?:\w|-(?![-.>]))+)\{(.+?)\}/, shape: "diamond" }
  // A{text}
], Sr = /^((?:\w|-(?![-.>]))+)/, Rr = /^:::([\w][\w-]*)/;
function Dr(t, e, n) {
  let o = t.trim(), a = _e(o, e, n);
  if (!a || a.ids.length === 0) return;
  o = a.remaining.trim();
  let r = a.ids;
  for (; o.length > 0; ) {
    let i, s, c, f, d = o.match(Mr);
    if (d) {
      i = !!d[1];
      let l = d[2], u = d[3]?.trim();
      f = u ? ut(u) : void 0, o = o.slice(d[0].length).trim(), s = Lr(l), c = l.endsWith(">");
    } else {
      let l = o.match(Ar);
      if (!l) break;
      i = !!l[1];
      let u = l[3].trim();
      f = u ? ut(u) : void 0;
      let g = l[2], m = l[4];
      o = o.slice(l[0].length).trim(), s = Er(g, m), c = m.endsWith(">");
    }
    let h = _e(o, e, n);
    if (!h || h.ids.length === 0) break;
    o = h.remaining.trim();
    for (let l of r)
      for (let u of h.ids)
        e.edges.push({
          source: l,
          target: u,
          label: f,
          style: s,
          hasArrowStart: i,
          hasArrowEnd: c
        });
    r = h.ids;
  }
}
function _e(t, e, n) {
  let o = je(t, e, n);
  if (!o) return null;
  let a = [o.id], r = o.remaining.trim();
  for (; r.startsWith("&"); ) {
    r = r.slice(1).trim();
    let i = je(r, e, n);
    if (!i) break;
    a.push(i.id), r = i.remaining.trim();
  }
  return { ids: a, remaining: r };
}
function je(t, e, n) {
  let o = null, a = t;
  for (let { regex: i, shape: s } of vr) {
    let c = t.match(i);
    if (c) {
      o = c[1];
      let f = ut(c[2]);
      Oe(e, n, { id: o, label: f, shape: s }), a = t.slice(c[0].length);
      break;
    }
  }
  if (o === null) {
    let i = t.match(Sr);
    i && (o = i[1], e.nodes.has(o) || Oe(e, n, { id: o, label: o, shape: "rectangle" }), a = t.slice(i[0].length));
  }
  if (o === null) return null;
  let r = a.match(Rr);
  return r && (e.classAssignments.set(o, r[1]), a = a.slice(r[0].length)), { id: o, remaining: a };
}
function Oe(t, e, n) {
  !t.nodes.has(n.id) && t.nodes.set(n.id, n), Tr(e, n.id);
}
function Tr(t, e) {
  if (t.length > 0) {
    let n = t[t.length - 1];
    n.nodeIds.includes(e) || n.nodeIds.push(e);
  }
}
function Lr(t) {
  return t === "-.->" || t === "-.-" ? "dotted" : t === "==>" || t === "===" ? "thick" : "solid";
}
function Er(t, e) {
  return t === "-." || e === ".->" || e === "-.-" ? "dotted" : t === "==" || e === "==>" || e === "===" ? "thick" : "solid";
}

// node_modules/beautiful-mermaid/src/ascii/types.ts
var O = { x: 1, y: 0 }, H = { x: 1, y: 2 }, z = { x: 0, y: 1 }, W = { x: 2, y: 1 }, At = { x: 2, y: 0 }, wt = { x: 0, y: 0 }, Dt = { x: 2, y: 2 }, vt = { x: 0, y: 2 }, $t = { x: 1, y: 1 };
function ge(t, e) {
  return t.x === e.x && t.y === e.y;
}
function re(t, e) {
  return t.x === e.x && t.y === e.y;
}
function Kt(t, e) {
  return { x: t.x + e.x, y: t.y + e.y };
}
function Bt(t) {
  return `${t.x},${t.y}`;
}
var Fe = { name: "", styles: {} };

// node_modules/beautiful-mermaid/src/ascii/ansi.ts
var ie = {
  fg: "#27272a",
  // zinc-800 — primary text
  border: "#a1a1aa",
  // zinc-400 — node borders (12% mix)
  line: "#71717a",
  // zinc-500 — edge lines (35% mix)
  arrow: "#52525b",
  // zinc-600 — arrowheads (60% mix)
  corner: "#71717a",
  // same as line
  junction: "#a1a1aa"
  // same as border
};
function Je() {
  let t = globalThis.process;
  if (t) {
    if (!t.stdout?.isTTY)
      return "none";
    let e = t.env?.COLORTERM?.toLowerCase() ?? "", n = t.env?.TERM?.toLowerCase() ?? "";
    return e === "truecolor" || e === "24bit" ? "truecolor" : n.includes("256color") || n.includes("256") ? "ansi256" : n && n !== "dumb" ? "ansi16" : "none";
  }
  return typeof document < "u" ? "html" : "none";
}
function xe(t) {
  let e = t.replace("#", "");
  return e.length === 3 ? {
    r: parseInt(e[0] + e[0], 16),
    g: parseInt(e[1] + e[1], 16),
    b: parseInt(e[2] + e[2], 16)
  } : {
    r: parseInt(e.substring(0, 2), 16),
    g: parseInt(e.substring(2, 4), 16),
    b: parseInt(e.substring(4, 6), 16)
  };
}
var se = "\x1B[", oe = `${se}0m`;
function Ue(t) {
  let { r: e, g: n, b: o } = xe(t);
  return `${se}38;2;${e};${n};${o}m`;
}
function Gr(t, e, n) {
  let o = (t + e + n) / 3;
  if (Math.max(Math.abs(t - o), Math.abs(e - o), Math.abs(n - o)) < 10) {
    let f = Math.round(o / 255 * 23);
    return 232 + Math.min(23, Math.max(0, f));
  }
  let r = (f) => f < 48 ? 0 : f < 115 ? 1 : Math.min(5, Math.floor((f - 35) / 40)), i = r(t), s = r(e), c = r(n);
  return 16 + 36 * i + 6 * s + c;
}
function qe(t) {
  let { r: e, g: n, b: o } = xe(t), a = Gr(e, n, o);
  return `${se}38;5;${a}m`;
}
function Ve(t) {
  let { r: e, g: n, b: o } = xe(t), a = 0.299 * e + 0.587 * n + 0.114 * o, r = a > 100 ? 0 : 60, i;
  return e > 180 && n < 100 && o < 100 ? i = 31 : n > 180 && e < 100 && o < 100 ? i = 32 : e > 150 && n > 150 && o < 100 ? i = 33 : o > 180 && e < 100 && n < 100 ? i = 34 : e > 150 && o > 150 && n < 100 ? i = 35 : n > 150 && o > 150 && e < 100 ? i = 36 : a > 200 ? i = 37 : a < 50 ? i = 30 : i = 37, `${se}${i + r}m`;
}
function Ke(t) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function Qe(t, e) {
  return `<span style="color:${t}">${Ke(e)}</span>`;
}
function Ze(t, e) {
  switch (t) {
    case "text":
      return e.fg;
    case "border":
      return e.border;
    case "line":
      return e.line;
    case "arrow":
      return e.arrow;
    case "corner":
      return e.corner ?? e.line;
    case "junction":
      return e.junction ?? e.border;
    default:
      return e.fg;
  }
}
function pe(t, e, n) {
  if (n === "none") return "";
  let o = Ze(t, e);
  switch (n) {
    case "truecolor":
      return Ue(o);
    case "ansi256":
      return qe(o);
    case "ansi16":
      return Ve(o);
    default:
      return "";
  }
}
function tn(t, e, n, o) {
  if (o === "none")
    return t.join("");
  if (o === "html")
    return kr(t, e, n);
  let a = "", r = null, i = "";
  for (let s = 0; s < t.length; s++) {
    let c = t[s], f = e[s] ?? null;
    if (c === " ") {
      i.length > 0 && (r !== null ? a += pe(r, n, o) + i + oe : a += i, i = "", r = null), a += c;
      continue;
    }
    if (f === r) {
      i += c;
      continue;
    }
    i.length > 0 && (r !== null ? a += pe(r, n, o) + i + oe : a += i), i = c, r = f;
  }
  return i.length > 0 && r !== null ? a += pe(r, n, o) + i + oe : i.length > 0 && (a += i), a;
}
function kr(t, e, n) {
  let o = "", a = null, r = "", i = () => {
    r.length !== 0 && (a !== null ? o += Qe(Ze(a, n), r) : o += Ke(r), r = "", a = null);
  };
  for (let s = 0; s < t.length; s++) {
    let c = t[s], f = e[s] ?? null;
    if (c === " ") {
      i(), o += " ";
      continue;
    }
    if (f === a) {
      r += c;
      continue;
    }
    i(), r = c, a = f;
  }
  return i(), o;
}
function ae(t, e, n) {
  if (n === "none" || t.length === 0) return t;
  if (n === "html") return Qe(e, t);
  let o;
  switch (n) {
    case "truecolor":
      o = Ue(e);
      break;
    case "ansi256":
      o = qe(e);
      break;
    case "ansi16":
      o = Ve(e);
      break;
    default:
      return t;
  }
  return `${o}${t}${oe}`;
}

// node_modules/beautiful-mermaid/src/ascii/canvas.ts
function ct(t, e) {
  let n = [];
  for (let o = 0; o <= t; o++) {
    let a = [];
    for (let r = 0; r <= e; r++)
      a.push(" ");
    n.push(a);
  }
  return n;
}
function ht(t) {
  let [e, n] = Qt(t);
  return ct(e, n);
}
function Ht(t, e) {
  let n = [];
  for (let o = 0; o <= t; o++) {
    let a = [];
    for (let r = 0; r <= e; r++)
      a.push(null);
    n.push(a);
  }
  return n;
}
function Yt(t, e, n) {
  let o = t.length - 1, a = (t[0]?.length ?? 1) - 1, r = Math.max(e, o), i = Math.max(n, a), s = Ht(r, i);
  for (let c = 0; c < s.length; c++)
    for (let f = 0; f < s[0].length; f++)
      c < t.length && f < t[0].length && (s[c][f] = t[c][f]);
  return t.length = 0, t.push(...s), t;
}
function Lt(t, e, n, o) {
  (e >= t.length || n >= (t[0]?.length ?? 0)) && Yt(t, e, n), t[e][n] = o;
}
function Qt(t) {
  return [t.length - 1, (t[0]?.length ?? 1) - 1];
}
function Et(t, e, n) {
  let [o, a] = Qt(t), r = Math.max(e, o), i = Math.max(n, a), s = ct(r, i);
  for (let c = 0; c < s.length; c++)
    for (let f = 0; f < s[0].length; f++)
      c < t.length && f < t[0].length && (s[c][f] = t[c][f]);
  return t.length = 0, t.push(...s), t;
}
var Ir = /* @__PURE__ */ new Set([
  "\u2500",
  "\u2502",
  "\u250C",
  "\u2510",
  "\u2514",
  "\u2518",
  "\u251C",
  "\u2524",
  "\u252C",
  "\u2534",
  "\u253C",
  "\u2574",
  "\u2575",
  "\u2576",
  "\u2577"
]);
function nn(t, e) {
  for (let n = 0; n < (e[0]?.length ?? 0); n++) {
    let o = e.map((a, r) => a[n] !== " " ? r : -1).filter((a) => a >= 0);
    if (o.length !== 0)
      for (let a = o[0]; a <= o[o.length - 1]; a++)
        e[a][n] === " " && !be(t[a][n]) && (t[a][n] = " ");
  }
}
function en(t) {
  return Ir.has(t);
}
function be(t) {
  return /^[a-zA-Z0-9]$/.test(t);
}
var Nr = {
  "\u2500": { "\u2502": "\u253C", "\u250C": "\u252C", "\u2510": "\u252C", "\u2514": "\u2534", "\u2518": "\u2534", "\u251C": "\u253C", "\u2524": "\u253C", "\u252C": "\u252C", "\u2534": "\u2534" },
  "\u2502": { "\u2500": "\u253C", "\u250C": "\u251C", "\u2510": "\u2524", "\u2514": "\u251C", "\u2518": "\u2524", "\u251C": "\u251C", "\u2524": "\u2524", "\u252C": "\u253C", "\u2534": "\u253C" },
  "\u250C": { "\u2500": "\u252C", "\u2502": "\u251C", "\u2510": "\u252C", "\u2514": "\u251C", "\u2518": "\u253C", "\u251C": "\u251C", "\u2524": "\u253C", "\u252C": "\u252C", "\u2534": "\u253C" },
  "\u2510": { "\u2500": "\u252C", "\u2502": "\u2524", "\u250C": "\u252C", "\u2514": "\u253C", "\u2518": "\u2524", "\u251C": "\u253C", "\u2524": "\u2524", "\u252C": "\u252C", "\u2534": "\u253C" },
  "\u2514": { "\u2500": "\u2534", "\u2502": "\u251C", "\u250C": "\u251C", "\u2510": "\u253C", "\u2518": "\u2534", "\u251C": "\u251C", "\u2524": "\u253C", "\u252C": "\u253C", "\u2534": "\u2534" },
  "\u2518": { "\u2500": "\u2534", "\u2502": "\u2524", "\u250C": "\u253C", "\u2510": "\u2524", "\u2514": "\u2534", "\u251C": "\u253C", "\u2524": "\u2524", "\u252C": "\u253C", "\u2534": "\u2534" },
  "\u251C": { "\u2500": "\u253C", "\u2502": "\u251C", "\u250C": "\u251C", "\u2510": "\u253C", "\u2514": "\u251C", "\u2518": "\u253C", "\u2524": "\u253C", "\u252C": "\u253C", "\u2534": "\u253C" },
  "\u2524": { "\u2500": "\u253C", "\u2502": "\u2524", "\u250C": "\u253C", "\u2510": "\u2524", "\u2514": "\u253C", "\u2518": "\u2524", "\u251C": "\u253C", "\u252C": "\u253C", "\u2534": "\u253C" },
  "\u252C": { "\u2500": "\u252C", "\u2502": "\u253C", "\u250C": "\u252C", "\u2510": "\u252C", "\u2514": "\u253C", "\u2518": "\u253C", "\u251C": "\u253C", "\u2524": "\u253C", "\u2534": "\u253C" },
  "\u2534": { "\u2500": "\u2534", "\u2502": "\u253C", "\u250C": "\u253C", "\u2510": "\u253C", "\u2514": "\u2534", "\u2518": "\u2534", "\u251C": "\u253C", "\u2524": "\u253C", "\u252C": "\u253C" }
};
function $r(t, e) {
  return Nr[t]?.[e] ?? t;
}
function Gt(t, e, n, ...o) {
  let [a, r] = Qt(t);
  for (let s of o) {
    let [c, f] = Qt(s);
    a = Math.max(a, c + e.x), r = Math.max(r, f + e.y);
  }
  let i = ct(a, r);
  for (let s = 0; s <= a; s++)
    for (let c = 0; c <= r; c++)
      s < t.length && c < t[0].length && (i[s][c] = t[s][c]);
  for (let s of o)
    for (let c = 0; c < s.length; c++)
      for (let f = 0; f < s[0].length; f++) {
        let d = s[c][f];
        if (d !== " ") {
          let h = c + e.x, l = f + e.y, u = i[h][l];
          !n && en(d) && en(u) ? i[h][l] = $r(u, d) : be(u) && be(d) || (i[h][l] = d);
        }
      }
  return i;
}
function _t(t, e) {
  let [n, o] = Qt(t), a = [], r = e?.roleCanvas, i = e?.colorMode ?? "none", s = e?.theme ?? ie;
  for (let c = 0; c <= o; c++)
    if (i === "none" || !r) {
      let f = "";
      for (let d = 0; d <= n; d++)
        f += t[d][c];
      a.push(f);
    } else {
      let f = [], d = [];
      for (let h = 0; h <= n; h++)
        f.push(t[h][c]), d.push(r[h]?.[c] ?? null);
      a.push(tn(f, d, s, i));
    }
  return a.join(`
`);
}
var Br = {
  // Unicode arrows
  "\u25B2": "\u25BC",
  "\u25BC": "\u25B2",
  "\u25E4": "\u25E3",
  "\u25E3": "\u25E4",
  "\u25E5": "\u25E2",
  "\u25E2": "\u25E5",
  // ASCII arrows
  "^": "v",
  v: "^",
  // Unicode corners
  "\u250C": "\u2514",
  "\u2514": "\u250C",
  "\u2510": "\u2518",
  "\u2518": "\u2510",
  // Unicode junctions (T-pieces flip vertically)
  "\u252C": "\u2534",
  "\u2534": "\u252C",
  // Box-start junctions (exit points from node boxes)
  "\u2575": "\u2577",
  "\u2577": "\u2575"
};
function rn(t) {
  for (let e of t)
    e.reverse();
  for (let e of t)
    for (let n = 0; n < e.length; n++) {
      let o = Br[e[n]];
      o && (e[n] = o);
    }
  return t;
}
function on(t) {
  for (let e of t)
    e.reverse();
  return t;
}
function ye(t, e, n, o = !1) {
  Et(t, e.x + n.length, e.y);
  for (let a = 0; a < n.length; a++) {
    let r = e.x + a, i = t[r][e.y];
    (o || i === " ") && (t[r][e.y] = n[a]);
  }
}
function sn(t, e, n) {
  let o = 0, a = 0;
  for (let r of e.values()) o += r;
  for (let r of n.values()) a += r;
  Et(t, o - 1, a - 1);
}
function an(t, e, n) {
  let o = 0, a = 0;
  for (let r of e.values()) o += r;
  for (let r of n.values()) a += r;
  Yt(t, o - 1, a - 1);
}

// node_modules/beautiful-mermaid/src/ascii/converter.ts
function cn(t, e) {
  let n = /* @__PURE__ */ new Map(), o = 0;
  for (let [s, c] of t.nodes) {
    let f = {
      // Use the parser ID as the unique identity key to avoid collisions
      // when multiple nodes share the same label (e.g. A[Web Server], C[Web Server]).
      name: s,
      // The label is used for rendering inside the box.
      displayLabel: c.label,
      // Preserve shape from parser for shape-aware rendering
      shape: c.shape,
      index: o,
      gridCoord: null,
      drawingCoord: null,
      drawing: null,
      drawn: !1,
      styleClassName: "",
      styleClass: Fe
    };
    n.set(s, f), o++;
  }
  let a = [...n.values()], r = [];
  for (let s of t.edges) {
    let c = n.get(s.source), f = n.get(s.target);
    !c || !f || r.push({
      from: c,
      to: f,
      text: s.label ?? "",
      path: [],
      labelLine: [],
      startDir: { x: 0, y: 0 },
      endDir: { x: 0, y: 0 },
      style: s.style,
      hasArrowStart: s.hasArrowStart,
      hasArrowEnd: s.hasArrowEnd
    });
  }
  let i = [];
  for (let s of t.subgraphs)
    ln(s, null, n, i);
  Yr(t.subgraphs, i, n, t);
  for (let [s, c] of t.classAssignments) {
    let f = n.get(s), d = t.classDefs.get(c);
    f && d && (f.styleClassName = c, f.styleClass = { name: c, styles: d });
  }
  return {
    nodes: a,
    edges: r,
    canvas: ct(0, 0),
    roleCanvas: Ht(0, 0),
    grid: /* @__PURE__ */ new Map(),
    columnWidth: /* @__PURE__ */ new Map(),
    rowHeight: /* @__PURE__ */ new Map(),
    subgraphs: i,
    config: e,
    offsetX: 0,
    offsetY: 0,
    bundles: []
    // Populated by analyzeEdgeBundles() during layout
  };
}
function ln(t, e, n, o) {
  let a;
  t.direction && (a = t.direction === "LR" || t.direction === "RL" ? "LR" : "TD");
  let r = {
    name: t.label,
    nodes: [],
    parent: e,
    children: [],
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    direction: a
  };
  for (let i of t.nodeIds) {
    let s = n.get(i);
    s && r.nodes.push(s);
  }
  o.push(r);
  for (let i of t.children) {
    let s = ln(i, r, n, o);
    r.children.push(s);
    for (let c of s.nodes)
      r.nodes.includes(c) || r.nodes.push(c);
  }
  return r;
}
function Yr(t, e, n, o) {
  let a = /* @__PURE__ */ new Map();
  Pr(t, e, a);
  let r = /* @__PURE__ */ new Map();
  function i(s) {
    let c = a.get(s);
    if (c) {
      for (let f of s.children)
        i(f);
      for (let f of s.nodeIds)
        r.has(f) || r.set(f, c);
    }
  }
  for (let s of t)
    i(s);
  for (let s of e)
    s.nodes = s.nodes.filter((c) => {
      let f;
      for (let [h, l] of n)
        if (l === c) {
          f = h;
          break;
        }
      if (!f) return !1;
      let d = r.get(f);
      return d ? Xr(s, d) : !0;
    });
}
function Xr(t, e) {
  let n = e;
  for (; n !== null; ) {
    if (n === t) return !0;
    n = n.parent;
  }
  return !1;
}
function Pr(t, e, n) {
  let o = [];
  function a(r) {
    for (let i of r)
      o.push(i), a(i.children);
  }
  a(t);
  for (let r = 0; r < o.length && r < e.length; r++)
    n.set(o[r], e[r]);
}

// node_modules/beautiful-mermaid/src/ascii/pathfinder.ts
var Ce = class {
  items = [];
  size() {
    return this.items.length;
  }
  push(e) {
    this.items.push(e), this.bubbleUp(this.items.length - 1);
  }
  pop() {
    if (this.items.length === 0) return;
    let e = this.items[0], n = this.items.pop();
    return this.items.length > 0 && (this.items[0] = n, this.sinkDown(0)), e;
  }
  bubbleUp(e) {
    for (; e > 0; ) {
      let n = e - 1 >> 1;
      if (this.items[e].priority < this.items[n].priority)
        [this.items[e], this.items[n]] = [this.items[n], this.items[e]], e = n;
      else
        break;
    }
  }
  sinkDown(e) {
    let n = this.items.length;
    for (; ; ) {
      let o = e, a = 2 * e + 1, r = 2 * e + 2;
      if (a < n && this.items[a].priority < this.items[o].priority && (o = a), r < n && this.items[r].priority < this.items[o].priority && (o = r), o !== e)
        [this.items[e], this.items[o]] = [this.items[o], this.items[e]], e = o;
      else
        break;
    }
  }
};
function Hr(t, e) {
  let n = Math.abs(t.x - e.x), o = Math.abs(t.y - e.y);
  return n === 0 || o === 0 ? n + o : n + o + 1;
}
var Wr = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];
function _r(t, e) {
  return e.x < 0 || e.y < 0 ? !1 : !t.has(Bt(e));
}
function jt(t, e, n) {
  let o = new Ce();
  o.push({ coord: e, priority: 0 });
  let a = /* @__PURE__ */ new Map();
  a.set(Bt(e), 0);
  let r = /* @__PURE__ */ new Map();
  r.set(Bt(e), null);
  let i = 0;
  for (; o.size() > 0; ) {
    if (++i > 5e4) throw new Error("mermaid edge routing gave up");
    let s = o.pop().coord;
    if (ge(s, n)) {
      let f = [], d = s;
      for (; d !== null; )
        f.unshift(d), d = r.get(Bt(d)) ?? null;
      return f;
    }
    let c = a.get(Bt(s));
    for (let f of Wr) {
      let d = { x: s.x + f.x, y: s.y + f.y };
      if (!_r(t, d) && !ge(d, n))
        continue;
      let h = c + 1, l = Bt(d), u = a.get(l);
      if (u === void 0 || h < u) {
        a.set(l, h);
        let g = h + Hr(d, n);
        o.push({ coord: d, priority: g }), r.set(l, s);
      }
    }
  }
  return null;
}
function Xt(t) {
  if (t.length <= 2) return t;
  let e = /* @__PURE__ */ new Set(), n = t[0], o = t[1];
  for (let a = 2; a < t.length; a++) {
    let r = t[a], i = o.x - n.x, s = o.y - n.y, c = r.x - o.x, f = r.y - o.y;
    i === c && s === f && e.add(a - 1), n = o, o = r;
  }
  return t.filter((a, r) => !e.has(r));
}

// node_modules/beautiful-mermaid/src/ascii/edge-routing.ts
function ce(t) {
  return t === O ? H : t === H ? O : t === z ? W : t === W ? z : t === At ? vt : t === wt ? Dt : t === Dt ? wt : t === vt ? At : $t;
}
function b(t, e) {
  return t.x === e.x && t.y === e.y;
}
function xt(t, e) {
  return t.x === e.x ? t.y < e.y ? H : O : t.y === e.y ? t.x < e.x ? W : z : t.x < e.x ? t.y < e.y ? Dt : At : t.y < e.y ? vt : wt;
}
function jr(t) {
  return t === "LR" ? [W, H, H, W] : [H, W, W, H];
}
function Or(t, e) {
  if (t.from === t.to) return jr(e);
  let n = xt(t.from.gridCoord, t.to.gridCoord), o, a, r, i, s = e === "LR" ? b(n, z) || b(n, wt) || b(n, vt) : b(n, O) || b(n, wt) || b(n, At);
  return b(n, Dt) ? e === "LR" ? (o = H, a = z, r = W, i = O) : (o = W, a = O, r = H, i = z) : b(n, At) ? e === "LR" ? (o = O, a = z, r = W, i = H) : (o = W, a = H, r = O, i = z) : b(n, vt) ? e === "LR" ? (o = H, a = H, r = z, i = O) : (o = z, a = O, r = H, i = W) : b(n, wt) ? e === "LR" ? (o = H, a = H, r = z, i = H) : (o = W, a = W, r = O, i = W) : s ? e === "LR" && b(n, z) ? (o = H, a = H, r = z, i = W) : e === "TD" && b(n, O) ? (o = W, a = W, r = O, i = H) : (o = n, a = ce(n), r = n, i = ce(n)) : (o = n, a = ce(n), r = n, i = ce(n)), [o, a, r, i];
}
function fn(t, e) {
  let n = mt(t, e.from), o = mt(t, e.to), a = n && n === o && n.direction ? n.direction : t.config.graphDirection, [r, i, s, c] = Or(e, a), f = Kt(e.from.gridCoord, r), d = Kt(e.to.gridCoord, i), h = jt(t.grid, f, d), l = Kt(e.from.gridCoord, s), u = Kt(e.to.gridCoord, c), g = jt(t.grid, l, u);
  if (h !== null && g !== null) {
    h = Xt(h), g = Xt(g), h.length <= g.length ? (e.startDir = r, e.endDir = i, e.path = h) : (e.startDir = s, e.endDir = c, e.path = g);
    return;
  }
  if (h !== null) {
    e.startDir = r, e.endDir = i, e.path = Xt(h);
    return;
  }
  if (g !== null) {
    e.startDir = s, e.endDir = c, e.path = Xt(g);
    return;
  }
  e.startDir = r, e.endDir = i, e.path = [f, d];
}
function we(t, e) {
  if (e.text.length === 0) return;
  let n = e.text.length, o = e.path.length, a = t.config.graphDirection === "TD", r = [];
  for (let l = 1; l < o; l++) {
    let u = e.path[l - 1], g = e.path[l], m = [u, g], x = zr(t, m), w = u.x === g.x;
    r.push({ line: m, width: x, index: l, isVertical: w });
  }
  let i = r.filter((l) => l.width >= n && l.index > 1), s;
  if (i.length > 0)
    i.sort((l, u) => u.index - l.index), s = i[0].line;
  else {
    let l = r.filter((u) => u.width >= n);
    l.length > 0 ? (l.sort((u, g) => g.index - u.index), s = l[0].line) : (r.sort((u, g) => g.width - u.width), s = r[0]?.line ?? [e.path[0], e.path[1]]);
  }
  let c = Math.min(s[0].x, s[1].x), f = Math.max(s[0].x, s[1].x), d = c + Math.floor((f - c) / 2), h = t.columnWidth.get(d) ?? 0;
  t.columnWidth.set(d, Math.max(h, n + 2)), e.labelLine = [s[0], s[1]];
}
function zr(t, e) {
  let n = 0, o = Math.min(e[0].x, e[1].x), a = Math.max(e[0].x, e[1].x);
  for (let r = o; r <= a; r++)
    n += t.columnWidth.get(r) ?? 0;
  return n;
}

// back-edges.ts
var Me = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }], Ae = [O, W, H, z], [ve, Se, Re, De] = [0, 1, 2, 3], Fr = 15, dn = 16, pn = 32, Jr = 2, Ur = 2, un = 4, qr = 2e5, Vr = 2, Pt = (t) => (t + 2) % 4, Ot = (t, e) => ({ x: t.x + Me[e].x, y: t.y + Me[e].y }), Kr = (t, e) => t.x === e.x && t.y === e.y, kt = (t, e) => Me.findIndex((n) => n.x === e.x - t.x && n.y === e.y - t.y), le = (t, e) => Ot({ x: t.gridCoord.x + 1, y: t.gridCoord.y + 1 }, e), Le = (t, e) => {
  let n = mt(t, e.from);
  return n?.direction && n === mt(t, e.to) ? n.direction : t.config.graphDirection;
};
function zt(t, e) {
  let n = e.from.gridCoord, o = e.to.gridCoord;
  return !n || !o ? !1 : e.from === e.to || (Le(t, e) === "LR" ? o.x < n.x : o.y < n.y);
}
var Qr = (t) => {
  let e = t.slice(0, 1);
  for (let n of t.slice(1)) {
    let o = e[e.length - 1];
    for (; o.x !== n.x; ) e.push(o = { x: o.x + Math.sign(n.x - o.x), y: o.y });
    for (; o.y !== n.y; ) e.push(o = { x: o.x, y: o.y + Math.sign(n.y - o.y) });
  }
  return e;
}, Zr = (t) => t.filter((e, n) => n === 0 || n === t.length - 1 || kt(t[n - 1], e) !== kt(e, t[n + 1])), Zt = 2, It = (t, e) => (e.x - t.x) * t.height + (e.y - t.y), to = ({ reach: t }, e) => e.x >= t.left && e.x <= t.right && e.y >= t.top && e.y <= t.bottom, hn = (t, e) => ({
  left: Math.min(e?.left ?? 1 / 0, ...t.map((n) => n.x - Zt)),
  top: Math.min(e?.top ?? 1 / 0, ...t.map((n) => n.y - Zt)),
  right: Math.max(e?.right ?? -1 / 0, ...t.map((n) => n.x + Zt)),
  bottom: Math.max(e?.bottom ?? -1 / 0, ...t.map((n) => n.y + Zt))
}), fe = (t, e, n) => n === Se || n === Re ? It(t, e) * 2 + n - 1 : fe(t, Ot(e, n), Pt(n)), xn = (t, e) => `out:${e.x},${e.y}:${t.style}:${t.hasArrowStart}`, Te = (t, e) => `in:${e.x},${e.y}:${t.style}:${t.hasArrowEnd}`, mn = (t, e, n) => {
  let o = (s, c) => t.cells[It(t, s)] = t.cells[It(t, s)] | c, a = e.map((s, c) => c > 0 && c < e.length - 1 && kt(e[c - 1], s) !== kt(s, e[c + 1])), r = a.indexOf(!0), i = a.lastIndexOf(!0);
  for (let s = 0; s + 1 < e.length; s++) {
    let c = kt(e[s], e[s + 1]);
    if (c < 0) continue;
    o(e[s], 1 << c), o(e[s + 1], 1 << Pt(c)), s === 0 && o(e[1], dn), s === e.length - 2 && o(e[s], dn);
    let f = n ? s >= i ? Te(n, e[e.length - 1]) : s < r ? xn(n, e[0]) : "" : "", d = fe(t, e[s], c), h = t.links.get(d);
    t.links.set(d, { edges: (h?.edges ?? 0) + 1, shared: h?.shared ?? f });
  }
}, eo = (t, e) => Le(t, e) === "LR" ? ve : De, gn = (t, e, n, o, a, r) => {
  let i = (N) => to(e, N) && !(e.cells[It(e, N)] & pn), s = (N, k) => e.links.get(fe(e, N, k))?.shared, c = eo(t, n), f = a.map((N) => ({ side: N, end: le(n.to, N), last: Ot(le(n.to, N), N) })).filter((N) => i(N.last) && [void 0, Te(n, N.end)].includes(s(N.end, N.side)));
  if (f.length === 0) return null;
  let d = f.map((N) => Te(n, N.end)), h = new Set([n.from, n.to].flatMap((N) => Ae.map((k, Z) => It(e, Ot(le(N, Z), Z))))), l = (N, k, Z) => {
    let G = s(N, Pt(k)), P = s(N, Z);
    return G?.startsWith("in:") && (Z !== k || P !== G) ? !1 : P === void 0 ? !0 : P.startsWith("out:") ? Z === k && G === P : d.includes(P);
  }, u = (N, k, Z) => {
    if (!l(N, k, Z)) return -1;
    let G = e.cells[It(e, N)], P = k === Z ? 0 : Jr;
    return G === 0 || G & (1 << Pt(k) | 1 << Z) ? P : P === 0 && G === (1 << (k + 1) % 4 | 1 << (k + 3) % 4) ? Ur : -1;
  }, g = (N) => ({ x: e.x + Math.floor(N / 4 / e.height), y: e.y + Math.floor(N / 4) % e.height }), m = (N) => Math.min(...f.map((k) => Math.abs(N.x - k.last.x) + Math.abs(N.y - k.last.y))), x = new Int32Array(e.cells.length * 4).fill(-1), w = new Int32Array(x.length).fill(-1), B = [], v = (N, k, Z, G) => {
    let P = It(e, N) * 4 + k;
    x[P] !== -1 && x[P] <= Z || (x[P] = Z, w[P] = G, (B[Z + m(N)] ??= []).push(P, Z));
  };
  for (let N of o) {
    let k = le(n.from, N);
    i(Ot(k, N)) && [void 0, xn(n, k)].includes(s(k, N)) && v(Ot(k, N), N, 1 + (N === c ? un : 0), -1);
  }
  let Y;
  for (let N = 0; N < B.length && N < (Y?.cost ?? 1 / 0); N++) {
    let k = B[N];
    for (let Z = 0; k && Z < k.length; Z += 2) {
      let G = k[Z], P = k[Z + 1];
      if (x[G] !== P) continue;
      if (++r.steps > qr) throw new Error("mermaid edge routing gave up");
      let C = g(G), U = G % 4;
      for (let F of f) {
        if (!Kr(C, F.last) || U !== Pt(F.side)) continue;
        let V = u(C, U, U), ot = P + 1 + V + (F.side === c ? un : 0);
        V >= 0 && (!Y || ot < Y.cost) && (Y = { cost: ot, state: G, end: F.end });
      }
      for (let F = 0; F < 4; F++) {
        if (F === Pt(U) || F !== U && h.has(G >> 2)) continue;
        let V = Ot(C, F);
        if (!i(V)) continue;
        let ot = u(C, U, F);
        ot >= 0 && v(V, F, P + 1 + ot, G);
      }
    }
  }
  if (!Y) return null;
  let T = [Y.end], K = Y.state;
  for (let N = Y.state; N !== -1; N = w[N]) T.push(g(K = N));
  return { cost: Y.cost, cells: [...T, Ot(g(K), Pt(K % 4))].reverse() };
}, no = (t, e, n, o) => {
  let a = Le(t, n) === "LR" ? [Re, De, Se, ve] : [Se, ve, Re, De], r = n.from !== n.to ? gn(t, e, n, a, a, o) : a.map((i) => gn(t, e, n, [i], a.filter((s) => (i + s) % 2 === 1), o)).reduce((i, s) => s && (!i || s.cost < i.cost) ? s : i, null);
  if (!r) throw new Error(`mermaid found no free route for the back edge ${n.from.name} to ${n.to.name}`);
  return r.cells;
}, ro = (t, e, n) => {
  let o = [...n.values()].flat(), a = Math.max(0, -Math.min(...o.map((s) => s.x))), r = Math.max(0, -Math.min(...o.map((s) => s.y)));
  if (a === 0 && r === 0) return;
  let i = (s) => ({ x: s.x + a, y: s.y + r });
  for (let s of t.nodes) s.gridCoord && (s.gridCoord = i(s.gridCoord));
  t.grid = new Map([...t.grid].map(([s, c]) => {
    let [f, d] = s.split(",").map(Number);
    return [`${f + a},${d + r}`, c];
  })), t.columnWidth = new Map([...t.columnWidth].map(([s, c]) => [s + a, c])), t.rowHeight = new Map([...t.rowHeight].map(([s, c]) => [s + r, c]));
  for (let s of t.edges)
    s.path = s.path.map(i), s.labelLine = s.labelLine.map(i), s.pathToJunction && (s.pathToJunction = s.pathToJunction.map(i));
  for (let s of t.bundles)
    s.junctionPoint && (s.junctionPoint = i(s.junctionPoint)), s.sharedPath = s.sharedPath.map(i);
  for (let [s, c] of n) n.set(s, c.map(i));
  e.x += a, e.y += r;
}, oo = (t, e, n, o) => {
  if (n.text = n.text.replace(/\s*\n\s*/g, " "), n.text.length === 0) return;
  let a = n.text.length + 3, r = o.map((l, u) => {
    if (u === 0 || u === o.length - 1) return !1;
    let g = kt(o[u - 1], l), m = kt(l, o[u + 1]), x = 1 << Pt(g) | 1 << m, w = (B) => e.links.get(fe(e, l, B)).edges;
    return g === m && (e.cells[It(e, l)] & Fr) === x && w(m) === 1 && w(Pt(g)) === 1;
  }), i = [];
  for (let l = 1; l < o.length - 1; l++) {
    if (!r[l]) continue;
    let u = l;
    for (; r[u + 1]; ) u++;
    let g = o[l].y === o[l - 1].y, m = g ? Math.abs(Mt(t, o[u + 1]).x - Mt(t, o[l - 1]).x) - 1 : u - l + 1;
    i.push({ from: l, to: u, level: g, size: m }), l = u;
  }
  let s = (l) => Math.max(...t.nodes.map((u) => u.gridCoord && l >= u.gridCoord.x && l <= u.gridCoord.x + 2 ? Math.abs(l - u.gridCoord.x - 1) : -1)), c = (l) => [-1, 0].flatMap((u) => o.slice(l.from, l.to + 1).filter((g) => s(g.x) === u))[0]?.x, f = (l) => i.filter((u) => u.level === l && c(u) !== void 0).reduce((u, g) => u && u.size >= g.size ? u : g, void 0), d = i.find((l) => l.level && l.size >= a) ?? f(!0) ?? f(!1);
  if (!d) throw new Error(`mermaid found no free cells for the label of the back edge ${n.from.name} to ${n.to.name}`);
  let h = c(d);
  if (h !== void 0) {
    let l = t.columnWidth.get(h) ?? 0;
    t.columnWidth.set(h, d.level ? l + Math.max(0, a - d.size) : Math.max(l, a));
  }
  n.labelLine = [o[d.from - 1], o[d.to + 1]];
}, bn = /* @__PURE__ */ new WeakMap(), yn = { 7: "\u251C", 11: "\u2534", 13: "\u2524", 14: "\u252C", 15: "\u253C" };
function Cn(t) {
  let e = t.edges.filter((m) => zt(t, m));
  if (e.length === 0) return;
  if (t.subgraphs.length > 0) throw new Error("mermaid cannot route a back edge in a diagram with subgraphs");
  let n = t.edges.filter((m) => !e.includes(m)).map((m) => Qr(m.path)), o = [...n.flat(), ...t.nodes.flatMap((m) => m.gridCoord ? [m.gridCoord, { x: m.gridCoord.x + 2, y: m.gridCoord.y + 2 }] : [])], a = hn(o), r = Zt * e.length, i = a.left - r, s = a.top - r, c = a.right + r - i + 1, f = a.bottom + r - s + 1, d = { x: i, y: s, width: c, height: f, cells: new Uint8Array(c * f), links: /* @__PURE__ */ new Map(), reach: a };
  for (let m of t.grid.keys()) {
    let [x, w] = m.split(",").map(Number);
    d.cells[It(d, { x, y: w })] = pn;
  }
  for (let m of n) mn(d, m);
  let h = (m) => Math.abs(m.from.gridCoord.x - m.to.gridCoord.x) + Math.abs(m.from.gridCoord.y - m.to.gridCoord.y), l = /* @__PURE__ */ new Map(), u = { steps: 0 };
  for (let m of [...e].sort((x, w) => h(x) - h(w))) {
    let x = no(t, d, m, u);
    mn(d, x, m), d.reach = hn(x, d.reach), l.set(m, x), m.startDir = Ae[kt(x[0], x[1])], m.endDir = Ae[kt(x[x.length - 1], x[x.length - 2])];
  }
  ro(t, d, l);
  let g = /* @__PURE__ */ new Map();
  for (let [m, x] of l) {
    m.path = Zr(x);
    for (let w of x)
      t.columnWidth.has(w.x) || t.columnWidth.set(w.x, Vr), t.rowHeight.has(w.y) || t.rowHeight.set(w.y, 1);
    x.slice(1, -1).forEach((w, B) => {
      let v = g.get(It(d, w)) ?? { cell: w, arms: 0, edges: 0 };
      g.set(It(d, w), { cell: w, arms: v.arms | 1 << Pt(kt(x[B], w)) | 1 << kt(w, x[B + 2]), edges: v.edges + 1 });
    });
  }
  for (let m of e) oo(t, d, m, l.get(m));
  bn.set(t, [...g.values()].filter((m) => m.edges > 1 && yn[m.arms]));
}
function wn(t) {
  for (let { cell: e, arms: n } of bn.get(t) ?? []) {
    let o = Mt(t, e);
    t.canvas[o.x]?.[o.y] !== void 0 && (t.canvas[o.x][o.y] = t.config.useAscii ? "+" : yn[n], Lt(t.roleCanvas, o.x, o.y, "junction"));
  }
}

// node_modules/beautiful-mermaid/src/ascii/edge-bundling.ts
function An(t) {
  if (t.config.graphDirection !== "TD")
    return [];
  let e = [], n = /* @__PURE__ */ new Set(), o = /* @__PURE__ */ new Map();
  for (let r of t.edges) {
    if (r.from === r.to || zt(t, r)) continue;
    let i = o.get(r.to) ?? [];
    i.push(r), o.set(r.to, i);
  }
  for (let [r, i] of o) {
    if (i.length < 2 || !Mn(i, t) || i.some((c) => n.has(c))) continue;
    let s = {
      type: "fan-in",
      edges: [...i],
      sharedNode: r,
      otherNodes: i.map((c) => c.from),
      junctionPoint: null,
      sharedPath: [],
      junctionDir: $t,
      sharedNodeDir: $t
    };
    for (let c of i)
      c.bundle = s, n.add(c);
    e.push(s);
  }
  let a = /* @__PURE__ */ new Map();
  for (let r of t.edges) {
    if (r.from === r.to || zt(t, r) || n.has(r)) continue;
    let i = a.get(r.from) ?? [];
    i.push(r), a.set(r.from, i);
  }
  for (let [r, i] of a) {
    if (i.length < 2 || !Mn(i, t)) continue;
    let s = {
      type: "fan-out",
      edges: [...i],
      sharedNode: r,
      otherNodes: i.map((c) => c.to),
      junctionPoint: null,
      sharedPath: [],
      junctionDir: $t,
      sharedNodeDir: $t
    };
    for (let c of i)
      c.bundle = s, n.add(c);
    e.push(s);
  }
  return e;
}
function Mn(t, e) {
  if (t.length < 2) return !1;
  let n = t[0].style, o = mt(e, t[0].from), a = mt(e, t[0].to);
  for (let r of t) {
    if (r.style !== n || r.text.length > 0) return !1;
    let i = mt(e, r.from), s = mt(e, r.to);
    if (i !== o || s !== a || i !== s) return !1;
  }
  return !0;
}
function io(t, e) {
  let n = t.config.graphDirection, o = e.sharedNode.gridCoord, a = e.otherNodes.map((r) => r.gridCoord);
  if (e.type === "fan-in") {
    let r = Math.min(...a.map((f) => f.x)), i = Math.max(...a.map((f) => f.x)), s = Math.min(...a.map((f) => f.y)), c = Math.max(...a.map((f) => f.y));
    if (n === "TD") {
      let f = o.y - 1, d = Math.floor((r + i) / 2) + 1;
      return { x: o.x + 1, y: f };
    } else {
      let f = o.x - 1, d = o.y + 1;
      return { x: f, y: d };
    }
  } else {
    let r = Math.min(...a.map((f) => f.x)), i = Math.max(...a.map((f) => f.x)), s = Math.min(...a.map((f) => f.y)), c = Math.max(...a.map((f) => f.y));
    if (n === "TD") {
      let f = o.y + 3;
      return { x: o.x + 1, y: f };
    } else {
      let f = o.x + 3, d = o.y + 1;
      return { x: f, y: d };
    }
  }
}
function so(t, e) {
  let n = t.config.graphDirection;
  e.junctionPoint = io(t, e);
  let o = e.junctionPoint;
  if (e.type === "fan-in") {
    e.junctionDir = n === "TD" ? O : z, e.sharedNodeDir = n === "TD" ? H : W;
    let a = e.sharedNode.gridCoord, r = n === "TD" ? { x: a.x + 1, y: a.y } : { x: a.x, y: a.y + 1 }, i = jt(t.grid, o, r);
    e.sharedPath = i ? Xt(i) : [o, r];
    for (let s of e.edges) {
      let c = s.from.gridCoord, f = n === "TD" ? { x: c.x + 1, y: c.y + 2 } : { x: c.x + 2, y: c.y + 1 }, d = jt(t.grid, f, o);
      s.pathToJunction = d ? Xt(d) : [f, o], s.startDir = n === "TD" ? H : W, s.endDir = n === "TD" ? O : z, s.path = [...s.pathToJunction, ...e.sharedPath.slice(1)];
    }
  } else {
    e.junctionDir = n === "TD" ? H : W, e.sharedNodeDir = n === "TD" ? O : z;
    let a = e.sharedNode.gridCoord, r = n === "TD" ? { x: a.x + 1, y: a.y + 2 } : { x: a.x + 2, y: a.y + 1 }, i = jt(t.grid, r, o);
    e.sharedPath = i ? Xt(i) : [r, o];
    for (let s of e.edges) {
      let c = s.to.gridCoord, f = n === "TD" ? { x: c.x + 1, y: c.y } : { x: c.x, y: c.y + 1 }, d = jt(t.grid, o, f);
      s.pathToJunction = d ? Xt(d) : [o, f], s.startDir = n === "TD" ? H : W, s.endDir = n === "TD" ? O : z, s.path = [...e.sharedPath, ...s.pathToJunction.slice(1)];
    }
  }
}
function vn(t) {
  for (let e of t.bundles)
    so(t, e);
}

// node_modules/beautiful-mermaid/src/ascii/multiline-utils.ts
function st(t) {
  return t.split(`
`);
}
function de(t) {
  let e = st(t);
  return Math.max(...e.map((n) => n.length), 0);
}
function Ee(t) {
  return st(t).length;
}

// node_modules/beautiful-mermaid/src/ascii/shapes/corners.ts
var Sn = {
  // Standard rectangular shapes
  rectangle: {
    unicode: { tl: "\u250C", tr: "\u2510", bl: "\u2514", br: "\u2518" },
    ascii: { tl: "+", tr: "+", bl: "+", br: "+" }
  },
  rounded: {
    unicode: { tl: "\u256D", tr: "\u256E", bl: "\u2570", br: "\u256F" },
    ascii: { tl: ".", tr: ".", bl: "'", br: "'" }
  },
  // Circular shapes - use circle markers at corners
  circle: {
    unicode: { tl: "\u25EF", tr: "\u25EF", bl: "\u25EF", br: "\u25EF" },
    ascii: { tl: "o", tr: "o", bl: "o", br: "o" }
  },
  doublecircle: {
    unicode: { tl: "\u25CE", tr: "\u25CE", bl: "\u25CE", br: "\u25CE" },
    ascii: { tl: "@", tr: "@", bl: "@", br: "@" }
  },
  // Diamond - decision nodes
  diamond: {
    unicode: { tl: "\u25C7", tr: "\u25C7", bl: "\u25C7", br: "\u25C7" },
    ascii: { tl: "<", tr: ">", bl: "<", br: ">" }
  },
  // Hexagon - process nodes (crop corners — monospace-safe, distinct from rectangle)
  hexagon: {
    unicode: { tl: "\u231C", tr: "\u231D", bl: "\u231E", br: "\u231F" },
    ascii: { tl: "*", tr: "*", bl: "*", br: "*" }
  },
  // Stadium/pill shape
  stadium: {
    unicode: { tl: "(", tr: ")", bl: "(", br: ")" },
    ascii: { tl: "(", tr: ")", bl: "(", br: ")" }
  },
  // Subroutine - double vertical bars
  subroutine: {
    unicode: { tl: "\u255F", tr: "\u2562", bl: "\u255F", br: "\u2562" },
    ascii: { tl: "|", tr: "|", bl: "|", br: "|" }
  },
  // Cylinder/database
  cylinder: {
    unicode: { tl: "\u256D", tr: "\u256E", bl: "\u2570", br: "\u256F" },
    ascii: { tl: ".", tr: ".", bl: "'", br: "'" }
  },
  // Asymmetric/flag - pointer on left side
  asymmetric: {
    unicode: { tl: "\u25B7", tr: "\u2510", bl: "\u25B7", br: "\u2518" },
    ascii: { tl: ">", tr: "+", bl: ">", br: "+" }
  },
  // Trapezoid - wider at bottom (top corners slope inward)
  trapezoid: {
    unicode: { tl: "/", tr: "\\", bl: "\u2514", br: "\u2518" },
    ascii: { tl: "/", tr: "\\", bl: "+", br: "+" }
  },
  // Trapezoid-alt - wider at top (bottom corners slope inward)
  "trapezoid-alt": {
    unicode: { tl: "\u250C", tr: "\u2510", bl: "\\", br: "/" },
    ascii: { tl: "+", tr: "+", bl: "\\", br: "/" }
  },
  // State diagram pseudostates (special handling, not corner-based)
  "state-start": {
    unicode: { tl: "\u25CF", tr: "\u25CF", bl: "\u25CF", br: "\u25CF" },
    ascii: { tl: "*", tr: "*", bl: "*", br: "*" }
  },
  "state-end": {
    unicode: { tl: "\u25C9", tr: "\u25C9", bl: "\u25C9", br: "\u25C9" },
    ascii: { tl: "@", tr: "@", bl: "@", br: "@" }
  }
};
function bt(t, e) {
  let n = Sn[t] ?? Sn.rectangle;
  return e ? n.ascii : n.unicode;
}

// node_modules/beautiful-mermaid/src/ascii/shapes/rectangle.ts
function St(t, e) {
  let n = st(t), o = Math.max(...n.map((d) => d.length), 0), a = n.length, r = 2 * e.padding + o, i = r + 2, s = a + 2 * e.padding, c = s % 2 === 0 ? s + 1 : s, f = c + 2;
  return {
    width: i,
    height: f,
    labelArea: {
      x: 1 + e.padding,
      y: 1 + e.padding,
      width: o,
      height: a
    },
    // Grid layout: [border=1, content, border=1]
    gridColumns: [1, r, 1],
    gridRows: [1, c, 1]
  };
}
function Rt(t, e, n, o) {
  let { width: a, height: r } = e, i = ct(a - 1, r - 1), s = { x: 0, y: 0 }, c = { x: a - 1, y: r - 1 }, f = o ? "-" : "\u2500", d = o ? "|" : "\u2502";
  for (let x = s.x + 1; x < c.x; x++)
    i[x][s.y] = f, i[x][c.y] = f;
  for (let x = s.y + 1; x < c.y; x++)
    i[s.x][x] = d, i[c.x][x] = d;
  i[s.x][s.y] = n.tl, i[c.x][s.y] = n.tr, i[s.x][c.y] = n.bl, i[c.x][c.y] = n.br;
  let h = st(t), l = a - 1, u = r - 1, m = Math.floor(u / 2) - Math.floor((h.length - 1) / 2);
  for (let x = 0; x < h.length; x++) {
    let w = h[x], B = Math.floor(l / 2) - Math.ceil(w.length / 2) + 1;
    for (let v = 0; v < w.length; v++) {
      let Y = B + v, T = m + x;
      Y >= 0 && Y < i.length && T >= 0 && T < i[0].length && (i[Y][T] = w[v]);
    }
  }
  return i;
}
function gt(t, e, n) {
  let { width: o, height: a } = e, r = n.x + Math.floor(o / 2), i = n.y + Math.floor(a / 2);
  return b(t, O) ? { x: r, y: n.y } : b(t, H) ? { x: r, y: n.y + a - 1 } : b(t, z) ? { x: n.x, y: i } : b(t, W) ? { x: n.x + o - 1, y: i } : b(t, wt) ? { x: n.x, y: n.y } : b(t, At) ? { x: n.x + o - 1, y: n.y } : b(t, vt) ? { x: n.x, y: n.y + a - 1 } : b(t, Dt) ? { x: n.x + o - 1, y: n.y + a - 1 } : { x: r, y: i };
}
var Ge = {
  getDimensions: St,
  render(t, e, n) {
    let o = bt("rectangle", n.useAscii);
    return Rt(t, e, o, n.useAscii);
  },
  getAttachmentPoint: gt
};

// node_modules/beautiful-mermaid/src/ascii/shapes/diamond.ts
var Rn = {
  getDimensions: St,
  render(t, e, n) {
    let o = bt("diamond", n.useAscii);
    return Rt(t, e, o, n.useAscii);
  },
  getAttachmentPoint: gt
};

// node_modules/beautiful-mermaid/src/ascii/shapes/circle.ts
var Dn = {
  getDimensions: St,
  render(t, e, n) {
    let o = bt("circle", n.useAscii);
    return Rt(t, e, o, n.useAscii);
  },
  getAttachmentPoint: gt
};

// node_modules/beautiful-mermaid/src/ascii/shapes/state.ts
var Tn = {
  getDimensions(t, e) {
    return {
      width: 5,
      height: 3,
      labelArea: { x: 2, y: 1, width: 1, height: 1 },
      gridColumns: [1, 3, 1],
      gridRows: [1, 1, 1]
    };
  },
  render(t, e, n) {
    let { width: o, height: a } = e, r = ct(o - 1, a - 1), i = Math.floor(o / 2);
    return n.useAscii ? (r[0][0] = ".", r[1][0] = "-", r[2][0] = "-", r[3][0] = "-", r[4][0] = ".", r[0][1] = "|", r[i][1] = "*", r[4][1] = "|", r[0][2] = "'", r[1][2] = "-", r[2][2] = "-", r[3][2] = "-", r[4][2] = "'") : (r[0][0] = "\u256D", r[1][0] = "\u2500", r[2][0] = "\u2500", r[3][0] = "\u2500", r[4][0] = "\u256E", r[0][1] = "\u2502", r[i][1] = "\u25CF", r[4][1] = "\u2502", r[0][2] = "\u2570", r[1][2] = "\u2500", r[2][2] = "\u2500", r[3][2] = "\u2500", r[4][2] = "\u256F"), r;
  },
  getAttachmentPoint(t, e, n) {
    let { width: o, height: a } = e, r = n.x + Math.floor(o / 2), i = n.y + Math.floor(a / 2);
    return b(t, O) ? { x: r, y: n.y } : b(t, H) ? { x: r, y: n.y + a - 1 } : b(t, z) ? { x: n.x, y: i } : b(t, W) ? { x: n.x + o - 1, y: i } : { x: r, y: i };
  }
}, Ln = {
  getDimensions(t, e) {
    return {
      width: 5,
      height: 3,
      labelArea: { x: 2, y: 1, width: 1, height: 1 },
      gridColumns: [1, 3, 1],
      gridRows: [1, 1, 1]
    };
  },
  render(t, e, n) {
    let { width: o, height: a } = e, r = ct(o - 1, a - 1), i = Math.floor(o / 2);
    return n.useAscii ? (r[0][0] = "#", r[1][0] = "=", r[2][0] = "=", r[3][0] = "=", r[4][0] = "#", r[0][1] = "#", r[i][1] = "*", r[4][1] = "#", r[0][2] = "#", r[1][2] = "=", r[2][2] = "=", r[3][2] = "=", r[4][2] = "#") : (r[0][0] = "\u2554", r[1][0] = "\u2550", r[2][0] = "\u2550", r[3][0] = "\u2550", r[4][0] = "\u2557", r[0][1] = "\u2551", r[i][1] = "\u25CE", r[4][1] = "\u2551", r[0][2] = "\u255A", r[1][2] = "\u2550", r[2][2] = "\u2550", r[3][2] = "\u2550", r[4][2] = "\u255D"), r;
  },
  getAttachmentPoint(t, e, n) {
    let { width: o, height: a } = e, r = n.x + Math.floor(o / 2), i = n.y + Math.floor(a / 2);
    return b(t, O) ? { x: r, y: n.y } : b(t, H) ? { x: r, y: n.y + a - 1 } : b(t, z) ? { x: n.x, y: i } : b(t, W) ? { x: n.x + o - 1, y: i } : { x: r, y: i };
  }
};

// node_modules/beautiful-mermaid/src/ascii/shapes/rounded.ts
var En = {
  getDimensions: St,
  render(t, e, n) {
    let o = bt("rounded", n.useAscii);
    return Rt(t, e, o, n.useAscii);
  },
  getAttachmentPoint: gt
};

// node_modules/beautiful-mermaid/src/ascii/shapes/stadium.ts
var Gn = {
  getDimensions(t, e) {
    let n = st(t), o = Math.max(...n.map((f) => f.length), 0), a = n.length, r = 2 * e.padding + o, i = r + 4, s = a + 2 * e.padding, c = Math.max(s + 2, 3);
    return {
      width: i,
      height: c,
      labelArea: {
        x: 2 + e.padding,
        y: 1 + e.padding,
        width: o,
        height: a
      },
      gridColumns: [2, r, 2],
      gridRows: [1, s, 1]
    };
  },
  render(t, e, n) {
    let { width: o, height: a } = e, r = ct(o - 1, a - 1), i = Math.floor(a / 2), s = n.useAscii ? "-" : "\u2500";
    if (a === 3)
      r[0][i] = "(", r[o - 1][i] = ")";
    else if (n.useAscii) {
      for (let d = 0; d < a; d++)
        r[0][d] = "(", r[o - 1][d] = ")";
      for (let d = 1; d < o - 1; d++)
        r[d][0] = s, r[d][a - 1] = s;
    } else {
      r[0][0] = "\u256D";
      for (let d = 1; d < o - 1; d++) r[d][0] = s;
      r[o - 1][0] = "\u256E";
      for (let d = 1; d < a - 1; d++)
        r[0][d] = "\u2502", r[o - 1][d] = "\u2502";
      r[0][a - 1] = "\u2570";
      for (let d = 1; d < o - 1; d++) r[d][a - 1] = s;
      r[o - 1][a - 1] = "\u256F";
    }
    let c = st(t), f = i - Math.floor((c.length - 1) / 2);
    for (let d = 0; d < c.length; d++) {
      let h = c[d], l = Math.floor(o / 2) - Math.floor(h.length / 2);
      for (let u = 0; u < h.length; u++) {
        let g = l + u, m = f + d;
        g > 0 && g < o - 1 && m >= 0 && m < a && (r[g][m] = h[u]);
      }
    }
    return r;
  },
  getAttachmentPoint: gt
};

// node_modules/beautiful-mermaid/src/ascii/shapes/hexagon.ts
var kn = {
  getDimensions: St,
  render(t, e, n) {
    let o = bt("hexagon", n.useAscii);
    return Rt(t, e, o, n.useAscii);
  },
  getAttachmentPoint: gt
};

// node_modules/beautiful-mermaid/src/ascii/shapes/special.ts
var In = {
  getDimensions(t, e) {
    let n = st(t), o = Math.max(...n.map((f) => f.length), 0), a = n.length, r = 2 * e.padding + o, i = r + 4, s = a + 2 * e.padding, c = s + 2;
    return {
      width: i,
      height: c,
      labelArea: {
        x: 2 + e.padding,
        y: 1 + e.padding,
        width: o,
        height: a
      },
      gridColumns: [2, r, 2],
      gridRows: [1, s, 1]
    };
  },
  render(t, e, n) {
    let { width: o, height: a } = e, r = ct(o - 1, a - 1), i = n.useAscii ? "-" : "\u2500", s = n.useAscii ? "|" : "\u2502";
    r[0][0] = n.useAscii ? "+" : "\u250C", r[1][0] = n.useAscii ? "+" : "\u252C";
    for (let h = 2; h < o - 2; h++) r[h][0] = i;
    r[o - 2][0] = n.useAscii ? "+" : "\u252C", r[o - 1][0] = n.useAscii ? "+" : "\u2510";
    for (let h = 1; h < a - 1; h++)
      r[0][h] = s, r[1][h] = s, r[o - 2][h] = s, r[o - 1][h] = s;
    r[0][a - 1] = n.useAscii ? "+" : "\u2514", r[1][a - 1] = n.useAscii ? "+" : "\u2534";
    for (let h = 2; h < o - 2; h++) r[h][a - 1] = i;
    r[o - 2][a - 1] = n.useAscii ? "+" : "\u2534", r[o - 1][a - 1] = n.useAscii ? "+" : "\u2518";
    let c = st(t), d = Math.floor(a / 2) - Math.floor((c.length - 1) / 2);
    for (let h = 0; h < c.length; h++) {
      let l = c[h], u = Math.floor(o / 2) - Math.floor(l.length / 2);
      for (let g = 0; g < l.length; g++) {
        let m = u + g, x = d + h;
        m > 1 && m < o - 2 && x > 0 && x < a - 1 && (r[m][x] = l[g]);
      }
    }
    return r;
  },
  getAttachmentPoint: gt
}, Nn = {
  getDimensions: St,
  render(t, e, n) {
    let o = bt("doublecircle", n.useAscii);
    return Rt(t, e, o, n.useAscii);
  },
  getAttachmentPoint: gt
}, $n = {
  getDimensions(t, e) {
    let n = st(t), o = Math.max(...n.map((f) => f.length), 0), a = n.length, r = 2 * e.padding + o, i = r + 2, s = a + 2 * e.padding + 2, c = s + 2;
    return {
      width: i,
      height: c,
      labelArea: {
        x: 1 + e.padding,
        y: 2 + e.padding,
        width: o,
        height: a
      },
      gridColumns: [1, r, 1],
      gridRows: [2, s - 2, 2]
    };
  },
  render(t, e, n) {
    let { width: o, height: a } = e, r = ct(o - 1, a - 1), i = n.useAscii ? "-" : "\u2500", s = n.useAscii ? "|" : "\u2502";
    r[0][0] = n.useAscii ? "." : "\u256D";
    for (let h = 1; h < o - 1; h++) r[h][0] = i;
    r[o - 1][0] = n.useAscii ? "." : "\u256E", r[0][1] = s;
    for (let h = 1; h < o - 1; h++) r[h][1] = i;
    r[o - 1][1] = s;
    for (let h = 2; h < a - 2; h++)
      r[0][h] = s, r[o - 1][h] = s;
    r[0][a - 2] = s;
    for (let h = 1; h < o - 1; h++) r[h][a - 2] = i;
    r[o - 1][a - 2] = s, r[0][a - 1] = n.useAscii ? "'" : "\u2570";
    for (let h = 1; h < o - 1; h++) r[h][a - 1] = i;
    r[o - 1][a - 1] = n.useAscii ? "'" : "\u256F";
    let c = st(t), d = Math.floor(a / 2) - Math.floor((c.length - 1) / 2);
    for (let h = 0; h < c.length; h++) {
      let l = c[h], u = Math.floor(o / 2) - Math.floor(l.length / 2);
      for (let g = 0; g < l.length; g++) {
        let m = u + g, x = d + h;
        m > 0 && m < o - 1 && x > 1 && x < a - 2 && (r[m][x] = l[g]);
      }
    }
    return r;
  },
  getAttachmentPoint: gt
}, Bn = {
  getDimensions: St,
  render(t, e, n) {
    let o = bt("asymmetric", n.useAscii);
    return Rt(t, e, o, n.useAscii);
  },
  getAttachmentPoint: gt
}, Yn = {
  getDimensions: St,
  render(t, e, n) {
    let o = bt("trapezoid", n.useAscii);
    return Rt(t, e, o, n.useAscii);
  },
  getAttachmentPoint: gt
}, Xn = {
  getDimensions: St,
  render(t, e, n) {
    let o = bt("trapezoid-alt", n.useAscii);
    return Rt(t, e, o, n.useAscii);
  },
  getAttachmentPoint: gt
};

// node_modules/beautiful-mermaid/src/ascii/shapes/index.ts
var ao = /* @__PURE__ */ new Map([
  // Core shapes
  ["rectangle", Ge],
  ["rounded", En],
  ["diamond", Rn],
  ["stadium", Gn],
  ["circle", Dn],
  // Batch 1 additions
  ["subroutine", In],
  ["doublecircle", Nn],
  ["hexagon", kn],
  // Batch 2 additions
  ["cylinder", $n],
  ["asymmetric", Bn],
  ["trapezoid", Yn],
  ["trapezoid-alt", Xn],
  // State diagram pseudo-states
  ["state-start", Tn],
  ["state-end", Ln]
]);
function Pn(t) {
  return ao.get(t) ?? Ge;
}
function Hn(t, e, n) {
  return Pn(t).getDimensions(e, n);
}
function Wn(t, e, n, o) {
  return Pn(t).getAttachmentPoint(e, n, o);
}

// node_modules/beautiful-mermaid/src/ascii/draw.ts
function co(t, e) {
  return lo(t, e);
}
function lo(t, e) {
  let n = t.gridCoord, o = e.config.useAscii, a = 0;
  for (let v = 0; v < 2; v++)
    a += e.columnWidth.get(n.x + v) ?? 0;
  let r = 0;
  for (let v = 0; v < 2; v++)
    r += e.rowHeight.get(n.y + v) ?? 0;
  let i = { x: 0, y: 0 }, s = { x: a, y: r }, c = ct(Math.max(i.x, s.x), Math.max(i.y, s.y)), f = bt(t.shape, o), d = t.shape === "state-end", h = o ? d ? "=" : "-" : d ? "\u2550" : "\u2500", l = o ? d ? "\u2016" : "|" : d ? "\u2551" : "\u2502", g = d ? o ? { tl: "#", tr: "#", bl: "#", br: "#" } : { tl: "\u2554", tr: "\u2557", bl: "\u255A", br: "\u255D" } : f;
  for (let v = i.x + 1; v < s.x; v++) c[v][i.y] = h;
  for (let v = i.x + 1; v < s.x; v++) c[v][s.y] = h;
  for (let v = i.y + 1; v < s.y; v++) c[i.x][v] = l;
  for (let v = i.y + 1; v < s.y; v++) c[s.x][v] = l;
  c[i.x][i.y] = g.tl, c[s.x][i.y] = g.tr, c[i.x][s.y] = g.bl, c[s.x][s.y] = g.br;
  let m = t.displayLabel, x = st(m), B = i.y + Math.floor(r / 2) - Math.floor((x.length - 1) / 2);
  for (let v = 0; v < x.length; v++) {
    let Y = x[v], T = i.x + Math.floor(a / 2) - Math.ceil(Y.length / 2) + 1;
    for (let K = 0; K < Y.length; K++)
      T + K >= 0 && T + K < c.length && B + v >= 0 && B + v < c[0].length && (c[T + K][B + v] = Y[K]);
  }
  return c;
}
function jn(t, e) {
  return co(t, e);
}
function ue(t, e, n = 1) {
  let o = 0;
  for (let v of t)
    for (let Y of v)
      o = Math.max(o, Y.length);
  let r = o + 2 * n + 2, i = 0;
  for (let v of t)
    i += Math.max(v.length, 1);
  let s = t.length - 1, c = i + s + 2, f = e ? "-" : "\u2500", d = e ? "|" : "\u2502", h = e ? "+" : "\u250C", l = e ? "+" : "\u2510", u = e ? "+" : "\u2514", g = e ? "+" : "\u2518", m = e ? "+" : "\u251C", x = e ? "+" : "\u2524", w = ct(r - 1, c - 1);
  w[0][0] = h;
  for (let v = 1; v < r - 1; v++) w[v][0] = f;
  w[r - 1][0] = l, w[0][c - 1] = u;
  for (let v = 1; v < r - 1; v++) w[v][c - 1] = f;
  w[r - 1][c - 1] = g;
  for (let v = 1; v < c - 1; v++)
    w[0][v] = d, w[r - 1][v] = d;
  let B = 1;
  for (let v = 0; v < t.length; v++) {
    let Y = t[v], T = Y.length > 0 ? Y : [""];
    for (let K of T) {
      let N = 1 + n;
      for (let k = 0; k < K.length; k++)
        w[N + k][B] = K[k];
      B++;
    }
    if (v < t.length - 1) {
      w[0][B] = m;
      for (let K = 1; K < r - 1; K++) w[K][B] = f;
      w[r - 1][B] = x, B++;
    }
  }
  return w;
}
var fo = {
  solid: {
    h: { unicode: "\u2500", ascii: "-" },
    v: { unicode: "\u2502", ascii: "|" }
  },
  dotted: {
    h: { unicode: "\u2504", ascii: "." },
    v: { unicode: "\u2506", ascii: ":" }
  },
  thick: {
    h: { unicode: "\u2501", ascii: "=" },
    v: { unicode: "\u2503", ascii: "\u2016" }
  }
};
function Ie(t, e, n, o, a, r, i = "solid") {
  let s = xt(e, n), c = [], f = fo[i], d = r ? f.h.ascii : f.h.unicode, h = r ? f.v.ascii : f.v.unicode;
  if (b(s, O))
    for (let l = e.y - o; l >= n.y - a; l--)
      c.push({ x: e.x, y: l }), t[e.x][l] = h;
  else if (b(s, H))
    for (let l = e.y + o; l <= n.y + a; l++)
      c.push({ x: e.x, y: l }), t[e.x][l] = h;
  else if (b(s, z))
    for (let l = e.x - o; l >= n.x - a; l--)
      c.push({ x: l, y: e.y }), t[l][e.y] = d;
  else if (b(s, W))
    for (let l = e.x + o; l <= n.x + a; l++)
      c.push({ x: l, y: e.y }), t[l][e.y] = d;
  else if (b(s, wt)) {
    for (let l = e.x - o; l >= n.x; l--)
      c.push({ x: l, y: e.y }), t[l][e.y] = d;
    for (let l = e.y - 1; l >= n.y - a; l--)
      c.push({ x: n.x, y: l }), t[n.x][l] = h;
  } else if (b(s, At)) {
    for (let l = e.x + o; l <= n.x; l++)
      c.push({ x: l, y: e.y }), t[l][e.y] = d;
    for (let l = e.y - 1; l >= n.y - a; l--)
      c.push({ x: n.x, y: l }), t[n.x][l] = h;
  } else if (b(s, vt)) {
    for (let l = e.x - o; l >= n.x; l--)
      c.push({ x: l, y: e.y }), t[l][e.y] = d;
    for (let l = e.y + 1; l <= n.y + a; l++)
      c.push({ x: n.x, y: l }), t[n.x][l] = h;
  } else if (b(s, Dt))
    if (n.x - e.x <= 1)
      for (let u = e.y + o; u <= n.y + a; u++)
        c.push({ x: e.x, y: u }), t[e.x][u] = h;
    else {
      for (let u = e.x + o; u <= n.x; u++)
        c.push({ x: u, y: e.y }), t[u][e.y] = d;
      for (let u = e.y + 1; u <= n.y + a; u++)
        c.push({ x: n.x, y: u }), t[n.x][u] = h;
    }
  return c;
}
function uo(t, e) {
  if (e.path.length === 0) {
    let d = ht(t.canvas);
    return [d, d, d, d, d, d];
  }
  let n = xo(t, e), [o, a, r] = mo(t, e.path, e.style), i = go(t, e.path, a[0], e.from.shape), s;
  e.hasArrowEnd ? s = _n(
    t,
    a[a.length - 1],
    r[r.length - 1]
  ) : s = ht(t.canvas);
  let c;
  if (e.hasArrowStart && a.length > 0) {
    let h = a[0][0], l = ho(r[0]), u = { x: h.x, y: h.y };
    b(r[0], W) ? u.x = h.x - 1 : b(r[0], z) ? u.x = h.x + 1 : b(r[0], H) ? u.y = h.y - 1 : b(r[0], O) && (u.y = h.y + 1), c = _n(t, [h, u], l);
  } else
    c = ht(t.canvas);
  let f = po(t, e.path);
  return [o, i, s, c, f, n];
}
function ho(t) {
  return b(t, O) ? H : b(t, H) ? O : b(t, z) ? W : b(t, W) ? z : b(t, wt) ? Dt : b(t, At) ? vt : b(t, vt) ? At : b(t, Dt) ? wt : $t;
}
function mo(t, e, n = "solid") {
  let o = ht(t.canvas), a = e[0], r = [], i = [];
  for (let s = 1; s < e.length; s++) {
    let c = e[s], f = Mt(t, a), d = Mt(t, c);
    if (re(f, d)) {
      a = c;
      continue;
    }
    let h = xt(a, c), l = Ie(o, f, d, 1, -1, t.config.useAscii, n);
    l.length === 0 && l.push(f), r.push(l), i.push(h), a = c;
  }
  return [o, r, i];
}
function go(t, e, n, o) {
  let a = ht(t.canvas);
  if (t.config.useAscii || o === "state-start" || o === "state-end")
    return a;
  let r = n[0], i = xt(e[0], e[1]);
  return b(i, O) ? a[r.x][r.y + 1] = "\u2534" : b(i, H) ? a[r.x][r.y - 1] = "\u252C" : b(i, z) ? a[r.x + 1][r.y] = "\u2524" : b(i, W) && (a[r.x - 1][r.y] = "\u251C"), a;
}
function _n(t, e, n) {
  let o = ht(t.canvas);
  if (e.length === 0) return o;
  let a = e[0], r = e[e.length - 1], i = xt(a, r);
  (e.length === 1 || b(i, $t)) && (i = n);
  let s;
  return t.config.useAscii ? b(i, O) ? s = "^" : b(i, H) ? s = "v" : b(i, z) ? s = "<" : b(i, W) ? s = ">" : b(n, O) ? s = "^" : b(n, H) ? s = "v" : b(n, z) ? s = "<" : b(n, W) ? s = ">" : s = "*" : b(i, O) ? s = "\u25B2" : b(i, H) ? s = "\u25BC" : b(i, z) ? s = "\u25C4" : b(i, W) ? s = "\u25BA" : b(i, At) ? s = "\u25E5" : b(i, wt) ? s = "\u25E4" : b(i, Dt) ? s = "\u25E2" : b(i, vt) ? s = "\u25E3" : b(n, O) ? s = "\u25B2" : b(n, H) ? s = "\u25BC" : b(n, z) ? s = "\u25C4" : b(n, W) ? s = "\u25BA" : b(n, At) ? s = "\u25E5" : b(n, wt) ? s = "\u25E4" : b(n, Dt) ? s = "\u25E2" : b(n, vt) ? s = "\u25E3" : s = "\u25CF", o[r.x][r.y] = s, o;
}
function po(t, e) {
  let n = ht(t.canvas);
  for (let o = 1; o < e.length - 1; o++) {
    let a = e[o], r = Mt(t, a), i = xt(e[o - 1], a), s = xt(a, e[o + 1]), c;
    t.config.useAscii ? c = "+" : b(i, W) && b(s, H) || b(i, O) && b(s, z) ? c = "\u2510" : b(i, W) && b(s, O) || b(i, H) && b(s, z) ? c = "\u2518" : b(i, z) && b(s, H) || b(i, O) && b(s, W) ? c = "\u250C" : b(i, z) && b(s, O) || b(i, H) && b(s, W) ? c = "\u2514" : c = "+", n[r.x][r.y] = c;
  }
  return n;
}
function xo(t, e) {
  let n = ht(t.canvas);
  if (e.text.length === 0) return n;
  let o = zn(t, e.labelLine), a;
  if (e.path.length >= 2) {
    let r = e.path[0].y, i = e.path[e.path.length - 1].y;
    i < r ? a = !0 : i > r && (a = !1);
  }
  return bo(n, o, e.text, zt(t, e) ? void 0 : a), n;
}
function bo(t, e, n, o) {
  if (e.length < 2) return;
  let a = Math.min(e[0].x, e[1].x), r = Math.max(e[0].x, e[1].x), i = Math.min(e[0].y, e[1].y), s = Math.max(e[0].y, e[1].y), c = a + Math.floor((r - a) / 2), f = i + Math.floor((s - i) / 2);
  if (o !== void 0 && a === r) {
    let l = s - i, u = Math.max(1, Math.floor(l / 4));
    o ? f = f + u : f = f - u;
  }
  let d = st(n), h = f - Math.floor((d.length - 1) / 2);
  for (let l = 0; l < d.length; l++) {
    let u = d[l], g = c - Math.floor(u.length / 2);
    ye(t, { x: g, y: h + l }, u);
  }
}
function Ut(t, e, n) {
  let o = e.gridCoord, a = 0;
  for (let c = 0; c < 2; c++)
    a += t.columnWidth.get(o.x + c) ?? 0;
  let r = 0;
  for (let c = 0; c < 2; c++)
    r += t.rowHeight.get(o.y + c) ?? 0;
  let i = {
    width: a + 1,
    height: r + 1,
    labelArea: { x: 0, y: 0, width: 0, height: 0 },
    gridColumns: [0, 0, 0],
    gridRows: [0, 0, 0]
  }, s = e.drawingCoord;
  return Wn(e.shape, n, i, s);
}
function yo(t, e, n) {
  let o = ht(t.canvas);
  if (!e.pathToJunction || e.pathToJunction.length === 0)
    return [o, o, o, o, o, o];
  let a = ht(t.canvas), r = t.config.useAscii, i = e.pathToJunction.map((d, h) => n.type === "fan-in" && h === 0 ? Ut(t, e.from, e.startDir) : n.type === "fan-out" && h === e.pathToJunction.length - 1 ? Ut(t, e.to, e.endDir) : Mt(t, d));
  for (let d = 1; d < i.length; d++) {
    let h = i[d - 1], l = i[d];
    re(h, l) || Ie(a, h, l, 1, -1, r, e.style);
  }
  let s = ht(t.canvas);
  for (let d = 1; d < e.pathToJunction.length - 1; d++) {
    let h = e.pathToJunction[d], l = Mt(t, h), u = xt(e.pathToJunction[d - 1], h), g = xt(h, e.pathToJunction[d + 1]), m;
    r ? m = "+" : b(u, W) && b(g, H) || b(u, O) && b(g, z) ? m = "\u2510" : b(u, W) && b(g, O) || b(u, H) && b(g, z) ? m = "\u2518" : b(u, z) && b(g, H) || b(u, O) && b(g, W) ? m = "\u250C" : b(u, z) && b(g, O) || b(u, H) && b(g, W) ? m = "\u2514" : m = "+", s[l.x][l.y] = m;
  }
  let c = ht(t.canvas);
  if (n.type === "fan-in" && e.pathToJunction.length >= 2) {
    let d = i[0], h = xt(e.pathToJunction[0], e.pathToJunction[1]);
    r || (b(h, O) ? c[d.x][d.y] = "\u2534" : b(h, H) ? c[d.x][d.y] = "\u252C" : b(h, z) ? c[d.x][d.y] = "\u2524" : b(h, W) && (c[d.x][d.y] = "\u251C"));
  }
  let f = ht(t.canvas);
  return [a, c, o, o, s, f];
}
function Co(t, e) {
  let n = ht(t.canvas), o = ht(t.canvas);
  if (e.sharedPath.length < 2)
    return [n, o];
  let a = t.config.useAscii, r = e.edges[0]?.style ?? "solid", i = t.config.graphDirection, s = e.sharedPath.map((c, f) => {
    if (e.type === "fan-in" && f === e.sharedPath.length - 1) {
      let d = i === "TD" ? O : z;
      return Ut(t, e.sharedNode, d);
    }
    if (e.type === "fan-out" && f === 0) {
      let d = i === "TD" ? H : W;
      return Ut(t, e.sharedNode, d);
    }
    return Mt(t, c);
  });
  for (let c = 1; c < s.length; c++) {
    let f = s[c - 1], d = s[c];
    re(f, d) || Ie(n, f, d, 1, -1, a, r);
  }
  for (let c = 1; c < e.sharedPath.length - 1; c++) {
    let f = e.sharedPath[c], d = Mt(t, f), h = xt(e.sharedPath[c - 1], f), l = xt(f, e.sharedPath[c + 1]), u;
    a ? u = "+" : b(h, W) && b(l, H) || b(h, O) && b(l, z) ? u = "\u2510" : b(h, W) && b(l, O) || b(h, H) && b(l, z) ? u = "\u2518" : b(h, z) && b(l, H) || b(h, O) && b(l, W) ? u = "\u250C" : b(h, z) && b(l, O) || b(h, H) && b(l, W) ? u = "\u2514" : u = "+", o[d.x][d.y] = u;
  }
  return [n, o];
}
function wo(t, e) {
  let n = ht(t.canvas);
  if (e.sharedPath.length < 2) return n;
  let o = e.sharedPath.length - 1, a = e.sharedPath[o - 1], r = e.sharedPath[o], i = xt(a, r), s = t.config.graphDirection, c = s === "TD" ? O : z, f = Ut(t, e.sharedNode, c);
  s === "TD" ? f.y -= 1 : f.x -= 1;
  let d;
  return t.config.useAscii ? b(i, O) ? d = "^" : b(i, H) ? d = "v" : b(i, z) ? d = "<" : b(i, W) ? d = ">" : d = "v" : b(i, O) ? d = "\u25B2" : b(i, H) ? d = "\u25BC" : b(i, z) ? d = "\u25C4" : b(i, W) ? d = "\u25BA" : d = "\u25BC", n[f.x][f.y] = d, n;
}
function Mo(t, e) {
  let n = ht(t.canvas);
  if (!e.pathToJunction || e.pathToJunction.length < 2) return n;
  let o = e.pathToJunction.length - 1, a = e.pathToJunction[o - 1], r = e.pathToJunction[o], i = xt(a, r), s = t.config.graphDirection, c = s === "TD" ? O : z, f = Ut(t, e.to, c);
  s === "TD" ? f.y -= 1 : f.x -= 1;
  let d;
  return t.config.useAscii ? b(i, O) ? d = "^" : b(i, H) ? d = "v" : b(i, z) ? d = "<" : b(i, W) ? d = ">" : d = "v" : b(i, O) ? d = "\u25B2" : b(i, H) ? d = "\u25BC" : b(i, z) ? d = "\u25C4" : b(i, W) ? d = "\u25BA" : d = "\u25BC", n[f.x][f.y] = d, n;
}
function Ao(t, e) {
  let n = ht(t.canvas);
  if (!e.junctionPoint) return n;
  let o = Mt(t, e.junctionPoint), a = t.config.useAscii, r = !1, i = !1, s = !1, c = !1;
  if (e.sharedPath.length >= 2) {
    let d = e.type === "fan-in" ? 0 : e.sharedPath.length - 1, h = e.type === "fan-in" ? 1 : e.sharedPath.length - 2, l = xt(
      e.sharedPath[d],
      e.sharedPath[h]
    );
    b(l, H) ? i = !0 : b(l, O) ? r = !0 : b(l, W) ? c = !0 : b(l, z) && (s = !0);
  }
  for (let d of e.edges)
    if (d.pathToJunction && d.pathToJunction.length >= 2) {
      let h = e.type === "fan-in" ? d.pathToJunction.length - 1 : 0, l = e.type === "fan-in" ? d.pathToJunction.length - 2 : 1, u = xt(
        d.pathToJunction[l],
        d.pathToJunction[h]
      );
      b(u, H) ? r = !0 : b(u, O) ? i = !0 : b(u, W) ? s = !0 : b(u, z) && (c = !0);
    }
  let f;
  return a ? f = "+" : r && i && s && c ? f = "\u253C" : i && s && c && !r ? f = "\u252C" : r && s && c && !i ? f = "\u2534" : r && i && c && !s ? f = "\u251C" : r && i && s && !c ? f = "\u2524" : s && c ? f = "\u2500" : r && i ? f = "\u2502" : i && c ? f = "\u250C" : i && s ? f = "\u2510" : r && c ? f = "\u2514" : r && s ? f = "\u2518" : f = "\u253C", n[o.x][o.y] = f, n;
}
function vo(t, e) {
  let n = t.maxX - t.minX, o = t.maxY - t.minY;
  if (n <= 0 || o <= 0) return ct(0, 0);
  let a = { x: 0, y: 0 }, r = { x: n, y: o }, i = ct(n, o);
  if (e.config.useAscii) {
    for (let s = a.x + 1; s < r.x; s++) i[s][a.y] = "-";
    for (let s = a.x + 1; s < r.x; s++) i[s][r.y] = "-";
    for (let s = a.y + 1; s < r.y; s++) i[a.x][s] = "|";
    for (let s = a.y + 1; s < r.y; s++) i[r.x][s] = "|";
    i[a.x][a.y] = "+", i[r.x][a.y] = "+", i[a.x][r.y] = "+", i[r.x][r.y] = "+";
  } else {
    for (let s = a.x + 1; s < r.x; s++) i[s][a.y] = "\u2500";
    for (let s = a.x + 1; s < r.x; s++) i[s][r.y] = "\u2500";
    for (let s = a.y + 1; s < r.y; s++) i[a.x][s] = "\u2502";
    for (let s = a.y + 1; s < r.y; s++) i[r.x][s] = "\u2502";
    i[a.x][a.y] = "\u250C", i[r.x][a.y] = "\u2510", i[a.x][r.y] = "\u2514", i[r.x][r.y] = "\u2518";
  }
  return i;
}
function So(t, e) {
  let n = t.maxX - t.minX, o = t.maxY - t.minY;
  if (n <= 0 || o <= 0) return [ct(0, 0), { x: 0, y: 0 }];
  let a = ct(n, o), r = st(t.name);
  for (let i = 0; i < r.length; i++) {
    let s = r[i], c = 1 + i, f = Math.floor(n / 2) - Math.floor(s.length / 2);
    f < 1 && (f = 1);
    for (let d = 0; d < s.length; d++)
      f + d < n && c < o && (a[f + d][c] = s[d]);
  }
  return [a, { x: t.minX, y: t.minY }];
}
function Ro(t) {
  function e(o) {
    return o.parent === null ? 0 : 1 + e(o.parent);
  }
  let n = [...t];
  return n.sort((o, a) => e(o) - e(a)), n;
}
function ke(t, e, n, o) {
  for (let a = 0; a < e.length; a++)
    for (let r = 0; r < (e[0]?.length ?? 0); r++) {
      let i = e[a]?.[r];
      if (i && i !== " ") {
        let s = a + n.x, c = r + n.y;
        s >= 0 && c >= 0 && Lt(t, s, c, o);
      }
    }
}
function Jt(t, e, n, o) {
  for (let a of e)
    ke(t, a, n, o);
}
function Do(t, e, n) {
  let o = (a) => /^[┌┐└┘├┤┬┴┼│─╭╮╰╯+\-|.':]$/.test(a);
  for (let a = 0; a < e.length; a++)
    for (let r = 0; r < (e[0]?.length ?? 0); r++) {
      let i = e[a]?.[r];
      if (i && i !== " ") {
        let s = a + n.x, c = r + n.y;
        s >= 0 && c >= 0 && Lt(t, s, c, o(i) ? "border" : "text");
      }
    }
}
function On(t) {
  let e = t.config.useAscii, n = { x: 0, y: 0 }, o = Ro(t.subgraphs);
  for (let l of o) {
    let u = vo(l, t), g = { x: l.minX, y: l.minY };
    t.canvas = Gt(t.canvas, g, e, u), ke(t.roleCanvas, u, g, "border");
  }
  for (let l of t.nodes)
    !l.drawn && l.drawingCoord && l.drawing && (t.canvas = Gt(t.canvas, l.drawingCoord, e, l.drawing), Do(t.roleCanvas, l.drawing, l.drawingCoord), l.drawn = !0);
  let a = [], r = [], i = [], s = [], c = [], f = [], d = [], h = /* @__PURE__ */ new Set();
  for (let l of t.edges)
    if (l.bundle && l.pathToJunction) {
      let u = l.bundle, [g, m, , , x, w] = yo(t, l, u);
      if (a.push(g), r.push(x), c.push(m), f.push(w), !h.has(u)) {
        h.add(u);
        let [B, v] = Co(t, u);
        if (a.push(B), r.push(v), u.type === "fan-in") {
          let T = wo(t, u);
          i.push(T);
        }
        let Y = Ao(t, u);
        d.push(Y);
      }
      if (u.type === "fan-out" && l.hasArrowEnd) {
        let B = Mo(t, l);
        i.push(B);
      }
    } else {
      let [u, g, m, x, w, B] = uo(t, l);
      a.push(u), r.push(w), i.push(m), s.push(x), c.push(g), f.push(B);
    }
  t.canvas = Gt(t.canvas, n, e, ...a), Jt(t.roleCanvas, a, n, "line"), t.canvas = Gt(t.canvas, n, e, ...r), Jt(t.roleCanvas, r, n, "corner"), t.canvas = Gt(t.canvas, n, e, ...d), Jt(t.roleCanvas, d, n, "junction"), wn(t), t.canvas = Gt(t.canvas, n, e, ...i), Jt(t.roleCanvas, i, n, "arrow"), t.canvas = Gt(t.canvas, n, e, ...c), Jt(t.roleCanvas, c, n, "junction"), t.canvas = Gt(t.canvas, n, e, ...s), Jt(t.roleCanvas, s, n, "arrow"), t.canvas = Gt(t.canvas, n, e, ...f);
  for (let l of f) nn(t.canvas, l);
  Jt(t.roleCanvas, f, n, "text");
  for (let l of t.subgraphs) {
    if (l.nodes.length === 0) continue;
    let [u, g] = So(l, t);
    t.canvas = Gt(t.canvas, g, e, u), ke(t.roleCanvas, u, g, "text");
  }
  return t.canvas;
}

// node_modules/beautiful-mermaid/src/ascii/grid.ts
function Mt(t, e, n) {
  let o = n ? { x: e.x + n.x, y: e.y + n.y } : e, a = 0;
  for (let c = 0; c < o.x; c++)
    a += t.columnWidth.get(c) ?? 0;
  let r = 0;
  for (let c = 0; c < o.y; c++)
    r += t.rowHeight.get(c) ?? 0;
  let i = t.columnWidth.get(o.x) ?? 0, s = t.rowHeight.get(o.y) ?? 0;
  return {
    x: a + Math.floor(i / 2) + t.offsetX,
    y: r + Math.floor(s / 2) + t.offsetY
  };
}
function zn(t, e) {
  return e.map((n) => Mt(t, n));
}
function te(t, e, n, o) {
  let a = o ?? Eo(t, e);
  if (t.grid.has(Bt(n)))
    return a === "LR" ? te(t, e, { x: n.x, y: n.y + 4 }, a) : te(t, e, { x: n.x + 4, y: n.y }, a);
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < 3; i++) {
      let s = { x: n.x + r, y: n.y + i };
      t.grid.set(Bt(s), e);
    }
  return e.gridCoord = n, n;
}
function To(t, e) {
  let n = e.gridCoord, o = t.config.boxBorderPadding, a = Hn(e.shape, e.displayLabel, {
    useAscii: t.config.useAscii,
    padding: o
  }), r = a.gridColumns, i = a.gridRows;
  for (let s = 0; s < r.length; s++) {
    let c = n.x + s, f = t.columnWidth.get(c) ?? 0;
    t.columnWidth.set(c, Math.max(f, r[s]));
  }
  for (let s = 0; s < i.length; s++) {
    let c = n.y + s, f = t.rowHeight.get(c) ?? 0;
    t.rowHeight.set(c, Math.max(f, i[s]));
  }
  if (n.x > 0) {
    let s = t.columnWidth.get(n.x - 1) ?? 0;
    t.columnWidth.set(n.x - 1, Math.max(s, t.config.paddingX));
  }
  if (n.y > 0) {
    let s = t.config.paddingY;
    Go(t, e) && (s += 4);
    let c = t.rowHeight.get(n.y - 1) ?? 0;
    t.rowHeight.set(n.y - 1, Math.max(c, s));
  }
}
function Fn(t, e) {
  for (let n of e)
    t.columnWidth.has(n.x) || t.columnWidth.set(n.x, Math.max(1, Math.floor(t.config.paddingX / 2))), t.rowHeight.has(n.y) || t.rowHeight.set(n.y, Math.max(1, Math.floor(t.config.paddingY / 2)));
}
function Ne(t, e) {
  return t.subgraphs.some((n) => n.nodes.includes(e));
}
function mt(t, e) {
  let n = null;
  for (let o of t.subgraphs)
    o.nodes.includes(e) && (!n || Lo(n, o)) && (n = o);
  return n;
}
function Lo(t, e) {
  let n = e;
  for (; n !== null; ) {
    if (n === t) return !0;
    n = n.parent;
  }
  return !1;
}
function Eo(t, e) {
  let n = mt(t, e);
  return n?.direction ? n.direction : t.config.graphDirection;
}
function Go(t, e) {
  let n = mt(t, e);
  if (!n) return !1;
  let o = !1;
  for (let a of t.edges)
    if (a.to === e && mt(t, a.from) !== n) {
      o = !0;
      break;
    }
  if (!o) return !1;
  for (let a of n.nodes) {
    if (a === e || !a.gridCoord) continue;
    let r = !1;
    for (let i of t.edges)
      if (i.to === a && mt(t, i.from) !== n) {
        r = !0;
        break;
      }
    if (r && a.gridCoord.y < e.gridCoord.y)
      return !1;
  }
  return !0;
}
function Jn(t, e) {
  if (e.nodes.length === 0) return;
  let n = 1e6, o = 1e6, a = -1e6, r = -1e6;
  for (let c of e.children)
    Jn(t, c), c.nodes.length > 0 && (n = Math.min(n, c.minX), o = Math.min(o, c.minY), a = Math.max(a, c.maxX), r = Math.max(r, c.maxY));
  for (let c of e.nodes) {
    if (!c.drawingCoord || !c.drawing) continue;
    let f = c.drawingCoord.x, d = c.drawingCoord.y, h = f + c.drawing.length - 1, l = d + c.drawing[0].length - 1;
    n = Math.min(n, f), o = Math.min(o, d), a = Math.max(a, h), r = Math.max(r, l);
  }
  let i = 2, s = 2;
  e.minX = n - i, e.minY = o - i - s, e.maxX = a + i, e.maxY = r + i;
}
function ko(t) {
  let n = t.subgraphs.filter((o) => o.parent === null && o.nodes.length > 0);
  for (let o = 0; o < n.length; o++)
    for (let a = o + 1; a < n.length; a++) {
      let r = n[o], i = n[a];
      r.minX < i.maxX && r.maxX > i.minX && (r.maxY >= i.minY - 1 && r.minY < i.minY ? i.minY = r.maxY + 1 + 1 : i.maxY >= r.minY - 1 && i.minY < r.minY && (r.minY = i.maxY + 1 + 1)), r.minY < i.maxY && r.maxY > i.minY && (r.maxX >= i.minX - 1 && r.minX < i.minX ? i.minX = r.maxX + 1 + 1 : i.maxX >= r.minX - 1 && i.minX < r.minX && (r.minX = i.maxX + 1 + 1));
    }
}
function Io(t) {
  for (let e of t.subgraphs)
    Jn(t, e);
  ko(t);
}
function No(t) {
  if (t.subgraphs.length === 0) return;
  let e = 0, n = 0;
  for (let r of t.subgraphs)
    e = Math.min(e, r.minX), n = Math.min(n, r.minY);
  let o = -e, a = -n;
  if (!(o === 0 && a === 0)) {
    t.offsetX = o, t.offsetY = a;
    for (let r of t.subgraphs)
      r.minX += o, r.minY += a, r.maxX += o, r.maxY += a;
    for (let r of t.nodes)
      r.drawingCoord && (r.drawingCoord.x += o, r.drawingCoord.y += a);
  }
}
function Un(t) {
  let e = t.config.graphDirection, n = new Array(100).fill(0), o = /* @__PURE__ */ new Set(), a = [];
  for (let l of t.nodes) {
    o.has(l.name) || a.push(l), o.add(l.name);
    for (let u of $e(t, l))
      o.add(u.name);
  }
  let r = a.filter((l) => {
    let u = mt(t, l);
    if (!u) return !0;
    for (let g of t.edges)
      if (g.to === l && mt(t, g.from) !== u)
        return !1;
    return !0;
  }), i = !1, s = !1;
  for (let l of r)
    Ne(t, l) ? $e(t, l).length > 0 && (s = !0) : i = !0;
  let c = e === "LR" && i && s, f, d = [];
  c ? (f = r.filter((l) => !Ne(t, l)), d = r.filter((l) => Ne(t, l))) : f = r;
  for (let l of f) {
    let u = e === "LR" ? { x: 0, y: n[0] } : { x: n[0], y: 0 };
    te(t, t.nodes[l.index], u), n[0] = n[0] + 4;
  }
  if (c && d.length > 0)
    for (let u of d) {
      let g = e === "LR" ? { x: 4, y: n[4] } : { x: n[4], y: 4 };
      te(t, t.nodes[u.index], g), n[4] = n[4] + 4;
    }
  let h = f.length + d.length;
  for (; h < t.nodes.length; ) {
    let l = h;
    for (let u of t.nodes) {
      if (u.gridCoord === null) continue;
      let g = u.gridCoord;
      for (let m of $e(t, u)) {
        if (m.gridCoord !== null) continue;
        let x = mt(t, u), w = mt(t, m), B = x && x === w && x.direction ? x.direction : t.config.graphDirection, v = B === "LR" ? g.x + 4 : g.y + 4, Y;
        B !== t.config.graphDirection ? Y = B === "LR" ? g.y : g.x : Y = n[v];
        let T = B === "LR" ? { x: v, y: Y } : { x: Y, y: v };
        te(t, t.nodes[m.index], T, B), B === t.config.graphDirection && (n[v] = Y + 4), h++;
      }
    }
    if (h === l) break;
  }
  for (let l of t.nodes)
    To(t, l);
  t.bundles = An(t), vn(t);
  for (let l of t.edges)
    if (!zt(t, l)) {
      if (l.bundle && l.path.length > 0) {
        Fn(t, l.path), we(t, l);
        continue;
      }
      fn(t, l), Fn(t, l.path), we(t, l);
    }
  Cn(t);
  for (let l of t.nodes)
    l.drawingCoord = Mt(t, l.gridCoord), l.drawing = jn(l, t);
  sn(t.canvas, t.columnWidth, t.rowHeight), an(t.roleCanvas, t.columnWidth, t.rowHeight), Io(t), No(t);
}
function $o(t, e) {
  return t.edges.filter((n) => n.from.name === e.name);
}
function $e(t, e) {
  return $o(t, e).map((n) => n.to);
}

// node_modules/beautiful-mermaid/src/sequence/parser.ts
function qn(t) {
  let e = {
    actors: [],
    messages: [],
    blocks: [],
    notes: []
  }, n = /* @__PURE__ */ new Set(), o = [];
  for (let a = 1; a < t.length; a++) {
    let r = t[a], i = r.match(/^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/);
    if (i) {
      let l = i[1], u = i[2], g = i[3]?.trim() ?? u, m = ut(g);
      n.has(u) || (n.add(u), e.actors.push({ id: u, label: m, type: l }));
      continue;
    }
    let s = r.match(/^Note\s+(left of|right of|over)\s+([^:]+):\s*(.+)$/i);
    if (s) {
      let l = s[1].toLowerCase(), u = s[2].trim(), g = ut(s[3].trim()), m = u.split(",").map((w) => w.trim());
      for (let w of m)
        ee(e, n, w);
      let x = "over";
      l === "left of" ? x = "left" : l === "right of" && (x = "right"), e.notes.push({
        actorIds: m,
        text: g,
        position: x,
        afterIndex: e.messages.length - 1
      });
      continue;
    }
    let c = r.match(/^(loop|alt|opt|par|critical|break|rect)\s*(.*)$/);
    if (c) {
      let l = c[1], u = c[2]?.trim() ?? "", g = ut(u);
      o.push({
        type: l,
        label: g,
        startIndex: e.messages.length,
        dividers: []
      });
      continue;
    }
    let f = r.match(/^(else|and)\s*(.*)$/);
    if (f && o.length > 0) {
      let l = f[2]?.trim() ?? "", u = ut(l);
      o[o.length - 1].dividers.push({
        index: e.messages.length,
        label: u
      });
      continue;
    }
    if (r === "end" && o.length > 0) {
      let l = o.pop();
      e.blocks.push({
        type: l.type,
        label: l.label,
        startIndex: l.startIndex,
        endIndex: Math.max(e.messages.length - 1, l.startIndex),
        dividers: l.dividers
      });
      continue;
    }
    let d = r.match(
      /^(\S+?)\s*(--?>?>|--?[)x]|--?>>|--?>)\s*([+-]?)(\S+?)\s*:\s*(.+)$/
    );
    if (d) {
      let l = d[1], u = d[2], g = d[3], m = d[4], x = ut(d[5].trim());
      ee(e, n, l), ee(e, n, m);
      let w = u.startsWith("--") ? "dashed" : "solid", B = u.includes(">>") || u.includes("x") ? "filled" : "open", v = {
        from: l,
        to: m,
        label: x,
        lineStyle: w,
        arrowHead: B
      };
      g === "+" && (v.activate = !0), g === "-" && (v.deactivate = !0), e.messages.push(v);
      continue;
    }
    let h = r.match(
      /^(\S+?)\s*(->>|-->>|-\)|--\)|-x|--x|->|-->)\s*([+-]?)(\S+?)\s*:\s*(.+)$/
    );
    if (h) {
      let l = h[1], u = h[2], g = h[3], m = h[4], x = ut(h[5].trim());
      ee(e, n, l), ee(e, n, m);
      let w = u.startsWith("--") ? "dashed" : "solid", B = u.includes(">>") || u.includes("x") ? "filled" : "open", v = { from: l, to: m, label: x, lineStyle: w, arrowHead: B };
      g === "+" && (v.activate = !0), g === "-" && (v.deactivate = !0), e.messages.push(v);
      continue;
    }
  }
  return e;
}
function ee(t, e, n) {
  e.has(n) || (e.add(n), t.actors.push({ id: n, label: n, type: "participant" }));
}

// node_modules/beautiful-mermaid/src/ascii/sequence.ts
function Vn(t, e, n, o) {
  let a = t.split(`
`).map((p) => p.trim()).filter((p) => p.length > 0 && !p.startsWith("%%")), r = qn(a);
  if (r.actors.length === 0) return "";
  let i = e.useAscii, s = i ? "-" : "\u2500", c = i ? "|" : "\u2502", f = i ? "+" : "\u250C", d = i ? "+" : "\u2510", h = i ? "+" : "\u2514", l = i ? "+" : "\u2518", u = i ? "+" : "\u252C", g = i ? "+" : "\u2534", m = i ? "+" : "\u251C", x = i ? "+" : "\u2524", w = /* @__PURE__ */ new Map();
  r.actors.forEach((p, y) => w.set(p.id, y));
  let B = 1, Y = r.actors.map((p) => de(p.label) + 2 * B + 2).map((p) => Math.ceil(p / 2)), T = r.actors.map((p) => Ee(p.label) + 2), K = Math.max(...T, 3), N = new Array(Math.max(r.actors.length - 1, 0)).fill(0);
  for (let p of r.messages) {
    let y = w.get(p.from), E = w.get(p.to);
    if (y === E) continue;
    let L = Math.min(y, E), I = Math.max(y, E), R = de(p.label) + 4, Q = I - L, $ = Math.ceil(R / Q);
    for (let S = L; S < I; S++)
      N[S] = Math.max(N[S], $);
  }
  let k = [Y[0]];
  for (let p = 1; p < r.actors.length; p++) {
    let y = Math.max(
      Y[p - 1] + Y[p] + 2,
      N[p - 1] + 2,
      10
    );
    k[p] = k[p - 1] + y;
  }
  let Z = [], G = [], P = /* @__PURE__ */ new Map(), C = /* @__PURE__ */ new Map(), U = /* @__PURE__ */ new Map(), F = [], V = K;
  for (let p = 0; p < r.messages.length; p++) {
    for (let I = 0; I < r.blocks.length; I++)
      r.blocks[I].startIndex === p && (V += 2, P.set(I, V - 1));
    for (let I = 0; I < r.blocks.length; I++)
      for (let R = 0; R < r.blocks[I].dividers.length; R++)
        r.blocks[I].dividers[R].index === p && (V += 1, U.set(`${I}:${R}`, V), V += 1);
    V += 1;
    let y = r.messages[p], E = y.from === y.to, L = Ee(y.label);
    E ? (G[p] = V + 1, Z[p] = V, V += 2 + L) : (G[p] = V, Z[p] = V + L, V += L + 1);
    for (let I = 0; I < r.notes.length; I++)
      if (r.notes[I].afterIndex === p) {
        V += 1;
        let R = r.notes[I], Q = st(R.text), $ = Math.max(...Q.map((_) => _.length)) + 4, S = Q.length + 2, q = w.get(R.actorIds[0]) ?? 0, D;
        if (R.position === "left")
          D = k[q] - $ - 1;
        else if (R.position === "right")
          D = k[q] + 2;
        else if (R.actorIds.length >= 2) {
          let _ = w.get(R.actorIds[1]) ?? q;
          D = Math.floor((k[q] + k[_]) / 2) - Math.floor($ / 2);
        } else
          D = k[q] - Math.floor($ / 2);
        D = Math.max(0, D), F.push({ x: D, y: V, width: $, height: S, lines: Q }), V += S;
      }
    for (let I = 0; I < r.blocks.length; I++)
      r.blocks[I].endIndex === p && (V += 1, C.set(I, V), V += 1);
  }
  V += 1;
  let ot = V, ft = ot + K, at = k[k.length - 1] ?? 0, lt = Y[Y.length - 1] ?? 0, A = at + lt + 2;
  for (let p = 0; p < r.messages.length; p++) {
    let y = r.messages[p];
    if (y.from === y.to) {
      let E = w.get(y.from), L = k[E] + 6 + 2 + y.label.length;
      A = Math.max(A, L + 1);
    }
  }
  for (let p of F)
    A = Math.max(A, p.x + p.width + 1);
  let j = ct(A, ft - 1), X = Ht(A, ft - 1);
  function M(p, y, E, L) {
    p >= 0 && p < j.length && y >= 0 && y < (j[0]?.length ?? 0) && (j[p][y] = E, Lt(X, p, y, L));
  }
  function J(p, y, E) {
    let L = st(E), I = de(E), R = I + 2 * B + 2, Q = L.length + 2, $ = p - Math.floor(R / 2);
    M($, y, f, "border");
    for (let q = 1; q < R - 1; q++) M($ + q, y, s, "border");
    M($ + R - 1, y, d, "border");
    for (let q = 0; q < L.length; q++) {
      let D = y + 1 + q;
      M($, D, c, "border"), M($ + R - 1, D, c, "border");
      let _ = L[q], nt = $ + 1 + B + Math.floor((I - _.length) / 2);
      for (let et = 0; et < _.length; et++)
        M(nt + et, D, _[et], "text");
    }
    let S = y + Q - 1;
    M($, S, h, "border");
    for (let q = 1; q < R - 1; q++) M($ + q, S, s, "border");
    M($ + R - 1, S, l, "border");
  }
  for (let p = 0; p < r.actors.length; p++) {
    let y = k[p];
    for (let E = K; E <= ot; E++)
      M(y, E, c, "line");
  }
  for (let p = 0; p < r.actors.length; p++) {
    let y = r.actors[p];
    J(k[p], 0, y.label), J(k[p], ot, y.label), i || (M(k[p], K - 1, u, "junction"), M(k[p], ot, g, "junction"));
  }
  for (let p = 0; p < r.messages.length; p++) {
    let y = r.messages[p], E = w.get(y.from), L = w.get(y.to), I = k[E], R = k[L], Q = E === L, $ = y.lineStyle === "dashed", S = y.arrowHead === "filled", q = $ ? i ? "." : "\u254C" : s;
    if (Q) {
      let D = Z[p], _ = Math.max(4, 4);
      M(I, D, m, "junction");
      for (let rt = I + 1; rt < I + _; rt++) M(rt, D, q, "line");
      M(I + _, D, i ? "+" : "\u2510", "corner"), M(I + _, D + 1, c, "line");
      let nt = I + _ + 2;
      for (let rt = 0; rt < y.label.length; rt++)
        nt + rt < A && M(nt + rt, D + 1, y.label[rt], "text");
      let et = S ? i ? "<" : "\u25C0" : i ? "<" : "\u25C1";
      M(I, D + 2, et, "arrow");
      for (let rt = I + 1; rt < I + _; rt++) M(rt, D + 2, q, "line");
      M(I + _, D + 2, i ? "+" : "\u2518", "corner");
    } else {
      let D = G[p], _ = Z[p], nt = I < R, et = Math.floor((I + R) / 2), rt = st(y.label);
      for (let it = 0; it < rt.length; it++) {
        let dt = rt[it], pt = et - Math.floor(dt.length / 2), Tt = D + it;
        for (let Ct = 0; Ct < dt.length; Ct++) {
          let Nt = pt + Ct;
          Nt >= 0 && Nt < A && M(Nt, Tt, dt[Ct], "text");
        }
      }
      if (nt) {
        for (let dt = I + 1; dt < R; dt++) M(dt, _, q, "line");
        M(R, _, S ? i ? ">" : "\u25B6" : i ? ">" : "\u25B7", "arrow");
      } else {
        for (let dt = R + 1; dt < I; dt++) M(dt, _, q, "line");
        M(R, _, S ? i ? "<" : "\u25C0" : i ? "<" : "\u25C1", "arrow");
      }
    }
  }
  for (let p = 0; p < r.blocks.length; p++) {
    let y = r.blocks[p], E = P.get(p), L = C.get(p);
    if (E === void 0 || L === void 0) continue;
    let I = A, R = 0;
    for (let D = y.startIndex; D <= y.endIndex && !(D >= r.messages.length); D++) {
      let _ = r.messages[D], nt = w.get(_.from) ?? 0, et = w.get(_.to) ?? 0;
      I = Math.min(I, k[Math.min(nt, et)]), R = Math.max(R, k[Math.max(nt, et)]);
    }
    let Q = Math.max(0, I - 4), $ = Math.min(A - 1, R + 4);
    M(Q, E, f, "border");
    for (let D = Q + 1; D < $; D++) M(D, E, s, "border");
    M($, E, d, "border");
    let S = y.label ? `${y.type} [${y.label}]` : y.type, q = st(S);
    for (let D = 0; D < q.length && E + D < L; D++) {
      let _ = q[D];
      for (let nt = 0; nt < _.length && Q + 1 + nt < $; nt++)
        M(Q + 1 + nt, E + D, _[nt], "text");
    }
    M(Q, L, h, "border");
    for (let D = Q + 1; D < $; D++) M(D, L, s, "border");
    M($, L, l, "border");
    for (let D = E + 1; D < L; D++)
      M(Q, D, c, "border"), M($, D, c, "border");
    for (let D = 0; D < y.dividers.length; D++) {
      let _ = U.get(`${p}:${D}`);
      if (_ === void 0) continue;
      let nt = tt();
      M(Q, _, m, "junction");
      for (let rt = Q + 1; rt < $; rt++) M(rt, _, nt, "line");
      M($, _, x, "junction");
      let et = y.dividers[D].label;
      if (et) {
        let rt = `[${et}]`;
        for (let it = 0; it < rt.length && Q + 1 + it < $; it++)
          M(Q + 1 + it, _, rt[it], "text");
      }
    }
  }
  for (let p of F) {
    Et(j, p.x + p.width, p.y + p.height), Yt(X, p.x + p.width, p.y + p.height), M(p.x, p.y, f, "border");
    for (let E = 1; E < p.width - 1; E++) M(p.x + E, p.y, s, "border");
    M(p.x + p.width - 1, p.y, d, "border");
    for (let E = 0; E < p.lines.length; E++) {
      let L = p.y + 1 + E;
      M(p.x, L, c, "border"), M(p.x + p.width - 1, L, c, "border");
      for (let I = 0; I < p.lines[E].length; I++)
        M(p.x + 2 + I, L, p.lines[E][I], "text");
    }
    let y = p.y + p.height - 1;
    M(p.x, y, h, "border");
    for (let E = 1; E < p.width - 1; E++) M(p.x + E, y, s, "border");
    M(p.x + p.width - 1, y, l, "border");
  }
  return _t(j, { roleCanvas: X, colorMode: n, theme: o });
  function tt() {
    return i ? "-" : "\u254C";
  }
}

// node_modules/beautiful-mermaid/src/class/parser.ts
function Qn(t) {
  let e = {
    classes: [],
    relationships: [],
    namespaces: []
  }, n = /* @__PURE__ */ new Map(), o = null, a = null, r = 0;
  for (let i = 1; i < t.length; i++) {
    let s = t[i];
    if (a && r > 0) {
      if (s === "}") {
        r--, r === 0 && (a = null);
        continue;
      }
      let g = s.match(/^<<(\w+)>>$/);
      if (g) {
        a.annotation = g[1];
        continue;
      }
      let m = Kn(s);
      m && (m.isMethod ? a.methods.push(m.member) : a.attributes.push(m.member));
      continue;
    }
    let c = s.match(/^namespace\s+(\S+)\s*\{$/);
    if (c) {
      o = { name: c[1], classIds: [] };
      continue;
    }
    if (s === "}" && o) {
      e.namespaces.push(o), o = null;
      continue;
    }
    let f = s.match(/^class\s+(\S+?)(?:\s*~(\w+)~)?\s*\{$/);
    if (f) {
      let g = f[1], m = f[2], x = qt(n, g);
      m && (x.label = `${g}<${m}>`), a = x, r = 1, o && o.classIds.push(g);
      continue;
    }
    let d = s.match(/^class\s+(\S+?)(?:\s*~(\w+)~)?\s*$/);
    if (d) {
      let g = d[1], m = d[2], x = qt(n, g);
      m && (x.label = `${g}<${m}>`), o && o.classIds.push(g);
      continue;
    }
    let h = s.match(/^class\s+(\S+?)\s*\{\s*<<(\w+)>>\s*\}$/);
    if (h) {
      let g = qt(n, h[1]);
      g.annotation = h[2];
      continue;
    }
    let l = s.match(/^(\S+?)\s*:\s*(.+)$/);
    if (l) {
      let g = l[2];
      if (!g.match(/<\|--|--|\*--|o--|-->|\.\.>|\.\.\|>/)) {
        let m = qt(n, l[1]), x = Kn(g);
        x && (x.isMethod ? m.methods.push(x.member) : m.attributes.push(x.member));
        continue;
      }
    }
    let u = Bo(s);
    if (u) {
      qt(n, u.from), qt(n, u.to), e.relationships.push(u);
      continue;
    }
  }
  return e.classes = [...n.values()], e;
}
function qt(t, e) {
  let n = t.get(e);
  return n || (n = { id: e, label: e, attributes: [], methods: [] }, t.set(e, n)), n;
}
function Kn(t) {
  let e = t.trim().replace(/;$/, "");
  if (!e) return null;
  let n = "", o = e;
  /^[+\-#~]/.test(o) && (n = o[0], o = o.slice(1).trim());
  let a = o.match(/^(.+?)\(([^)]*)\)(?:\s*(.+))?$/);
  if (a) {
    let d = a[1].trim(), h = a[2]?.trim() || void 0, l = a[3]?.trim(), u = d.endsWith("$") || o.includes("$"), g = d.endsWith("*") || o.includes("*");
    return {
      member: {
        visibility: n,
        name: d.replace(/[$*]$/, ""),
        type: l || void 0,
        isStatic: u,
        isAbstract: g,
        isMethod: !0,
        params: h
      },
      isMethod: !0
    };
  }
  let r = o.split(/\s+/), i, s;
  r.length >= 2 ? (s = r[0], i = r.slice(1).join(" ")) : i = r[0] ?? o;
  let c = i.endsWith("$"), f = i.endsWith("*");
  return {
    member: {
      visibility: n,
      name: i.replace(/[$*]$/, ""),
      type: s || void 0,
      isStatic: c,
      isAbstract: f,
      isMethod: !1
    },
    isMethod: !1
  };
}
function Bo(t) {
  let e = t.match(
    /^(\S+?)\s+(?:"([^"]*?)"\s+)?(<\|--|<\|\.\.|\*--|o--|-->|--\*|--o|--\|>|\.\.>|\.\.\|>|<--|<\.\.?|--)\s+(?:"([^"]*?)"\s+)?(\S+?)(?:\s*:\s*(.+))?$/
  );
  if (!e) return null;
  let n = e[1], o = e[2], a = o ? ut(o) : void 0, r = e[3].trim(), i = e[4], s = i ? ut(i) : void 0, c = e[5], f = e[6]?.trim(), d = f ? ut(f) : void 0, h = Yo(r);
  return h ? { from: n, to: c, type: h.type, markerAt: h.markerAt, label: d, fromCardinality: a, toCardinality: s } : null;
}
function Yo(t) {
  switch (t.trim()) {
    case "<|--":
      return { type: "inheritance", markerAt: "from" };
    case "--|>":
      return { type: "inheritance", markerAt: "to" };
    case "<|..":
      return { type: "realization", markerAt: "from" };
    case "..|>":
      return { type: "realization", markerAt: "to" };
    case "*--":
      return { type: "composition", markerAt: "from" };
    case "--*":
      return { type: "composition", markerAt: "to" };
    case "o--":
      return { type: "aggregation", markerAt: "from" };
    case "--o":
      return { type: "aggregation", markerAt: "to" };
    case "-->":
      return { type: "association", markerAt: "to" };
    case "<--":
      return { type: "association", markerAt: "from" };
    case "..>":
      return { type: "dependency", markerAt: "to" };
    case "<..":
      return { type: "dependency", markerAt: "from" };
    case "--":
      return { type: "association", markerAt: "to" };
    default:
      return null;
  }
}

// node_modules/beautiful-mermaid/src/ascii/class-diagram.ts
function Xo(t) {
  return /^[┌┐└┘├┤┬┴┼│─╭╮╰╯+\-|]$/.test(t) ? "border" : "text";
}
function Zn(t) {
  let e = t.visibility || "", n = t.type ? `: ${t.type}` : "";
  return `${e}${t.name}${n}`;
}
function Po(t) {
  let e = [];
  t.annotation && e.push(`<<${t.annotation}>>`);
  let n = st(t.label);
  e.push(...n);
  let o = t.attributes.map(Zn), a = t.methods.map(Zn);
  return o.length === 0 && a.length === 0 ? [e] : a.length === 0 ? [e, o] : [e, o, a];
}
function Ho(t, e) {
  return { type: t, markerAt: e, dashed: t === "dependency" || t === "realization" };
}
function Ft(t, e, n) {
  switch (t) {
    case "inheritance":
    case "realization":
      return n === "down" ? e ? "^" : "\u25B3" : n === "up" ? e ? "v" : "\u25BD" : n === "left" ? e ? ">" : "\u25C1" : e ? "<" : "\u25B7";
    case "composition":
      return e ? "*" : "\u25C6";
    case "aggregation":
      return e ? "o" : "\u25C7";
    case "association":
    case "dependency":
      return n === "down" ? e ? "v" : "\u25BC" : n === "up" ? e ? "^" : "\u25B2" : n === "left" ? e ? "<" : "\u25C0" : e ? ">" : "\u25B6";
  }
}
function tr(t, e, n, o) {
  let a = t.split(`
`).map((A) => A.trim()).filter((A) => A.length > 0 && !A.startsWith("%%")), r = Qn(a);
  if (r.classes.length === 0) return "";
  let i = e.useAscii, s = 4, c = 3, f = /* @__PURE__ */ new Map(), d = /* @__PURE__ */ new Map(), h = /* @__PURE__ */ new Map();
  for (let A of r.classes) {
    let j = Po(A);
    f.set(A.id, j);
    let X = 0;
    for (let p of j)
      for (let y of p) X = Math.max(X, y.length);
    let M = X + 4, J = 0;
    for (let p of j) J += Math.max(p.length, 1);
    let tt = J + (j.length - 1) + 2;
    d.set(A.id, M), h.set(A.id, tt);
  }
  let l = /* @__PURE__ */ new Map();
  for (let A of r.classes) l.set(A.id, A);
  let u = /* @__PURE__ */ new Map(), g = /* @__PURE__ */ new Map();
  for (let A of r.relationships) {
    let j = A.type === "inheritance" || A.type === "realization", X = j && A.markerAt === "to" ? A.to : A.from, M = j && A.markerAt === "to" ? A.from : A.to;
    u.has(M) || u.set(M, /* @__PURE__ */ new Set()), u.get(M).add(X), g.has(X) || g.set(X, /* @__PURE__ */ new Set()), g.get(X).add(M);
  }
  let m = /* @__PURE__ */ new Map(), w = r.classes.filter((A) => !u.has(A.id) || u.get(A.id).size === 0).map((A) => A.id);
  for (let A of w) m.set(A, 0);
  let B = r.classes.length - 1, v = 0;
  for (; v < w.length; ) {
    let A = w[v++], j = g.get(A);
    if (j)
      for (let X of j) {
        let M = (m.get(A) ?? 0) + 1;
        M > B || (!m.has(X) || m.get(X) < M) && (m.set(X, M), w.push(X));
      }
  }
  for (let A of r.classes)
    m.has(A.id) || m.set(A.id, 0);
  let Y = Math.max(...m.values(), 0), T = Array.from({ length: Y + 1 }, () => []);
  for (let A of r.classes)
    T[m.get(A.id)].push(A.id);
  let K = /* @__PURE__ */ new Map(), N = 0;
  for (let A = 0; A <= Y; A++) {
    let j = T[A];
    if (j.length === 0) continue;
    let X = 0, M = 0;
    for (let J of j) {
      let tt = l.get(J), p = d.get(J), y = h.get(J);
      K.set(J, {
        cls: tt,
        sections: f.get(J),
        x: X,
        y: N,
        width: p,
        height: y
      }), X += p + s, M = Math.max(M, y);
    }
    N += M + c;
  }
  let k = 0, Z = 0;
  for (let A of K.values())
    k = Math.max(k, A.x + A.width), Z = Math.max(Z, A.y + A.height);
  k += 4, Z += 2;
  let G = ct(k - 1, Z - 1), P = Ht(k - 1, Z - 1);
  function C(A, j, X, M) {
    A >= 0 && A < G.length && j >= 0 && j < (G[0]?.length ?? 0) && (G[A][j] = X, Lt(P, A, j, M));
  }
  for (let A of K.values()) {
    let j = ue(A.sections, i);
    for (let X = 0; X < j.length; X++)
      for (let M = 0; M < j[0].length; M++) {
        let J = j[X][M];
        if (J !== " ") {
          let tt = A.x + X, p = A.y + M;
          tt < k && p < Z && C(tt, p, J, Xo(J));
        }
      }
  }
  let U = [];
  for (let A of K.values())
    U.push({
      x1: A.x,
      x2: A.x + A.width - 1,
      y1: A.y,
      y2: A.y + A.height - 1
    });
  function F(A, j, X) {
    for (let [M, J] of K.entries())
      if (!X?.has(M) && A >= J.x && A <= J.x + J.width - 1 && j >= J.y && j <= J.y + J.height - 1)
        return !0;
    return !1;
  }
  function V(A, j, X, M) {
    let J = !0;
    for (let tt = Math.min(j, X); tt <= Math.max(j, X); tt++)
      if (F(A, tt, M)) {
        J = !1;
        break;
      }
    if (J) return A;
    for (let tt = 1; tt < k + 10; tt++) {
      let p = A + tt;
      J = !0;
      for (let E = Math.min(j, X); E <= Math.max(j, X); E++)
        if (F(p, E, M)) {
          J = !1;
          break;
        }
      if (J) return p;
      let y = A - tt;
      if (y >= 0) {
        J = !0;
        for (let E = Math.min(j, X); E <= Math.max(j, X); E++)
          if (F(y, E, M)) {
            J = !1;
            break;
          }
        if (J) return y;
      }
    }
    return k + 2;
  }
  let ot = i ? "-" : "\u2500", ft = i ? "|" : "\u2502", at = i ? "." : "\u254C", lt = i ? ":" : "\u250A";
  for (let A of r.relationships) {
    let j = K.get(A.from), X = K.get(A.to);
    if (!j || !X) continue;
    let M = Ho(A.type, A.markerAt), J = M.dashed ? at : ot, tt = M.dashed ? lt : ft, p = /* @__PURE__ */ new Set([A.from, A.to]), y = j.x + Math.floor(j.width / 2), E = j.y + j.height - 1, L = X.x + Math.floor(X.width / 2), I = X.y;
    if (E < I) {
      let R = V(y, E + 1, I - 1, p), Q = R !== y;
      if (R >= k && Et(G, R + 2, Z), Q) {
        let $ = E + 1, S = I - 1, q = Math.min(y, R), D = Math.max(y, R);
        for (let _ = q; _ <= D; _++)
          C(_, $, J, "line");
        !i && $ < (G[0]?.length ?? 0) && (y < R ? (C(y, $, "\u2514", "corner"), C(R, $, "\u2510", "corner")) : (C(y, $, "\u2518", "corner"), C(R, $, "\u250C", "corner")));
        for (let _ = $ + 1; _ <= S; _++)
          C(R, _, tt, "line");
        if (R !== L) {
          let _ = Math.min(R, L), nt = Math.max(R, L);
          for (let et = _; et <= nt; et++)
            C(et, S, J, "line");
          !i && S < (G[0]?.length ?? 0) && (R < L ? (C(R, S, "\u2514", "corner"), C(L, S, "\u2510", "corner")) : (C(R, S, "\u2518", "corner"), C(L, S, "\u250C", "corner")));
        }
        if (M.markerAt === "to") {
          let _ = Ft(M.type, i, "down");
          C(L, S, _, "arrow");
        }
        if (M.markerAt === "from") {
          let _ = Ft(M.type, i, "down");
          C(y, E + 1, _, "arrow");
        }
      } else {
        let $ = E + Math.floor((I - E) / 2);
        for (let S = E + 1; S <= $; S++)
          C(y, S, tt, "line");
        if (y !== L && $ < (G[0]?.length ?? 0)) {
          let S = Math.min(y, L), q = Math.max(y, L);
          for (let D = S; D <= q; D++)
            C(D, $, J, "line");
          i || (C(y, $, y < L ? "\u2514" : "\u2518", "corner"), C(L, $, y < L ? "\u2510" : "\u250C", "corner"));
        }
        for (let S = $ + 1; S < I; S++)
          C(L, S, tt, "line");
        M.markerAt === "to" && C(L, I - 1, Ft(M.type, i, "down"), "arrow"), M.markerAt === "from" && C(y, E + 1, Ft(M.type, i, "down"), "arrow");
      }
    } else if (X.y + X.height - 1 < j.y) {
      let R = j.y, Q = X.y + X.height - 1, $ = Q + Math.floor((R - Q) / 2);
      for (let S = R - 1; S >= $; S--)
        C(y, S, tt, "line");
      if (y !== L) {
        let S = Math.min(y, L), q = Math.max(y, L);
        for (let D = S; D <= q; D++)
          C(D, $, J, "line");
        !i && $ >= 0 && $ < Z && (C(y, $, y < L ? "\u250C" : "\u2510", "corner"), C(L, $, y < L ? "\u2518" : "\u2514", "corner"));
      }
      for (let S = $ - 1; S > Q; S--)
        C(L, S, tt, "line");
      if (M.markerAt === "from") {
        let S = Ft(M.type, i, "up"), q = R - 1;
        for (let D = 0; D < S.length; D++)
          C(y - Math.floor(S.length / 2) + D, q, S[D], "arrow");
      }
      if (M.markerAt === "to") {
        let q = M.type === "inheritance" || M.type === "realization" ? "down" : "up", D = Ft(M.type, i, q), _ = Q + 1;
        for (let nt = 0; nt < D.length; nt++)
          C(L - Math.floor(D.length / 2) + nt, _, D[nt], "arrow");
      }
    } else {
      let R = Math.max(E, X.y + X.height - 1) + 2;
      Et(G, k, R + 1), Yt(P, k, R + 1);
      for (let S = E + 1; S <= R; S++)
        C(y, S, tt, "line");
      let Q = Math.min(y, L), $ = Math.max(y, L);
      for (let S = Q; S <= $; S++)
        C(S, R, J, "line");
      for (let S = R - 1; S >= X.y + X.height; S--)
        C(L, S, tt, "line");
      if (M.markerAt === "from") {
        let S = Ft(M.type, i, "down"), q = E + 1;
        for (let D = 0; D < S.length; D++)
          C(y - Math.floor(S.length / 2) + D, q, S[D], "arrow");
      }
      if (M.markerAt === "to") {
        let S = Ft(M.type, i, "up"), q = X.y + X.height;
        for (let D = 0; D < S.length; D++)
          C(L - Math.floor(S.length / 2) + D, q, S[D], "arrow");
      }
    }
    if (A.label) {
      let R = st(A.label), Q = Math.max(...R.map((et) => et.length)) + 2, $, S;
      if (E < I)
        $ = Math.floor((E + 1 + I - 1) / 2), S = Math.floor((y + L) / 2);
      else if (X.y + X.height - 1 < j.y) {
        let et = X.y + X.height - 1;
        $ = Math.floor((et + 1 + j.y - 1) / 2), S = Math.floor((y + L) / 2);
      } else
        $ = Math.max(E, X.y + X.height - 1) + 2, S = Math.floor((y + L) / 2);
      let q = $, D = Math.floor(R.length / 2), _ = !1;
      for (let et = 0; et < R.length; et++) {
        let rt = q - D + et, it = S - Math.floor(Q / 2), dt = Math.max(0, it);
        for (let pt = dt; pt < dt + Q; pt++)
          if (F(pt, rt, p)) {
            _ = !0;
            break;
          }
        if (_) break;
      }
      if (_) {
        let et = E + 1, rt = I - 1;
        for (let it = et; it <= rt; it++) {
          let dt = !0, pt = S - Math.floor(Q / 2), Tt = Math.max(0, pt);
          for (let Ct = Tt; Ct < Tt + Q; Ct++)
            if (F(Ct, it, p)) {
              dt = !1;
              break;
            }
          if (dt) {
            q = it;
            break;
          }
        }
      }
      let nt = q - D;
      for (let et = 0; et < R.length; et++) {
        let rt = ` ${R[et]} `, it = S - Math.floor(rt.length / 2), dt = Math.max(0, it), pt = nt + et, Tt = dt + rt.length;
        Tt > 0 && pt >= 0 && (Et(G, Math.max(Tt, 1), Math.max(pt + 1, 1)), Yt(P, Math.max(Tt, 1), Math.max(pt + 1, 1)));
        for (let Ct = 0; Ct < rt.length; Ct++) {
          let Nt = dt + Ct;
          Nt >= 0 && pt >= 0 && C(Nt, pt, rt[Ct], "text");
        }
      }
    }
  }
  return _t(G, { roleCanvas: P, colorMode: n, theme: o });
}

// node_modules/beautiful-mermaid/src/er/parser.ts
function nr(t) {
  let e = {
    entities: [],
    relationships: []
  }, n = /* @__PURE__ */ new Map(), o = null;
  for (let a = 1; a < t.length; a++) {
    let r = t[a];
    if (o) {
      if (r === "}") {
        o = null;
        continue;
      }
      let c = Wo(r);
      c && o.attributes.push(c);
      continue;
    }
    let i = r.match(/^(\S+)\s*\{$/);
    if (i) {
      let c = i[1];
      o = Be(n, c);
      continue;
    }
    let s = _o(r);
    if (s) {
      Be(n, s.entity1), Be(n, s.entity2), e.relationships.push(s);
      continue;
    }
  }
  return e.entities = [...n.values()], e;
}
function Be(t, e) {
  let n = t.get(e);
  return n || (n = { id: e, label: e, attributes: [] }, t.set(e, n)), n;
}
function Wo(t) {
  let e = t.match(/^(\S+)\s+(\S+)(?:\s+(.+))?$/);
  if (!e) return null;
  let n = e[1], o = e[2], a = e[3]?.trim() ?? "", r = [], i, s = a.match(/"([^"]*)"/);
  s && (i = ut(s[1]));
  let c = a.replace(/"[^"]*"/, "").trim();
  for (let f of c.split(/\s+/)) {
    let d = f.toUpperCase();
    (d === "PK" || d === "FK" || d === "UK") && r.push(d);
  }
  return { type: n, name: o, keys: r, comment: i };
}
function _o(t) {
  let e = t.match(/^(\S+)\s+([|o}{]+(?:--|\.\.)[|o}{]+)\s+(\S+)\s*:\s*(.+)$/);
  if (!e) return null;
  let n = e[1], o = e[2], a = e[3], r = e[4].trim().replace(/^["']|["']$/g, ""), i = ut(r), s = o.match(/^([|o}{]+)(--|\.\.?)([|o}{]+)$/);
  if (!s) return null;
  let c = s[1], f = s[2], d = s[3], h = er(c), l = er(d), u = f === "--";
  return !h || !l ? null : { entity1: n, entity2: a, cardinality1: h, cardinality2: l, label: i, identifying: u };
}
function er(t) {
  let e = t.split("").sort().join("");
  return e === "||" ? "one" : e === "o|" ? "zero-one" : e === "|}" || e === "{|" ? "many" : e === "{o" || e === "o{" ? "zero-many" : null;
}

// node_modules/beautiful-mermaid/src/ascii/er-diagram.ts
function jo(t) {
  return /^[┌┐└┘├┤┬┴┼│─╭╮╰╯+\-|]$/.test(t) ? "border" : "text";
}
function Oo(t) {
  return `${t.keys.length > 0 ? t.keys.join(",") + " " : "   "}${t.type} ${t.name}`;
}
function zo(t) {
  let e = st(t.label), n = t.attributes.map(Oo);
  return n.length === 0 ? [e] : [e, n];
}
function he(t, e, n = !1) {
  if (e)
    switch (t) {
      case "one":
        return "|";
      case "zero-one":
        return "o|";
      case "many":
        return n ? "<" : ">";
      case "zero-many":
        return n ? "o<" : ">o";
    }
  else
    switch (t) {
      case "one":
        return "\u2502";
      case "zero-one":
        return "\u25CB\u2502";
      case "many":
        return n ? "\u255F" : "\u2562";
      case "zero-many":
        return n ? "\u25CB\u255F" : "\u2562\u25CB";
    }
}
function Fo(t) {
  let e = /* @__PURE__ */ new Set(), n = [], o = /* @__PURE__ */ new Map();
  for (let r of t.entities)
    o.set(r.id, /* @__PURE__ */ new Set());
  for (let r of t.relationships)
    o.get(r.entity1)?.add(r.entity2), o.get(r.entity2)?.add(r.entity1);
  function a(r, i) {
    let s = [r];
    for (; s.length > 0; ) {
      let c = s.pop();
      if (!e.has(c)) {
        e.add(c), i.add(c);
        for (let f of o.get(c) ?? [])
          e.has(f) || s.push(f);
      }
    }
  }
  for (let r of t.entities)
    if (!e.has(r.id)) {
      let i = /* @__PURE__ */ new Set();
      a(r.id, i), i.size > 0 && n.push(i);
    }
  return n;
}
function rr(t, e, n, o) {
  let a = t.split(`
`).map((G) => G.trim()).filter((G) => G.length > 0 && !G.startsWith("%%")), r = nr(a);
  if (r.entities.length === 0) return "";
  let i = e.useAscii, s = 6, c = 4, f = 6, d = /* @__PURE__ */ new Map(), h = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Map(), u = /* @__PURE__ */ new Map();
  for (let G of r.entities) {
    u.set(G.id, G);
    let P = zo(G);
    d.set(G.id, P);
    let C = 0;
    for (let ot of P)
      for (let ft of ot) C = Math.max(C, ft.length);
    let U = C + 4, F = 0;
    for (let ot of P) F += Math.max(ot.length, 1);
    let V = F + (P.length - 1) + 2;
    h.set(G.id, U), l.set(G.id, V);
  }
  let g = Fo(r), m = /* @__PURE__ */ new Map(), x = 0;
  for (let G of g) {
    let P = r.entities.filter((ft) => G.has(ft.id)), C = Math.max(2, Math.ceil(Math.sqrt(P.length))), U = 0, F = 0, V = 0, ot = x;
    for (let ft of P) {
      let at = h.get(ft.id), lt = l.get(ft.id);
      V >= C && (x += F + c, U = 0, F = 0, V = 0), m.set(ft.id, {
        entity: ft,
        sections: d.get(ft.id),
        x: U,
        y: x,
        width: at,
        height: lt
      }), U += at + s, F = Math.max(F, lt), V++;
    }
    x += F + f;
  }
  let w = 0, B = 0;
  for (let G of m.values())
    w = Math.max(w, G.x + G.width), B = Math.max(B, G.y + G.height);
  w += 4, B += 2;
  let v = ct(w - 1, B - 1), Y = Ht(w - 1, B - 1);
  function T(G, P, C, U) {
    G >= 0 && G < v.length && P >= 0 && P < (v[0]?.length ?? 0) && (v[G][P] = C, Lt(Y, G, P, U));
  }
  for (let G of m.values()) {
    let P = ue(G.sections, i);
    for (let C = 0; C < P.length; C++)
      for (let U = 0; U < P[0].length; U++) {
        let F = P[C][U];
        if (F !== " ") {
          let V = G.x + C, ot = G.y + U;
          V < w && ot < B && T(V, ot, F, jo(F));
        }
      }
  }
  let K = i ? "-" : "\u2500", N = i ? "|" : "\u2502", k = i ? "." : "\u254C", Z = i ? ":" : "\u250A";
  for (let G of r.relationships) {
    let P = m.get(G.entity1), C = m.get(G.entity2);
    if (!P || !C) continue;
    let U = G.identifying ? K : k, F = G.identifying ? N : Z, V = P.x + Math.floor(P.width / 2), ot = P.y + Math.floor(P.height / 2), ft = C.x + Math.floor(C.width / 2), at = C.y + Math.floor(C.height / 2);
    if (Math.abs(ot - at) < Math.max(P.height, C.height)) {
      let [A, j] = V < ft ? [P, C] : [C, P], [X, M] = V < ft ? [G.cardinality1, G.cardinality2] : [G.cardinality2, G.cardinality1], J = A.x + A.width, tt = j.x - 1, p = A.y + Math.floor(A.height / 2);
      for (let L = J; L <= tt; L++)
        T(L, p, U, "line");
      let y = he(X, i, !1);
      for (let L = 0; L < y.length; L++)
        T(J + L, p, y[L], "arrow");
      let E = he(M, i, !0);
      for (let L = 0; L < E.length; L++)
        T(tt - E.length + 1 + L, p, E[L], "arrow");
      if (G.label) {
        let L = st(G.label), I = Math.floor((J + tt) / 2);
        for (let R = 0; R < L.length; R++) {
          let Q = L[R], $ = Math.max(J, I - Math.floor(Q.length / 2)), S = p + 1 + R;
          Et(v, Math.max($ + Q.length, 1), Math.max(S + 1, 1)), Yt(Y, Math.max($ + Q.length, 1), Math.max(S + 1, 1));
          for (let q = 0; q < Q.length; q++) {
            let D = $ + q;
            D >= J && D <= tt && T(D, S, Q[q], "text");
          }
        }
      }
    } else {
      let [A, j] = ot < at ? [P, C] : [C, P], [X, M] = ot < at ? [G.cardinality1, G.cardinality2] : [G.cardinality2, G.cardinality1], J = A.y + A.height, tt = j.y - 1, p = A.x + Math.floor(A.width / 2);
      for (let R = J; R <= tt; R++)
        T(p, R, F, "line");
      let y = j.x + Math.floor(j.width / 2);
      if (p !== y) {
        let R = Math.floor((J + tt) / 2), Q = Math.min(p, y), $ = Math.max(p, y);
        for (let S = Q; S <= $; S++)
          T(S, R, U, "line");
        for (let S = R + 1; S <= tt; S++)
          T(y, S, F, "line");
      }
      let E = he(X, i, !1);
      for (let R = 0; R < E.length; R++)
        T(p - Math.floor(E.length / 2) + R, J, E[R], "arrow");
      let L = p !== y ? y : p, I = he(M, i, !0);
      for (let R = 0; R < I.length; R++)
        T(L - Math.floor(I.length / 2) + R, tt, I[R], "arrow");
      if (G.label) {
        let R = st(G.label), $ = Math.floor((J + tt) / 2) - Math.floor((R.length - 1) / 2);
        for (let S = 0; S < R.length; S++) {
          let q = R[S], D = p + 2, _ = $ + S;
          if (_ >= 0)
            for (let nt = 0; nt < q.length; nt++) {
              let et = D + nt;
              et >= 0 && (Et(v, et + 1, _ + 1), Yt(Y, et + 1, _ + 1), T(et, _, q[nt], "text"));
            }
        }
      }
    }
  }
  return _t(v, { roleCanvas: Y, colorMode: n, theme: o });
}

// node_modules/beautiful-mermaid/src/xychart/parser.ts
function ir(t) {
  let e = {}, n = {}, o = [], a, r = !1;
  for (let i of t) {
    if (/^xychart(-beta)?\b/i.test(i)) {
      /\bhorizontal\b/i.test(i) && (r = !0);
      continue;
    }
    let s = i.match(/^title\s+"([^"]+)"/);
    if (s) {
      a = s[1];
      continue;
    }
    let c = i.match(/^x-axis\s+(?:"([^"]*)"\s*)?\[([^\]]+)\]/);
    if (c) {
      c[1] && (e.title = c[1]), e.categories = c[2].split(",").map((g) => g.trim());
      continue;
    }
    let f = i.match(/^x-axis\s+(?:"([^"]*)"\s+)?(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?)/);
    if (f) {
      f[1] && (e.title = f[1]), e.range = { min: parseFloat(f[2]), max: parseFloat(f[3]) };
      continue;
    }
    let d = i.match(/^y-axis\s+(?:"([^"]*)"\s+)?(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?)/);
    if (d) {
      d[1] && (n.title = d[1]), n.range = { min: parseFloat(d[2]), max: parseFloat(d[3]) };
      continue;
    }
    let h = i.match(/^y-axis\s+"([^"]+)"\s*$/);
    if (h) {
      n.title = h[1];
      continue;
    }
    let l = i.match(/^bar\s+(?:"([^"]*)"\s*|([^\s"[]+)\s+)?\[([^\]]+)\]/);
    if (l) {
      o.push({ type: "bar", name: l[1] ?? l[2], data: or(l[3]) });
      continue;
    }
    let u = i.match(/^line\s+(?:"([^"]*)"\s*|([^\s"[]+)\s+)?\[([^\]]+)\]/);
    if (u) {
      o.push({ type: "line", name: u[1] ?? u[2], data: or(u[3]) });
      continue;
    }
  }
  if (!n.range && o.length > 0) {
    let i = o.flatMap((d) => d.data), s = Math.min(...i), c = Math.max(...i), f = c - s || 1;
    s = s - f * 0.1, c = c + f * 0.1, s > 0 && s < f * 0.5 && (s = 0), n.range = { min: s, max: c };
  }
  return n.range || (n.range = { min: 0, max: 100 }), { title: a, horizontal: r, xAxis: e, yAxis: n, series: o };
}
function or(t) {
  return t.split(",").map((e) => parseFloat(e.trim()));
}

// node_modules/beautiful-mermaid/src/xychart/colors.ts
var Ye = "#3b82f6";
function ar(t) {
  let e = t.replace("#", ""), n = parseInt(e.substring(0, 2), 16) / 255, o = parseInt(e.substring(2, 4), 16) / 255, a = parseInt(e.substring(4, 6), 16) / 255, r = Math.max(n, o, a), i = Math.min(n, o, a), s = (r + i) / 2;
  if (r === i) return [0, 0, s * 100];
  let c = r - i, f = s > 0.5 ? c / (2 - r - i) : c / (r + i), d;
  return r === n ? d = ((o - a) / c + (o < a ? 6 : 0)) / 6 : r === o ? d = ((a - n) / c + 2) / 6 : d = ((n - o) / c + 4) / 6, [d * 360, f * 100, s * 100];
}
function Jo(t, e, n) {
  let o = e / 100, a = n / 100, r = (1 - Math.abs(2 * a - 1)) * o, i = r * (1 - Math.abs(t / 60 % 2 - 1)), s = a - r / 2, c, f, d;
  t < 60 ? (c = r, f = i, d = 0) : t < 120 ? (c = i, f = r, d = 0) : t < 180 ? (c = 0, f = r, d = i) : t < 240 ? (c = 0, f = i, d = r) : t < 300 ? (c = i, f = 0, d = r) : (c = r, f = 0, d = i);
  let h = (l) => Math.round((l + s) * 255).toString(16).padStart(2, "0");
  return `#${h(c)}${h(f)}${h(d)}`;
}
function sr(t) {
  return /^#[0-9a-fA-F]{6}$/.test(t);
}
function Uo(t) {
  return ar(t)[2] < 50;
}
function cr(t, e, n) {
  if (t === 0) return e;
  let o = sr(e) ? e : Ye, a = n && sr(n) ? n : void 0, [r, i] = ar(o), s = Math.max(55, Math.min(85, i)), c = Math.ceil(t / 2), f = t % 2 === 1, d = a && Uo(a) ? !f : f, h = d ? Math.max(25, 48 - c * 13) : Math.min(78, 55 + c * 11), l = (d ? -8 : 12) * c, u = ((r + l) % 360 + 360) % 360;
  return Jo(u, s, h);
}

// node_modules/beautiful-mermaid/src/ascii/xychart.ts
var Xe = 60, Pe = 20, qo = {
  hLine: "\u2500",
  vLine: "\u2502",
  origin: "\u253C",
  yTick: "\u2524",
  xTick: "\u252C",
  bar: "\u2588",
  grid: "\xB7",
  cornerTL: "\u256D",
  // top-left: down+right
  cornerTR: "\u256E",
  // top-right: down+left
  cornerBL: "\u2570",
  // bottom-left: up+right
  cornerBR: "\u256F"
  // bottom-right: up+left
}, lr = {
  hLine: "-",
  vLine: "|",
  origin: "+",
  yTick: "+",
  xTick: "+",
  bar: "#",
  grid: ".",
  cornerTL: "+",
  cornerTR: "+",
  cornerBL: "+",
  cornerBR: "+"
};
function fr(t, e) {
  let n = e.accent ?? Ye;
  return t <= 1 ? [n] : Array.from({ length: t }, (o, a) => cr(a, n, e.bg));
}
function Vo(t, e) {
  switch (t) {
    case "text":
      return e.fg;
    case "border":
      return e.border;
    case "line":
      return e.line;
    case "arrow":
      return e.arrow;
    case "corner":
      return e.corner ?? e.line;
    case "junction":
      return e.junction ?? e.border;
    default:
      return e.fg;
  }
}
function dr(t, e, n, o) {
  let a = t.split(`
`).map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith("%%")), r = ir(a), i = e.useAscii ? lr : qo;
  return r.horizontal ? Qo(r, i, n, o) : Ko(r, i, n, o);
}
function Ko(t, e, n, o) {
  let a = xr(t);
  if (a === 0) return "";
  let r = t.yAxis.range, i = yr(r.min, r.max), s = i.length > 1 ? i[1] - i[0] : Math.abs(r.max - r.min) || 1, c = Math.floor(r.min / s + 1e-9) * s, f = Math.max(c + s, Math.ceil(r.max / s - 1e-9) * s), d = Math.round((f - c) / s), h = Array.from({ length: d + 1 }, (p, y) => Math.round((c + y * s) * 1e10) / 1e10), l = h.map((p) => me(p)), u = Math.max(...l.map((p) => p.length)) + 1, g = Math.max(Xe, a * 6), m = Math.max(1, Math.round(Pe / d)), x = d * m, w = s / m, B = (p) => (p - c) / w, v = B(Math.min(Math.max(0, c), f)), Y = Math.round(v) - 1, T = Math.floor(g / a), K = br(t, a), N = !!t.title, k = !!t.xAxis.title, Z = t.series.length > 1, G = N ? 0 : -1, P = (N ? 2 : 0) + (Z ? 1 : 0), C = u + 1, U = C + T * a + 2, F = P + x, V = F + 1, ot = k ? V + 1 : -1, ft = V + 1 + (k ? 1 : 0) + 0, at = hr(U, ft), lt = mr(U, ft), A = gr(U, ft), j = fr(t.series.length, o), X = (p) => Math.min(x - 1, Math.max(-1, Math.round(B(p)) - 1)), M = (p) => C + Math.floor(T * (p + 0.5));
  N && G >= 0 && Wt(at, lt, G, Math.floor(U / 2 - t.title.length / 2), t.title, "text"), Z && ur(at, lt, A, t, N ? 1 : 0, U, e, j);
  for (let p = 0; p < x; p++) {
    let y = P + (x - 1 - p);
    yt(at, lt, y, C - 1, e.vLine, "border");
  }
  yt(at, lt, F, C - 1, e.origin, "border");
  for (let p of h) {
    let y = Math.round(B(p)) - 1;
    if (y < -1 || y >= x) continue;
    let E = P + (x - 1 - y), L = me(p);
    yt(at, lt, E, C - 1, y === -1 || y === Y ? e.origin : e.yTick, "border");
    let I = u - L.length;
    Wt(at, lt, E, Math.max(0, I), L, "text");
  }
  for (let p = C; p < C + T * a; p++)
    yt(at, lt, F, p, e.hLine, "border");
  for (let p = 0; p < a; p++) {
    let y = M(p);
    yt(at, lt, F, y, e.xTick, "border");
    let E = K[p], L = y - Math.floor(E.length / 2);
    Wt(at, lt, V, Math.max(0, L), E, "text");
  }
  if (k && ot >= 0) {
    let p = t.xAxis.title;
    Wt(at, lt, ot, Math.floor(U / 2 - p.length / 2), p, "text");
  }
  for (let p of h) {
    let y = Math.round(B(p)) - 1;
    if (y < 0 || y >= x) continue;
    let E = P + (x - 1 - y);
    for (let L = C; L < C + T * a; L++)
      He(at, E, L) === " " && yt(at, lt, E, L, y === Y ? e.hLine : e.grid, y === Y ? "border" : "line");
  }
  let J = [];
  for (let p = 0; p < t.series.length; p++)
    t.series[p].type === "bar" && J.push({ data: t.series[p].data, globalIdx: p });
  if (J.length > 0) {
    let p = J.length, y = Math.max(1, T - 2), E = Math.max(1, Math.min(Math.floor(y / p), 8)), L = E * p + (p - 1);
    for (let I = 0; I < J.length; I++) {
      let R = J[I], Q = j[R.globalIdx];
      for (let $ = 0; $ < R.data.length; $++) {
        let D = M($) - Math.floor(L / 2) + I * (E + 1), _ = B(R.data[$]), nt = _ < v ? Math.ceil(_ * 2 - 1e-9) / 2 : Math.floor(_ * 2 + 1e-9) / 2, et = Math.max(0, Math.min(v, nt)), rt = Math.min(x, Math.max(v, nt));
        for (let it = -1; it < x; it++) {
          let dt = et <= it + 0.5 + 1e-9 && rt >= it + 1 - 1e-9, pt = et <= it + 1 + 1e-9 && rt >= it + 1.5 - 1e-9, Tt = e === lr ? (nt < v ? pt : dt) && e.bar : dt && pt ? e.bar : dt ? "\u2584" : pt && "\u2580";
          if (!Tt) continue;
          let Ct = P + (x - 1 - it);
          for (let Nt = D; Nt < D + E; Nt++)
            yt(at, lt, Ct, Nt, Tt, "arrow", A, Q);
        }
      }
    }
  }
  let tt = [];
  for (let p = 0; p < t.series.length; p++)
    t.series[p].type === "line" && tt.push({ data: t.series[p].data, globalIdx: p });
  for (let p of tt) {
    if (p.data.length === 0) continue;
    let y = j[p.globalIdx];
    Zo(at, lt, p.data, M, X, P, x, C, T * a, e, A, y);
  }
  return pr(at, lt, A, n, o);
}
function Qo(t, e, n, o) {
  let a = xr(t);
  if (a === 0) return "";
  let r = t.yAxis.range, i = yr(r.min, r.max), s = br(t, a), c = Math.max(...s.map((C) => C.length)) + 1, f = Math.max(Xe, 40), d = Math.max(2, Math.floor(Pe / a)), h = d * a, l = !!t.title, u = !!t.yAxis.title, g = t.series.length > 1, m = (l ? 2 : 0) + (g ? 1 : 0), x = c + 1, w = x + f + 2, B = m + h + 2 + (u ? 1 : 0), v = m + h, Y = hr(w, B), T = mr(w, B), K = gr(w, B), N = fr(t.series.length, o), k = (C) => {
    let U = (C - r.min) / (r.max - r.min || 1);
    return x + Math.round(U * (f - 1));
  }, Z = (C) => m + Math.floor(d * (C + 0.5));
  l && Wt(Y, T, 0, Math.floor(w / 2 - t.title.length / 2), t.title, "text"), g && ur(Y, T, K, t, l ? 1 : 0, w, e, N);
  for (let C = m; C < m + h; C++)
    yt(Y, T, C, x - 1, e.vLine, "border");
  yt(Y, T, v, x - 1, e.origin, "border");
  for (let C = 0; C < a; C++) {
    let U = Z(C), F = s[C], V = c - F.length;
    Wt(Y, T, U, Math.max(0, V), F, "text");
  }
  for (let C = x; C < x + f; C++)
    yt(Y, T, v, C, e.hLine, "border");
  for (let C of i) {
    let U = k(C);
    if (U < x || U >= x + f) continue;
    yt(Y, T, v, U, e.xTick, "border");
    let F = me(C);
    Wt(Y, T, v + 1, U - Math.floor(F.length / 2), F, "text");
  }
  if (u) {
    let C = t.yAxis.title;
    Wt(Y, T, B - 1, Math.floor(w / 2 - C.length / 2), C, "text");
  }
  for (let C of i) {
    let U = k(C);
    if (!(U < x || U >= x + f))
      for (let F = m; F < m + h; F++)
        He(Y, F, U) === " " && yt(Y, T, F, U, e.grid, "line");
  }
  let G = [];
  for (let C = 0; C < t.series.length; C++)
    t.series[C].type === "bar" && G.push({ data: t.series[C].data, globalIdx: C });
  if (G.length > 0) {
    let C = G.length, U = 1, F = U * C + (C - 1), V = k(Math.max(0, r.min));
    for (let ot = 0; ot < G.length; ot++) {
      let ft = G[ot], at = N[ft.globalIdx];
      for (let lt = 0; lt < ft.data.length; lt++) {
        let X = Z(lt) - Math.floor(F / 2) + ot * (U + 1), M = k(ft.data[lt]), J = Math.min(V, M), tt = Math.max(V, M);
        for (let p = X; p < X + U; p++)
          for (let y = J; y <= tt; y++)
            yt(Y, T, p, y, e.bar, "arrow", K, at);
      }
    }
  }
  let P = [];
  for (let C = 0; C < t.series.length; C++)
    t.series[C].type === "line" && P.push({ data: t.series[C].data, globalIdx: C });
  for (let C of P) {
    if (C.data.length === 0) continue;
    let U = N[C.globalIdx];
    ti(Y, T, C.data, Z, k, m, h, x, f, e, K, U);
  }
  return pr(Y, T, K, n, o);
}
function Zo(t, e, n, o, a, r, i, s, c, f, d, h) {
  if (n.length === 0) return;
  let l = n.map((g, m) => ({
    col: o(m),
    row: a(g)
  })), u = (g, m, x) => {
    let w = r + (i - 1 - m);
    w >= 0 && g >= s && g < s + c && ![f.bar, "\u2580", "\u2584"].includes(He(t, w, g)) && yt(t, e, w, g, x, "arrow", d, h);
  };
  if (l.length === 1) {
    u(l[0].col, l[0].row, f.hLine);
    return;
  }
  for (let g = 0; g < l.length - 1; g++) {
    let m = l[g], x = l[g + 1];
    if (m.row === x.row) {
      for (let T = m.col; T <= x.col; T++)
        u(T, m.row, f.hLine);
      continue;
    }
    let w = Math.round((m.col + x.col) / 2), B = x.row > m.row;
    for (let T = m.col; T < w; T++)
      u(T, m.row, f.hLine);
    B ? u(w, m.row, f.cornerBR) : u(w, m.row, f.cornerTR);
    let v = Math.min(m.row, x.row), Y = Math.max(m.row, x.row);
    for (let T = v + 1; T < Y; T++)
      u(w, T, f.vLine);
    B ? u(w, x.row, f.cornerTL) : u(w, x.row, f.cornerBL);
    for (let T = w + 1; T <= x.col; T++)
      u(T, x.row, f.hLine);
    if (g === 0) {
      let T = Math.max(s, m.col - Math.floor((x.col - m.col) / 4));
      for (let K = T; K < m.col; K++)
        u(K, m.row, f.hLine);
    }
    if (g === l.length - 2) {
      let T = Math.min(s + c - 1, x.col + Math.floor((x.col - m.col) / 4));
      for (let K = x.col + 1; K <= T; K++)
        u(K, x.row, f.hLine);
    }
  }
}
function ti(t, e, n, o, a, r, i, s, c, f, d, h) {
  if (n.length === 0) return;
  let l = n.map((g, m) => ({
    row: o(m),
    col: a(g)
  })), u = (g, m, x) => {
    g >= r && g < r + i && m >= s && m < s + c && yt(t, e, g, m, x, "arrow", d, h);
  };
  if (l.length === 1) {
    u(l[0].row, l[0].col, f.vLine);
    return;
  }
  for (let g = 0; g < l.length - 1; g++) {
    let m = l[g], x = l[g + 1];
    if (m.col === x.col) {
      for (let T = m.row; T <= x.row; T++)
        u(T, m.col, f.vLine);
      continue;
    }
    let w = Math.round((m.row + x.row) / 2), B = x.col > m.col;
    for (let T = m.row; T < w; T++)
      u(T, m.col, f.vLine);
    B ? u(w, m.col, f.cornerBL) : u(w, m.col, f.cornerBR);
    let v = Math.min(m.col, x.col), Y = Math.max(m.col, x.col);
    for (let T = v + 1; T < Y; T++)
      u(w, T, f.hLine);
    B ? u(w, x.col, f.cornerTR) : u(w, x.col, f.cornerTL);
    for (let T = w + 1; T <= x.row; T++)
      u(T, x.col, f.vLine);
  }
}
function ur(t, e, n, o, a, r, i, s) {
  let c = [], f = 0, d = 0;
  for (let g = 0; g < o.series.length; g++) {
    let m = o.series[g];
    m.type === "bar" ? (c.push({ symbol: i.bar, label: m.name || `Bar ${f + 1}`, globalIdx: g }), f++) : (c.push({ symbol: i.hLine, label: m.name || `Line ${d + 1}`, globalIdx: g }), d++);
  }
  let h = 0;
  for (let g = 0; g < c.length; g++)
    g > 0 && (h += 2), h += 2 + c[g].label.length;
  let u = Math.max(0, Math.floor(r / 2 - h / 2));
  for (let g = 0; g < c.length; g++) {
    g > 0 && (u += 2);
    let m = c[g];
    yt(t, e, a, u, m.symbol, "arrow", n, s[m.globalIdx]), u += 1, u += 1, Wt(t, e, a, u, m.label, "text"), u += m.label.length;
  }
}
function hr(t, e) {
  return Array.from({ length: t }, () => Array.from({ length: e }, () => " "));
}
function mr(t, e) {
  return Array.from({ length: t }, () => Array.from({ length: e }).fill(null));
}
function gr(t, e) {
  return Array.from({ length: t }, () => Array.from({ length: e }).fill(null));
}
function yt(t, e, n, o, a, r, i, s) {
  o >= 0 && o < t.length && n >= 0 && n < t[0].length && (t[o][n] = a, e[o][n] = r, i && s && (i[o][n] = s));
}
function He(t, e, n) {
  return n >= 0 && n < t.length && e >= 0 && e < t[0].length ? t[n][e] : " ";
}
function Wt(t, e, n, o, a, r) {
  for (let i = 0; i < a.length; i++)
    yt(t, e, n, o + i, a[i], r);
}
function pr(t, e, n, o, a) {
  if (t.length === 0) return "";
  let r = t[0].length, i = t.length, s = [];
  for (let c = 0; c < r; c++) {
    let f = [], d = [], h = [];
    for (let u = 0; u < i; u++)
      f.push(t[u][c]), d.push(e[u][c]), h.push(n[u][c]);
    let l = f.length - 1;
    for (; l >= 0 && f[l] === " "; ) l--;
    l < 0 ? s.push("") : s.push(ei(
      f.slice(0, l + 1),
      d.slice(0, l + 1),
      h.slice(0, l + 1),
      a,
      o
    ));
  }
  for (; s.length > 0 && s[s.length - 1] === ""; )
    s.pop();
  return s.join(`
`);
}
function ei(t, e, n, o, a) {
  if (a === "none") return t.join("");
  let r = "", i = null, s = "";
  for (let c = 0; c < t.length; c++) {
    let f = t[c];
    if (f === " ") {
      s.length > 0 && (r += i ? ae(s, i, a) : s, s = "", i = null), r += " ";
      continue;
    }
    let d = n[c] ?? null, h = e[c] ?? null, l = d ?? (h ? Vo(h, o) : null);
    l === i ? s += f : (s.length > 0 && (r += i ? ae(s, i, a) : s), s = f, i = l);
  }
  return s.length > 0 && (r += i ? ae(s, i, a) : s), r;
}
function xr(t) {
  if (t.xAxis.categories) return t.xAxis.categories.length;
  for (let e of t.series)
    if (e.data.length > 0) return e.data.length;
  return 0;
}
function br(t, e) {
  if (t.xAxis.categories) return t.xAxis.categories;
  if (t.xAxis.range) {
    let { min: n, max: o } = t.xAxis.range, a = e > 1 ? (o - n) / (e - 1) : 0;
    return Array.from({ length: e }, (r, i) => me(n + a * i));
  }
  return Array.from({ length: e }, (n, o) => String(o + 1));
}
function yr(t, e) {
  let n = e - t;
  if (n <= 0) return [t];
  let o = n / 6, a = Math.pow(10, Math.floor(Math.log10(o))), r = o / a, i;
  r <= 1.5 ? i = a : r <= 3 ? i = 2 * a : r <= 7 ? i = 5 * a : i = 10 * a;
  let s = Math.ceil(t / i) * i, c = [];
  for (let f = s; f <= e + i * 1e-3; f += i)
    c.push(Math.round(f * 1e10) / 1e10);
  return c;
}
function me(t) {
  return Number.isInteger(t) ? String(t) : t.toFixed(Math.abs(t) < 10 ? 1 : 0);
}
var ni = (t, e) => {
  Xe = t, Pe = e;
};

// node_modules/beautiful-mermaid/src/ascii/index.ts
function ri(t) {
  let e = t.trim().split(`
`)[0]?.trim().toLowerCase() ?? "";
  return /^xychart(-beta)?\b/.test(e) ? "xychart" : /^sequencediagram\s*$/.test(e) ? "sequence" : /^classdiagram\s*$/.test(e) ? "class" : /^erdiagram\s*$/.test(e) ? "er" : "flowchart";
}
function oi(t, e = {}) {
  let n = {
    useAscii: e.useAscii ?? !1,
    paddingX: e.paddingX ?? 5,
    paddingY: e.paddingY ?? 5,
    boxBorderPadding: e.boxBorderPadding ?? 1,
    graphDirection: "TD"
    // default, overridden for flowcharts below
  }, o = e.colorMode === "auto" || e.colorMode === void 0 ? Je() : e.colorMode, a = { ...ie, ...e.theme };
  switch (ri(t)) {
    case "xychart":
      return dr(t, n, o, a);
    case "sequence":
      return Vn(t, n, o, a);
    case "class":
      return tr(t, n, o, a);
    case "er":
      return rr(t, n, o, a);
    default: {
      let i = ze(t);
      i.direction === "LR" || i.direction === "RL" ? n.graphDirection = "LR" : n.graphDirection = "TD";
      let s = cn(i, n);
      return Un(s), On(s), i.direction === "BT" && (rn(s.canvas), on(s.roleCanvas)), _t(s.canvas, {
        roleCanvas: s.roleCanvas,
        colorMode: o,
        theme: a
      });
    }
  }
}
var ii = oi;
export {
  ii as renderMermaidAscii,
  ni as setChartSize
};
