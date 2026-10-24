// Round 4 (2026-10-24): colour for P&L and one highlight, proposed for docs/DESIGN.md §2.
// Every value and ratio here was computed by colour-check.mjs (WCAG 2.x contrast; Machado et al.
// 2009 colour-vision simulation at full severity; distance in OKLab ×100). The source is
// docs/research/2026-10-24-pnl-and-highlight-colours.md: change a value there first, then here.
export const HUE = {
  gain: "#006B55", // on paper 5.53:1
  loss: "#BA2C1A", // on paper 5.16:1
  gainOnInk: "#3FC4A2", // on ink 9.63:1
  lossOnInk: "#FF7A4D", // on ink 8.14:1
}
// The three highlight options: a fill behind ink text (G, H) or a text colour and rule (J).
export const MARK = {
  G: { name: "Highlighter", hex: "#F9DC5C", kind: "fill", inkOn: "15.4:1", vsPaper: "1.16:1" },
  H: { name: "Signal orange", hex: "#FF5F1F", kind: "fill", inkOn: "6.9:1", vsPaper: "2.59:1" },
  J: { name: "Blue pencil", hex: "#1F4FBF", kind: "text", inkOn: "2.9:1 (fails)", vsPaper: "6.10:1" },
}
// The same two figures as each kind of colour vision sees them.
export const SIM = {
  classic: { pair: ["#2E7D32", "#C62828"], normal: ["#2E7D32", "#C62828"], protan: ["#7F722A", "#5B5226"], deutan: ["#756B38", "#817420"], tritan: ["#1E7A6D", "#DA002B"], dE: { protan: "11.6", deutan: "4.3", tritan: "30.9" } },
  proposed: { pair: ["#006B55", "#BA2C1A"], normal: ["#006B55", "#BA2C1A"], protan: ["#676354", "#594E15"], deutan: ["#5C5A57", "#7B6E10"], tritan: ["#006C65", "#CD002A"], dE: { protan: "9.2", deutan: "12.1", tritan: "30.3" } },
}
