#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Listening Hub · 镜像构建与发布脚本
#
#  用法：
#    ./build-image.sh                # 本地 build，tag 为 latest
#    ./build-image.sh 1.0            # 本地 build，tag 为 1.0 和 latest
#    ./build-image.sh 1.0 push       # build + push 到仓库（需先 docker login）
#    ./build-image.sh 1.0 save       # build + 导出 tar 包（适合离线传给 NAS）
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── 配置 ────────────────────────────────────────────────────
# 修改为你自己的镜像仓库地址
IMAGE_NAME="${IMAGE_NAME:-listening-hub/voa-english}"

# ── 参数解析 ────────────────────────────────────────────────
VERSION="${1:-latest}"
ACTION="${2:-build}"

# ── 构建 ────────────────────────────────────────────────────
echo "🐳 构建镜像 ${IMAGE_NAME}:${VERSION} ..."

docker build \
  -t "${IMAGE_NAME}:${VERSION}" \
  -t "${IMAGE_NAME}:latest" \
  .

echo "✅ 构建完成"
docker images "${IMAGE_NAME}" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"

# ── 后续动作 ────────────────────────────────────────────────
case "$ACTION" in
  push)
    echo ""
    echo "📤 推送到镜像仓库 ..."
    docker push "${IMAGE_NAME}:${VERSION}"
    docker push "${IMAGE_NAME}:latest"
    echo "✅ 推送完成"
    echo ""
    echo "NAS 上执行：  docker pull ${IMAGE_NAME}:${VERSION}"
    ;;
  save)
    TAR_FILE="voa-english-${VERSION}.tar"
    echo ""
    echo "📦 导出镜像到 ${TAR_FILE} ..."
    docker save -o "${TAR_FILE}" "${IMAGE_NAME}:${VERSION}" "${IMAGE_NAME}:latest"
    gzip -f "${TAR_FILE}"
    echo "✅ 导出完成：${TAR_FILE}.gz ($(du -h "${TAR_FILE}.gz" | cut -f1))"
    echo ""
    echo "NAS 上执行："
    echo "  gunzip -c ${TAR_FILE}.gz | docker load"
    echo "  docker compose up -d"
    ;;
  build|"")
    echo ""
    echo "本地测试运行："
    echo "  docker run --rm -p 28080:28080 ${IMAGE_NAME}:${VERSION}"
    ;;
  *)
    echo "❌ 未知操作：${ACTION}（可选：build / push / save）"
    exit 1
    ;;
esac
