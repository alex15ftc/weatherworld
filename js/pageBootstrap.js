import { profiler } from './performance/PerformanceProfiler.js?v=2.20.14';

const badge = document.querySelector('#authorityModeBadge');
profiler.mark('bootstrap:scheduled');

// The tiled feature pages require the Node authority. Opening the HTML files
// directly used to silently import the complete local simulation and recreate
// the original browser overload. Redirect to the authority instead.
if (location.protocol === 'file:') {
  if (badge) badge.textContent = 'Authority: redirecting to Node';
  const target = `http://localhost:3000/${location.pathname.split('/').pop() || 'index.html'}${location.search}${location.hash}`;
  location.replace(target);
} else if (new URLSearchParams(location.search).get('local') === '1') {
  if (badge) badge.textContent = 'Authority: explicit local mode';
  import('./main.js?v=2.32.6').catch(showFatal);
} else {
  if (badge) badge.textContent = 'Authority: Node · tiled viewer';
  // No preliminary health round-trip and no automatic heavy local fallback.
  import('./remoteProductPage.js?v=2.32.6').catch(showFatal);
}

function showFatal(error) {
  profiler.error(error, { phase: 'bootstrap' });
  const subtitle = document.querySelector('#mapSubtitle');
  if (subtitle) subtitle.textContent = `Node authority unavailable: ${error.message}. Start it with npm start.`;
  if (badge) badge.textContent = 'Authority: unavailable';
}
