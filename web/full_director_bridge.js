// Engine-local graph views keep one canvas node's three contracts separate.
import { HELPER_CLASSES } from "./full_director_helpers.js";
import { engineGroupScope, syncEngineGroups } from "./full_director_groups.js";
export const FULL_NODE = "XiantuFullDirector";
export const ENGINES = Object.freeze({
    manga: {
        type: FULL_NODE, range: [0, 4],
        inputs: { CLIP: "CLIP", VAE: "VAE", "音频 VAE": "音频 VAE" },
        widgets: { project_id: "project_id", editor_state: "editor_state" },
    },
    replacement: {
        type: "XiantuFullReplacementDirector", range: [4, 10],
        inputs: { clip: "角色替换_CLIP", vae: "角色替换_VAE", audio_vae: "角色替换_音频VAE" },
        widgets: { shot_json: "replacement_state", conditioning_mode: "replacement_conditioning_mode" },
    },
    image: {
        type: "XiantuFullH3ImageWorkbench", range: [10, 13],
        inputs: { clip: "H3_IMAGE_CLIP", vae: "H3_IMAGE_VAE", prompt_upsampler: "H3_IMAGE_提示词优化模型" },
        widgets: { project_name: "image_project_name", workbench_state: "image_workbench_state", h3_image_state: "image_h3_state" },
    },
    digital: {
        type: "XiantuFullDigitalHumanStudioV2", range: [13, 19],
        inputs: { H3_CLIP: "数字人_H3_CLIP", H3_VIDEO_VAE: "数字人_H3_VIDEO_VAE", H3_AUDIO_VAE: "数字人_H3_AUDIO_VAE" },
        widgets: { project_id: "digital_project_id", segment_index: "digital_segment_index" },
    },
});
const captured = new Map();
const apps = new WeakMap();
const rawGraphPrompt = new WeakMap();
const graphViews = new WeakMap();
const promptQueues = new WeakMap();
let host;

export function engineExtensions(engine) { return captured.get(engine) || []; }
const isFull = node => String(node?.comfyClass || node?.type) === FULL_NODE;
const linksOf = graph => graph?.links instanceof Map ? [...graph.links.entries()] : Object.entries(graph?.links || {});
const linkField = (link, key, index) => Array.isArray(link) ? link[index] : link?.[key];
const childrenOf = output => {
    const children = new Map();
    for (const [id, record] of Object.entries(output)) for (const value of Object.values(record.inputs || {})) {
        if (!Array.isArray(value) || value.length !== 2 || !output[String(value[0])]) continue;
        const key = String(value[0]);
        if (!children.has(key)) children.set(key, new Set());
        children.get(key).add(id);
    }
    return children;
};
const descend = (starts, children) => {
    const found = new Set(), todo = [...starts];
    while (todo.length) {
        const id = String(todo.pop());
        if (found.has(id)) continue;
        found.add(id);
        todo.push(...(children.get(id) || []));
    }
    return found;
};

