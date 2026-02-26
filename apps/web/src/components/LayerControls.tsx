import type { TwinRecipe, LayerType } from '@geotwin/types';

interface LayerControlsProps {
  recipe: TwinRecipe;
  enabledLayers: Set<LayerType>;
  onToggleLayer: (layerId: LayerType) => void;
}

export default function LayerControls({
  recipe,
  enabledLayers,
  onToggleLayer,
}: LayerControlsProps) {
  return (
    <div className="bg-climate-dark/90 backdrop-blur border border-gray-700 rounded-lg p-4 min-w-[200px]">
      <h3 className="font-bold mb-3 text-sm uppercase text-gray-400">Layers</h3>
      <div className="space-y-2">
        {recipe.layers.map((layer: any) => (
          <label
            key={layer.id}
            className="flex items-center space-x-2 cursor-pointer hover:bg-gray-800/50 px-2 py-1 rounded"
          >
            <input
              type="checkbox"
              checked={enabledLayers.has(layer.id)}
              onChange={() => onToggleLayer(layer.id)}
              className="w-4 h-4 rounded border-gray-600 text-climate-accent focus:ring-climate-accent"
            />
            <span className="text-sm">{layer.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
