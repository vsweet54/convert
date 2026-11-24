import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const maxDuration = 60;

function quantizeColors(
  pixels: Buffer,
  width: number,
  height: number,
  maxColors: number,
  step: number
) {
  const colorMap = new Map<
    string,
    { r: number; g: number; b: number; pixels: [number, number][] }
  >();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const a = pixels[idx + 3];
      if (a < 128) continue;

      const r = Math.round(pixels[idx] / step) * step;
      const g = Math.round(pixels[idx + 1] / step) * step;
      const b = Math.round(pixels[idx + 2] / step) * step;
      const key = `${r},${g},${b}`;

      if (!colorMap.has(key)) {
        colorMap.set(key, { r, g, b, pixels: [] });
      }
      colorMap.get(key)!.pixels.push([x, y]);
    }
  }

  return [...colorMap.values()]
    .sort((a, b) => b.pixels.length - a.pixels.length)
    .slice(0, maxColors);
}

function regionToPath(region: [number, number][]): string {
  if (region.length === 0) return "";

  const rows = new Map<number, number[]>();
  for (const [x, y] of region) {
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

function toHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function generateAMXML(
  shapes: { color: string; path: string }[],
  width: number,
  height: number
): string {
  const layersXML = shapes
    .map(
      (s, i) => `    <layer id="${i}" type="shape" name="Shape ${i + 1}">
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
    const file = formData.get("file") as File | null;
    const mode = (formData.get("mode") as string) || "fast";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const isFast = mode === "fast";
    const maxSize = isFast ? 128 : 256;
    const maxColors = isFast ? 8 : 32;
    const step = isFast ? 64 : 32;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data: pixels, info } = await sharp(buffer)
      .resize(maxSize, maxSize, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;

    const colors = quantizeColors(pixels, width, height, maxColors, step);

    // Build visited grid
    const visited = new Uint8Array(width * height);

    // Build quantized color grid
    const colorGrid = new Array<string>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const a = pixels[idx + 3];
        if (a < 128) {
          colorGrid[y * width + x] = "";
          continue;
        }
        const r = Math.round(pixels[idx] / step) * step;
        const g = Math.round(pixels[idx + 1] / step) * step;
        const b = Math.round(pixels[idx + 2] / step) * step;
        colorGrid[y * width + x] = `${r},${g},${b}`;
      }
    }

    const shapes: { color: string; path: string }[] = [];

    for (const colorEntry of colors) {
      const colorKey = `${colorEntry.r},${colorEntry.g},${colorEntry.b}`;
      const hexColor = toHex(colorEntry.r, colorEntry.g, colorEntry.b);

      for (const [px, py] of colorEntry.pixels) {
        const startIdx = py * width + px;
        if (visited[startIdx]) continue;

        // Iterative flood fill
        const region: [number, number][] = [];
        const stack: number[] = [startIdx];

        while (stack.length > 0) {
          const idx = stack.pop()!;
          if (visited[idx]) continue;
          if (colorGrid[idx] !== colorKey) continue;

          visited[idx] = 1;
          const cx = idx % width;
          const cy = Math.floor(idx / width);
          region.push([cx, cy]);

          if (cx + 1 < width) stack.push(idx + 1);
          if (cx - 1 >= 0) stack.push(idx - 1);
          if (cy + 1 < height) stack.push(idx + width);
          if (cy - 1 >= 0) stack.push(idx - width);
        }

        if (region.length < 2) continue;

        const path = regionToPath(region);
        if (path) shapes.push({ color: hexColor, path });
      }
    }

    if (shapes.length === 0) {
      return NextResponse.json({ error: "Tidak ada shape yang dihasilkan" }, { status: 400 });
    }

    const xml = generateAMXML(shapes, width, height);

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml",
        "Content-Disposition": `attachment; filename="output.xml"`,
      },
    });
  } catch (err: unknown) {
    console.error("convert-am error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Conversion failed" },
      { status: 500 }
    );
  }
}
