#!/usr/bin/env bash
set -euo pipefail

export NEO4J_HOME="${NEO4J_HOME:-/var/lib/neo4j}"
export JAVA_HOME="${JAVA_HOME:-/usr/share/elasticsearch/jdk}"
export PATH="${JAVA_HOME}/bin:${NEO4J_HOME}/bin:${PATH}"

config_file="${NEO4J_HOME}/conf/neo4j.conf"

append_config_once() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" "${config_file}"; then
    printf '%s=%s\n' "${key}" "${value}" >> "${config_file}"
  fi
}

append_config_once "server.default_listen_address" "0.0.0.0"
append_config_once "dbms.security.procedures.unrestricted" "${NEO4J_dbms_security_procedures_unrestricted:-apoc.*}"

auth_value="${NEO4J_AUTH:-neo4j/12345678}"
if [[ "${auth_value}" != "none" && ! -d "/data/databases/system" ]]; then
  username="${auth_value%%/*}"
  password="${auth_value#*/}"
  if [[ "${username}" != "neo4j" || -z "${password}" || "${password}" == "${auth_value}" ]]; then
    echo "NEO4J_AUTH 必须是 neo4j/<password> 或 none" >&2
    exit 1
  fi
  neo4j-admin dbms set-initial-password "${password}" >/dev/null
fi

exec "$@"
