import * as THREE from 'three';
import type { HoldType } from '../game/types';
import { HOLD_DEPTH } from './palette';

/**
 * One geometry per hold shape, built once and shared.
 *
 * The shapes are readable before they are pretty: a crimp is a thin lip, a
 * sloper is a dome with nothing to hold onto, a volume is a big faceted wedge.
 * You should be able to tell what a hold is from across the gym, which on a
 * phone means from about nine millimetres away.
 */

const cache = new Map<HoldType, THREE.BufferGeometry>();

function build(type: HoldType): THREE.BufferGeometry {
  const d = HOLD_DEPTH[type];
  let g: THREE.BufferGeometry;

  switch (type) {
    case 'jug': {
      // Chunky rounded block with an obvious lip to pull on.
      g = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
      g.scale(1, 0.78, d * 9);
      g.rotateX(Math.PI * 0.5);
      break;
    }
    case 'crimp': {
      g = new THREE.BoxGeometry(1.9, 0.5, d * 8);
      break;
    }
    case 'sloper': {
      g = new THREE.SphereGeometry(1, 14, 10);
      g.scale(1, 0.9, d * 5.5);
      break;
    }
    case 'pinch': {
      g = new THREE.CylinderGeometry(0.42, 0.85, d * 12, 6);
      g.rotateX(Math.PI * 0.5);
      break;
    }
    case 'pocket': {
      g = new THREE.TorusGeometry(0.72, 0.34, 6, 12);
      g.scale(1, 1, d * 7);
      break;
    }
    case 'sidepull':
    case 'gaston': {
      // A vertical rail. Which one it is depends on which way it faces.
      g = new THREE.BoxGeometry(0.62, 1.9, d * 8);
      break;
    }
    case 'undercling': {
      g = new THREE.CylinderGeometry(0.9, 0.5, d * 9, 8, 1, false);
      g.rotateX(Math.PI * 0.5);
      break;
    }
    case 'foothold': {
      g = new THREE.CylinderGeometry(0.8, 0.95, d * 9, 7);
      g.rotateX(Math.PI * 0.5);
      break;
    }
    case 'volume': {
      // Big faceted plywood shape. Kevin's favourite.
      g = new THREE.ConeGeometry(1.25, d * 6, 4, 1);
      g.rotateX(Math.PI * 0.5);
      break;
    }
  }
  g.computeVertexNormals();
  return g;
}

export function holdGeometry(type: HoldType): THREE.BufferGeometry {
  let g = cache.get(type);
  if (!g) { g = build(type); cache.set(type, g); }
  return g;
}

export function disposeHoldGeometry(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
