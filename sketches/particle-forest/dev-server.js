const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 3000;
const HTML_FILE = path.join(__dirname, 'index.html');

// Track file modification time for live reload
let lastMod = fs.statSync(HTML_FILE).mtimeMs;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Check for file changes (for live reload polling)
  if (req.url === '/check-reload') {
    const currentMod = fs.statSync(HTML_FILE).mtimeMs;
    const shouldReload = currentMod > lastMod;
    if (shouldReload) lastMod = currentMod;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reload: shouldReload }));
    return;
  }

  // Save settings back to code
  if (req.url === '/save-settings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const settings = JSON.parse(body);
        let html = fs.readFileSync(HTML_FILE, 'utf8');
        
        // Update slider defaults in HTML
        const updates = [
          { id: 'sliderStarDensity', value: settings.starDensity, display: settings.starDensity + '%' },
          { id: 'sliderRotation', value: settings.rotation, display: settings.rotation + '%' },
          { id: 'sliderBloom', value: settings.bloom, display: settings.bloom + '%' },
          { id: 'sliderSpeed', value: settings.speed, display: settings.speed + '%' },
          { id: 'sliderColorShift', value: settings.colorShift, display: settings.colorShift + '°' },
          { id: 'sliderTrailBrightness', value: settings.trailBrightness, display: settings.trailBrightness + '%' },
          { id: 'sliderMoonPhase', value: settings.moonPhase, display: settings.moonPhase == 0 ? 'New' : settings.moonPhase == 100 ? 'Full' : settings.moonPhase + '%' },
          { id: 'sliderMoonRotation', value: settings.moonRotation, display: settings.moonRotation + '°' },
          { id: 'sliderMoonOcclusion', value: settings.moonOcclusion, display: settings.moonOcclusion + '%' },
        ];
        
        for (const upd of updates) {
          // Update the value attribute
          const sliderRegex = new RegExp(`(id="${upd.id}"[^>]*value=")[^"]*(")`);
          html = html.replace(sliderRegex, `$1${upd.value}$2`);
          
          // Update the display span - find the label containing this slider
          const displayId = upd.id.replace('slider', '').replace(/([A-Z])/g, (m) => m);
          const spanId = displayId.charAt(0).toLowerCase() + displayId.slice(1) + 'Value';
        }
        
        // Update display values in spans
        html = html.replace(/(id="starDensityValue">)[^<]*(<)/g, `$1${settings.starDensity}%$2`);
        html = html.replace(/(id="rotationValue">)[^<]*(<)/g, `$1${settings.rotation}%$2`);
        html = html.replace(/(id="bloomValue">)[^<]*(<)/g, `$1${settings.bloom}%$2`);
        html = html.replace(/(id="speedValue">)[^<]*(<)/g, `$1${settings.speed}%$2`);
        html = html.replace(/(id="colorShiftValue">)[^<]*(<)/g, `$1${settings.colorShift}°$2`);
        html = html.replace(/(id="trailBrightnessValue">)[^<]*(<)/g, `$1${settings.trailBrightness}%$2`);
        html = html.replace(/(id="moonPhaseValue">)[^<]*(<)/g, `$1${settings.moonPhase == 0 ? 'New' : settings.moonPhase == 100 ? 'Full' : settings.moonPhase + '%'}$2`);
        html = html.replace(/(id="moonRotationValue">)[^<]*(<)/g, `$1${settings.moonRotation}°$2`);
        html = html.replace(/(id="moonOcclusionValue">)[^<]*(<)/g, `$1${settings.moonOcclusion}%$2`);
        
        // Update JavaScript uniform defaults
        html = html.replace(/(UnrealBloomPass\(\s*new THREE\.Vector2\([^)]+\),\s*)[0-9.]+/, `$1${settings.bloom / 100}`);
        html = html.replace(/(uSpeedMult:\s*\{\s*value:\s*)[0-9.]+/, `$1${settings.speed / 100}`);
        html = html.replace(/(uPhase:\s*\{\s*value:\s*)[0-9.]+/, `$1${settings.moonPhase / 100}`);
        html = html.replace(/(uRotation:\s*\{\s*value:\s*)[0-9.]+(\s*\})/, `$1${(settings.moonRotation / 360 * Math.PI * 2).toFixed(2)}$2`);
        html = html.replace(/(uOcclusion:\s*\{\s*value:\s*)[0-9.]+/, `$1${settings.moonOcclusion / 100}`);
        html = html.replace(/(uDensity:\s*\{\s*value:\s*)[0-9.]+/, `$1${settings.starDensity / 100}`);
        
        // Update rotationSpeed default
        html = html.replace(/(let rotationSpeed\s*=\s*)[0-9.]+/, `$1${(settings.rotation / 100) * 0.05}`);
        
        fs.writeFileSync(HTML_FILE, html);
        lastMod = fs.statSync(HTML_FILE).mtimeMs; // Update to prevent immediate reload
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        console.error('Settings saved to index.html');
      } catch (err) {
        console.error('Error saving settings:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);
  
  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
  };
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    
    // Inject live reload script into HTML
    if (ext === '.html') {
      const reloadScript = `
<script>
// Live reload - poll for changes
setInterval(async () => {
  try {
    const res = await fetch('/check-reload');
    const data = await res.json();
    if (data.reload) location.reload();
  } catch (e) {}
}, 1000);
</script>
</body>`;
      data = data.toString().replace('</body>', reloadScript);
    }
    
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.error(`Dev server running at http://localhost:${PORT}`);
  console.error('Live reload enabled - edit index.html and save to reload');
  console.error('Use the "Save to Code" button in the debug panel to persist settings');
});
