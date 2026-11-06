import metadata from '../extension.json';
import { createPackageManifest } from './manifest.js';
import { createVectorPathExtension } from './install';
import { getVectorGpuPolyline } from './render-gpu';
import type { ExtensionContext, SceneGpuContributionRegistry } from '@alid/kernel';

const spec = createVectorPathExtension();
export default {
  ...spec, ...createPackageManifest(metadata), summary: metadata.summary,
  activate(context: ExtensionContext) {
    const off = context.services.get<SceneGpuContributionRegistry>('canvas.gpu-contributions')?.register({ getPolyline: getVectorGpuPolyline });
    try {
      const dispose = spec.activate?.(context);
      return () => { try { if (typeof dispose === 'function') dispose(); else dispose?.dispose(); } finally { off?.(); } };
    } catch (error) { off?.(); throw error; }
  },
};
