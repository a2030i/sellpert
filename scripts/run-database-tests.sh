#!/usr/bin/env bash
set -euo pipefail

readonly database_url="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

mapfile -t test_files < <(find supabase/tests -maxdepth 1 -type f -name '*.sql' -print | sort)

if [[ ${#test_files[@]} -eq 0 ]]; then
  echo "No database tests were found." >&2
  exit 1
fi

echo "Running ${#test_files[@]} database isolation and authorization tests..."
for test_file in "${test_files[@]}"; do
  echo "::group::${test_file}"
  psql "${database_url}" --no-psqlrc --set ON_ERROR_STOP=1 --file "${test_file}"
  echo "::endgroup::"
done

echo "All ${#test_files[@]} database tests passed."

