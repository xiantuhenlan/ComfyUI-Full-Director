"""The V2 optimizer uses this plugin's own local runtime, never another plugin."""
from pathlib import Path
from types import SimpleNamespace
import uuid

from PIL import Image
import numpy as np

from . import prompt_runtime as runtime

DEFAULT_MODEL = "Qwen3.8-27B-Q4_K_M.gguf"
DEFAULT_MMPROJ = "mmproj-F16.gguf"


def model_catalog():
    catalog = runtime._catalog()
    return {
        "installed": runtime._runtime_executable().is_file(),
        "directory": str(Path(runtime.folder_paths.models_dir) / "LLM"),
        "models": [item["display"] for item in catalog["models"]],
        "projectors": [item["path"] for item in catalog["mmproj_models"]],
        "model_aliases": {alias: item["display"] for item in catalog["models"]
                          for alias in (item["name"], item["path"], item["display"])},
        "projectors_by_model": catalog["projectors_by_model"],
        "default_model": catalog["selected_model"] or DEFAULT_MODEL,
        "default_projector": catalog["selected_mmproj"],
    }


class LocalQwenPrompt:
    @classmethod
    def execute(cls, prompt, skill, duration, llm_model, vision_model, think_mode,
                reasoning_effort, seed, max_tokens, video_sample_frames_per_sec,
                force_unload_model, reference_images=None, reference_videos=None):
        catalog = runtime._catalog(verify_projectors=False)
        model = next((item for item in catalog["models"]
                      if llm_model in (item["display"], item["name"], item["path"])), None)
        if model is None:
            raise ValueError(f"找不到所选本地语言模型：{llm_model}")
        projector = next((item["path"] for item in catalog["mmproj_models"]
                          if vision_model in (item["path"], item["name"])), "")
        if vision_model and not projector:
            raise ValueError(f"找不到所选视觉投影：{vision_model}")
        content = [{"type": "text", "text": f"Duration: {duration} seconds. Skill: {skill}.\n{prompt}"}]
        if projector:
            for index, tensor in enumerate((reference_images or {}).values(), 1):
                array = (tensor[0].detach().cpu().numpy().clip(0, 1) * 255).astype(np.uint8)
                content.append({"type": "text", "text": f"<Picture {index}>"})
                content.append({"type": "image_url", "image_url": {"url": runtime._optimizer_image_url(Image.fromarray(array))}})
        task_id = "full-digital-v2-" + uuid.uuid4().hex
        with runtime._OPTIMIZER_LOCK:
            runtime._OPTIMIZER_CANCELLED.clear()
            runtime._release_story_llm_runtime()
            try:
                port = runtime._start_story_llm_server(Path(model["path"]), max(8192, int(max_tokens) + 2048), task_id, projector, -1)
                response = runtime._story_server_request(f"http://127.0.0.1:{port}/v1/chat/completions", {
                    "model": "full-director-digital-v2",
                    "messages": [
                        {"role": "system", "content": "Enhance the supplied MiniMax H3 digital-human prompt. Preserve the user's identity, exact speech or lyrics, audio timing, camera direction, and requested actions. Output only the final prompt. " + runtime._official_h3_prompt_contract("REF2VA", float(duration), "zh")},
                        {"role": "user", "content": content},
                    ],
                    "seed": int(seed), "max_tokens": int(max_tokens),
                    "reasoning_effort": reasoning_effort,
                    "chat_template_kwargs": {"enable_thinking": bool(think_mode)},
                }, timeout=900)
                text = str(response["choices"][0]["message"].get("content") or "").strip()
                return SimpleNamespace(result=(text,))
            finally:
                if force_unload_model:
                    runtime._release_story_llm_runtime()
