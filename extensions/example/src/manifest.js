/** Shared by the bundle and build script; keep the reviewed and executed contracts identical. */
export function createPackageManifest(metadata) {
  return {
    id: metadata.id,
    version: metadata.version,
    engine: metadata.engine,
    dependencies: { ...metadata.dependencies },
    optionalDependencies: { ...metadata.optionalDependencies },
    conflicts: [...metadata.conflicts],
    provides: {
      services: [...metadata.provides.services],
      aspects: [`${metadata.id}.note`],
      hsmSlots: [...metadata.provides.hsmSlots],
    },
  };
}
