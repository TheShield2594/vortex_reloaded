import type { Config } from "drizzle-kit"
import { resolveDbPath } from "./src/db-path"

export default {
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: resolveDbPath(),
  },
} satisfies Config
