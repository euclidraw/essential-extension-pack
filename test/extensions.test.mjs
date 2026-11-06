import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import group from '../extensions/group/dist/plugin.js';
import frame from '../extensions/frame/dist/plugin.js';

test('built manifests match the bundles and declare the group dependency', async () => {
  for (const name of ['group','frame']) {
    const dir=new URL(`../extensions/${name}/`,import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('alid.extension.json',dir)));
    const bytes=await readFile(new URL(manifest.entry,dir));
    assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(manifest.id,name==='group'?group.id:frame.id);
    assert.deepEqual(manifest.provides,(name==='group'?group:frame).provides);
  }
  assert.equal(frame.dependencies['space.group'],'^0.1.2');
  for (const id of ['members','ungroup']) assert.deepEqual(group.ui.controls.find(control => control.id === id).selectionReference, {aspect:'core.hierarchy',field:'parentId',targetAspect:'space.group'});
});

test('groups selected siblings, selects their members, ungroups and attaches to a frame', () => {
  const entities=new Map([['a',{'test.item':{}}],['b',{'test.item':{}}]]), commands=new Map();
  let selected=['a','b']; let batches=0; const history={begin(){},commit(){batches++},abort(){}};
  const selection={getSelection:()=>selected,setSelection:ids=>{selected=[...ids]}};
  const expanders=[]; const expand=ids=>expanders.reduce((current,fn)=>fn(current),ids); const world={registerSelectionExpander(fn){expanders.push(fn);return ()=>expanders.splice(expanders.indexOf(fn),1)},hasCanonicalSpec:()=>false,registerCanonical:()=>()=>{},hasEntity:id=>entities.has(id),isEntityReadOnly:()=>false,
    getCanonical:(id,aspect)=>entities.get(id)?.[aspect],listEntityIds:()=>[...entities.keys()],
    applyCanonicalTransaction(_caller,ops){for(const {id,aspect,patch} of ops){const obj=entities.get(id)??{}; if(patch===null)delete obj[aspect];else obj[aspect]={...obj[aspect],...patch};if(Object.keys(obj).length)entities.set(id,obj);else entities.delete(id);}}};
  const services={require(id){if(id==='canvas.selection')return selection;if(id==='canvas.active-tool-surface')return {get:()=>({selection,host:{history}})};if(id==='canvas.creation')return {create(){entities.set('f',{'space.scoped-frame':{title:'Frame'}});selected=['f'];return 'f'}};throw new Error(id)}};
  const registry={register(spec){commands.set(spec.id,spec.run);return ()=>commands.delete(spec.id)}};
  const grouping=group.activate({world,services,commands:registry});
  const framed=frame.activate({world,services,commands:registry,requireExtensionApi(id){assert.equal(id,'space.group');return grouping.api}});
  const id=commands.get('group:create')();assert.equal(world.getCanonical('a','core.hierarchy').parentId,id);assert.equal(world.getCanonical('b','core.hierarchy').parentId,id);
  assert.deepEqual(expand(['a']).sort(),['a','b']);
  selected=['a']; commands.get('group:select-members')(); assert.deepEqual(selected.sort(),['a','b']);commands.get('group:ungroup')();assert.equal(world.getCanonical('a','core.hierarchy').parentId,null);
  commands.get('frame:create')();selected=['f','a'];commands.get('frame:attach')();assert.equal(world.getCanonical('a','core.hierarchy').parentId,'f');
  assert.deepEqual(expand(['f']).sort(),['a','f']);
  entities.set('nested',{'space.scoped-frame':{title:'Nested'},'core.hierarchy':{parentId:'f'}});entities.set('nestedChild',{'test.item':{},'core.hierarchy':{parentId:'nested'}});
  assert.deepEqual(expand(['f']).sort(),['a','f','nested','nestedChild']);
  assert.throws(()=>grouping.api.setParent(['f'],'a'),/순환/);assert.equal(batches,3);
  framed();grouping.dispose();assert.equal(commands.size,0);assert.equal(expanders.length,0);
});
