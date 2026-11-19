import test from 'node:test';
import assert from 'node:assert/strict';
import {exemptionUpdate,internalGroups,missingManualGroups} from './prepare-testflight-beta.mjs';

test('Only the validated audited build can receive an absent exemption setting',()=>{
  const b={id:'target',attributes:{version:'26',processingState:'VALID',usesNonExemptEncryption:null}};
  assert.deepEqual(exemptionUpdate(b),{data:{type:'builds',id:'target',attributes:{usesNonExemptEncryption:false}}});
  assert.equal(exemptionUpdate({...b,attributes:{...b.attributes,usesNonExemptEncryption:false}}),null);
  for(const attributes of [{version:'25'},{processingState:'PROCESSING'},{expired:true},{usesNonExemptEncryption:true}]) {
    assert.throws(()=>exemptionUpdate({...b,attributes:{...b.attributes,...attributes}}));
  }
});

test('Existing internal groups are reused without selecting external or ambiguous groups',()=>{
  const group=(id,internal)=>({id,attributes:{isInternalGroup:internal}});
  const groups=[group('internal',true),group('external',false)];
  assert.deepEqual(internalGroups(groups).map(g=>g.id),['internal']);
  assert.deepEqual(internalGroups([...groups,group('other',true)],['internal','external']).map(g=>g.id),['internal']);
  assert.throws(()=>internalGroups([group('external',false)]));
  assert.throws(()=>internalGroups([...groups,group('other',true)]));
});

test('Automatic groups and an already assigned build never receive a redundant add request',()=>{
  const groups=[{id:'automatic',attributes:{hasAccessToAllBuilds:true}},{id:'existing',attributes:{}},{id:'missing',attributes:{}}];
  assert.deepEqual(missingManualGroups(groups,['existing']).map(g=>g.id),['missing']);
});
