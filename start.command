#!/bin/bash
# Double-click (macOS) or run: ./start.command — serves the designer at http://localhost:8137
cd "$(dirname "$0")"
(sleep 1; open "http://localhost:8137") &
python3 serve.py 8137
