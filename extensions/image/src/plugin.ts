import metadata from '../extension.json';
import { createPackageManifest } from './manifest.js';
import { createMediaImageSuite } from './install';
export default { ...createMediaImageSuite(), ...createPackageManifest(metadata), summary:metadata.summary };
