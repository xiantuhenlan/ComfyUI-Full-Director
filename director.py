"""One visible node with three independent execution contracts."""
import copy
import json

from .engines.manga.video_editor import XiantuFullMangaEngine
from .engines.replacement.media_interface import XiantuFullReplacementDirector
from .engines.image.moss_image_asset_workbench import XiantuFullH3ImageWorkbench
from .engines.digital_human_v2_impl.nodes import XiantuFullDigitalHumanStudioV2

MODE_INPUTS = {
    'manga': ('CLIP', 'VAE', '音频 VAE'),
    'replacement': ('角色替换_CLIP', '角色替换_VAE', '角色替换_音频VAE'),
    'image': ('H3_IMAGE_CLIP', 'H3_IMAGE_VAE'),
    'digital': ('数字人_H3_CLIP', '数字人_H3_VIDEO_VAE', '数字人_H3_AUDIO_VAE'),
}
OUTPUT_RANGES = {'manga': (0, 4), 'replacement': (4, 10), 'image': (10, 13), 'digital': (13, 19)}


def _output_parts(output):
    if isinstance(output, dict):
        return tuple(output.get('result', ())), output.get('ui')
    if isinstance(output, tuple):
        return output, None
    return tuple(getattr(output, 'args', getattr(output, 'result', ()))), getattr(output, 'ui', None)


