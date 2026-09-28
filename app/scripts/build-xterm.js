#!/usr/bin/env node
// Bouwt src/features/terminal/xtermHtml.ts: één zelfstandige HTML-pagina met xterm.js, de fit-addon en JetBrains Mono.
// Niets wordt van een CDN geladen; de WebView heeft geen internet nodig.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);
const xtermJs = fs.readFileSync(nm('@xterm/xterm/lib/xterm.js'), 'utf8');
const xtermCss = fs.readFileSync(nm('@xterm/xterm/css/xterm.css'), 'utf8');
const fitJs = fs.readFileSync(nm('@xterm/addon-fit/lib/addon-fit.js'), 'utf8');
const font = fs.readFileSync(nm('@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf')).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
@font-face{font-family:'JBM';src:url(data:font/ttf;base64,${font}) format('truetype');}
${xtermCss}
html,body{margin:0;padding:0;height:100%;background:#07070C;overflow:hidden}
#t{position:absolute;inset:6px 4px 4px 6px}
.xterm .xterm-viewport{background:#07070C!important}
</style></head><body><div id="t"></div>
<script>${xtermJs}</script>
<script>${fitJs}</script>
<script>
(function(){
  var post=function(o){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(o));};
  var term=new Terminal({
    fontFamily:"JBM, monospace", fontSize:13, lineHeight:1.15, cursorBlink:true, cursorStyle:'bar',
    scrollback:5000, allowProposedApi:false, convertEol:false, macOptionIsMeta:true,
    theme:{background:'#07070C',foreground:'#EDEDF5',cursor:'#34F5C5',cursorAccent:'#07070C',selectionBackground:'rgba(139,92,246,0.35)',
      black:'#14141F',red:'#F2545B',green:'#34F5C5',yellow:'#F5B942',blue:'#60A5FA',magenta:'#8B5CF6',cyan:'#22D3EE',white:'#EDEDF5',
      brightBlack:'#5F5F78',brightRed:'#FF7A80',brightGreen:'#7CFFDD',brightYellow:'#FFD27A',brightBlue:'#93C5FD',brightMagenta:'#B18CFF',brightCyan:'#67E8F9',brightWhite:'#FFFFFF'}
  });
  var fit=new FitAddon.FitAddon(); term.loadAddon(fit); term.open(document.getElementById('t'));
  var mods={ctrl:false,alt:false};
  function applyMods(d){
    if(d.length===1&&mods.ctrl){var c=d.toUpperCase().charCodeAt(0);if(c>=64&&c<=95){d=String.fromCharCode(c-64);} mods.ctrl=false;post({t:'mods',ctrl:false,alt:mods.alt});}
    if(mods.alt){d='\\x1b'+d;mods.alt=false;post({t:'mods',ctrl:mods.ctrl,alt:false});}
    return d;
  }
  term.onData(function(d){post({t:'i',d:applyMods(d)});});
  function doFit(){try{fit.fit();post({t:'r',c:term.cols,r:term.rows});}catch(e){}}
  window.addEventListener('resize',doFit);
  window.__hal={
    recv:function(m){
      if(m.t==='o'){term.write(m.d);}
      else if(m.t==='clear'){term.clear();}
      else if(m.t==='font'){term.options.fontSize=m.s;doFit();}
      else if(m.t==='mods'){mods.ctrl=!!m.ctrl;mods.alt=!!m.alt;}
      else if(m.t==='key'){post({t:'i',d:m.d});}
      else if(m.t==='focus'){term.focus();}
      else if(m.t==='fit'){doFit();}
      else if(m.t==='status'){term.write('\\r\\n\\x1b[38;2;138;138;163m'+m.d+'\\x1b[0m\\r\\n');}
    }
  };
  setTimeout(function(){doFit();term.focus();post({t:'ready',c:term.cols,r:term.rows});},50);
})();
</script></body></html>`;

const out = `// GEGENEREERD door scripts/build-xterm.js. Niet met de hand aanpassen.\n/* eslint-disable */\nexport const XTERM_HTML: string = ${JSON.stringify(html)};\n`;
fs.writeFileSync(path.join(root, 'src/features/terminal/xtermHtml.ts'), out);
console.log(`xtermHtml.ts geschreven (${Math.round(out.length / 1024)} KB)`);
