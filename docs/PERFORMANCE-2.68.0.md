# WeatherWorld 2.68.0 performance baseline

Measured on the implementation environment with a 50×50 grid and seed `100000`:

- Previous 2.67.0 synchronous initialization: approximately 18.8 seconds.
- 2.68.0 gameplay initialization: typically 0.7–1.2 seconds.
- 2.68.0 six-hour gameplay evolution: approximately 5.7 seconds.
- The largest remaining scheduled cost is Day 1 ensemble issuance, approximately 2.4 seconds in the sampled run.

Use:

```bash
npm run benchmark:runtime -- 100000 6 gameplay
```

Calibration mode intentionally retains full thermodynamics, detailed histories, and 8/12/16 ensemble members and is not expected to meet gameplay budgets.
