---
name: build-wasm
description: Rebuild the C cloud model (native/cloudmodel/cloudmodel.c) to js/cloudmodel/cloudmodel.wasm with Zig 0.13 and check it still matches. Use after any change to cloudmodel.c.
---

# Build the cloud model wasm

1. Keep a copy of the current `js/cloudmodel/cloudmodel.wasm` in the scratch folder.
2. Build: `sh tools/cloudlab/native/build.sh` (Zig 0.13 on PATH; flags keep `a*b+c` as two roundings to match the Luau).
3. If the C change should not alter results, compare bytes: `cmp old.wasm js/cloudmodel/cloudmodel.wasm`.
   A rebuild of unchanged source is byte-for-byte identical.
4. Run the tests that load it: `node scripts/run-tests.mjs storm-workers` and `node tests/tornado-frame.mjs`.
5. Luau side: the Luau model must still agree. `lune run tools/cloudlab/native/dump_slow.luau <dir>` dumps the Luau reference (needs Lune 0.11.1).

clangd (clangd-lsp plugin) gives definitions and diagnostics in cloudmodel.c.
