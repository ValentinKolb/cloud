#!/bin/sh
# Cloud CLI installer and updater.
#
#   curl -fsSL https://your-cloud.example/cli | sh
#   curl -fsSL https://your-cloud.example/cli | sh -s -- --yes

set -eu

REPO="${CLD_RELEASE_REPO:-ValentinKolb/cloud}"
RELEASE_BASE="${CLD_RELEASE_BASE:-https://github.com/${REPO}/releases}"
API_BASE="${CLD_RELEASE_API_BASE:-https://api.github.com/repos/${REPO}}"
PREFIX="${HOME}/.local/bin"
VERSION="${CLD_VERSION:-latest}"
VERIFY=1
ASSUME_YES=0
CURL_RETRY_COUNT=3
CURL_CONNECT_TIMEOUT=10
CURL_MAX_TIME=60
MAX_RELEASE_PAGES=100
COSIGN_IDENTITY_REGEXP='^https://github\.com/ValentinKolb/cloud/\.github/workflows/cli\.yml@refs/tags/cli-v[0-9]+\.[0-9]+\.[0-9]+$'

die() { printf 'cld: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
curl_get() {
  curl -fsSL --retry "$CURL_RETRY_COUNT" --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" "$@"
}

stable_version_key() {
  printf '%s\n' "$1" | awk -F. '
    NF == 3 && $1 ~ /^(0|[1-9][0-9]*)$/ && $2 ~ /^(0|[1-9][0-9]*)$/ && $3 ~ /^(0|[1-9][0-9]*)$/ {
      printf "%09d%09d%09d\n", $1, $2, $3
    }
  '
}

latest_release() {
  page=1
  tags=""
  while :; do
    body=$(curl_get "${API_BASE}/releases?per_page=100&page=${page}") || return 1
    [ "$(printf '%s' "$body" | tr -d '[:space:]')" = "[]" ] && break
    page_tags=$(printf '%s\n' "$body" | sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\(cli-v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p')
    tags="${tags}${page_tags}\n"
    [ "$page" -lt "$MAX_RELEASE_PAGES" ] || return 1
    page=$((page + 1))
  done
  printf '%b' "$tags" | while IFS= read -r tag; do
    [ -n "$tag" ] || continue
    key=$(stable_version_key "${tag#cli-v}") || continue
    [ -n "$key" ] && printf '%s %s\n' "$key" "$tag"
  done | sort | tail -n 1 | awk '{ print $2 }'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix=*) PREFIX="${1#--prefix=}"; shift ;;
    --version=*) VERSION="${1#--version=}"; shift ;;
    --no-verify) VERIFY=0; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: install.sh [options]

Install or update Cloud CLI.

  --prefix=DIR       Install into DIR (default: ~/.local/bin)
  --version=VERSION  Install cli-vX.Y.Z or X.Y.Z (default: latest CLI release)
  --no-verify        Skip optional Cosign verification; SHA-256 is still required
  -y, --yes          Skip the confirmation prompt
  -h, --help         Show this help
EOF
      exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
done

confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  if [ ! -t 0 ] && [ ! -r /dev/tty ]; then
    die "not a terminal; pass --yes to install non-interactively"
  fi
  printf '%s [Y/n] ' "$1"
  if [ -r /dev/tty ]; then
    IFS= read -r reply < /dev/tty || reply=""
  else
    IFS= read -r reply || reply=""
  fi
  case "$reply" in
    ''|y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$OS" in
  linux|darwin) ;;
  *) die "unsupported OS: $OS" ;;
esac
case "$ARCH" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported architecture: $ARCH" ;;
esac

have curl || die "curl is required"
if [ "$VERSION" = "latest" ]; then
  VERSION=$(latest_release) || die "could not find a Cloud CLI release"
  [ -n "$VERSION" ] || die "could not find a stable Cloud CLI release"
elif [ "${VERSION#cli-v}" = "$VERSION" ]; then
  VERSION="cli-v${VERSION#v}"
fi

