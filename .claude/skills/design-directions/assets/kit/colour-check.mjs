// Contrast (WCAG 2.x) and colour-vision-deficiency checks for P&L and highlight candidates.
// CVD: Machado, Oliveira & Fernandes (2009) matrices at severity 1.0, applied in linear RGB.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const unlin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const L = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const M = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
}
const toHex = (rgb) => "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, unlin(c))) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()
const sim = (h, m) => { const v = hex(h).map(lin); return toHex(M[m].map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])) }
// CIEDE-lite: Euclidean distance in OKLab, enough to compare candidates.
function oklab(h) {
  const [r, g, b] = hex(h).map(lin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const dE = (a, b) => { const p = oklab(a), q = oklab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100 }

const PAPER = "#EDEDE8", INK = "#000000"
const pairs = {
  "paper text": [["#1D6B3A", "#B3261E"], ["#00715A", "#B83A14"], ["#0B6B63", "#C2410C"], ["#006B55", "#BA2C1A"], ["#0F6E5C", "#C0341D"], ["#00684F", "#B5341A"]],
  "ink panel text": [["#4CC77F", "#FF7369"], ["#3FC4A2", "#FF7A4D"], ["#45C8A8", "#FF8A5C"]],
}
for (const [where, list] of Object.entries(pairs)) {
  console.log(`\n== P&L pairs, ${where}`)
  const ground = where.startsWith("paper") ? PAPER : INK
  for (const [g, r] of list) {
    const row = [`${g}/${r}`, `on ground ${cr(g, ground).toFixed(2)} / ${cr(r, ground).toFixed(2)}`, `ΔE ${dE(g, r).toFixed(1)}`, `L ${L(g).toFixed(3)}/${L(r).toFixed(3)}`]
    for (const m of ["protan", "deutan", "tritan"]) row.push(`${m} ${sim(g, m)}/${sim(r, m)} ΔE ${dE(sim(g, m), sim(r, m)).toFixed(1)}`)
    console.log(row.join(" · "))
  }
}
console.log("\n== Highlight candidates (a fill behind ink text, or a mark)")
for (const [name, h] of [["marker yellow", "#F9DC5C"], ["deep marker", "#F2C53D"], ["signal orange", "#FF5F1F"], ["blue pencil", "#1F4FBF"], ["soft blue fill", "#C9D8F7"], ["lilac fill", "#D9CCF5"]]) {
  const row = [`${name} ${h}`, `ink on it ${cr(INK, h).toFixed(2)}`, `vs paper ${cr(h, PAPER).toFixed(2)}`, `as text on paper ${cr(h, PAPER).toFixed(2)}`, `ΔE paper ${dE(h, PAPER).toFixed(1)}`]
  for (const m of ["protan", "deutan", "tritan"]) row.push(`${m} ${sim(h, m)} ΔEvsLoss ${dE(sim(h, m), sim("#B3261E", m)).toFixed(1)} vsGain ${dE(sim(h, m), sim("#1D6B3A", m)).toFixed(1)}`)
  console.log(row.join(" · "))
}
