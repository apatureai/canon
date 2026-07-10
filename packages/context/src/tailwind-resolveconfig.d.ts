// The aliased Tailwind v3 package ships `resolveConfig.js` + `resolveConfig.d.ts`
// but does not expose a NodeNext-resolvable types condition for this subpath.
// Declare the minimal signature we use (resolve -> resolved theme).
declare module "tailwindcss-v3/resolveConfig" {
  export default function resolveConfig(config: unknown): { theme: Record<string, unknown> };
}
