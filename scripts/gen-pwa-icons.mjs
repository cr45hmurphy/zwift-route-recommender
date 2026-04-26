import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';

const svg = readFileSync('public/assets/favicon.svg', 'utf8');

for (const size of [192, 512]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: '#0f0f0f',
  });
  const png = resvg.render().asPng();
  const outPath = `public/assets/icon-${size}.png`;
  writeFileSync(outPath, png);
  console.log(`Written ${outPath} (${png.length} bytes)`);
}
