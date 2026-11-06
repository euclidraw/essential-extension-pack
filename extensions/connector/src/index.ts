export { WireExtension, wirePaintBounds } from './extension';
export { deriveWire } from './derive';
export { renderWireSvg } from './render-svg';
import { WireExtension } from './extension';
import type { WireProps } from './types';
/** @deprecated Renamed to `WireExtension`; the wire routes both orthogonally and as a Bézier curve. */
export const OrthogonalWireExtension = WireExtension;
/** @deprecated Renamed to `WireProps`. */
export type OrthogonalWireProps = WireProps;
export { getWireGpuPolyline } from './render-gpu';
export { WIRE_DEFAULT_CORNER_RADIUS, WIRE_MAX_CORNER_RADIUS, wireCornerRadius } from './derive';
export { wireGpuArrowhead } from './render-defs';
export type { WireProps, WireDerivedGeometry, ConnectorPortsProps, PortSide, EntityPort, LayoutBounds } from './types';
export { ConnectorPortsExtension, getEntityPorts, getEntityLayoutBounds, findNearestEntityPort } from './ports';
export type { NearestPortQuery } from './ports';
export { createConnectorPreview, mountConnectorPreviewPainter } from './connectorpreview';
export type { ConnectorPreviewStatus, ConnectorPreviewSnapshot, ConnectorPreviewOptions, ConnectorPreviewBegin, ConnectorPreviewUpdate, ConnectorPreviewController, ConnectorPreviewPainterOptions, ConnectorPreviewPainter } from './connectorpreview';
export { routeOrthogonal, segmentAvoidsObstacles } from './routing';
export const SmartWireExtensionId = 'connector.smart-wire';
