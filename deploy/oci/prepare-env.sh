#!/bin/sh
set -eu

cd "$(dirname "$0")"
if [ -e app.env ] || [ -e origin.env ]; then
  echo 'Refusing to replace existing app.env or origin.env.' >&2
  exit 1
fi
command -v openssl >/dev/null 2>&1 || {
  echo 'OpenSSL is required to create local secrets.' >&2
  exit 1
}

umask 077
read_secret() {
  secret_name=$1
  secret_prompt=$2
  printf '%s' "$secret_prompt"
  trap 'stty echo 2>/dev/null || true' EXIT HUP INT TERM
  stty -echo
  IFS= read -r "$secret_name"
  stty echo
  trap - EXIT HUP INT TERM
  printf '\n'
}

read_secret MONGO_URI 'Enter the connection string for a database-only Coderax MongoDB user: '
case "$MONGO_URI" in
  mongodb+srv://*|mongodb://*) ;;
  *) echo 'Expected a mongodb:// or mongodb+srv:// connection string.' >&2; exit 1 ;;
esac
case "$MONGO_URI" in
  *' '*|*'\'*|*'\n'*|*'$'*) echo 'The connection string contains unsupported characters; percent-encode reserved URI characters.' >&2; exit 1 ;;
esac

read_secret JWT_SECRET 'Enter the existing production JWT_SECRET from Vercel: '
read_secret JWT_REFRESH_SECRET 'Enter the existing production JWT_REFRESH_SECRET from Vercel: '
read_secret CREDS_KEY 'Enter the existing production CREDS_KEY from Vercel: '
read_secret CREDS_IV 'Enter the existing production CREDS_IV from Vercel: '

for secret in "$JWT_SECRET" "$JWT_REFRESH_SECRET" "$CREDS_KEY" "$CREDS_IV"; do
  case "$secret" in
    ''|*[!0-9a-fA-F]*) echo 'Application secrets must be non-empty hexadecimal strings.' >&2; exit 1 ;;
  esac
done
[ "${#JWT_SECRET}" -ge 64 ] || { echo 'JWT_SECRET must contain at least 32 bytes of hexadecimal entropy.' >&2; exit 1; }
[ "${#JWT_REFRESH_SECRET}" -ge 64 ] || { echo 'JWT_REFRESH_SECRET must contain at least 32 bytes of hexadecimal entropy.' >&2; exit 1; }
[ "${#CREDS_KEY}" -eq 64 ] || { echo 'CREDS_KEY must be a 32-byte hexadecimal AES-256 key.' >&2; exit 1; }
[ "${#CREDS_IV}" -eq 32 ] || { echo 'CREDS_IV must be a 16-byte hexadecimal value.' >&2; exit 1; }

read_secret OPENROUTER_API_KEY 'Enter the required OpenRouter API key for the free hosted Work models: '
case "$OPENROUTER_API_KEY" in
  '' ) echo 'An OpenRouter API key is required: free hosted models are the only Work inference path.' >&2; exit 1 ;;
  *[!A-Za-z0-9._-]*) echo 'The OpenRouter API key must be a single token without spaces.' >&2; exit 1 ;;
esac

printf 'Enter the public IPv4 address assigned to the VM: '
IFS= read -r PUBLIC_IP
case "$PUBLIC_IP" in
  *[!0-9.]*|*.*.*.*.*|.*|*.) echo 'Enter a dotted-quad public IPv4 address.' >&2; exit 1 ;;
esac
set -- $(printf '%s' "$PUBLIC_IP" | tr '.' ' ')
[ "$#" -eq 4 ] || { echo 'Enter a dotted-quad public IPv4 address.' >&2; exit 1; }
for octet in "$@"; do
  [ "$octet" -le 255 ] || { echo 'Each IPv4 octet must be from 0 to 255.' >&2; exit 1; }
done
first=$1
second=$2
[ "$first" -gt 0 ] || { echo 'The address must be public.' >&2; exit 1; }
case "$first.$second" in
  10.*|127.*|169.254|172.1[6-9]|172.2[0-9]|172.3[01]|192.168|100.6[4-9]|100.[7-9][0-9]|100.1[01][0-9]|100.12[0-7])
    echo 'The address must be public.' >&2
    exit 1
    ;;
esac
[ "$first" -lt 224 ] || { echo 'The address must be public.' >&2; exit 1; }
HOST_LABEL=$(printf '%s' "$PUBLIC_IP" | tr '.' '-')
API_HOST="coderax-${HOST_LABEL}.sslip.io"
PROXY_SECRET=$(openssl rand -hex 32)

cat > app.env <<EOF
MONGO_URI=$MONGO_URI
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
CREDS_KEY=$CREDS_KEY
CREDS_IV=$CREDS_IV
EOF
printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_API_KEY" >> app.env
cat > origin.env <<EOF
CODERAX_API_HOST=$API_HOST
CODERAX_PROXY_SECRET=$PROXY_SECRET
EOF
unset MONGO_URI JWT_SECRET JWT_REFRESH_SECRET CREDS_KEY CREDS_IV OPENROUTER_API_KEY PROXY_SECRET secret_name secret_prompt
chmod 600 app.env origin.env

printf 'Created protected environment files. API origin: https://%s\n' "$API_HOST"
printf 'The proxy secret is stored in origin.env; do not print or commit that file.\n'
