# Polymarket AI Trading Game - Local Run Instructions

## Quick Start (Terminal.app)
1. Open Terminal.app (Finder → Applications → Utilities → Terminal)
2. Navigate to the repo: `cd /Users/ryanbartell/polymarket-ai-trader`
3. Make the script executable: `chmod +x run-local.sh`
4. Run the server: `./run-local.sh`
   - This starts the Python server on port 8080 and opens your browser to http://localhost:8080

## Manual Steps (if script doesn't work)
1. In Terminal.app: `cd /Users/ryanbartell/polymarket-ai-trader`
2. Start server: `python3 -m http.server 8080`
3. Open browser to http://localhost:8080

## Push to GitHub (Terminal.app)
1. Check status: `git status`
2. Add changes: `git add -A`
3. Commit: `git commit -m "Add local run script and instructions"`
4. Push: `git push origin main`

## Enable GitHub Pages (Web UI)
1. Go to https://github.com/BTizzy/polymarket-ai-trader
2. Settings → Pages → Source: Deploy from a branch → Branch: main → Save
3. The site will be live at https://btizzy.github.io/polymarket-ai-trader/

## VS Code Terminal Fix
If integrated terminal fails:
- Move VS Code to /Applications
- Reload with extensions disabled (Cmd+Shift+P → "Reload Window With Extensions Disabled")
- Or use Terminal.app for all commands