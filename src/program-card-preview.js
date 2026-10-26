import { defaultDesign, prepareDesign } from './card-designer.js';
import { STAMP_LIBRARY } from './stamp-library.js';

// Read-only adapter. Never persist these preview defaults onto an existing program.
export function prepareProgramPreview(p, business, activity, assetUrl) {
  if (!p) return null;
  const program = { bg:p.bg, accent:p.accent, mode:p.mode, goal:p.goal, reward:p.reward,
    logo_path:p.logoPath, hero_path:p.heroPath };
  const merchant = { business_name:business, activity };
  if (p.cardDesign) return prepareDesign(p.cardDesign, program, merchant, assetUrl);
  const d = defaultDesign({merchant, program});
  const stamp = STAMP_LIBRARY.find(s => s.id === p.selfServiceStampId);
  const self = p.designMode === 'custom';
  d.previewKind = self ? (stamp && p.mode !== 'points' ? 'self-service-stamps' : 'self-service') : 'legacy';
  d.assets.logo = p.logoUrl ? {url:p.logoUrl} : null;
  d.assets.hero = p.heroUrl ? {url:p.heroUrl} : null;
  d.stamps = {...d.stamps, icon:stamp?'library':'none', libraryId:stamp?.id || '',
    rewardId:stamp?'cadeau':'reward-star', inactiveOpacity:stamp?32:22};
  d.apple = {...d.apple, showBusinessName:self, showStampPanel:!self};
  return d;
}
