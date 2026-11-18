#!/usr/bin/env bash
# Read-only preflight before changing a repository from private to public.
# It does not change visibility, push, or print matched secret values.
set -u
cd "$(git rev-parse --show-toplevel)"

fail=0
echo "== tracked files that usually must not be public =="
git ls-files | grep -E '(^|/)\.env($|\.)|id_rsa|\.pem$|\.p12$|credentials\.json$' \
  | grep -v -E '\.example$|\.sample$|\.template$' || true

echo "== likely credential patterns in the current tree (names only) =="
if git grep -I -l -E 'sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY' -- . \
  | grep -v -E '(spec|test|fixture|example|docs?)/' | head -20; then
  echo "Review the files above. Test fixtures and documentation examples are expected."
else
  echo "none"
fi

echo "== deleted/renamed credential-shaped paths in history (names only) =="
git log --all --name-only --pretty=format: -- . 2>/dev/null \
  | grep -E '(^|/)\.env($|\.)|id_rsa|\.pem$|\.p12$|credentials\.json$' \
  | grep -v -E '\.example$|\.sample$|\.template$' | sort -u | head -20 || true

echo
echo "Manual checks still required:"
echo "  1. Rotate anything that ever contained a real credential."
echo "  2. Review forks and cached artifacts; a visibility change is not reversible for them."
echo "  3. Confirm the license and notices permit public distribution."
echo "  4. Only an organization owner should run gh repo edit --visibility public."
exit "$fail"
