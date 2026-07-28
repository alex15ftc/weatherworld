export const DEFAULT_RETRYABLE_STATUS_CODES = Object.freeze([408, 425, 429, 500, 502, 503, 504]);

export async function fetchWithRetry(url, {
  fetchImpl = globalThis.fetch,
  retries = 4,
  timeoutMs = 30000,
  retryDelayMs = 750,
  retryableStatusCodes = DEFAULT_RETRYABLE_STATUS_CODES,
  headers = {},
  onRetry = () => {}
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      if (response.ok) return response;
      const error = new Error(`HTTP ${response.status}: ${url}`);
      error.status = response.status;
      if (!retryableStatusCodes.includes(response.status) || attempt === retries) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'AbortError' || error?.name === 'TypeError' || retryableStatusCodes.includes(error?.status);
      if (!retryable || attempt === retries) throw error;
    } finally {
      clearTimeout(timer);
    }
    const delay = retryDelayMs * (2 ** attempt) + Math.floor(Math.random() * Math.max(50, retryDelayMs / 3));
    onRetry({ url, attempt: attempt + 1, retries, delay, error: lastError });
    await sleep(delay);
  }
  throw lastError;
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
