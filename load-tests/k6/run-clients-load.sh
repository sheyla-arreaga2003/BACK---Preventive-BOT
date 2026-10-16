#!/bin/zsh
set -euo pipefail

readonly project_root="${0:A:h:h:h}"
readonly credentials_file="${project_root}/.env.k6.credentials.local"
readonly k6_binary="${HOME}/.local/bin/k6"
readonly run_id="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
readonly result_file="load-tests/k6/results/clients-load-${run_id}.json"

if [[ ! -f "${credentials_file}" ]]; then
  print -u2 "Falta .env.k6.credentials.local. No se ejecutó la prueba."
  exit 1
fi

if [[ ! -x "${k6_binary}" ]]; then
  print -u2 "No se encontró el binario de k6 en ~/.local/bin/k6."
  exit 1
fi

set -a
source "${credentials_file}"
set +a

cd "${project_root}"
exec "${k6_binary}" run \
  -e BASE_URL="${BASE_URL:-http://127.0.0.1:3100}" \
  -e K6_TEST_EMAIL="${K6_TEST_EMAIL}" \
  -e K6_TEST_PASSWORD="${K6_TEST_PASSWORD}" \
  -e K6_PAUSE_SECONDS="${K6_PAUSE_SECONDS:-1}" \
  -e K6_RESULT_FILE="${result_file}" \
  load-tests/k6/clients.load.js
