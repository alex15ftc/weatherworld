#!/bin/sh
# Builds the cloud model's C core (native/cloudmodel/cloudmodel.c) to js/cloudmodel/cloudmodel.wasm.
# Needs Zig 0.13 (its bundled clang and wasi-libc), installed by winget: sh tools/cloudlab/native/build.sh
# -ffp-contract=off keeps a * b + c as two roundings, like the Luau.
set -e
cd "$(dirname "$0")/../../.."
# (zig on the PATH, or where winget installs it: winget install zig.zig --version 0.13.0)
if [ -z "$ZIG" ]; then
  ZIG=zig
  command -v zig >/dev/null 2>&1 || ZIG="$LOCALAPPDATA/Microsoft/WinGet/Packages/zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe/zig-windows-x86_64-0.13.0/zig.exe"
fi
"$ZIG" cc -target wasm32-wasi -O3 -ffp-contract=off -mexec-model=reactor -s \
  -o js/cloudmodel/cloudmodel.wasm native/cloudmodel/cloudmodel.c
echo "built js/cloudmodel/cloudmodel.wasm ($(wc -c < js/cloudmodel/cloudmodel.wasm) bytes)"
