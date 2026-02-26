import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import type { TwinRecipe } from '@geotwin/types';
import ViewerContainer from '../components/ViewerContainer';
import { loadSampleData } from '@/lib/api';

/**
 * Demo Page - Autoplay landing demo with tile mode
 * 
 * Query params:
 * - ?preset=mountain|dehesa|mediterranean (default: dehesa)
 * - ?autoplay=1 (default: 1)
 * - ?tileMode=1 (default: 1)
 */
export default function DemoPage() {
  const router = useRouter();
  const [recipe, setRecipe] = useState<TwinRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Parse query params
  const preset = (router.query.preset as 'mountain' | 'dehesa' | 'mediterranean') || 'dehesa';
  const autoplay = router.query.autoplay !== '0'; // Default ON
  const tileMode = router.query.tileMode !== '0'; // Default ON

  useEffect(() => {
    async function loadDemo() {
      if (!router.isReady) return;

      try {
        setLoading(true);
        setError(null);
        
        // Load sample data automatically
        const loadedRecipe = await loadSampleData({
          preset,
          onProgress: (status) => console.log('[Demo]', status),
        });

        setRecipe(loadedRecipe);
      } catch (err) {
        console.error('Demo load error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load demo');
      } finally {
        setLoading(false);
      }
    }

    loadDemo();
  }, [router.isReady, preset]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-climate-darker">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-climate-accent mx-auto"></div>
          <p className="text-gray-400">Loading GeoTwin demo...</p>
          <p className="text-xs text-gray-600">Preset: {preset}</p>
        </div>
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="h-screen flex items-center justify-center bg-climate-darker">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl">⚠️</div>
          <h1 className="text-2xl font-bold text-red-400">Demo Load Failed</h1>
          <p className="text-gray-400">{error || 'No recipe data available'}</p>
          <button
            onClick={() => router.reload()}
            className="px-4 py-2 bg-climate-accent hover:bg-climate-accent-bright rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <ViewerContainer recipe={recipe} autoplay={autoplay} tileMode={tileMode} />
    </div>
  );
}
