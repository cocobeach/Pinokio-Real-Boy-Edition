const Pinokiod = require("pinokiod")
const config = require('./config')
const pinokiod = new Pinokiod(config)
let mode = pinokiod.kernel.store.get("mode") || "full"

// Check if BMAD architecture should be used
// Default to BMAD (new architecture), set PINOKIO_LEGACY=1 to use old architecture
const useBMAD = process.env.PINOKIO_LEGACY !== '1';

if (mode === 'minimal' || mode === 'background') {
  // Minimal/Background mode
  if (useBMAD) {
    console.log('[Pinokio] Using Minimal Mode (BMAD Architecture)');
    require('./minimal-bmad');
  } else {
    console.log('[Pinokio] Using Minimal Mode (Legacy Architecture)');
    require('./minimal');
  }
} else {
  // Full mode
  if (useBMAD) {
    console.log('[Pinokio] Using Full Mode (BMAD Architecture - Real Boy Edition)');
    require('./full-bmad');
  } else {
    console.log('[Pinokio] Using Full Mode (Legacy Architecture)');
    require('./full');
  }
}
