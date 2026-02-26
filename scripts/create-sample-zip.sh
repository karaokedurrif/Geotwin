#!/bin/bash

# Create ZIP file from KML sample
cd "$(dirname "$0")"
cd ../apps/web/public/sample-data

if command -v zip &> /dev/null; then
    echo "Creating 40212A00200007.zip..."
    zip 40212A00200007.zip 40212A00200007.kml
    echo "✓ ZIP file created successfully"
else
    echo "⚠ 'zip' command not found. Please install zip utility or create ZIP manually."
    echo "  On Ubuntu/Debian: sudo apt-get install zip"
    echo "  On macOS: zip is pre-installed"
fi
