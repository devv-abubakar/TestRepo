import { roundRectPath } from './draw';

/**
 * Generates sample screenshots so the tool can be tried without uploading
 * anything.
 *
 * Drawn rather than bundled: three PNGs would add a few hundred kilobytes to
 * every page load for a feature most visitors use once, and generating them
 * costs a few milliseconds. They deliberately include a realistic status bar so
 * the trim-the-status-bar feature has something to find.
 */

interface DemoSpec {
  name: string;
  accent: string;
  surface: string;
  ink: string;
  title: string;
  rows: { label: string; value: string }[];
  chart: number[];
}

const SPECS: DemoSpec[] = [
  {
    name: 'demo-dashboard.png',
    accent: '#335dff',
    surface: '#f6f7fb',
    ink: '#101218',
    title: 'This month',
    rows: [
      { label: 'Groceries', value: '12,400' },
      { label: 'Transport', value: '3,850' },
      { label: 'Internet', value: '4,200' },
      { label: 'Eating out', value: '6,120' },
    ],
    chart: [0.35, 0.62, 0.48, 0.81, 0.55, 0.73, 0.9],
  },
  {
    name: 'demo-list.png',
    accent: '#0f9d6b',
    surface: '#0d1016',
    ink: '#f4f6fb',
    title: 'Scan results',
    rows: [
      { label: 'com.free.vpn', value: 'High' },
      { label: 'photo.editor.pro', value: 'High' },
      { label: 'battery.saver', value: 'Medium' },
      { label: 'note.keeper', value: 'Safe' },
    ],
    chart: [0.9, 0.7, 0.4, 0.25, 0.2, 0.15, 0.1],
  },
  {
    name: 'demo-detail.png',
    accent: '#a855f7',
    surface: '#faf7ff',
    ink: '#16121f',
    title: 'Today',
    rows: [
      { label: 'Morning run', value: '5.2 km' },
      { label: 'Water', value: '1.8 L' },
      { label: 'Sleep', value: '7h 10m' },
      { label: 'Steps', value: '8,420' },
    ],
    chart: [0.2, 0.4, 0.55, 0.5, 0.75, 0.68, 0.95],
  },
];

function drawDemo(spec: DemoSpec, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const dark = spec.surface === '#0d1016';
  const u = width / 100;

  ctx.fillStyle = spec.surface;
  ctx.fillRect(0, 0, width, height);

  // Status bar, flat band then icons then flat band — the shape the trimmer looks for.
  const statusHeight = u * 8;
  ctx.fillStyle = dark ? '#080a0f' : '#ececf2';
  ctx.fillRect(0, 0, width, statusHeight);
  ctx.fillStyle = spec.ink;
  ctx.font = `600 ${u * 3.4}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('9:41', u * 6, statusHeight * 0.55);
  for (let i = 0; i < 4; i += 1) {
    const h = u * (1 + i * 0.6);
    ctx.fillRect(width - u * 20 + i * u * 2, statusHeight * 0.55 + u * 1.2 - h, u * 1.3, h);
  }
  ctx.beginPath();
  roundRectPath(ctx, { x: width - u * 9, y: statusHeight * 0.55 - u * 1.1, w: u * 5, h: u * 2.2 }, u * 0.6);
  ctx.fill();

  // Header
  let y = statusHeight + u * 6;
  ctx.fillStyle = spec.ink;
  ctx.font = `800 ${u * 7}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(spec.title, u * 6, y);
  y += u * 11;

  // Hero card with a bar chart
  const cardHeight = u * 34;
  ctx.fillStyle = spec.accent;
  ctx.beginPath();
  roundRectPath(ctx, { x: u * 5, y, w: width - u * 10, h: cardHeight }, u * 4);
  ctx.fill();

  const barWidth = (width - u * 20) / (spec.chart.length * 1.8);
  spec.chart.forEach((value, i) => {
    const barHeight = (cardHeight - u * 12) * value;
    const bx = u * 10 + i * barWidth * 1.8;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    roundRectPath(
      ctx,
      { x: bx, y: y + cardHeight - u * 6 - barHeight, w: barWidth, h: barHeight },
      barWidth / 2.5,
    );
    ctx.fill();
  });
  y += cardHeight + u * 7;

  // Rows
  for (const row of spec.rows) {
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(16,18,24,0.04)';
    ctx.beginPath();
    roundRectPath(ctx, { x: u * 5, y, w: width - u * 10, h: u * 14 }, u * 3.5);
    ctx.fill();

    ctx.fillStyle = spec.accent;
    ctx.beginPath();
    roundRectPath(ctx, { x: u * 9, y: y + u * 3.5, w: u * 7, h: u * 7 }, u * 2.2);
    ctx.fill();

    ctx.fillStyle = spec.ink;
    ctx.font = `600 ${u * 4}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, u * 20, y + u * 7);

    ctx.textAlign = 'right';
    ctx.font = `700 ${u * 4}px system-ui, sans-serif`;
    ctx.fillText(row.value, width - u * 9, y + u * 7);
    ctx.textAlign = 'left';

    y += u * 17;
  }

  // Bottom bar
  const navY = height - u * 16;
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(16,18,24,0.05)';
  ctx.fillRect(0, navY, width, u * 16);
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = i === 0 ? spec.accent : dark ? 'rgba(255,255,255,0.25)' : 'rgba(16,18,24,0.22)';
    ctx.beginPath();
    roundRectPath(
      ctx,
      { x: width * (0.14 + i * 0.24) - u * 3, y: navY + u * 4.5, w: u * 6, h: u * 6 },
      u * 2,
    );
    ctx.fill();
  }

  return canvas;
}

function toFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not build the sample screenshot.'));
        return;
      }
      resolve(new File([blob], name, { type: 'image/png' }));
    }, 'image/png');
  });
}

export async function makeDemoFiles(): Promise<File[]> {
  const width = 1080;
  const height = 2280;
  return Promise.all(SPECS.map((spec) => toFile(drawDemo(spec, width, height), spec.name)));
}
