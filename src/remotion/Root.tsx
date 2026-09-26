import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

type RemotionAsset = { id: string; path: string; fallbackAssetId: string | null };
type RemotionScene = {
  id: string;
  actualStartSec: number | null;
  actualEndSec: number | null;
  plannedDurationSec: number;
  voiceover: string;
  onScreenText: string[];
  assetRefs: string[];
  caption?: string;
  bilingual?: { onScreenText: string[]; subtitle: string };
};
export type RemotionSpec = {
  product: { name: string; oneLiner: string; url: string };
  brand: { colors: string[]; fontFamilies: string[]; canvas: 'dark' | 'light' };
  output: { width: number; height: number; fps: number; targetDurationSec: number };
  assets: RemotionAsset[];
  scenes: RemotionScene[];
  captions: { enabled: boolean };
};
export type RemotionInputProps = { spec: RemotionSpec; narrationPath?: string | null };

const DEFAULT_PROPS: RemotionInputProps = {
  spec: {
    product: { name: 'Product Video', oneLiner: 'A clear product story', url: '' },
    brand: { colors: ['#08111F', '#F2EBE5', '#3784DB'], fontFamilies: ['Segoe UI'], canvas: 'dark' },
    output: { width: 1920, height: 1080, fps: 30, targetDurationSec: 1 },
    assets: [],
    scenes: [],
    captions: { enabled: true },
  },
};

export function durationInFramesForSpec(spec: RemotionSpec): number {
  const end = spec.scenes.reduce((max, scene, index) => {
    const start = scene.actualStartSec ?? (index === 0 ? 0 : max);
    return Math.max(max, scene.actualEndSec ?? start + scene.plannedDurationSec);
  }, 0);
  return Math.max(1, Math.round(Math.max(end, spec.output.targetDurationSec) * spec.output.fps));
}

function assetUrl(spec: RemotionSpec, assetId: string): string | null {
  const requested = spec.assets.find((candidate) => candidate.id === assetId);
  const fallback = requested?.fallbackAssetId ? spec.assets.find((candidate) => candidate.id === requested.fallbackAssetId) : undefined;
  const asset = requested ?? fallback ?? spec.assets[0];
  if (!asset) return null;
  return staticFile(asset.path.replaceAll('\\', '/'));
}

function SceneView({ spec, scene, sceneIndex }: { spec: RemotionSpec; scene: RemotionScene; sceneIndex: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [0, Math.min(16, fps * 0.5)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const slide = interpolate(frame, [0, Math.min(24, fps * 0.8)], [40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const title = scene.bilingual?.onScreenText?.[0] ?? scene.onScreenText[0] ?? spec.product.name;
  const details = scene.bilingual?.onScreenText?.slice(1) ?? scene.onScreenText.slice(1);
  const image = assetUrl(spec, scene.assetRefs[0] ?? '');
  const palette = spec.brand.colors.length >= 3 ? spec.brand.colors : ['#08111F', '#F2EBE5', '#3784DB'];
  const caption = scene.bilingual?.subtitle ?? scene.caption ?? scene.voiceover;

  return (
    <AbsoluteFill style={{ opacity: fade, transform: `translateX(${slide}px)`, background: palette[0], color: palette[1], fontFamily: spec.brand.fontFamilies.join(', ') }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '64px 120px 20px', borderBottom: `1px solid ${palette[1]}55`, fontSize: 24 }}>
        <strong style={{ letterSpacing: 2 }}>{spec.product.name}</strong>
        <span style={{ color: palette[2] }}>{String(sceneIndex + 1).padStart(2, '0')} / {String(spec.scenes.length).padStart(2, '0')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: 56, alignItems: 'center', flex: 1, padding: '46px 120px 28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          <span style={{ color: palette[2], fontWeight: 700, letterSpacing: 4, fontSize: 24 }}>PRODUCT STORY</span>
          <h1 style={{ margin: 0, fontSize: 72, lineHeight: 1.18, letterSpacing: -2, fontWeight: 800 }}>{title}</h1>
          <div style={{ width: 132, height: 6, background: palette[2] }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: `${palette[1]}cc`, fontSize: 31, lineHeight: 1.45 }}>
            {details.map((detail) => <span key={detail}>{detail}</span>)}
          </div>
        </div>
        <div style={{ height: 590, border: `1px solid ${palette[1]}77`, borderRadius: 20, background: palette[2] + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: `0 20px 60px ${palette[2]}22` }}>
          {image ? <Img src={image} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <div style={{ color: `${palette[1]}99`, fontSize: 34 }}>Scene {sceneIndex + 1}</div>}
        </div>
      </div>
      {spec.captions.enabled && caption ? <div style={{ padding: '18px 120px 50px', borderTop: `1px solid ${palette[1]}55`, fontSize: 28, lineHeight: 1.4 }}>{caption}</div> : null}
    </AbsoluteFill>
  );
}

export function RemotionVideo({ spec, narrationPath }: RemotionInputProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: spec.brand.colors[0] ?? '#08111F' }}>
      {spec.scenes.map((scene, index) => {
        const start = scene.actualStartSec ?? (index === 0 ? 0 : (spec.scenes[index - 1]?.actualEndSec ?? 0));
        const end = scene.actualEndSec ?? start + scene.plannedDurationSec;
        return <Sequence key={scene.id} from={Math.round(start * fps)} durationInFrames={Math.max(1, Math.round((end - start) * fps))}><SceneView spec={spec} scene={scene} sceneIndex={index} /></Sequence>;
      })}
      {narrationPath ? <Audio src={staticFile(narrationPath.replaceAll('\\', '/'))} /> : null}
    </AbsoluteFill>
  );
}

export function RemotionRoot() {
  return <Composition id="main" component={RemotionVideo} width={1920} height={1080} fps={30} durationInFrames={1} defaultProps={DEFAULT_PROPS} />;
}
