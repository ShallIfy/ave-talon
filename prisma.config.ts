import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load Next.js-style env files in the same order Next does:
// .env.development.local > .env.local > .env.development > .env
for (const file of [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
]) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) loadEnv({ path: p });
}

export default defineConfig({
  schema: "./prisma/schema.prisma",
  migrations: {
    path: "./prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
