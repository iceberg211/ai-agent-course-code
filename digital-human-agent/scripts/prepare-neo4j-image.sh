#!/usr/bin/env bash
set -euo pipefail

version="${NEO4J_VERSION:-5.26.26}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vendor_dir="${root_dir}/docker/neo4j/vendor"
archive="${vendor_dir}/neo4j-community-${version}-unix.tar.gz"
source_dir="${vendor_dir}/neo4j-community-${version}"
download_url="https://dist.neo4j.org/neo4j-community-${version}-unix.tar.gz"

mkdir -p "${vendor_dir}"

if [[ ! -d "${source_dir}" ]]; then
  if [[ ! -f "${archive}" ]]; then
    echo "下载 Neo4j ${version} 官方包：${download_url}"
    curl -L -C - "${download_url}" -o "${archive}"
  fi

  echo "解压 Neo4j ${version} 到 ${vendor_dir}"
  tar -xzf "${archive}" -C "${vendor_dir}"
fi

rm -rf "${source_dir}/data" "${source_dir}/logs" "${source_dir}/run"
rm -f "${archive}"

if [[ ! -f "${source_dir}/labs/apoc-${version}-core.jar" ]]; then
  echo "缺少 APOC 插件：${source_dir}/labs/apoc-${version}-core.jar" >&2
  exit 1
fi

echo "Neo4j ${version} 本地镜像上下文已准备好"
