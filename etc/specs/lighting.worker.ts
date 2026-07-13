/**
 * Web Worker for computing occlusion and emissive lighting maps
 * Offloads expensive calculations from the main thread
 */

import type { Block } from '../types/VoxelModelTypes';

// Constants matching the main thread
const GRID_SIZE = 16;
const OCCLUSION_SIZE = GRID_SIZE; // 16x16x16
const LIGHT_MAP_RESOLUTION_MULTIPLIER = 3;
const LIGHT_MAP_SIZE = GRID_SIZE * LIGHT_MAP_RESOLUTION_MULTIPLIER; // 48x48x48

interface ComputeLightingMessage {
  type: 'compute';
  blocks: Block[];
  emissiveColorIndices: number[]; // Palette indices that are emissive (e.g., [25, 26, 27])
}

interface LightingResultMessage {
  type: 'result';
  occlusionData: Uint8Array;
  emissiveData: Uint8Array;
}

// 3D DDA raycasting for occlusion detection
function raycast3D(
  fromX: number, fromY: number, fromZ: number,
  toX: number, toY: number, toZ: number,
  isOccupied: (x: number, y: number, z: number) => boolean
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dz = toZ - fromZ;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < 0.01) return false;

  const steps = Math.ceil(dist * 2);
  const stepX = dx / steps;
  const stepY = dy / steps;
  const stepZ = dz / steps;

  for (let i = 1; i < steps; i++) {
    const x = Math.floor(fromX + stepX * i);
    const y = Math.floor(fromY + stepY * i);
    const z = Math.floor(fromZ + stepZ * i);

    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE || z < 0 || z >= GRID_SIZE) {
      continue;
    }

    if (isOccupied(x, y, z)) {
      return true; // Hit an occupied voxel
    }
  }

  return false; // Clear path
}

