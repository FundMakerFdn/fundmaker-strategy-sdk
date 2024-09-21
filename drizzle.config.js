import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.js",
  out: "./drizzle",
  dbCredentials: {
    url: "./uniswap.db",
  },
});
