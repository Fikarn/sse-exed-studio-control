import StyleDictionary from "style-dictionary";

StyleDictionary.registerFormat({
  name: "sse/typescript-tokens",
  format: ({ dictionary }) => {
    const tokens = Object.fromEntries(dictionary.allTokens.map((token) => [token.name, token.value]));

    return `export const tokenValues = ${JSON.stringify(tokens, null, 2)} as const;

export type TokenName = keyof typeof tokenValues;
`;
  },
});

export default {
  source: ["src/tokens/**/*.json"],
  platforms: {
    css: {
      transformGroup: "css",
      buildPath: "src/generated/",
      files: [
        {
          destination: "tokens.css",
          format: "css/variables",
          options: {
            selector: ":root",
            // Emit `var(--base)` for any token whose value is a reference, so
            // the Slice 1 semantic aliases stay theme-aware: Slice 3's
            // `[data-theme]` blocks then only override the base tokens and the
            // aliases cascade. Functionally identical in the single dark theme
            // (var() resolves to the same value the literal would have).
            outputReferences: true,
          },
        },
      ],
    },
    ts: {
      transformGroup: "js",
      buildPath: "src/generated/",
      files: [
        {
          destination: "tokens.ts",
          format: "sse/typescript-tokens",
        },
      ],
    },
    docs: {
      transformGroup: "js",
      buildPath: "dist/docs/",
      files: [
        {
          destination: "tokens.json",
          format: "json/nested",
        },
      ],
    },
  },
};
