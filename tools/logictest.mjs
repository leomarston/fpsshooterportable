// Headless logic tests for the browser-free algorithms.
import * as THREE from 'three';
import { CollisionWorld, Box } from '../src/world/Collision.js';
import { Nav } from '../src/world/Nav.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  FAIL:', m); } };

// --- world: 40x40 ground, a wall down the middle with a doorway ---
const w = new CollisionWorld();
w.add(Box.fromCenter(0, -1, 0, 40, 2, 40, 'sand'));            // ground
// wall along x at z=0, from x=-18..-3 and 3..18 (doorway at -3..3)
w.add(Box.fromCenter(-10.5, 3, 0, 15, 6, 1, 'concrete'));
w.add(Box.fromCenter(10.5, 3, 0, 15, 6, 1, 'concrete'));

// groundHeight
ok(Math.abs(w.groundHeight(5, 5, 30) - 0) < 0.01, 'groundHeight on flat = 0 (got ' + w.groundHeight(5, 5, 30) + ')');

// raycast hits the wall
const hit = w.raycast(new THREE.Vector3(-10.5, 1.6, -5), new THREE.Vector3(0, 0, 1), 20, true);
ok(hit && Math.abs(hit.dist - 4.5) < 0.2, 'ray hits wall at ~4.5 (got ' + (hit && hit.dist.toFixed(2)) + ')');

// ray through doorway misses the wall
const hit2 = w.raycast(new THREE.Vector3(0, 1.6, -5), new THREE.Vector3(0, 0, 1), 20, true);
ok(!hit2 || hit2.dist > 19, 'ray through doorway passes (got ' + (hit2 ? hit2.dist.toFixed(2) : 'null') + ')');

// line of sight blocked by wall, clear through doorway
ok(!w.lineOfSight(new THREE.Vector3(-10.5, 1.6, -5), new THREE.Vector3(-10.5, 1.6, 5)), 'LOS blocked by wall');
ok(w.lineOfSight(new THREE.Vector3(0, 1.6, -5), new THREE.Vector3(0, 1.6, 5)), 'LOS clear through doorway');

// moveAABB: walking into a wall stops you
const feet = new THREE.Vector3(-10.5, 0, -2);
const res = w.moveAABB(feet, 0.42, 1.78, new THREE.Vector3(0, 0, 5));
ok(feet.z < 0 && feet.z > -1.0, 'blocked by wall, stays on -z side (z=' + feet.z.toFixed(2) + ')');

// gravity / ground: drop and land on ground
const feet2 = new THREE.Vector3(5, 5, 5);
let landed = false;
for (let i = 0; i < 120; i++) { const r = w.moveAABB(feet2, 0.42, 1.78, new THREE.Vector3(0, -0.1, 0)); if (r.onGround) { landed = true; break; } }
ok(landed && Math.abs(feet2.y) < 0.05, 'falls and lands on ground (y=' + feet2.y.toFixed(3) + ')');

// --- navmesh: path must route through the doorway ---
const nav = new Nav(w, { x0: -20, x1: 20, z0: -20, z1: 20 }, 1.4);
let walkable = 0; for (const n of nav.nodes) if (n.walkable) walkable++;
ok(walkable > 200, 'navmesh has walkable cells (' + walkable + ')');

const path = nav.findPath(new THREE.Vector3(-10.5, 0, -6), new THREE.Vector3(-10.5, 0, 6));
ok(path && path.length > 1, 'path found across the wall');
if (path) {
  // every segment midpoint should be walkable-ish; and path should cross near doorway (|x|<4 at some z~0)
  let crossedDoor = false;
  for (const p of path) if (Math.abs(p.z) < 1.6 && Math.abs(p.x) < 4.5) crossedDoor = true;
  ok(crossedDoor, 'path routes through the doorway (not through the wall)');
}

// path to an unreachable point returns null gracefully
const wall2 = new CollisionWorld();
wall2.add(Box.fromCenter(0, -1, 0, 40, 2, 40, 'sand'));
const nav2 = new Nav(wall2, { x0: -20, x1: 20, z0: -20, z1: 20 }, 1.6);
const p2 = nav2.findPath(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 10));
ok(p2 && p2.length >= 1, 'open-field path works');

// --- step-up physics: a 0.5 ledge is climbed, a 1.0 wall is not ---
function walkInto(stepHeight) {
  const w3 = new CollisionWorld();
  w3.add(Box.fromCenter(20, -1, 0, 120, 2, 40, 'sand'));         // big ground
  w3.add(Box.fromCenter(31, stepHeight / 2, 0, 58, stepHeight, 20, 'concrete')); // long ledge/plateau at x>=2
  const feet = new THREE.Vector3(0, 0, 0);
  let vy = 0;
  for (let i = 0; i < 100; i++) {                                // ~14 units of walking
    vy -= 20 * (1 / 60);
    const r = w3.moveAABB(feet, 0.42, 1.78, new THREE.Vector3(0.12, vy * (1 / 60), 0));
    if (r.onGround) vy = 0;
  }
  return feet;
}
const climbed = walkInto(0.5);
ok(climbed.x > 4 && climbed.y > 0.45, 'player steps up onto a 0.5 ledge (x=' + climbed.x.toFixed(1) + ' y=' + climbed.y.toFixed(2) + ')');
const blocked = walkInto(1.0);
ok(blocked.x < 2.4 && blocked.y < 0.1, 'player is blocked by a 1.0 wall (x=' + blocked.x.toFixed(1) + ' y=' + blocked.y.toFixed(2) + ')');

console.log(`\n  logic tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
