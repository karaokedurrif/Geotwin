---
agent: 'agent'
description: 'Fix screenshot/capture bugs in CesiumJS viewer'
---
The user reports a screenshot/capture issue in the GeoTwin CesiumJS viewer.

Key rules:
- Cesium canvas is WebGL. After each frame, the buffer may be cleared.
- ALWAYS call viewer.scene.renderForSpecs() SYNCHRONOUSLY before canvas.toDataURL()
- NEVER rely on requestAnimationFrame timing for captures
- For changed viewport (zoom, resolution scale): wait 500ms + renderForSpecs()
- preserveDrawingBuffer must be true in viewer creation
- Test: the PNG must have >10% non-black pixels to be valid
