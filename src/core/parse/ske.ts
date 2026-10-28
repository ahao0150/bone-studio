import type { DbArmatureData, DbSkeletonData } from '../types';

export interface SkeletonDoc {
  raw: DbSkeletonData;
  name: string;
  version: string;
  compatibleVersion: string;
  frameRate: number;
  armatures: DbArmatureData[];
}

/** Accepted string spellings for the numeric enums (both forms stay valid). */
export const DISPLAY_TYPES: Record<string, number> = { image: 0, armature: 1, mesh: 2, boundingBox: 3 };
export const BONE_TYPES: Record<string, number> = { bone: 0, armature: 1, mesh: 2, boundingBox: 3 };

/** Normalise a DragonBones 5.x `_ske.json` document (also accepts 4.x exports). */
export function parseSkeletonData(input: unknown): SkeletonDoc {
  if (!input || typeof input !== 'object') throw new Error('skeleton: not an object');
  const raw = input as DbSkeletonData;
  if (!Array.isArray(raw.armature) || raw.armature.length === 0) {
    throw new Error('skeleton: missing "armature" array');
  }
  for (const armature of raw.armature) {
    if (!Array.isArray(armature.bone)) throw new Error(`armature "${armature.name}": missing bones`);
    armature.slot ??= [];
    armature.skin ??= [];
    armature.animation ??= [];
    for (const skin of armature.skin) {
      for (const slot of skin.slot ?? []) {
        for (const display of slot.display ?? []) {
          if (display.uvs && display.uvs.length && Math.max(...display.uvs) > 1.5) {
            // some exporters store uvs in pixels relative to the texture rect
            for (let i = 0; i < display.uvs.length; i++) display.uvs[i] = display.uvs[i] / 1000;
          }
        }
      }
    }
  }
  const armatureRate = raw.armature[0]?.frameRate;
  return {
    raw,
    name: raw.name ?? raw.armature[0]?.name ?? 'untitled',
    version: raw.version ?? '4.5',
    compatibleVersion: raw.compatibleVersion ?? '',
    frameRate: armatureRate || raw.frameRate || 24,
    armatures: raw.armature,
  };
}

export function serializeSkeletonData(doc: SkeletonDoc): string {
  return JSON.stringify(doc.raw);
}

export function skeletonSummary(doc: SkeletonDoc) {
  return doc.armatures.map((a) => ({
    name: a.name,
    type: a.type ?? 'armature',
    bones: a.bone.length,
    slots: a.slot.length,
    skins: a.skin.length,
    animations: (a.animation ?? []).map((an) => ({ name: an.name, duration: an.duration })),
    ik: (a.ik ?? []).length,
  }));
}
