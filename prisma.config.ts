import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// O CLI do Prisma 7 não carrega .env sozinho; dotenv/config cuida disso.
// DATABASE_URL é opcional em `prisma generate` (ex.: build da imagem Docker).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
