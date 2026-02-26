#!/bin/bash
# GeoTwin Illustration Service - Quick Setup Script
# ================================================================

echo "🎨 GeoTwin Illustration Service Setup"
echo "======================================"
echo ""

# Check Python version
echo "📋 Checking Python version..."
python3 --version || { echo "❌ Python 3 not found. Install Python 3.11+"; exit 1; }
echo "✅ Python OK"
echo ""

# Install dependencies
echo "📦 Installing Python dependencies..."
pip install -r requirements.txt --break-system-packages
echo "✅ Dependencies installed"
echo ""

# Check for .env
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found"
    echo "📝 Creating .env from template..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your REPLICATE_API_TOKEN"
    echo "   1. Register at https://replicate.com (free)"
    echo "   2. Go to Settings → API Tokens"
    echo "   3. Copy your token"
    echo "   4. Edit .env and paste: REPLICATE_API_TOKEN=your_token_here"
    echo ""
else
    echo "✅ .env file exists"
fi

# Check if token is configured
if grep -q "your_token_here" .env 2>/dev/null; then
    echo "⚠️  WARNING: REPLICATE_API_TOKEN not configured in .env"
    echo "   The service will not work until you add a valid token"
    echo ""
fi

echo "✅ Setup complete!"
echo ""
echo "📚 Next steps:"
echo ""
echo "1. Configure API token in .env (if not done)"
echo "2. Test the pipeline:"
echo "   python test_quick.py ../path/to/snapshot.json"
echo ""
echo "3. Start the service:"
echo "   uvicorn main:app --host 0.0.0.0 --port 8001 --reload"
echo ""
echo "4. The Studio will connect to http://localhost:8001"
echo ""
