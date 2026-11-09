import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Các test tích hợp dùng chung 1 CSDL test nên chạy lần lượt từng file
    fileParallelism: false,
  },
});
