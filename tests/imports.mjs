// Every module under js/ and server/ (the server's entry point aside) loads on its own.
import { readdirSync } from 'node:fs';
const walk = dir => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(`${dir}${entry.name}/`) : entry.name.endsWith('.js') ? [`${dir}${entry.name}`] : []));
// Page scripts need a browser; the server's entry point starts listening.
const skip = path => path.startsWith('../js/pages/') || path.startsWith('../js/map/') || path.startsWith('../js/api/') || path.startsWith('../js/radar/Radar') && /Page|Renderer|Client/.test(path) || /remoteProductPage|pageBootstrap|server\/index\.js/.test(path);
const modules = [...walk('../js/'), ...walk('../server/')].filter(path => !skip(path));
const failed = [];
for (const modulePath of modules) { try { await import(modulePath); } catch (error) { if (!/document|window|navigator|HTMLElement|location is not defined/.test(error.message)) failed.push(`${modulePath}: ${error.message.split('\n')[0]}`); } }
if (failed.length) throw new Error(`modules failed to load:\n${failed.join('\n')}`);
console.log(`Imported ${modules.length} modules successfully.`);
