import {LIBRARY_STAMP_IDS} from './stamp-library.js';

// Old requests keep their existing stamp default. An explicit false never
// falls back to café, including when an earlier stamp selection is still sent.
export function selfServiceChoice(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid_stamp_mode');
  if (Object.hasOwn(payload, 'show_stamps') && typeof payload.show_stamps !== 'boolean') throw new Error('invalid_stamp_mode');
  if (payload.show_stamps === false) return {showStamps:false, stampId:null};
  const stampId = typeof payload.stamp_id === 'string' ? payload.stamp_id : 'cafe';
  if (stampId === 'cadeau' || !LIBRARY_STAMP_IDS.includes(stampId)) throw new Error('invalid_stamp');
  return {showStamps:true, stampId};
}

export const selfServiceWithoutStamps = p => p?.design_mode === 'custom'
  && !p?.card_design && p?.self_service_show_stamps === false;

// Google owns its logo/header placement. The body template selects only the
// requested information and avoids displaying the internal card number.
export function simpleGoogleTemplate() {
  const item = path => ({firstValue:{fields:[{fieldPath:path}]}});
  return {cardTemplateOverride:{cardRowTemplateInfos:[
    {twoItems:{startItem:item('object.accountName'),endItem:item("object.textModulesData['reward']")}},
    {oneItem:{item:item("object.textModulesData['progress']")}}
  ]}};
}

export function simpleGoogleFields(p, balance) {
  const done = Math.max(0, Math.floor(Number(balance)||0)), goal = Math.max(1, Math.floor(Number(p.goal)||10));
  return {textModulesData:[
    {id:'reward',header:'Récompense',body:String(p.reward||'')},
    {id:'progress',header:p.mode==='points'?'Points':'Passages',body:done+' / '+goal}
  ]};
}
