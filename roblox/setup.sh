#!/bin/sh
# Installs tools and packages, then generates types for the language server.
# Run again any time you change wally.toml.
set -e
cd "$(dirname "$0")"

aftman install
wally install
rojo sourcemap default.project.json --output sourcemap.json
wally-package-types --sourcemap sourcemap.json Packages/

echo "Done. Run 'rojo serve' and connect from the Rojo plugin in Studio."
