#!/bin/bash

# GeoTwin Development Helper Script

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print colored output
print_green() {
    echo -e "${GREEN}$1${NC}"
}

print_blue() {
    echo -e "${BLUE}$1${NC}"
}

print_yellow() {
    echo -e "${YELLOW}$1${NC}"
}

# Main menu
show_menu() {
    echo ""
    print_blue "==================================="
    print_blue "    GeoTwin Development Helper     "
    print_blue "==================================="
    echo ""
    echo "1. 🚀 Quick Start (Install & Run)"
    echo "2. 📦 Install Dependencies"
    echo "3. 🔨 Build All Packages"
    echo "4. 🏃 Start Development Servers"
    echo "5. ✅ Run Type Checking"
    echo "6. 💅 Format Code"
    echo "7. 🧹 Clean Build Artifacts"
    echo "8. 📊 Project Status"
    echo "9. 🆘 Help"
    echo "0. 🚪 Exit"
    echo ""
}

# Quick start
quick_start() {
    print_green "🚀 Quick Start..."
    print_blue "Installing dependencies..."
    pnpm install
    
    print_blue "Building types package..."
    pnpm --filter @geotwin/types build
    
    print_green "✅ Setup complete! Starting development servers..."
    pnpm dev
}

# Install dependencies
install_deps() {
    print_green "📦 Installing dependencies..."
    pnpm install
    print_green "✅ Dependencies installed!"
}

# Build all
build_all() {
    print_green "🔨 Building all packages..."
    pnpm build
    print_green "✅ Build complete!"
}

# Start dev servers
start_dev() {
    print_green "🏃 Starting development servers..."
    print_yellow "Web: http://localhost:3000"
    print_yellow "API: http://localhost:3001"
    pnpm dev
}

# Type check
type_check() {
    print_green "✅ Running type checking..."
    pnpm typecheck
    print_green "✅ Type check complete!"
}

# Format code
format_code() {
    print_green "💅 Formatting code..."
    pnpm format
    print_green "✅ Code formatted!"
}

# Clean
clean() {
    print_green "🧹 Cleaning build artifacts..."
    rm -rf node_modules
    rm -rf apps/*/node_modules
    rm -rf packages/*/node_modules
    rm -rf apps/*/.next
    rm -rf apps/*/dist
    rm -rf packages/*/dist
    rm -rf data
    print_green "✅ Clean complete!"
}

# Project status
project_status() {
    print_blue "📊 Project Status"
    echo ""
    
    echo "Node Version:"
    node --version
    
    echo ""
    echo "pnpm Version:"
    pnpm --version
    
    echo ""
    echo "Installed Packages:"
    pnpm list --depth 0
    
    echo ""
    print_green "✅ Status check complete!"
}

# Help
show_help() {
    print_blue "🆘 GeoTwin Help"
    echo ""
    echo "Quick Start:"
    echo "  ./dev.sh (then select option 1)"
    echo ""
    echo "Manual Commands:"
    echo "  pnpm install                    - Install dependencies"
    echo "  pnpm dev                        - Start development"
    echo "  pnpm build                      - Build for production"
    echo "  pnpm typecheck                  - Check TypeScript types"
    echo "  pnpm format                     - Format code"
    echo ""
    echo "Documentation:"
    echo "  README.md        - Main documentation"
    echo "  QUICKSTART.md    - Quick start guide"
    echo "  ARCHITECTURE.md  - Architecture details"
    echo "  API.md           - API reference"
    echo ""
}

# Main loop
main() {
    while true; do
        show_menu
        read -p "Select option: " choice
        
        case $choice in
            1) quick_start ;;
            2) install_deps ;;
            3) build_all ;;
            4) start_dev ;;
            5) type_check ;;
            6) format_code ;;
            7) clean ;;
            8) project_status ;;
            9) show_help ;;
            0) print_green "👋 Goodbye!"; exit 0 ;;
            *) print_yellow "Invalid option. Please try again." ;;
        esac
        
        if [ $choice != "4" ]; then
            echo ""
            read -p "Press Enter to continue..."
        fi
    done
}

# Run main if script is executed directly
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main
fi
