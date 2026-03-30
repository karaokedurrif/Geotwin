import { EffectComposer, SSAO, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { useStudioStore } from '../store';

function SSAOEffect() {
  return (
    <SSAO
      blendFunction={BlendFunction.MULTIPLY}
      radius={0.06}
      intensity={25}
      samples={21}
      luminanceInfluence={0.6}
      worldDistanceThreshold={0.97}
      worldDistanceFalloff={0.03}
      worldProximityThreshold={0.97}
      worldProximityFalloff={0.03}
    />
  );
}

function BloomEffect() {
  return (
    <Bloom
      luminanceThreshold={1.5}
      mipmapBlur
      intensity={0.2}
    />
  );
}

function VignetteEffect() {
  return (
    <Vignette
      offset={0.15}
      darkness={0.7}
      blendFunction={BlendFunction.NORMAL}
    />
  );
}

export default function StudioPostProcessing() {
  const ssao = useStudioStore((s) => s.ssaoEnabled);
  const bloom = useStudioStore((s) => s.bloomEnabled);
  const vignette = useStudioStore((s) => s.vignetteEnabled);

  // No effects enabled — skip EffectComposer entirely for perf
  if (!ssao && !bloom && !vignette) return null;

  return (
    <EffectComposer multisampling={4}>
      <>
        {ssao ? <SSAOEffect /> : null}
        {bloom ? <BloomEffect /> : null}
        {vignette ? <VignetteEffect /> : null}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </>
    </EffectComposer>
  );
}
