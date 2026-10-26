import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    // n8n-seo-automation/ is a standalone n8n project (Node tooling, not site code)
    ignores: [".next/**", "out/**", "node_modules/**", "n8n-seo-automation/**"],
  },
];

export default eslintConfig;
