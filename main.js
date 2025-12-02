const Pinokiod = require("pinokiod")
const config = require('./config')
const pinokiod = new Pinokiod(config)
let mode = pinokiod.kernel.store.get("mode") || "full"

// Check if BMAD architecture should be used
// Default to BMAD (new architecture), set PINOKIO_LEGACY=1 to use old architecture
const useBMAD = process.env.PINOKIO_LEGACY !== '1'

if (mode === 'minimal' || mode === 'background') {
  // Minimal mode: use existing implementation
  require('./minimal');
} else {
  // Full mode: use BMAD architecture (or legacy if PINOKIO_LEGACY=1)
  if (useBMAD) {
    console.log('[Pinokio] Using BMAD Architecture (Real Boy Edition)');
    require('./full-bmad');
  } else {
    console.log('[Pinokio] Using Legacy Architecture');
    require('./full');
  }
}
