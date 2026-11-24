"use client";
import { useState } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"fast" | "accurate">("fast");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleConvert = async () => {
    if (!file) return;
    setLoading(true);

    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);

    const res = await fetch("/api/convert-am", {
      method: "POST",
      body: form,
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Auto download
      const a = document.createElement("a");
      a.href = url;
      a.download = "output.xml";
      a.click();
    } else {
      alert("Konversi gagal");
    }

    setLoading(false);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold">Foto → Alight Motion XML</h1>

      {/* Upload */}
      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          setFile(f);
          if (f) setPreview(URL.createObjectURL(f));
        }}
        className="border p-2 rounded"
      />

      {preview && (
        <img src={preview} alt="preview" className="max-w-xs rounded shadow" />
      )}

      {/* Mode toggle */}
      <div className="flex gap-4">
        {(["fast", "accurate"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded border font-medium ${
              mode === m
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300"
            }`}
          >
            {m === "fast" ? "⚡ Fast" : "🎯 Accurate"}
          </button>
        ))}
      </div>

      <p className="text-sm text-gray-500">
        {mode === "fast"
          ? "8 warna, proses cepat, file ringan"
          : "32 warna, detail tinggi, proses lebih lama"}
      </p>

      {/* Convert button */}
      <button
        onClick={handleConvert}
        disabled={!file || loading}
        className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold disabled:opacity-50"
      >
        {loading ? "Memproses..." : "Convert → AM XML"}
      </button>
    </main>
  );
}