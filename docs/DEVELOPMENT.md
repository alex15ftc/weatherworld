# Development guide

## Requirements

- A current Node.js LTS release
- PowerShell, Command Prompt, or another shell capable of invoking Node/npm
- No dependency installation is currently required

On Windows systems that block `npm.ps1`, invoke `npm.cmd` instead:

```powershell
& "C:\Program Files\nodejs\npm.cmd" test
```

## Run the application

```powershell
npm start
```

Optional environment variables:

- `PORT`: HTTP port; defaults to `3000`.
- `WEATHER_SEED`: deterministic initial seed.

## Validation tiers

### Fast change check

```powershell
npm run test:imports
npm run test:2.29.0
```

Use this while iterating on isolated thermodynamic or module changes.

### Primary behavior suite

```powershell
npm test
```

This covers imports, storms, organization, boundaries, coupling, synoptic realism,
and the world framework.

### Current full regression

```powershell
npm run test:regression-2.29.0
```

Run this before a release or after changing shared atmospheric, storm, outlook, or
verification behavior. It is CPU-intensive and may take several minutes.

### Performance baseline

```powershell
npm run benchmark:seed -- 63869760 6 3
```

Use the same Node version, machine power mode, seed, simulated duration, and run count
when comparing branches. Record median and slowest time; do not rely only on the fastest
run.

## Change workflow

1. Identify which layer owns the behavior.
2. Add the smallest deterministic regression that expresses the required invariant.
3. Change the owning layer rather than compensating downstream.
4. Run the narrow test, then the primary suite.
5. For physics changes, inspect several fixed seeds and run the full regression.
6. For hot-path changes, follow the protocol in [PERFORMANCE.md](PERFORMANCE.md).

## Test conventions

- Tests are standalone ES modules using Node assertions.
- Prefer invariant checks over exact floating-point snapshots.
- Include the seed and important diagnostics in failure output.
- Name milestone-specific tests with the version that introduced the behavior.
- A performance improvement must preserve deterministic output unless the change is
  explicitly a model revision.

## Documentation conventions

- Keep this guide focused on contributor workflow.
- Put model/data-flow decisions in `ARCHITECTURE.md`.
- Put measurement results and optimization experiments in `PERFORMANCE.md`.
- Keep milestone notes short and link to tests that protect the behavior.
- Document units on every public field and distinguish signed CIN from CIN magnitude.
