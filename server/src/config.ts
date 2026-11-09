import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET phải dài ít nhất 16 ký tự'),
  ADMIN_EMAIL: z.string().email().default('admin@checklive.local'),
  ADMIN_PASSWORD: z.string().min(6).default('doimatkhau'),
  EULER_API_KEY: z.string().optional(),
  FB_GRAPH_VERSION: z.string().default('v26.0'),
  /** Thư mục chứa webapp đã build (để server phục vụ luôn giao diện) */
  WEB_DIST: z.string().optional(),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Cấu hình không hợp lệ:\n${msg}`);
  }
  return parsed.data;
}