export function translatePrompt(snapshot, engineHint = null, graph = host?.graph, workbenchId = null) {
    const result = structuredClone(snapshot);
    const output = result.output || {};
    const children = childrenOf(output);
    const translated = new Map();
    const inactiveRoots = new Set(), activeRoots = new Set();
    for (const [id, record] of Object.entries(output)) {
        if (record.class_type !== FULL_NODE) continue;
        const actual = graph?.getNodeById?.(Number(id)) || graph?._nodes?.find(node => String(node.id) === id);
        const hinted = workbenchId == null || String(workbenchId) === id;
        const mode = (hinted ? engineHint : null) || actual?.properties?.fullDirectorActiveEngine || record.inputs.director_mode || "manga";
        const protocol = ENGINES[mode] || ENGINES.manga;
        translated.set(id, protocol);
        const [start, end] = protocol.range;
        for (const [consumerId, consumer] of Object.entries(output)) for (const value of Object.values(consumer.inputs || {})) {
            if (Array.isArray(value) && value.length === 2 && String(value[0]) === id) {
                (Number(value[1]) >= start && Number(value[1]) < end ? activeRoots : inactiveRoots).add(consumerId);
            }
        }
        const inputs = {};
        for (const [local, real] of Object.entries({ ...protocol.inputs, ...protocol.widgets })) {
            if (Object.hasOwn(record.inputs, real)) inputs[local] = record.inputs[real];
        }
        if (mode === "manga") {
            Object.assign(inputs, { director_mode: "manga", replacement_state: "{}", replacement_conditioning_mode: "video_audio", image_project_name: "H3-IMAGE工程", image_workbench_state: "{}", image_h3_state: "", digital_project_id: "", digital_segment_index: 0 });
        }
        if (mode === "image") {
            // This integrated page is H3-IMAGE, never the P-H3 code path.
            inputs.h3_image_state ||= inputs.workbench_state || "{}";
        }
        record.class_type = protocol.type;
        record.inputs = inputs;
    }
    const inactive = descend(inactiveRoots, children), active = descend(activeRoots, children);
    for (const id of inactive) if (!active.has(id) && !translated.has(id)) delete output[id];
    for (const [id, record] of Object.entries(output)) {
        for (const [name, value] of Object.entries(record.inputs || {})) {
            if (!Array.isArray(value) || value.length !== 2) continue;
            const origin = String(value[0]);
            if (inactive.has(origin) && !output[origin]) { delete record.inputs[name]; continue; }
            const protocol = translated.get(origin);
            if (protocol) {
                const [start, end] = protocol.range;
                if (value[1] >= start && value[1] < end) record.inputs[name] = [value[0], value[1] - start];
                else delete record.inputs[name];
            }
        }
    }
    const currentChildren = childrenOf(output), parents = new Map();
    for (const [origin, consumers] of currentChildren) for (const consumer of consumers) {
        if (!parents.has(consumer)) parents.set(consumer, new Set()); parents.get(consumer).add(origin);
    }
    const owned = descend(descend(translated.keys(), currentChildren), parents);
    for (const id of owned) if (output[id] && HELPER_CLASSES[output[id].class_type]) output[id].class_type = HELPER_CLASSES[output[id].class_type];
    if (workbenchId != null && output[String(workbenchId)]) {
        const keep = descend(descend([String(workbenchId)], currentChildren), parents);
        for (const id of Object.keys(output)) if (!keep.has(id)) delete output[id];
    }
    return result;
}

