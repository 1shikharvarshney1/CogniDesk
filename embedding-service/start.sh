#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Starting CogniDesk Local Embedding Microservice on port 8000..."
python3 "$DIR/main.py"