VERSION_NUM=${VERSION#cli-v}
TARGET_KEY=$(stable_version_key "$VERSION_NUM")
[ -n "$TARGET_KEY" ] || die "--version must be a stable version such as 1.2.3"
ASSET="cld_${OS}_${ARCH}"
DOWNLOAD_BASE="${RELEASE_BASE}/download/${VERSION}"
CURRENT=""
if [ -x "$PREFIX/cld" ]; then
  CURRENT=$("$PREFIX/cld" --version 2>/dev/null | awk 'NR == 1 { print $2 }' || true)
fi

if [ "$CURRENT" = "$VERSION_NUM" ]; then
  printf 'cld %s already installed at %s\n' "$VERSION_NUM" "$PREFIX"
  exit 0
fi
CURRENT_KEY=$(stable_version_key "$CURRENT")
if [ "${CLD_VERSION:-latest}" = "latest" ] && [ -n "$CURRENT_KEY" ] && [ "$CURRENT_KEY" \> "$TARGET_KEY" ]; then
  printf 'cld %s is newer than the latest published release (%s)\n' "$CURRENT" "$VERSION_NUM"
  exit 0
fi

printf '\nCloud CLI installer\n'
printf '  target:  %s\n' "$PREFIX"
if [ -n "$CURRENT" ]; then
  printf '  current: %s\n' "$CURRENT"
  printf '  new:     %s\n' "$VERSION_NUM"
else
  printf '  version: %s\n' "$VERSION_NUM"
fi
if [ "$VERIFY" = "1" ] && have cosign; then
  printf '  verify:  SHA-256 + Cosign\n'
elif [ "$VERIFY" = "1" ]; then
  printf '  verify:  SHA-256; Cosign unavailable\n'
else
  printf '  verify:  SHA-256; Cosign disabled\n'
fi
printf '\n'
confirm "proceed?" || { printf 'aborted.\n'; exit 1; }

TMP=$(mktemp -d)
staged=""
cleanup() {
  rm -rf "$TMP"
  [ -z "$staged" ] || rm -f "$staged"
}
trap cleanup EXIT

curl_get "${DOWNLOAD_BASE}/checksums.txt" -o "$TMP/checksums.txt" || die "missing checksum manifest"
if [ "$VERIFY" = "1" ] && have cosign; then
  curl_get "${DOWNLOAD_BASE}/checksums.txt.sig" -o "$TMP/checksums.txt.sig" || die "missing checksum signature"
  curl_get "${DOWNLOAD_BASE}/checksums.txt.pem" -o "$TMP/checksums.txt.pem" || die "missing checksum certificate"
  cosign verify-blob \
    --certificate "$TMP/checksums.txt.pem" \
    --signature "$TMP/checksums.txt.sig" \
    --certificate-identity-regexp "$COSIGN_IDENTITY_REGEXP" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    "$TMP/checksums.txt" >/dev/null 2>&1 || die "Cosign verification failed"
fi

expected=$(awk -v target="$ASSET" '$2 == target || $2 == "*" target { print $1 }' "$TMP/checksums.txt")
[ -n "$expected" ] || die "$ASSET is not listed in checksums.txt"
curl_get "${DOWNLOAD_BASE}/${ASSET}" -o "$TMP/$ASSET" || die "could not download $ASSET"
if have sha256sum; then
  actual=$(sha256sum "$TMP/$ASSET" | awk '{ print $1 }')
elif have shasum; then
  actual=$(shasum -a 256 "$TMP/$ASSET" | awk '{ print $1 }')
else
  die "sha256sum or shasum is required"
fi
[ "$actual" = "$expected" ] || die "SHA-256 mismatch; refusing to install"

mkdir -p "$PREFIX"
staged="$PREFIX/.cld.installing.$$"
cp "$TMP/$ASSET" "$staged"
chmod 755 "$staged"
mv -f "$staged" "$PREFIX/cld"
staged=""
printf '✓ cld %s installed at %s/cld\n' "$VERSION_NUM" "$PREFIX"

case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *)
    printf '\n%s is not in your PATH. Add to your shell rc:\n' "$PREFIX"
    printf '    export PATH="%s:$PATH"\n' "$PREFIX"
    ;;
esac