function ordinaryNodeView(node, engine) {
    if (!node) return node;
    return new Proxy(node, {
        get(target, key) {
            if (key === "type" || key === "comfyClass") {
                const value = target[key] || target.type;
                return HELPER_CLASSES[value] || value;
            }
            if (key === "properties" && engine === "manga") {
                target.properties ||= {};
                return new Proxy(target.properties, { get: (properties, name) => name === "fullDirectorMangaFunctionTag"
                    ? properties[name] || properties.xiantuFunctionTag : properties[name] });
            }
            if (key === "connect") return (slot, targetNode, targetSlot) => {
                if (targetNode?.__fullDirectorView) {
                    const name = targetNode.inputs[targetSlot]?.name;
                    const protocol = ENGINES[Object.keys(ENGINES).find(key => ENGINES[key].type === targetNode.type) || "manga"];
                    const real = targetNode.__fullDirectorOwner;
                    targetSlot = real.inputs.findIndex(input => input.name === protocol.inputs[name]);
                    targetNode = real;
                }
                return target.connect(slot, targetNode, targetSlot);
            };
            const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function graphView(actual, engine, owner) {
    if (!actual) return actual;
    let views=graphViews.get(actual);
    if(!views){views=new Map();graphViews.set(actual,views);}
    const viewKey=String(owner.id)+':'+engine;
    const existing=views.get(viewKey);
    if(existing?.owner===owner)return existing.view;
    const protocol = ENGINES[engine];
    let linkSnapshot=null,linkVersion='',scopeLinks=null,scopeSnapshot=null;
    const ordinaryViews=new WeakMap(),groupMembers=new WeakMap();
    const nodeView=node=>{
        if(!node)return node;
        if(isFull(node))return engineNode(node,engine);
        if(!ordinaryViews.has(node))ordinaryViews.set(node,ordinaryNodeView(node,engine));
        return ordinaryViews.get(node);
    };
    const filteredLinks = () => {
        const version=[actual._version,actual.last_link_id,actual.links instanceof Map?actual.links.size:Object.keys(actual.links||{}).length].join('|');
        if(linkSnapshot&&version===linkVersion)return linkSnapshot;
        const entries = [];
        for (const [key, link] of linksOf(actual)) {
            const origin = actual.getNodeById?.(linkField(link, "origin_id", 1));
            const target = actual.getNodeById?.(linkField(link, "target_id", 3));
            let originSlot = Number(linkField(link, "origin_slot", 2)), targetSlot = Number(linkField(link, "target_slot", 4));
            if (isFull(origin)) {
                if (originSlot < protocol.range[0] || originSlot >= protocol.range[1]) continue;
                originSlot -= protocol.range[0];
            }
            if (isFull(target)) {
                const name = target.inputs?.[targetSlot]?.name;
                const local = Object.entries(protocol.inputs).find(([, real]) => real === name)?.[0];
                if (!local) continue;
                targetSlot = Object.keys(protocol.inputs).indexOf(local);
            }
            const value = Array.isArray(link) ? [...link] : { ...link };
            if (Array.isArray(value)) { value[2] = originSlot; value[4] = targetSlot; }
            else { value.origin_slot = originSlot; value.target_slot = targetSlot; }
            entries.push([key, value]);
        }
        linkSnapshot=entries;linkVersion=version;
        queueMicrotask(()=>{if(linkSnapshot===entries)linkSnapshot=null;});
        return entries;
    };
    const scopedIds = () => {
        const links=filteredLinks();
        if(scopeLinks===links)return scopeSnapshot;
        const parents = new Map(), children = new Map();
        const edge = (a, b) => {
            a = String(a); b = String(b);
            if (!children.has(a)) children.set(a, new Set()); children.get(a).add(b);
            if (!parents.has(b)) parents.set(b, new Set()); parents.get(b).add(a);
        };
        for (const [, link] of links) edge(linkField(link, "origin_id", 1), linkField(link, "target_id", 3));
        const setters = new Map();
        for (const item of actual._nodes || []) if (item.type === "SetNode") {
            const name = item.widgets?.[0]?.value;
            if (typeof name === "string" && name.trim()) setters.set(name, setters.has(name) ? null : item);
        }
        for (const item of actual._nodes || []) if (item.type === "GetNode") {
            const setter = setters.get(item.widgets?.[0]?.value);
            if (setter) edge(setter.id, item.id);
        }
        scopeLinks=links;scopeSnapshot=descend(descend([String(owner.id)], children), parents);
        return scopeSnapshot;
    };
    const groupView = group => new Proxy(group, {
        get(target, key) {
            if (key === "recomputeInsideNodes") return () => target.recomputeInsideNodes?.();
            if (key === "nodes" || key === "_nodes") {
                const links=filteredLinks(),cached=groupMembers.get(target);
                if(cached?.links===links)return cached.nodes;
                const own=engineGroupScope(owner,engine,ENGINES);
                if(!own.hasGroups)target.recomputeInsideNodes?.();
                const ids=own.hasGroups?own.nodes:scopedIds();
                const nodes=[...(target.nodes||target._nodes||[])].filter(item=>ids.has(String(item.id))).map(nodeView);
                groupMembers.set(target,{links,nodes});
                return nodes;
            }
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    const view = new Proxy(actual, {
        get(target, key) {
            if (key === "_nodes") {
                const own=engineGroupScope(owner,engine,ENGINES);
                const ids=own.hasGroups?own.nodes:scopedIds();
                return target._nodes.filter(node=>String(node.id)===String(owner.id)||ids.has(String(node.id))).map(nodeView);
            }
            if (key === "getNodeById") return id => nodeView(target.getNodeById(id));
            if (key === "getGroupOnPos") return (...args) => {
                const group=target.getGroupOnPos?.(...args),own=engineGroupScope(owner,engine,ENGINES);
                return group&&(!own.hasGroups||own.groups.includes(group))?groupView(group):null;
            };
            if (key === "links") return target.links instanceof Map ? new Map(filteredLinks()) : Object.fromEntries(filteredLinks());
            if (key === "getLink") return id => filteredLinks().find(([key]) => String(key) === String(id))?.[1];
            if (key === "_groups") {
                const own=engineGroupScope(owner,engine,ENGINES);
                if(own.hasGroups)return own.groups.map(groupView);
                const ids = scopedIds();
                return (target._groups || []).filter(group => {
                    group.recomputeInsideNodes?.();
                    return (group.nodes || group._nodes || []).some(item => ids.has(String(item.id)));
                }).map(groupView);
            }
            if (key === "extra" && engine === "manga") {
                const extra=target.extra||={},legacy=extra.xiantuFunctionGroups;
                if(legacy){
                    owner.properties.fullDirectorEngines ||= {};
                    const state=owner.properties.fullDirectorEngines.manga ||= {};
                    const imported=state.legacyFunctionGroupImports ||= {};
                    for(const group of engineGroupScope(owner,engine,ENGINES).groups){
                        const id=`group:${group.id}`;
                        if(!Object.hasOwn(legacy,id)||Object.hasOwn(imported,id))continue;
                        const marks=extra.fullDirectorMangaFunctionGroups ||= {};
                        if(!Object.hasOwn(marks,id))marks[id]=JSON.parse(JSON.stringify(legacy[id]));
                        // Persist the import receipt so removing an imported tag
                        // does not resurrect it from the original workflow data.
                        imported[id]=true;
                    }
                }
                return extra;
            }
            if (key === "extra" && engine !== "manga") {
                owner.properties.fullDirectorEngines ||= {};
                const state = owner.properties.fullDirectorEngines[engine] ||= {};
                return state.graphExtra ||= {};
            }
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    views.set(viewKey,{owner,view});
    return view;
}

function serializeEnginePrompt(application,engine,args,workbenchId=null) {
    const serialize=async()=>{
        const owners=(application.graph?._nodes||[]).filter(node=>isFull(node)&&(workbenchId==null||String(node.id)===String(workbenchId)));
        for(const owner of owners)syncEngineGroups(owner,engine||owner.properties?.fullDirectorActiveEngine||'manga',ENGINES,false);
        try{return translatePrompt(await rawGraphPrompt.get(application)(...args),engine,application.graph,workbenchId);}
        finally{for(const owner of owners)syncEngineGroups(owner,owner.properties?.fullDirectorActiveEngine||'manga',ENGINES,false);}
    };
    const task=(promptQueues.get(application)||Promise.resolve()).catch(()=>{}).then(serialize);
    promptQueues.set(application,task.catch(()=>{}));
    return task;
}

export function engineNode(owner, engine) {
    if (!isFull(owner) || owner.__fullDirectorView) return owner;
    owner._fullDirectorViews ||= new Map();
    if (owner._fullDirectorViews.has(engine)) return owner._fullDirectorViews.get(engine);
    const protocol = ENGINES[engine];
    owner.properties ||= {};
    owner.properties.fullDirectorEngines ||= {};
    const properties = owner.properties.fullDirectorEngines[engine] ||= {};
    const view = {
        id: owner.id, type: protocol.type, comfyClass: protocol.type, properties,
        title: "闲兔H3全功能导演台V1",
        size: [420, 180], mode: 0, widgets: [], __fullDirectorView: true, __fullDirectorOwner: owner,
        inputs: Object.entries(protocol.inputs).map(([local, real]) => ({ ...(owner.inputs?.find(input => input.name === real) || {}), name: local })),
        outputs: (owner.outputs || []).slice(...protocol.range).map((output, index) => ({ ...output, name: ({
            manga: ["条件", "Latent", "H3放大前文件名", "H3放大后文件名"],
            replacement: ["positive", "Latent", "原声", "引导视频帧", "分镜帧数", "文件名"],
            image: ["positive", "Latent", "文件名"],
            digital: ["H3条件", "H3 Latent", "H3图像", "H3音频", "H3放大前文件名", "H3放大后文件名"],
        })[engine][index] })),
        addWidget(type, name, value, callback, options = {}) {
            const widget = { type, name, value, callback, options }; this.widgets.push(widget); return widget;
        },
        addInput(name, type) { this.inputs.push({ name, type, link: null }); },
        addOutput(name, type) { this.outputs.push({ name, type, links: [] }); },
        removeInput(index) { this.inputs.splice(index, 1); },
        removeOutput(index) { this.outputs.splice(index, 1); },
        setSize(value) { this.size = value; }, computeSize() { return this.size; },
        setDirtyCanvas(...args) { owner.setDirtyCanvas?.(...args); },
        getInputNode(index) {
            const real = protocol.inputs[this.inputs[index]?.name];
            const slot = owner.inputs?.findIndex(input => input.name === real);
            return slot >= 0 ? owner.getInputNode?.(slot) : null;
        },
        getInputInfo(index) { return this.inputs[index]; },
        getOutputInfo(index) { return this.outputs[index]; },
        connect(slot, target, targetSlot) { return owner.connect?.(slot + protocol.range[0], target.__fullDirectorOwner || target, targetSlot); },
        disconnectInput() {}, disconnectOutput() {},
    };
    for (const [local, real] of Object.entries(protocol.widgets)) {
        const original = owner.widgets?.find(widget => widget.name === real);
        const widget = { name: local, type: original?.type || "text", options: original?.options || {} };
        Object.defineProperty(widget, "value", { enumerable: true, get: () => original?.value ?? "{}", set: value => { if (original) original.value = value; } });
        view.widgets.push(widget);
    }
    owner._fullDirectorViews.set(engine, view);
    view.graph = graphView(owner.graph || host?.graph, engine, owner);
    if (engine === "image") {
        properties.fullDirectorH3ImageWorkbenchPage = "H3-IMAGE";
        properties.h3ImageOfficialEdit = false;
        properties.h3ImageCanvas = true;
    }
    return view;
}

export function engineApp(application, engine) {
    host ||= application;
    if (!rawGraphPrompt.has(application)) rawGraphPrompt.set(application, application.graphToPrompt.bind(application));
    let perApp = apps.get(application); if (!perApp) { perApp = new Map(); apps.set(application, perApp); }
    if (perApp.has(engine)) return perApp.get(engine);
    const proxy = new Proxy(application, {
        get(target, key) {
            if (key === "registerExtension") return extension => {
                const list = captured.get(engine) || [];
                if (list.some(item => item.name === extension.name)) return;
                list.push(extension); captured.set(engine, list);
                const { nodeCreated, ...hooks } = extension;
                if(hooks.getCanvasMenuItems){
                    const menu=hooks.getCanvasMenuItems;
                    hooks.getCanvasMenuItems=function(canvas,...args){
                        const owner=canvas.graph?._nodes?.find(isFull);
                        const scoped=owner?new Proxy(canvas,{get(target,key){if(key==='graph')return graphView(target.graph,engine,owner);const value=target[key];return typeof value==='function'?value.bind(target):value;}}):canvas;
                        return menu.call(this,scoped,...args);
                    };
                }
                target.registerExtension({ ...hooks, name: "FullDirector." + engine + "." + extension.name });
            };
            if (key === "graphToPrompt") return async (...args) => {
                const request = args[0];
                const workbenchId = request?.fullDirectorNodeId;
                if (workbenchId != null) args.shift();
                return serializeEnginePrompt(application,engine,args,workbenchId);
            };
            if (key === "graph") {
                const owner = target.graph?._nodes?.find(isFull);
                return owner ? graphView(target.graph, engine, owner) : target.graph;
            }
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    perApp.set(engine, proxy);
    return proxy;
}

export function installCanvasPromptRouting(application) {
    if (application.__fullDirectorRouting) return;
    application.__fullDirectorRouting = true;
    if (!rawGraphPrompt.has(application)) rawGraphPrompt.set(application, application.graphToPrompt.bind(application));
    application.graphToPrompt = (...args) => serializeEnginePrompt(application,null,args);
}
