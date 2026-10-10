import { profiler } from './performance/PerformanceProfiler.js';

const badge = document.querySelector('#authorityModeBadge');
profiler.mark('bootstrap:scheduled');

// The pages are thin clients of the Node authority (npm start); opening the HTML files
// directly redirects to it.
if (location.protocol === 'file:') {
  if (badge) badge.textContent = 'Authority: redirecting to Node';
  const target = `http://localhost:3000/${location.pathname.split('/').pop() || 'index.html'}${location.search}${location.hash}`;
  location.replace(target);
} else {
  if (badge) badge.textContent = 'Authority: Node · tiled viewer';
  // No preliminary health round-trip and no automatic heavy local fallback.
  import('./remoteProductPage.js').catch(showFatal);
}

function showFatal(error) {
  profiler.error(error, { phase: 'bootstrap' });
  const subtitle = document.querySelector('#mapSubtitle');
  if (subtitle) subtitle.textContent = `Node authority unavailable: ${error.message}. Start it with npm start.`;
  if (badge) badge.textContent = 'Authority: unavailable';
}
