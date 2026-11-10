# --- Build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- Chạy ---
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
# Mã nguồn tiện ích Chrome (server đóng gói .zip cho người dùng tải)
COPY --from=build /app/extension ./extension
WORKDIR /app/server
EXPOSE 3000
# Tự chạy migrate CSDL rồi khởi động server (phục vụ cả API và giao diện)
CMD ["npm", "start"]
