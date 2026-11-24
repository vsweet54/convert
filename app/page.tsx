"use client";
import { useState } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"fast" | "accurate">("fast");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConvert = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
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
        const a = document.createElement("a");
        a.href = url;
        a.download = "output.xml";
        a.click();
      } else {
        const json = await res.json();
        setError(json.error || "Konversi gagal");
      }
    } catch (e) {
      setError("Network error: " + String(e));
    }

    setLoading(false);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8 bg-gray-950 text-white">
      <h1 className="text-3xl font-bold">Foto → Alight Motion XML</h1>

      <label className="cursor-pointer border-2 border-dashed border-gray-500 rounded-xl p-8 text-center hover:border-blue-400 transition">
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setFile(f);
            if (f) setPreview(URL.createObjectURL(f));
          }}
        />
        {preview ? (
          <img src={preview} alt="preview" className="max-w-xs rounded-lg mx-auto" />
        ) : (
          <p className="text-gray-400">Tap untuk upload foto</p>
        )}
      </label>

      <div className="flex gap-4">
        {(["fast", "accurate"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-5 py-2 rounded-lg font-semibold border transition ${
              mode === m
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-transparent border-gray-500 text-gray-300"
            }`}
          >
            {m === "fast" ? "⚡ Fast" : "🎯 Accurate"}
          </button>
        ))}
      </div>

      <p className="text-sm text-gray-400">
        {mode === "fast"
          ? "8 warna · proses cepat · file ringan"
          : "32 warna · detail tinggi · proses lebih lama"}
      </p>

      {error && (
        <p className="text-red-400 bg-red-950 px-4 py-2 rounded-lg text-sm">{error}</p>
      )}

      <button
        onClick={handleConvert}
        disabled={!file || loading}
        className="px-8 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-40 rounded-xl font-bold text-lg transition"
      >
        {loading ? "Memproses..." : "Convert → AM XML"}
      </button>
    </main>
  );
}