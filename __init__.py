"""Three independently namespaced workbenches behind one canvas node."""
from .director import XiantuFullDirector
from .engines import digital_human_v2_impl
from .engines.replacement.media_interface import XiantuFullReplacementDirector
from .engines.replacement.video_output import XiantuFullReplacementSaveVideo
from .engines.replacement.cleanup_routes import register_cleanup_routes
from .engines.replacement import local_services as _replacement_services
from .engines.image.moss_image_asset_workbench import XiantuFullH3ImageWorkbench
from .engines.image import services as _image_services
from .engines.manga import local_image_import as _manga_services
from .engines.manga import video_prompt_optimizer as _prompt_optimizer
from .engines.manga import video_continuity, video_postprocess, video_latent_cache
from .engines.manga import h3_data_bridge, h3_latent_continuation, sigmas_relay, sampler_relay, universal_relay, group_switch
from server import PromptServer

__version__ = "0.1.1"

NODE_CLASS_MAPPINGS = {
    'XiantuFullDirector': XiantuFullDirector,
    'XiantuFullReplacementDirector': XiantuFullReplacementDirector,
    'XiantuFullReplacementSaveVideo': XiantuFullReplacementSaveVideo,
    'XiantuFullH3ImageWorkbench': XiantuFullH3ImageWorkbench,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    'XiantuFullDirector': '闲兔H3全功能导演台V1',
    'XiantuFullReplacementDirector': '闲兔H3全功能导演台V1 · 角色替换内部接口',
    'XiantuFullReplacementSaveVideo': '闲兔H3全功能导演台V1 · 角色替换保存视频',
    'XiantuFullH3ImageWorkbench': '闲兔H3全功能导演台V1 · H3-IMAGE内部接口',
}
for _module in (video_continuity, video_postprocess, video_latent_cache, h3_data_bridge,
                h3_latent_continuation, sigmas_relay, sampler_relay, universal_relay, group_switch, digital_human_v2_impl):
    NODE_CLASS_MAPPINGS.update(_module.NODE_CLASS_MAPPINGS)
    NODE_DISPLAY_NAME_MAPPINGS.update(_module.NODE_DISPLAY_NAME_MAPPINGS)
register_cleanup_routes()
PromptServer.instance.add_on_prompt_handler(h3_data_bridge.route_bridge_after_continuation)
WEB_DIRECTORY = './web'

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
