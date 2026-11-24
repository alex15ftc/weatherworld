// Where the engine's memory goes, for /api/performance (docs/HOSTING.md): the main thread's heap and
// buffers, each radar and forecast thread's heap, each cloud-model storm worker process, and the
// container's own count (cgroup v2: what Railway bills). Paths missing off Linux read as null.
import fs from 'node:fs';
import v8 from 'node:v8';

const MB = 1048576;
const mb = bytes => (Number.isFinite(bytes) ? Math.round(bytes / MB) : null);
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// A cgroup v2 file holding one number (memory.current, memory.peak), as MB.
const cgroupMb = name => { const text = read(`/sys/fs/cgroup/${name}`); return text === null ? null : mb(Number(text)); };

// The container's memory by kind (memory.stat): anon is the processes' own, file the page cache.
function cgroupStat() {
  const text = read('/sys/fs/cgroup/memory.stat');
  if (!text) return null;
  const all = Object.fromEntries(text.trim().split('\n').map(line => line.split(' ')).map(([k, v]) => [k, Number(v)]));
  return { anonMb: mb(all.anon), fileMb: mb(all.file), kernelMb: mb(all.kernel), shmemMb: mb(all.shmem) };
}

// One process's resident memory from /proc (the storm workers are child processes, outside this one's rss).
const procRssMb = pid => { const m = /VmRSS:\s+(\d+) kB/.exec(read(`/proc/${pid}/status`) ?? ''); return m ? Math.round(Number(m[1]) / 1024) : null; };

// Each live thread of a pool (RadarPool, ForecastPool: a `workers` Set of worker_threads Workers): its heap.
async function poolHeaps(pool) {
  if (!pool?.workers) return null;
  return Promise.all([...pool.workers].map(worker => worker.getHeapStatistics()
    .then(s => ({ usedMb: mb(s.used_heap_size), totalMb: mb(s.total_heap_size), externalMb: mb(s.external_memory) }))
    .catch(() => null)));
}

export async function memoryReport({ radarPool = null, forecastPool = null, stormWorkers = null } = {}) {
  const m = process.memoryUsage(), heap = v8.getHeapStatistics();
  const storms = stormWorkers?.workers ? [...stormWorkers.workers.values()].map(w => ({ id: w.id, nest: w.nest, rssMb: procRssMb(w.proc?.pid) })) : null;
  return {
    process: { rssMb: mb(m.rss), heapUsedMb: mb(m.heapUsed), heapTotalMb: mb(m.heapTotal), heapLimitMb: mb(heap.heap_size_limit), externalMb: mb(m.external), arrayBuffersMb: mb(m.arrayBuffers) },
    container: { currentMb: cgroupMb('memory.current'), peakMb: cgroupMb('memory.peak'), ...(cgroupStat() ?? {}) },
    radarThreads: await poolHeaps(radarPool),
    forecastThreads: await poolHeaps(forecastPool),
    stormWorkers: storms,
    mallocArenaMax: process.env.MALLOC_ARENA_MAX ?? null
  };
}
