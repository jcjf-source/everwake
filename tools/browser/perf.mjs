/**
 * Frame-time benchmark: drag-pans at default, minimum, and maximum zoom on
 * three viewports and prints script/task milliseconds per frame.
 *
 * Usage: node tools/browser/perf.mjs [--profile]
 * --profile also prints the top self-time functions at minimum zoom on the
 * 1440x900@2 viewport (useful for finding hot canvas calls).
 *
 * Numbers are from headless Chrome on the current machine: compare runs
 * against each other, not against real devices.
 */
import { startSession } from './cdp.mjs';

const profile = process.argv.includes('--profile');
const s = await startSession();
const click = (sel) => s.ev(`document.querySelector('${sel}').click()`);

try {
  for (const [w, h, dpr] of [[1280, 800, 1], [1440, 900, 2], [390, 844, 3]]) {
    await s.setViewport({ w, h, dpr, mobile: false });
    await s.send('Page.navigate', { url: `${s.appUrl}?seed=everwake` });
    await s.wait(1200);
    await s.frame();
    const out = [];
    for (const mode of ['default', 'min', 'max']) {
      if (mode === 'min') for (let i = 0; i < 20; i++) await click('#zoom-out');
      if (mode === 'max') for (let i = 0; i < 20; i++) await click('#zoom-in');
      await s.frame();
      const m = await s.measureDrag(w, h, false);
      out.push(`${mode}: script ${m.script.toFixed(2)} task ${m.task.toFixed(2)}`);
    }
    console.log(`${w}x${h}@${dpr}  ${out.join(' | ')}  (ms/frame)`);
  }

  if (profile) {
    const [w, h] = [1440, 900];
    await s.setViewport({ w, h, dpr: 2, mobile: false });
    await s.send('Page.navigate', { url: `${s.appUrl}?seed=everwake` });
    await s.wait(1200);
    for (let i = 0; i < 20; i++) await click('#zoom-out');
    await s.frame();
    await s.send('Profiler.enable');
    await s.send('Profiler.setSamplingInterval', { interval: 100 });
    await s.send('Profiler.start');
    const frames = 40;
    await s.measureDrag(w, h, false, frames);
    const { result: { profile: p } } = await s.send('Profiler.stop');
    const self = new Map();
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    p.samples.forEach((sid, i) => {
      const n = byId.get(sid);
      const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
      self.set(k, (self.get(k) || 0) + (p.timeDeltas[i] || 0));
    });
    console.log('\nTop self time at min zoom, 1440x900@2:');
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${(v / 1000 / frames).toFixed(2)} ms/frame  ${k}`);
    }
  }
} finally {
  await s.close();
}
