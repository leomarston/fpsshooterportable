// Registers the three-resolution hook. Use: node --import ./tools/loader.mjs <file>
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
