---
agent: 'agent'
description: 'Deploy GeoTwin to production server'
---
Deploy steps:
1. git add + commit + push origin main
2. ssh docker-edge-apps "cd /opt/stacks/geotwin && git pull origin main"
3. docker compose build [service] --no-cache
4. docker compose up -d [service]
5. Verify: docker compose ps + curl https://api.geotwin.es/health

If disk full: docker builder prune -af && docker image prune -af
If API crash: check docker logs geotwin-api --tail 30
If ESM error: verify "type": "module" in apps/api/package.json
NEVER touch Seedy containers or files.