// Compute occlusion map (16x16x16, 1 byte per voxel)
function computeOcclusion(blocks: Block[]): Uint8Array {
  const data = new Uint8Array(GRID_SIZE * GRID_SIZE * GRID_SIZE);

  // Build occupancy lookup
  const occupied = new Set<string>();
  for (const block of blocks) {
    const [x, y, z] = block.position;
    occupied.add(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`);
  }

  const isOccupied = (x: number, y: number, z: number): boolean => {
    return occupied.has(`${x},${y},${z}`);
  };

  // For each voxel, count occupied neighbors
  for (const block of blocks) {
    const [bx, by, bz] = block.position;
    const x = Math.floor(bx);
    const y = Math.floor(by);
    const z = Math.floor(bz);

    let occupiedCount = 0;
    const directions = [
      [-1, 0, 0], [1, 0, 0],
      [0, -1, 0], [0, 1, 0],
      [0, 0, -1], [0, 0, 1],
    ];

    for (const [dx, dy, dz] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;

      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE && nz >= 0 && nz < GRID_SIZE) {
        if (isOccupied(nx, ny, nz)) {
          occupiedCount++;
        }
      }
    }

    // Store occlusion value (0-255, where 255 = fully occluded)
    const index = x + y * GRID_SIZE + z * GRID_SIZE * GRID_SIZE;
    data[index] = Math.floor((occupiedCount / 6) * 255);
  }

  return data;
}

// Compute emissive light map (48x48x48, 4 bytes per cell: RGBA)
function computeEmissive(blocks: Block[], emissiveColorIndices: number[]): Uint8Array {
  const data = new Uint8Array(LIGHT_MAP_SIZE * LIGHT_MAP_SIZE * LIGHT_MAP_SIZE * 4);

  // Build occupancy and emissive lookups
  const occupied = new Set<string>();
  const emissiveBlocks: Array<{ x: number; y: number; z: number; color: [number, number, number]; intensity: number }> = [];

  for (const block of blocks) {
    const [x, y, z] = block.position;
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const gz = Math.floor(z);
    occupied.add(`${gx},${gy},${gz}`);

    // Check if this block has an emissive color
    if (block.paletteOverride) {
      const { c1, c2, c3 } = block.paletteOverride;
      const emissiveSlots = [
        { index: c1, power: 1.0 },
        { index: c2, power: 0.5 },
        { index: c3, power: 0.25 },
      ];

      for (const slot of emissiveSlots) {
        if (slot.index !== undefined && emissiveColorIndices.includes(slot.index)) {
          // TODO: Get actual color from palette - for now use placeholder
          emissiveBlocks.push({
            x: gx,
            y: gy,
            z: gz,
            color: [255, 200, 100], // Placeholder warm emissive color
            intensity: slot.power,
          });
          break; // Only add once per block
        }
      }
    }
  }

  if (emissiveBlocks.length === 0) {
    return data; // No emissive blocks, return empty map
  }

  const isOccupied = (x: number, y: number, z: number): boolean => {
    return occupied.has(`${x},${y},${z}`);
  };

  // For each emissive block, propagate light
  for (const light of emissiveBlocks) {
    const range = 4; // Max light range in voxels
    const minX = Math.max(0, light.x - range);
    const maxX = Math.min(GRID_SIZE - 1, light.x + range);
    const minY = Math.max(0, light.y - range);
    const maxY = Math.min(GRID_SIZE - 1, light.y + range);
    const minZ = Math.max(0, light.z - range);
    const maxZ = Math.min(GRID_SIZE - 1, light.z + range);

    // Fill light source voxel itself at high resolution
    for (let hy = 0; hy < LIGHT_MAP_RESOLUTION_MULTIPLIER; hy++) {
      for (let hx = 0; hx < LIGHT_MAP_RESOLUTION_MULTIPLIER; hx++) {
        for (let hz = 0; hz < LIGHT_MAP_RESOLUTION_MULTIPLIER; hz++) {
          const hcx = light.x * LIGHT_MAP_RESOLUTION_MULTIPLIER + hx;
          const hcy = light.y * LIGHT_MAP_RESOLUTION_MULTIPLIER + hy;
          const hcz = light.z * LIGHT_MAP_RESOLUTION_MULTIPLIER + hz;
          const idx = (hcx + hcy * LIGHT_MAP_SIZE + hcz * LIGHT_MAP_SIZE * LIGHT_MAP_SIZE) * 4;

          data[idx + 0] = light.color[0];
          data[idx + 1] = light.color[1];
          data[idx + 2] = light.color[2];
          data[idx + 3] = 255;
        }
      }
    }

    // Propagate to surrounding voxels
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (isOccupied(x, y, z)) continue;

          // Raycast from voxel center to light center
          const fromX = x + 0.5;
          const fromY = y + 0.5;
          const fromZ = z + 0.5;
          const toX = light.x + 0.5;
          const toY = light.y + 0.5;
          const toZ = light.z + 0.5;

          const dx = toX - fromX;
          const dy = toY - fromY;
          const dz = toZ - fromZ;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (distance < 0.1) continue; // Skip self

          // Check occlusion
          if (raycast3D(fromX, fromY, fromZ, toX, toY, toZ, isOccupied)) {
            continue; // Occluded
          }

          // Calculate light intensity with exponential falloff
          const falloff = Math.exp(-distance * 0.5);
          const intensity = light.intensity * falloff;

          if (intensity < 0.01) continue; // Too dim

          // Apply to all high-res cells in this voxel
          for (let hy = 0; hy < LIGHT_MAP_RESOLUTION_MULTIPLIER; hy++) {
            for (let hx = 0; hx < LIGHT_MAP_RESOLUTION_MULTIPLIER; hx++) {
              for (let hz = 0; hz < LIGHT_MAP_RESOLUTION_MULTIPLIER; hz++) {
                const hcx = x * LIGHT_MAP_RESOLUTION_MULTIPLIER + hx;
                const hcy = y * LIGHT_MAP_RESOLUTION_MULTIPLIER + hy;
                const hcz = z * LIGHT_MAP_RESOLUTION_MULTIPLIER + hz;
                const idx = (hcx + hcy * LIGHT_MAP_SIZE + hcz * LIGHT_MAP_SIZE * LIGHT_MAP_SIZE) * 4;

                // Additive blending
                data[idx + 0] = Math.min(255, data[idx + 0] + light.color[0] * intensity);
                data[idx + 1] = Math.min(255, data[idx + 1] + light.color[1] * intensity);
                data[idx + 2] = Math.min(255, data[idx + 2] + light.color[2] * intensity);
                data[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
  }

  return data;
}

// Worker message handler
self.onmessage = (e: MessageEvent<ComputeLightingMessage>) => {
  const { type, blocks, emissiveColorIndices } = e.data;

  if (type === 'compute') {

    const startTime = performance.now();

    const occlusionData = computeOcclusion(blocks);
    const emissiveData = computeEmissive(blocks, emissiveColorIndices);

    const duration = performance.now() - startTime;


    const result: LightingResultMessage = {
      type: 'result',
      occlusionData,
      emissiveData,
    };

    self.postMessage(result, { transfer: [occlusionData.buffer, emissiveData.buffer] });
  }
};
