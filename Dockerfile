# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────
#  Listening Hub · VOA English Static Site
#  Lightweight nginx image serving the SPA on port 28080
# ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

LABEL maintainer="Listening Hub Contributors"
LABEL description="VOA Special English listening practice · Vue 3 · PWA"

# 复制静态资源
COPY index.html app.js manifest.json service-worker.js /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/

# 复制自定义 nginx 配置（监听 28080）
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 28080

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://localhost:28080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
