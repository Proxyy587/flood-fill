import { beforeEach, describe, expect, it } from 'vitest';
import { asBuildingId, BlockType, DEFAULT_NPC_PARAMS, type EditCommand, type Scenario } from '../contracts';
import { NpcParamsSchema, ScenarioSchema } from '../contracts/schemas';
import { mockScenario } from '../contracts/mocks';
import { useEditorStore } from '../ui/store/editorStore';
import { applyCommands, commandBatch, historyEntry } from './commands';
import { commitGesture } from './gestures';
import { footprint, lineCells, neighbours, rectCells, validateFootprint } from './geometry';
import { parseCity } from './persistence';
import { cityWarnings } from './validation';
import { editorBus } from '../bridge/buses';

function city(): Scenario {
  const s=mockScenario();s.size={w:16,h:16};s.ground=new Array(256).fill(2);s.blocks=new Array(256).fill(BlockType.Grass);
  s.buildings=[];s.districts=[];s.powerGrid={nodes:[],edges:[]};s.weather.sources=[];s.injected=[];return s;
}

describe('grid geometry',()=>{
  it('paints reverse rectangles and edge-connected diagonal road polylines',()=>{
    expect(rectCells(34,17,16)).toEqual([17,18,33,34]);
    for(const [a,b] of [[0,255],[15,240],[31,31],[70,76],[70,166]]){
      const cells=lineCells(a,b,16);expect(cells[0]).toBe(a);expect(cells.at(-1)).toBe(b);
      cells.slice(1).forEach((c,i)=>expect(neighbours(cells[i],16,16)).toContain(c));
    }
    expect(neighbours(15,16,16)).not.toContain(16);
  });
  it('rejects out-of-bounds, occupied, steep and inaccessible hospital lots',()=>{
    const s=city();expect(footprint(15,3,16,16)).toEqual([]);
    const cells=footprint(34,3,16,16);expect(validateFootprint(s,cells,BlockType.Hospital)).toContain('Hospital needs an adjacent road.');
    s.blocks[33]=BlockType.Road;expect(validateFootprint(s,cells,BlockType.Hospital)).toEqual([]);
    s.ground[34]=3;expect(validateFootprint(s,cells,BlockType.Hospital)).toContain('Level the foundation with the height brush first.');
    s.ground[34]=2;s.buildings=[{id:asBuildingId(0),type:BlockType.House,cells:[34],entrance:33,capacity:4,floorHeight:.5}];
    expect(validateFootprint(s,cells,BlockType.Hospital)).toContain('Overlaps an existing building.');
  });
});

