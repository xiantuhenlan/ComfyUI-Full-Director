import { app } from "../../scripts/app.js";
import { FULL_NODE, ENGINES, engineNode, engineExtensions, installCanvasPromptRouting } from "./full_director_bridge.js";
import { FULL_DIRECTOR_NAVIGATION } from "./full_director_manga.js";
import { syncEngineGroups } from "./full_director_groups.js";
import "./motion_director.js";
import "./xiantu_moss_image_asset_workbench.js";
import "./character_multiview.js";
import { studio as createDigitalV2 } from "./full_director_digital_human_v2.js";

const PAGES = { manga: "漫剧 / 短剧", replacement: "角色替换", image: "H3-IMAGE 做图", digital: "数字人" };
const DIRECTOR_TITLE = "闲兔H3全功能导演台V1";
function repairDigitalPorts(node) {
    const legacy = {"数字人_CLIP":"数字人_H3_CLIP","数字人_VAE":"数字人_H3_VIDEO_VAE","数字人_音频VAE":"数字人_H3_AUDIO_VAE"};
    for (const input of node.inputs || []) if (legacy[input.name]) input.name = legacy[input.name];
    for (let index=(node.inputs?.length||0)-1;index>=0;index--) {
        if(node.inputs[index].name==="数字人_优化后提示词")node.removeInput?.(index);
    }
    for (const [name,type] of [["数字人_H3_CLIP","CLIP"],["数字人_H3_VIDEO_VAE","VAE"],["数字人_H3_AUDIO_VAE","VAE"]]) {
        if (!node.inputs?.some(input => input.name === name)) node.addInput(name,type);
        const retained=node.inputs.find(input=>input.name===name);
        for(let index=node.inputs.length-1;index>=0;index--){
            const duplicate=node.inputs[index];
            if(duplicate===retained||duplicate.name!==name)continue;
            if(retained.link==null&&duplicate.link!=null){
                retained.link=duplicate.link;duplicate.link=null;
                const graph=node.graph,id=retained.link;
                const link=graph?.getLink?.(id)||(graph?.links instanceof Map?graph.links.get(id):graph?.links?.[id]);
                if(Array.isArray(link))link[4]=node.inputs.indexOf(retained);
                else if(link)link.target_slot=node.inputs.indexOf(retained);
            }
            node.removeInput(index);
        }
        Object.assign(retained,{name,type,localized_name:name});
    }
    for (const [index,[name,type]] of [["数字人_H3条件","CONDITIONING"],["数字人_H3 Latent","LATENT"],["数字人_H3图像","IMAGE"],["数字人_H3音频","AUDIO"],["数字人_H3放大前文件名","STRING"],["数字人_H3放大后文件名","STRING"]].entries()) {
        if (!node.outputs?.[13+index]) node.addOutput(name,type);
        Object.assign(node.outputs[13+index],{name,type,localized_name:name});
    }
    const project=node.widgets?.find(widget=>widget.name==="digital_project_id");
    if(project?.value&&!/^[a-zA-Z0-9_-]{8,80}$/.test(String(project.value)))project.value="";
}
function pageRoot(node, page) {
    if (page === "manga") return node._xfdmWorkbench;
    if (page === "image") return engineNode(node, page)._xfdiaw?.root;
    if (page === "digital") return engineNode(node,page)._fdh2Studio;
    return node._fullReplacementRoot;
}
function initializeDigital(node) {
    const view = engineNode(node, "digital");
    const root = createDigitalV2(view);
    document.body.append(root);
    view._fdh2Studio = root;
}
function initializeRole(node) {
    const view = engineNode(node, "replacement");
    if (view._fullInitialized) return view;
    view._fullInitialized = true;
    const Type = function() {};
    for (const extension of engineExtensions("replacement")) {
        extension.beforeRegisterNodeDef?.(Type, {
            name: "XiantuFullReplacementDirector", output: ["CONDITIONING", "LATENT", "AUDIO", "IMAGE", "INT", "STRING"],
            output_name: ["positive", "Latent", "原声", "引导视频帧", "分镜帧数", "文件名"],
        });
    }
    Type.prototype.onNodeCreated?.call(view);
    return view;
}
async function initializeImage(node) {
    const view = engineNode(node, "image");
    if (!view._fullInitialized) {
        view._fullInitialized = true;
        for (const extension of engineExtensions("image")) await extension.nodeCreated?.(view);
    }
    return view;
}
function decorate(node, page, root) {
    if (!root) throw new Error(`无法打开${PAGES[page]}工作台`);
    root.dataset.fullDirectorEngine = page;
    root.hidden = false;
    const heading=root.querySelector(({manga:".xfdm-brand span",replacement:".xfd-role-brand h1",image:".xfdiaw-header>strong",digital:".fdh2-brand h1 b"})[page]);
    if(heading){
        if(page==="replacement"&&heading.querySelector("span")){
            heading.firstChild.textContent="闲兔";
            heading.querySelector("span").textContent="H3全功能导演台V1";
        }else heading.textContent=DIRECTOR_TITLE;
    }
    (root.matches('[role="dialog"]')?root:root.querySelector('[role="dialog"]'))?.setAttribute("aria-label",DIRECTOR_TITLE);
    if (!root._fullDirectorNavigation) {
        root._fullDirectorNavigation = true;
        root.addEventListener("click", event => {
            const target = event.target.closest?.("[data-full-page]");
            if (!target) {
                if(page==="manga"&&event.target.closest?.("[data-mode]"))syncEngineGroups(node,"manga",ENGINES);
                return;
            }
            event.preventDefault(); event.stopImmediatePropagation();
            openPage(node, target.dataset.fullPage).catch(showError);
        }, true);
    }
    if (page !== "manga") {
        root.style.left = "0";
        const nav = root._fullDirectorLeftNav ||= document.createElement("nav");
        if (!nav.isConnected) {
            nav.className = "xfdm-workflow-nav xfdm-panel full-director-left-nav";
            nav.dataset.fullDirectorNavigation = page;
            nav.setAttribute("aria-label", `${DIRECTOR_TITLE}页面`);
            nav.innerHTML = FULL_DIRECTOR_NAVIGATION;
            nav.querySelectorAll("button").forEach(button => {
                button.classList.toggle("active",button.dataset.fullPage === page);
                button.onclick = async () => {
                    try {
                        if (button.dataset.fullPage) await openPage(node,button.dataset.fullPage);
                        else {
                            await openPage(node,"manga");
                            pageRoot(node,"manga").querySelector(`.xfdm-workflow-nav [data-mode="${button.dataset.mode}"]`)?.click();
                        }
                    } catch(error) { showError(error); }
                };
            });
            document.body.append(nav);
            root._fullDirectorNavObserver?.disconnect();
            const observer = root._fullDirectorNavObserver = new MutationObserver(() => {
                if (!root.isConnected) { nav.remove(); observer.disconnect(); root._fullDirectorLayoutObserver?.disconnect(); }
            });
            observer.observe(document.body,{childList:true});
        }
        nav.hidden = false;
        const layout = () => {
            const header = page === "image" ? root.querySelector(".xfdiaw-header") : page === "replacement" ? root.querySelector(".xfd-role-head") : root.querySelector(".fdh2-header");
            const bottom = page === "image" ? root.querySelector(".xfdiaw-bottom") : page === "replacement" ? root.querySelector(".xfd-role-timeline") : root.querySelector(".fdh2-footer");
            nav.style.top = `${(header?.getBoundingClientRect().bottom || 68) + 10}px`;
            nav.style.bottom = bottom ? `${window.innerHeight - bottom.getBoundingClientRect().top + 8}px` : "12px";
        };
        if (!root._fullDirectorLayoutObserver) {
            root._fullDirectorLayoutObserver = new ResizeObserver(layout);
            root._fullDirectorLayoutObserver.observe(root);
            const bottom = root.querySelector(".xfdiaw-bottom,.xfd-role-timeline,.fdh2-footer");
            if (bottom) root._fullDirectorLayoutObserver.observe(bottom);
        }
        requestAnimationFrame(layout);
    }
    if (page === "image") {
        const select = root.querySelector("[data-model-profile]");
        if (select) select.replaceChildren(new Option("H3-IMAGE", "H3-IMAGE", true, true));
    }
}
function showError(error) { app.extensionManager?.toast?.add?.({ severity: "error", summary: DIRECTOR_TITLE, detail: String(error?.message || error), life: 7000 }); console.error(error); }
async function openPage(node, page = "manga") {
    if (!Object.hasOwn(PAGES, page)) return;
    const old = node.properties.fullDirectorActiveEngine;
    try {
        syncEngineGroups(node,page,ENGINES);
        if (!pageRoot(node, page)?.isConnected) {
            if (page === "manga") await node.__xfdmOpen();
            else if (page === "digital") initializeDigital(node);
            else if (page === "image") {
                const view = await initializeImage(node);
                view.properties.fullDirectorH3ImageWorkbenchPage = "H3-IMAGE";
                view.__xfdiawOpen();
            } else {
                const view = initializeRole(node);
                view.widgets.find(widget => widget.type === "button")?.callback?.();
                node._fullReplacementRoot = [...document.querySelectorAll(".xfd-role-root")].at(-1);
            }
        }
        const root = pageRoot(node, page);
        decorate(node, page, root);
        for (const key of Object.keys(PAGES)) {
            const other = pageRoot(node, key);
            if (!other || key === page) continue;
            other.querySelectorAll("video,audio").forEach(media => media.pause());
            other.hidden = true;
            if (other._fullDirectorLeftNav) other._fullDirectorLeftNav.hidden = true;
        }
        node.properties.fullDirectorActiveEngine = page;
        node.widgets.find(widget => widget.name === "director_mode").value = page;
        syncEngineGroups(node,page,ENGINES);
        node.setDirtyCanvas?.(true, true);
    } catch (error) { node.properties.fullDirectorActiveEngine = old; syncEngineGroups(node,old||"manga",ENGINES); throw error; }
}

