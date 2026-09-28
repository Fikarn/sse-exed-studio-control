import StyleDictionary from "style-dictionary";

StyleDictionary.registerFormat({
  name: "sse/typescript-tokens",
  format: ({ dictionary, options }) => {
    // Style Dictionary v5 runs this source in DTCG mode (`$value`/`$type`), so a
    // token's resolved value lives on `$value`, not the legacy `value`. Reading
    // `.value` here yields `undefined` for every token, which `JSON.stringify`
    // then omits — the cause of the previously-empty `{}` output.
    const useDtcg = options?.usesDtcg ?? false;
    const tokens = Object.fromEntries(
      dictionary.allTokens.map((token) => [token.name, useDtcg ? token.$value : token.value])
    );

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
            // an alias names its base in the stylesheet as it does in
            // core.json, and a scope that re-points a base (the wells, in
            // wells.css) carries its aliases with it.
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
