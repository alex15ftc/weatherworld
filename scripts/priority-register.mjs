// Preloaded into each test process (node --import) so it is not throttled as a background
// process; see js/runtime/processPriority.node.js.
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