const style = document.createElement("style");
style.textContent = `[data-full-director-engine][hidden],[data-full-director-navigation][hidden]{display:none!important}.full-director-left-nav{position:fixed;z-index:100001;left:12px;top:78px;bottom:12px;width:88px;box-sizing:border-box}[data-full-director-engine="image"]>.xfdiaw-app{max-width:100%}[data-full-director-engine="image"] .xfdiaw-main{margin-left:100px}[data-full-director-engine="replacement"]>.xfd-role-toolbar,[data-full-director-engine="replacement"]>.xfd-role-workspace{margin-left:100px}body:has([data-full-director-engine]:not([hidden])) #xiantu-toolbar-status{display:none!important}@media(max-width:1450px){.full-director-left-nav{width:76px}[data-full-director-engine="image"] .xfdiaw-main,[data-full-director-engine="replacement"]>.xfd-role-toolbar,[data-full-director-engine="replacement"]>.xfd-role-workspace{margin-left:88px}}`;
style.textContent += `.full-director-left-nav[data-full-director-navigation="digital"]{z-index:1000001}[data-full-director-engine="digital"] .fdh2-app>:is(.fdh2-scenes,.fdh2-settings,.fdh2-audio,.fdh2-lower){margin-left:100px}@media(max-width:1450px){[data-full-director-engine="digital"] .fdh2-app>:is(.fdh2-scenes,.fdh2-settings,.fdh2-audio,.fdh2-lower){margin-left:88px}}`;
document.head.append(style);
style.textContent += `.full-director-left-nav{font-family:"Microsoft YaHei","PingFang SC",Inter,sans-serif}.full-director-left-nav *{box-sizing:border-box}.full-director-left-nav button{font:inherit}`;
app.registerExtension({
    name: "Xiantu.FullDirector",
    setup() { installCanvasPromptRouting(app); },
    async nodeCreated(node) {
        if (String(node.comfyClass || node.type) !== FULL_NODE) return;
        node.properties ||= {};
        repairDigitalPorts(node);
        // ComfyUI may configure a saved node before this async hook resumes.
        // Install the migration synchronously so legacy saved slots cannot survive.
        const previousConfigure = node.onConfigure;
        node.onConfigure = function(...args) {
            previousConfigure?.apply(this,args);
            repairDigitalPorts(this);
            this.title=DIRECTOR_TITLE;
            this._fullDirectorViews?.delete("digital");
            requestAnimationFrame(()=>syncEngineGroups(this,this.properties.fullDirectorActiveEngine||"manga",ENGINES));
        };
        for (const extension of engineExtensions("manga")) await extension.nodeCreated?.(node);
        node.title = DIRECTOR_TITLE;
        for (const [index, name] of ["漫剧_条件", "漫剧_Latent", "漫剧_放大前文件名", "漫剧_放大后文件名"].entries()) {
            if (node.outputs?.[index]) Object.assign(node.outputs[index], { name, localized_name: name });
        }
        for (const widget of node.widgets || []) {
            if (widget.type === "button") {
                widget.name = `打开${DIRECTOR_TITLE}`;
                widget.callback = () => openPage(node, node.properties.fullDirectorActiveEngine || "manga").catch(showError);
            } else if (widget.name !== "replacement_conditioning_mode") {
                widget.type = "converted-widget"; widget.hidden = true; widget.computeSize = () => [0, -4];
                widget.draw = () => {}; widget.serializeValue = async () => widget.value;
                if (widget.element) widget.element.style.display = "none";
            } else {
                widget.label = "角色替换参考条件";
                widget.localized_name = "角色替换参考条件";
            }
        }
        const previousExecuted = node.onExecuted;
        node.onExecuted = function(message) {
            previousExecuted?.call(this, message);
            for (const view of this._fullDirectorViews?.values() || []) view.onExecuted?.(message);
        };
        node.setSize?.([520, Math.max(350, node.computeSize?.()?.[1] || 350)]);
    },
});

export { openPage };
