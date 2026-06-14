// Node loader hook: resolve bare `three` / `three/addons/*` to the vendored
// build so headless logic tests run without a node_modules copy of three.
export async function resolve(spec, ctx, next) {
  if (spec === 'three')
    return { url: new URL('../vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  if (spec.startsWith('three/addons/'))
    return { url: new URL('../vendor/addons/' + spec.slice('three/addons/'.length), import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