class XiantuFullDirector:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'project_id': ('STRING', {'default': ''}),
                'editor_state': ('STRING', {'default': '{}', 'multiline': True}),
                'director_mode': (['manga', 'replacement', 'image', 'digital'], {'default': 'manga'}),
                'replacement_state': ('STRING', {'default': '{}', 'multiline': True}),
                'replacement_conditioning_mode': (['video_audio', 'guide', 'pose'], {'default': 'video_audio'}),
                'image_project_name': ('STRING', {'default': 'H3-IMAGE工程'}),
                'image_workbench_state': ('STRING', {'default': '{}', 'multiline': True}),
                'image_h3_state': ('STRING', {'default': '', 'multiline': True}),
                'digital_project_id': ('STRING', {'default': ''}),
                'digital_segment_index': ('INT', {'default': 0, 'min': 0, 'max': 9999}),
            },
            'optional': {
                'CLIP': ('CLIP', {'lazy': True}),
                'VAE': ('VAE', {'lazy': True}),
                '音频 VAE': ('VAE', {'lazy': True}),
                '角色替换_CLIP': ('CLIP', {'lazy': True}),
                '角色替换_VAE': ('VAE', {'lazy': True}),
                '角色替换_音频VAE': ('VAE', {'lazy': True}),
                'H3_IMAGE_CLIP': ('CLIP', {'lazy': True}),
                'H3_IMAGE_VAE': ('VAE', {'lazy': True}),
                'H3_IMAGE_提示词优化模型': ('CLIP', {'lazy': True}),
                '数字人_H3_CLIP': ('CLIP', {'lazy': True}),
                '数字人_H3_VIDEO_VAE': ('VAE', {'lazy': True}),
                '数字人_H3_AUDIO_VAE': ('VAE', {'lazy': True}),
            },
        }

    RETURN_TYPES = ('CONDITIONING', 'LATENT', 'STRING', 'STRING',
                    'CONDITIONING', 'LATENT', 'AUDIO', 'IMAGE', 'INT', 'STRING',
                    'CONDITIONING', 'LATENT', 'STRING',
                    'CONDITIONING', 'LATENT', 'IMAGE', 'AUDIO', 'STRING', 'STRING')
    RETURN_NAMES = ('漫剧_条件', '漫剧_Latent', '漫剧_放大前文件名', '漫剧_放大后文件名',
                    '角色替换_条件', '角色替换_Latent', '角色替换_原声', '角色替换_引导视频帧', '角色替换_分镜帧数', '角色替换_文件名',
                    'H3_IMAGE_条件', 'H3_IMAGE_Latent', 'H3_IMAGE_文件名',
                    '数字人_H3条件', '数字人_H3 Latent', '数字人_H3图像', '数字人_H3音频', '数字人_H3放大前文件名', '数字人_H3放大后文件名')
    FUNCTION = 'run'
    CATEGORY = '闲兔/全功能导演台'
    OUTPUT_NODE = True

    @classmethod
    def check_lazy_status(cls, director_mode='manga', image_workbench_state='{}', image_h3_state='', **inputs):
        required = list(MODE_INPUTS.get(director_mode, ()))
        if director_mode == 'image':
            from .engines.image.moss_image_asset_workbench import _active_task
            _state, _shot, task = _active_task(image_h3_state or image_workbench_state)
            if (task.get('generateText') or {}).get('enabled', False):
                required.append('H3_IMAGE_提示词优化模型')
        return [name for name in required if name in inputs and inputs[name] is None]

    @classmethod
    def VALIDATE_INPUTS(cls, director_mode='manga', editor_state='{}', replacement_state='{}', image_workbench_state='{}', image_h3_state='', **_inputs):
        if director_mode == 'manga':
            return XiantuFullMangaEngine.VALIDATE_INPUTS(editor_state)
        if director_mode == 'digital':
            return True
        if director_mode not in OUTPUT_RANGES:
            return '请选择漫剧、角色替换或 H3-IMAGE 页面。'
        raw = replacement_state if director_mode == 'replacement' else image_h3_state or image_workbench_state
        try:
            if not isinstance(json.loads(raw), dict):
                return '当前页面状态必须是 JSON 对象。'
        except (ValueError, TypeError):
            return '当前页面状态不是有效 JSON。'
        return True

    def run(self, director_mode='manga', project_id='', editor_state='{}', replacement_state='{}',
            replacement_conditioning_mode='video_audio', image_project_name='H3-IMAGE工程',
            image_workbench_state='{}', image_h3_state='', digital_project_id='', digital_segment_index=0, **inputs):
        if director_mode == 'manga':
            output = XiantuFullMangaEngine().run(project_id, editor_state,
                                               **{name: inputs.get(name) for name in MODE_INPUTS['manga']})
        elif director_mode == 'replacement':
            output = XiantuFullReplacementDirector.execute(
                clip=inputs.get('角色替换_CLIP'), vae=inputs.get('角色替换_VAE'),
                audio_vae=inputs.get('角色替换_音频VAE'), shot_json=replacement_state,
                conditioning_mode=replacement_conditioning_mode,
            )
        elif director_mode == 'image':
            output = XiantuFullH3ImageWorkbench.execute(
                clip=inputs.get('H3_IMAGE_CLIP'), vae=inputs.get('H3_IMAGE_VAE'),
                prompt_upsampler=inputs.get('H3_IMAGE_提示词优化模型'), project_name=image_project_name,
                workbench_state=image_workbench_state, h3_image_state=image_h3_state or image_workbench_state,
            )
        elif director_mode == 'digital':
            output = XiantuFullDigitalHumanStudioV2().process(
                project_id=digital_project_id, segment_index=digital_segment_index,
                H3_CLIP=inputs.get('数字人_H3_CLIP'), H3_VIDEO_VAE=inputs.get('数字人_H3_VIDEO_VAE'),
                H3_AUDIO_VAE=inputs.get('数字人_H3_AUDIO_VAE'),
            )
        else:
            raise ValueError('未知导演台页面。')
        values, ui = _output_parts(output)
        start, end = OUTPUT_RANGES[director_mode]
        if len(values) != end - start:
            raise ValueError(f'{director_mode} 返回接口数量不符：{len(values)}')
        result = [None] * len(self.RETURN_TYPES)
        result[start:end] = values
        return {'result': tuple(result), **({'ui': ui} if ui else {})}
