import { EffectComposer, SSAO, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { useStudioStore } from '../store';

function SSAOEffect() {
  return (
    <SSAO
      blendFunction={BlendFunction.MULTIPLY}
      radius={0.05}
      intensity={15}
      samples={16}
      luminanceInfluence={0.6}
      worldDistanceThreshold={0.5}
      worldDistanceFalloff={0.1}
      worldProximityThreshold={0.3}
      worldProximityFalloff={0.1}
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
    <EffectComposer multisampling={0} enableNormalPass={ssao}>
      <>
        {ssao ? <SSAOEffect /> : null}
        {bloom ? <BloomEffect /> : null}
        {vignette ? <VignetteEffect /> : null}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </>
    </EffectComposer>
  );
}
