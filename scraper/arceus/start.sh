#!/bin/bash
cd "$(dirname "$0")/../.."
exec python3 -m uvicorn scraper.arceus.server:app --host 0.0.0.0 --port ${PORT:-5000}
