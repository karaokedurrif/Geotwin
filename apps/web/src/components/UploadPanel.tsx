import { useState } from 'react';
import type { StylePreset, TwinRecipe } from '@geotwin/types';

interface UploadPanelProps {
  onRecipeLoaded: (recipe: TwinRecipe) => void;
}

export default function UploadPanel({ onRecipeLoaded }: UploadPanelProps) {
  const [preset, setPreset] = useState<StylePreset>('mountain');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(
        `http://localhost:3001/api/import?preset=${preset}`,
        {
          method: 'POST',
          body: formData,
        }
      );

      const data = await response.json();

      if (data.success && data.recipe) {
        onRecipeLoaded(data.recipe);
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch {
      setError('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleLoadSample = async () => {
    setUploading(true);
    setError(null);

    try {
      // Load sample KML file
      const response = await fetch('/sample-data/40212A00200007.kml');
      const blob = await response.blob();
      const file = new File([blob], '40212A00200007.kml', { type: 'application/vnd.google-earth.kml+xml' });
      await handleFileUpload(file);
    } catch {
      setError('Failed to load sample data');
      setUploading(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-climate-darker via-climate-dark to-climate-darker">
      <div className="max-w-2xl w-full mx-4">
        <div className="bg-climate-dark border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-3xl font-bold mb-2 text-center">Upload Cadastral File</h2>
          <p className="text-gray-400 text-center mb-8">
            Support for KML, GML, and ZIP formats
          </p>

          {/* Preset Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-3">Style Preset</label>
            <div className="grid grid-cols-3 gap-3">
              <PresetButton
                preset="mountain"
                selected={preset === 'mountain'}
                onClick={() => setPreset('mountain')}
                icon="🏔️"
                label="Mountain"
              />
              <PresetButton
                preset="dehesa"
                selected={preset === 'dehesa'}
                onClick={() => setPreset('dehesa')}
                icon="🌳"
                label="Dehesa"
              />
              <PresetButton
                preset="mediterranean"
                selected={preset === 'mediterranean'}
                onClick={() => setPreset('mediterranean')}
                icon="🫒"
                label="Mediterranean"
              />
            </div>
          </div>

          {/* File Upload */}
          <div className="mb-6">
            <label
              htmlFor="file-upload"
              className="block w-full px-6 py-12 border-2 border-dashed border-gray-700 rounded-lg text-center cursor-pointer hover:border-climate-accent transition"
            >
              <div className="text-5xl mb-4">📁</div>
              <span className="text-lg">
                {uploading ? 'Uploading...' : 'Click to upload or drag file here'}
              </span>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                accept=".kml,.gml,.xml,.zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                disabled={uploading}
              />
            </label>
          </div>

          {/* Load Sample */}
          <div className="text-center">
            <button
              onClick={handleLoadSample}
              disabled={uploading}
              className="px-6 py-3 bg-climate-green hover:bg-green-600 rounded-lg font-medium transition disabled:opacity-50"
            >
              Load Sample Data
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mt-4 p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface PresetButtonProps {
  preset: StylePreset;
  selected: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}

function PresetButton({ selected, onClick, icon, label }: PresetButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-lg border-2 transition ${
        selected
          ? 'border-climate-accent bg-climate-accent/10'
          : 'border-gray-700 hover:border-gray-600'
      }`}
    >
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-sm font-medium">{label}</div>
    </button>
  );
}
