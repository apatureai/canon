/* A Tailwind v3 config. It is executable code, which is why `ui-dna context`
   ignores it unless you pass --exec-tailwind-config; the boxShadow closure below
   only produces a value once Tailwind's resolveConfig actually runs it. */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: "#2f6fed", surface: "#ffffff" },
      borderRadius: { card: "12px" },
      spacing: { gutter: "16px" },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
      boxShadow: ({ theme }) => ({ card: `0 1px 3px ${theme("colors.black")}14` }),
    },
  },
};
