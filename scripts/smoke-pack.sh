#!/usr/bin/env bash
# Build, pack, install the tarball outside the checkout, and run the installed CLI.
# No Jira calls, no hooks, no global installs; temp dirs are removed on exit.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "smoke-pack: FAIL: $*" >&2; exit 1; }

cd "$root"
rm -rf dist
npm run build --silent
version="$(node -p 'require("./package.json").version')"
tarball="$tmp/$(npm pack --silent --pack-destination "$tmp")"

contents="$(tar -tzf "$tarball")"
for f in package.json LICENSE README.md skills/jira-axi/SKILL.md \
  dist/bin/jira-axi.js dist/src/cli.js dist/src/version.js; do
  grep -qx "package/$f" <<<"$contents" || fail "tarball missing $f (check package.json \"files\" / build output)"
done
if grep -E '^package/(src|test|bin)/' <<<"$contents"; then
  fail "tarball ships source/test files listed above"
fi

app="$tmp/app"
mkdir -p "$app" "$tmp/home"
cd "$app"
echo '{"name":"smoke","private":true}' > package.json
npm install --omit=dev --no-audit --no-fund --silent "$tarball" \
  || fail "npm install of $tarball failed"
for dev in typescript tsx vitest; do
  [[ ! -e "node_modules/$dev" ]] || fail "devDependency $dev was installed"
done
if grep -rIl --exclude='*.map' -F "$root" node_modules/@mateusz-plociennik/jira-axi; then
  fail "installed package references checkout path $root"
fi

bin="$app/node_modules/.bin/jira-axi"
[[ -x "$bin" ]] || fail "bin $bin not executable"
# Clean env: no Jira credentials/config, isolated HOME, only node on PATH.
run() {
  env -i PATH="$(dirname "$(command -v node)"):/usr/bin:/bin" HOME="$tmp/home" "$bin" "$@" \
    || fail "jira-axi $* exited $?"
}

got="$(run --version)"
[[ "$got" == *"$version"* ]] || fail "--version printed '$got', expected $version"
run --help | grep "usage: jira-axi" >/dev/null || fail "--help missing usage"
for cmd in issue epic sprint board project release me open setup; do
  run "$cmd" --help | grep "usage: jira-axi $cmd" >/dev/null || fail "$cmd --help missing usage"
done

echo "smoke-pack: OK ($(basename "$tarball"))"
