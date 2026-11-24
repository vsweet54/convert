import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

const FAST_COLORS = 8;
const ACCURATE_COLORS = 32;

// Quantize warna pakai median cut sederhana
function quantizeColors(pixels: Buffer, width: number, height: number, maxColors: number) {
  const colorMap = new Map<string, { r: number; g: number; b: number; count: number; pixels: [number, number][] }>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      if (a < 128) continue; // skip transparan

      // Quantize ke bucket
      const step = maxColors === FAST_COLORS ? 64 : 32;
      const qr = Math.round(r / step) * step;
      const qg = Math.round(g / step) * step;
      const qb = Math.round(b / step) * step;
      const key = `${qr},${qg},${qb}`;

      if (!colorMap.has(key)) {
        colorMap.set(key, { r: qr, g: qg, b: qb, count: 0, pixels: [] });
      }
      const entry = colorMap.get(key)!;
      entry.count++;
      entry.pixels.push([x, y]);
    }
  }

  // Sort by count, ambil top N
  return [...colorMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors);
}

// Flood fill → dapat region per warna
function floodFill(
  pixelGrid: string[][],
  startX: number,
  startY: number,
  targetColor: string,
  visited: boolean[][]
): [number, number][] {
  const width = pixelGrid[0].length;
  const height = pixelGrid.length;
  const region: [number, number][] = [];
  const stack: [number, number][] = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (visited[y][x]) continue;
    if (pixelGrid[y][x] !== targetColor) continue;

    visited[y][x] = true;
    region.push([x, y]);

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return region;
}

// Convert region pixels → SVG path sederhana (bounding box + rle)
function regionToPath(region: [number, number][]): string {
  if (region.length === 0) return "";

  // Sort by y then x
  const sorted = [...region].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  // Group by row
  const rows = new Map<number, number[]>();
  for (const [x, y] of sorted) {
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push(x);
  }

  let path = "";
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let start = xs[0];
    let prev = xs[0];

    for (let i = 1; i <= xs.length; i++) {
      if (i === xs.length || xs[i] !== prev + 1) {
        // Draw horizontal line segment
        path += `M ${start} ${y} H ${prev + 1} V ${y + 1} H ${start} Z `;
        if (i < xs.length) {
          start = xs[i];
          prev = xs[i];
        }
      } else {
        prev = xs[i];
      }
    }
  }

  return path.trim();
}

// Hex color
function toHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Generate AM XML
function generateAMXML(
  shapes: { color: string; path: string }[],
  width: number,
  height: number
): string {
  const layersXML = shapes
    .map(
      (s, i) => `
    <layer id="${i}" type="shape" name="Shape ${i + 1}">
      <transform>
        <position x="0" y="0"/>
        <scale x="1" y="1"/>
        <rotation>0</rotation>
        <opacity>1</opacity>
      </transform>
      <fillColor>${s.color}</fillColor>
      <path>${s.path}</path>
    </layer>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<alightMotion version="1.0">
  <project>
    <width>${width}</width>
    <height>${height}</height>
    <frameRate>30</frameRate>
    <duration>150</duration>
  </project>
  <layers>
${layersXML}
  </layers>
</alightMotion>`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const mode = (formData.get("mode") as string) || "fast";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Resize kalau terlalu besar (Vercel limit)
    const maxSize = mode === "fast" ? 256 : 512;

    const { data: pixels, info } = await sharp(buffer)
      .resize(maxSize, maxSize, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    const maxColors = mode === "fast" ? FAST_COLORS : ACCURATE_COLORS;

    // Quantize
    const colors = quantizeColors(pixels, width, height, maxColors);

    // Build pixel grid (quantized)
    const step = mode === "fast" ? 64 : 32;
    const pixelGrid: string[][] = Array.from({ length: height }, () =>
      new Array(width).fill("")
    );

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = Math.round(pixels[idx] / step) * step;
        const g = Math.round(pixels[idx + 1] / step) * step;
        const b = Math.round(pixels[idx + 2] / step) * step;
        const a = pixels[idx + 3];
        pixelGrid[y][x] = a < 128 ? "transparent" : `${r},${g},${b}`;
      }
    }

    // Flood fill per warna
    const visited: boolean[][] = Array.from({ length: height }, () =>
      new Array(width).fill(false)
    );

    const shapes: { color: string; path: string }[] = [];

    for (const colorEntry of colors) {
      const colorKey = `${colorEntry.r},${colorEntry.g},${colorEntry.b}`;
      const hexColor = toHex(colorEntry.r, colorEntry.g, colorEntry.b);

      for (const [px, py] of colorEntry.pixels) {
        if (visited[py][px]) continue;

        const region = floodFill(pixelGrid, px, py, colorKey, visited);
        if (region.length < 4) continue; // skip region terlalu kecil

        const path = regionToPath(region);
        if (path) {
          shapes.push({ color: hexColor, path });
        }
      }
    }

    const xml = generateAMXML(shapes, width, height);

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml",
        "Content-Disposition": `attachment; filename="output.xml"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Conversion failed" }, { status: 500 });
  }
}