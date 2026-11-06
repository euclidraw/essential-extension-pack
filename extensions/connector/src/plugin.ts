import metadata from '../extension.json';
import { createPackageManifest } from './manifest.js';
import { WireExtension } from './extension';
import { ConnectorPortsExtension, getEntityPorts } from './ports';
import { WiringTool } from './wiring-tool';
import { connectOps, quickCreateOps } from './connection-actions';
import { getWireGpuPolyline } from './render-gpu';
import type { ExtensionContext, SceneGpuContributionRegistry } from '@alid/kernel';

export default {
  ...createPackageManifest(metadata), summary: metadata.summary, aspects: [ConnectorPortsExtension, WireExtension],
  activate(context: ExtensionContext) {
    const offTools = context.services.provide('connector.tools', { getEntityPorts, createWiringTool: (host: ConstructorParameters<typeof WiringTool>[0]) => new WiringTool(host), connectOps, quickCreateOps });
    try {
      const offGpu = context.services.get<SceneGpuContributionRegistry>('canvas.gpu-contributions')?.register({ getPolyline: getWireGpuPolyline });
      return () => { offGpu?.(); offTools(); };
    } catch (error) { offTools(); throw error; }
  },
};
