#!/usr/bin/env bash
# Installs the pinned tools and Wally packages, generates package types, and exports the world
# map the place is built from if it is not there yet. Run again whenever aftman.toml or
# wally.toml changes; delete WorldData to re-export after changing the world generator.
set -euo pipefail
cd "$(dirname "$0")"

aftman install --no-trust-check
if [ ! -d WorldData ] || [ ! -d Shared/MapData ]; then
	(cd .. && node scripts/export-world-roblox.mjs)
fi
wally install
rojo sourcemap default.project.json --output sourcemap.json
wally-package-types --sourcemap sourcemap.json Packages/

echo "Ready: run 'rojo serve' here, then Connect in the Rojo plugin in Studio."