describe('document commands and history',()=>{
  beforeEach(()=>useEditorStore.getState().load(city()));
  it('inverts surface edits and does not mutate the source',()=>{
    const s=city(),commands:EditCommand[]=[{kind:'setBlock',cell:0,block:BlockType.Road},{kind:'setHeight',cell:1,ground:10}];
    const entry=historyEntry(s,commands);expect(applyCommands(entry.after,entry.inverse)).toEqual(s);
    expect(s.blocks[0]).toBe(BlockType.Grass);
  });
  it('retains 100 gestures and restores exact structural IDs, generators and power topology',()=>{
    const s=city();s.buildings=[{id:asBuildingId(40),type:BlockType.Hospital,cells:[34,35],entrance:33,capacity:30,floorHeight:.5,generator:{fuelTicks:200},powerNode:1}];
    s.blocks[34]=s.blocks[35]=BlockType.Hospital;s.powerGrid={nodes:[{id:1,kind:'load',cell:34,building:asBuildingId(40)}],edges:[]};
    useEditorStore.getState().load(s);useEditorStore.getState().commit([{kind:'removeAt',cell:34}]);
    expect(useEditorStore.getState().scenario?.buildings).toEqual([]);
    useEditorStore.getState().undo();expect(useEditorStore.getState().scenario).toEqual(s);
    useEditorStore.getState().redo();expect(useEditorStore.getState().scenario?.powerGrid.nodes).toEqual([]);
    for(let i=0;i<120;i++)useEditorStore.getState().commit([{kind:'setHeight',cell:0,ground:i}]);
    expect(useEditorStore.getState().past).toHaveLength(100);
  });
  it('replays emitted commands to the same grid and round-trips road → hospital → undo → redo → save → load',()=>{
    const baseline=city(), emitted:EditCommand[]=[];
    const off=editorBus.onDispatch(cmd=>emitted.push(cmd));
    useEditorStore.setState({tool:'line',block:BlockType.Road});commitGesture(33,97);
    useEditorStore.setState({tool:'building',block:BlockType.Hospital});commitGesture(34,34);
    const placed=useEditorStore.getState().scenario!;expect(placed.buildings).toHaveLength(1);
    useEditorStore.getState().undo();expect(useEditorStore.getState().scenario?.buildings).toHaveLength(0);
    useEditorStore.getState().redo();expect(useEditorStore.getState().scenario).toEqual(placed);
    expect(applyCommands(baseline,emitted)).toEqual(placed);
    expect(parseCity(JSON.stringify({scenario:placed,params:DEFAULT_NPC_PARAMS})).scenario).toEqual(placed);
    expect(ScenarioSchema.safeParse(placed).success).toBe(true);off();
  });
  it('locks commands in run and replay, and discards redo after a fresh edit',()=>{
    const store=useEditorStore.getState();store.commit([{kind:'setHeight',cell:0,ground:3}]);store.undo();
    useEditorStore.getState().commit([{kind:'setHeight',cell:1,ground:4}]);expect(useEditorStore.getState().future).toHaveLength(0);
    const s=useEditorStore.getState().scenario;useEditorStore.setState({mode:'run'});store.commit([{kind:'setHeight',cell:1,ground:5}]);store.undo();expect(useEditorStore.getState().scenario).toBe(s);
    useEditorStore.setState({mode:'replay'});store.redo();expect(useEditorStore.getState().scenario).toBe(s);
  });
  it('rejects invalid command cells, wrapping rectangles and unknown power nodes',()=>{
    expect(()=>applyCommands(city(),[{kind:'setBlock',cell:300,block:BlockType.Road}])).toThrow('outside');
    expect(()=>applyCommands(city(),[{kind:'paintRect',x0:15,x1:17,z0:1,z1:1,block:BlockType.Road}])).toThrow('outside');
    expect(()=>applyCommands(city(),[{kind:'setPowerEdge',a:0,b:1,on:true}])).toThrow('existing nodes');
  });
  it('round-trips all NPC fields through Zod',()=>{
    for(const key of Object.keys(DEFAULT_NPC_PARAMS) as (keyof typeof DEFAULT_NPC_PARAMS)[])useEditorStore.getState().setParam(key,key.includes('Delay')?42:.5);
    expect(NpcParamsSchema.parse(useEditorStore.getState().params)).toEqual(useEditorStore.getState().params);
  });
  it('connects and disconnects power edges through existing node clicks',()=>{
    const s=city();s.powerGrid={nodes:[{id:0,kind:'plant',cell:17},{id:1,kind:'load',cell:20}],edges:[]};
    useEditorStore.getState().load(s);useEditorStore.setState({tool:'power'});commitGesture(17,17);commitGesture(20,20);
    expect(useEditorStore.getState().scenario?.powerGrid.edges).toEqual([[0,1]]);
    commitGesture(17,17);commitGesture(20,20);expect(useEditorStore.getState().scenario?.powerGrid.edges).toEqual([]);
    expect(commandBatch([]).kind).toBe('applyPatch');
  });
});

describe('save validation and city checks',()=>{
  it('reads raw scenarios and editor saves, and explains malformed JSON',()=>{
    expect(parseCity(JSON.stringify(city())).params.carOwnership).toBe(.4);
    expect(()=>parseCity('{broken')).toThrow('not valid JSON');
    expect(()=>parseCity(JSON.stringify({...city(),ground:[]}))).toThrow('expected 256 cells');
    expect(()=>parseCity(JSON.stringify({scenario:city(),params:{...DEFAULT_NPC_PARAMS,panicMean:2}}))).toThrow('panicMean');
  });
  it('warns about missing HQ and disconnected roads',()=>{
    const s=city();s.blocks[0]=s.blocks[255]=BlockType.Road;
    expect(cityWarnings(s)).toContain('No Flood HQ: add a command centre.');
    expect(cityWarnings(s)).toContain('Road network has 2 disconnected components.');
  });
});
