// Navigation owns branch activation; each workbench only enumerates its groups.
const cache = new WeakMap();
const names = {
    manga: /漫剧|短剧/i,
    replacement: /角色替换|动作迁移/i,
    image: /h3[-_\s]*image|h3.*生图/i,
    digital: /数字人/i,
};
const walk = (starts, edges, stop) => {
    const found=new Set(),todo=[...starts];
    while(todo.length){const id=String(todo.pop());if(found.has(id))continue;found.add(id);if(id!==stop)todo.push(...(edges.get(id)||[]));}
    return found;
};
const membersOf = (group, graph) => {
    group.recomputeInsideNodes?.();
    const members=group.nodes||group._nodes;
    if(members)return [...members];
    const box=group._bounding||group.bounding;
    if(!box)return [];
    return (graph._nodes||[]).filter(node=>node.pos?.[0]>=box[0]&&node.pos[1]>=box[1]&&node.pos[0]<=box[0]+box[2]&&node.pos[1]<=box[1]+box[3]);
};

function scopesFor(owner, protocols) {
    const graph=owner.graph;
    if(!graph)return {};
    const version=[graph._version,graph.last_link_id,graph._nodes?.length,graph._groups?.length,...(owner.inputs||[]).map(input=>input.link)].join('|');
    let entry=cache.get(graph);
    if(!entry){entry=new Map();cache.set(graph,entry);queueMicrotask(()=>cache.delete(graph));}
    const key=String(owner.id)+':'+version;
    if(entry.has(key))return entry.get(key);
    const links=graph.links instanceof Map?[...graph.links.values()]:Object.values(graph.links||{});
    const field=(link,name,index)=>Array.isArray(link)?link[index]:link[name];
    const parents=new Map(),children=new Map();
    for(const link of links){const a=String(field(link,'origin_id',1)),b=String(field(link,'target_id',3));if(!parents.has(b))parents.set(b,new Set());parents.get(b).add(a);if(!children.has(a))children.set(a,new Set());children.get(a).add(b);}
    const setters=new Map();
    for(const node of graph._nodes||[])if(node.type==='SetNode'){const name=node.widgets?.[0]?.value;if(name)setters.set(name,setters.has(name)?null:node);}
    for(const node of graph._nodes||[])if(node.type==='GetNode'){const source=setters.get(node.widgets?.[0]?.value);if(source){const a=String(source.id),b=String(node.id);if(!parents.has(b))parents.set(b,new Set());parents.get(b).add(a);if(!children.has(a))children.set(a,new Set());children.get(a).add(b);}}
    const ownerId=String(owner.id),groups=(graph._groups||[]).map(group=>({group,members:membersOf(group,graph)}));
    const result={};
    for(const [engine,protocol] of Object.entries(protocols)){
        const downstream=links.filter(link=>String(field(link,'origin_id',1))===ownerId&&field(link,'origin_slot',2)>=protocol.range[0]&&field(link,'origin_slot',2)<protocol.range[1]).map(link=>String(field(link,'target_id',3)));
        const roots=(owner.inputs||[]).filter(input=>Object.values(protocol.inputs).includes(input.name)).map(input=>links.find(link=>String(field(link,'id',0))===String(input.link))).filter(Boolean).map(link=>String(field(link,'origin_id',1)));
        const connected=walk([...walk(downstream,children,ownerId),...roots],parents,ownerId);
        connected.delete(ownerId);
        const stored=owner.properties?.fullDirectorGroupBindings?.[engine]||[];
        const candidates=groups.filter(item=>stored.some(id=>String(id)===String(item.group.id))||names[engine].test(String(item.group.title||'')));
        // Named/bound branches belong to this combined workflow even before
        // their inputs or outputs have been wired to the director.
        const matched=candidates;
        const nodes=new Set(matched.flatMap(item=>item.members.map(node=>String(node.id))));nodes.delete(ownerId);
        const nested=groups.filter(item=>item.members.length&&item.members.some(node=>nodes.has(String(node.id)))&&item.members.every(node=>nodes.has(String(node.id))||String(node.id)===ownerId));
        result[engine]={nodes,connected,providers:walk(roots,parents,ownerId),groups:nested.map(item=>item.group),bindings:matched.map(item=>item.group.id),hasGroups:matched.length>0};
    }
    entry.set(key,result);
    return result;
}

export function engineGroupScope(owner, engine, protocols) {
    return scopesFor(owner,protocols)[engine]||{nodes:new Set(),connected:new Set(),groups:[],bindings:[],hasGroups:false};
}

export function syncEngineGroups(owner, engine, protocols, notify=true) {
    const graph=owner.graph;if(!graph||!protocols[engine])return;
    const scopes=scopesFor(owner,protocols);
    owner.properties||={};
    const saved=owner.properties.fullDirectorGroupNodeModes||={};
    const bindings=owner.properties.fullDirectorGroupBindings||={};
    const fullNodes=new Set((graph._nodes||[]).filter(node=>String(node.comfyClass||node.type)==='XiantuFullDirector').map(node=>String(node.id)));
    let changed=false;
    for(const [page,scope] of Object.entries(scopes)){
        if(scope.bindings.length)bindings[page]=scope.bindings;
        for(const id of scope.nodes){
            if(fullNodes.has(id))continue;
            // Shared providers cannot be bypassed merely because their box is
            // inside another branch. Leave them available to their consumers.
            const node=graph.getNodeById?.(Number(id))||(graph._nodes||[]).find(item=>String(item.id)===id);
            if(!node)continue;
            const mode=Number(node.mode||0);
            if(Object.entries(scopes).some(([other,value])=>other!==page&&(value.nodes.has(id)||value.providers.has(id)))){
                if(Object.hasOwn(saved,id)){const wanted=saved[id];delete saved[id];if(mode!==wanted){node.mode=wanted;changed=true;}}
                continue;
            }
            if(page===engine){if(Object.hasOwn(saved,id)){const wanted=saved[id];delete saved[id];if(mode!==wanted){node.mode=wanted;changed=true;}}}
            else{if(!Object.hasOwn(saved,id)||mode!==4)saved[id]=mode;if(mode!==4){node.mode=4;changed=true;}}
        }
    }
    if(changed&&notify){graph.change?.();graph.setDirtyCanvas?.(true,true);}
}
