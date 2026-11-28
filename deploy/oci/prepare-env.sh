#!/bin/sh
set -eu

cd "$(dirname "$0")"
if [ -e app.env ] || [ -e origin.env ] || [ -e engine.env ]; then
  echo 'Refusing to replace existing app.env or origin.env (or engine.env).' >&2
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
read_secret PASSWORD_LOGIN_PASSWORD 'Enter the existing production PASSWORD_LOGIN_PASSWORD from Vercel: '

for secret in "$JWT_SECRET" "$JWT_REFRESH_SECRET" "$CREDS_KEY" "$CREDS_IV"; do
  case "$secret" in
    ''|*[!0-9a-fA-F]*) echo 'Application secrets must be non-empty hexadecimal strings.' >&2; exit 1 ;;
  esac
done
[ "${#JWT_SECRET}" -ge 64 ] || { echo 'JWT_SECRET must contain at least 32 bytes of hexadecimal entropy.' >&2; exit 1; }
[ "${#JWT_REFRESH_SECRET}" -ge 64 ] || { echo 'JWT_REFRESH_SECRET must contain at least 32 bytes of hexadecimal entropy.' >&2; exit 1; }
[ "${#CREDS_KEY}" -eq 64 ] || { echo 'CREDS_KEY must be a 32-byte hexadecimal AES-256 key.' >&2; exit 1; }
[ "${#CREDS_IV}" -eq 32 ] || { echo 'CREDS_IV must be a 16-byte hexadecimal value.' >&2; exit 1; }
case "$PASSWORD_LOGIN_PASSWORD" in
  '') echo 'PASSWORD_LOGIN_PASSWORD is required: password sign-in is the only owner entry path on the VM.' >&2; exit 1 ;;
  *"'"*|*\\*) echo 'PASSWORD_LOGIN_PASSWORD must not contain a single quote or backslash; app.env stores it single-quoted.' >&2; exit 1 ;;
esac

read_secret OPENROUTER_API_KEY 'Enter the required OpenRouter API key for the free hosted Work models: '
case "$OPENROUTER_API_KEY" in
  '' ) echo 'An OpenRouter API key is required: free hosted models are the only Work inference path.' >&2; exit 1 ;;
  *[!A-Za-z0-9._-]*) echo 'The OpenRouter API key must be a single token without spaces.' >&2; exit 1 ;;
esac

# Every other OpenAI-compatible provider is optional. A missing credential is a
# reported provider state, not a hidden provider: the model catalog lists the
# provider with the reason it cannot run, so provisioning every key that exists
# is worthwhile even though inference still requires verified $0 pricing.
read_secret_optional() {
  optional_name=$1
  optional_prompt=$2
  printf '%s' "$optional_prompt"
  trap 'stty echo 2>/dev/null || true' EXIT HUP INT TERM
  stty -echo
  IFS= read -r "$optional_name" || eval "$optional_name="
  stty echo
  trap - EXIT HUP INT TERM
  printf '\n'
  eval "optional_value=\${$optional_name:-}"
  case "$optional_value" in
    '') ;;
    *[!A-Za-z0-9._:/-]*)
      echo "The value for $optional_name must be a single token without spaces or quotes." >&2
      exit 1
      ;;
  esac
}

read_secret_optional GEMINI_API_KEY 'Enter GEMINI_API_KEY (Enter to skip): '
read_secret_optional CEREBRAS_API_KEY 'Enter CEREBRAS_API_KEY (Enter to skip): '
read_secret_optional GROQ_API_KEY 'Enter GROQ_API_KEY (Enter to skip): '
read_secret_optional OPENCODEAI_API_KEY 'Enter OPENCODEAI_API_KEY (Enter to skip): '
read_secret_optional APINEX_KEY 'Enter APINEX_KEY (Enter to skip): '
read_secret_optional FREEAI_API_KEY 'Enter FREEAI_API_KEY (Enter to skip): '
# HMS_API_KEY is the canonical name: a variable starting with a digit cannot be
# exported by a POSIX shell, so the 100MillionSeek key is stored under it.
read_secret_optional HMS_API_KEY 'Enter the 100MillionSeek key, stored as HMS_API_KEY (Enter to skip): '

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
OPENCODE_SERVER_PASSWORD=$(openssl rand -hex 32)

cat > app.env <<EOF
MONGO_URI=$MONGO_URI
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
CREDS_KEY=$CREDS_KEY
CREDS_IV=$CREDS_IV
PASSWORD_LOGIN_PASSWORD='$PASSWORD_LOGIN_PASSWORD'
CODERAX_ALLOWED_HOSTS=coderaxai.vercel.app,coderax.nnabdelshahid.workers.dev
DOMAIN_CLIENT=https://coderaxai.vercel.app
DOMAIN_SERVER=https://coderaxai.vercel.app
EOF
printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_API_KEY" >> app.env
for optional_name in GEMINI_API_KEY CEREBRAS_API_KEY GROQ_API_KEY OPENCODEAI_API_KEY APINEX_KEY FREEAI_API_KEY HMS_API_KEY; do
  eval "optional_value=\${$optional_name:-}"
  if [ -n "$optional_value" ]; then
    printf '%s=%s\n' "$optional_name" "$optional_value" >> app.env
  fi
done
printf 'OPENCODE_SERVER_PASSWORD=%s\n' "$OPENCODE_SERVER_PASSWORD" >> app.env
cat > engine.env <<EOF
OPENCODE_SERVER_PASSWORD=$OPENCODE_SERVER_PASSWORD
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
EOF
cat > origin.env <<EOF
CODERAX_API_HOST=$API_HOST
CODERAX_PROXY_SECRET=$PROXY_SECRET
CODERAX_PUBLIC_HOST=coderax.nnabdelshahid.workers.dev
EOF
unset MONGO_URI JWT_SECRET JWT_REFRESH_SECRET CREDS_KEY CREDS_IV PASSWORD_LOGIN_PASSWORD OPENROUTER_API_KEY PROXY_SECRET OPENCODE_SERVER_PASSWORD secret_name secret_prompt
unset GEMINI_API_KEY CEREBRAS_API_KEY GROQ_API_KEY OPENCODEAI_API_KEY APINEX_KEY FREEAI_API_KEY HMS_API_KEY optional_name optional_prompt optional_value
chmod 600 app.env origin.env engine.env

printf 'Created protected environment files. API origin: https://%s\n' "$API_HOST"
printf 'The proxy secret is stored in origin.env; do not print or commit that file.\n'
printf 'The owner login password is stored in app.env; do not print or commit that file.\n'
printf 'The OpenCode service password is stored in app.env and engine.env; do not print or commit those files.\n'
