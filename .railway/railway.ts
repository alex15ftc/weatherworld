// The hosted engine on Railway (docs/HOSTING.md). Preview with `railway config plan`, apply with
// `railway config apply`. Variables (keys, paths, worker counts) stay in Railway: `railway variables`.
// Restart policy is Railway's default (on failure, 10 retries).
import { defineRailway, project, service, volume } from "railway/iac";

export const partial = "engine";

export default defineRailway(() => {
  // The world's saved state, spin-up cache and day reviews (WEATHER_* paths under /data).
  const data = volume("engine-volume", { region: "us-west2", sizeMB: 50000 });
  const engine = service("engine", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    // (a new world takes about a minute before it answers)
    healthcheck: "/api/health",
    healthcheckTimeout: 300,
    replicas: { "us-west2": 1 },
    volumeMounts: { "/data": data },
  });

  return project("weatherworld", {
    variables: { managed: false },
    resources: [engine, data],
  });
});
