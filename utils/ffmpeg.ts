import { FFmpegKit, FFprobeKit, ReturnCode } from '@wekor/react-native-ffmpeg';
import { Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface ClipInput {
  uri: string;
  trim?: { start: number; end: number };
  hasAudio?: boolean;
  duration?: number;
}

export interface EditOptions {
  speed?: number;
  color?: { brightness?: number; contrast?: number; saturation?: number };
  resolution?: string;
  fps?: number;
  transform?: {
    scale?: number;
    translateX?: number;
    translateY?: number;
    rotation?: number;
    targetRatio?: string;
    canvasWidth?: number;
    canvasHeight?: number;
  };
  musicUri?: string;
  videoVolume?: number;
  musicVolume?: number;
}

export interface ExportProgress {
  processedMs: number;
  totalMs: number;
  percent: number;
}

export interface FFmpegResult {
  success: boolean;
  error?: string;
}

const ensureRawPath = (uri: string): string => {
  if (uri.startsWith('file://')) {
    return uri.substring(7);
  }
  return uri;
};

export const getVideoMetadata = async (uri: string): Promise<VideoMetadata | null> => {
  try {
    const rawPath = ensureRawPath(uri);
    const session = await FFprobeKit.getMediaInformation(rawPath);
    const info = await session.getMediaInformation();
    if (info) {
      const duration = Number(info.getDuration());
      const streams = info.getStreams();
      let width = 0, height = 0;
      let hasAudio = false;
      let hasVideo = false;
      for (let i = 0; i < streams.length; i++) {
        const stream = streams[i];
        if (stream.getType() === 'video') {
          hasVideo = true;
          width = stream.getWidth();
          height = stream.getHeight();
        } else if (stream.getType() === 'audio') {
          hasAudio = true;
        }
      }
      return { duration, width, height, hasAudio, hasVideo };
    }
  } catch (error) {
    console.error('Error getting video metadata:', error);
  }
  return null;
};

export const executeFFmpeg = async (
  command: string,
  onProgress?: (progress: ExportProgress) => void
): Promise<FFmpegResult> => {
  try {
    console.log(`Executing FFmpeg: ${command}`);
    const session = await FFmpegKit.execute(command);
    const returnCode = await session.getReturnCode();
    if (ReturnCode.isSuccess(returnCode)) {
      console.log('FFmpeg success.');
      return { success: true };
    } else if (ReturnCode.isCancel(returnCode)) {
      console.log('FFmpeg cancelled.');
      return { success: false, error: 'Export cancelled' };
    } else {
      const output = await session.getOutput();
      const allLogs = await session.getAllLogsAsString();
      console.error('FFmpeg failed. Output:', output);
      console.error('FFmpeg logs:', allLogs);
      return { success: false, error: output || allLogs || 'Unknown FFmpeg error' };
    }
  } catch (error) {
    console.error('FFmpeg execution error:', error);
    return { success: false, error: String(error) };
  }
};

export const generateThumbnails = async (uri: string, duration: number, count: number): Promise<string[]> => {
  const fps = Math.max(0.1, count / Math.max(duration, 1));
  const outDirPath = `${Paths.cache.uri}thumbs_current/`;

  try {
    const info = await FileSystem.getInfoAsync(outDirPath);
    if (info.exists) {
      await FileSystem.deleteAsync(outDirPath, { idempotent: true });
    }
  } catch {}

  await FileSystem.makeDirectoryAsync(outDirPath, { intermediates: true });

  const rawInput = ensureRawPath(uri);
  const rawOutput = ensureRawPath(outDirPath);

  const command = `-y -i "${rawInput}" -vf "fps=${fps},scale=120:-1" -q:v 2 "${rawOutput}thumb_%03d.jpg"`;
  const result = await executeFFmpeg(command);
  if (result.success) {
    const files = await FileSystem.readDirectoryAsync(outDirPath);
    return files.sort().map(f => `${outDirPath}${f}`);
  }
  return [];
};

function getTargetDimensions(targetRatio: string): { w: number; h: number } {
  switch (targetRatio) {
    case '16:9': return { w: 1920, h: 1080 };
    case '9:16': return { w: 1080, h: 1920 };
    case '1:1': return { w: 1080, h: 1080 };
    default: return { w: 1920, h: 1080 };
  }
}

function buildAtempoFilter(speed: number): string[] {
  const filters: string[] = [];
  let remaining = speed;

  if (remaining >= 0.5 && remaining <= 2.0) {
    filters.push(`atempo=${remaining.toFixed(4)}`);
  } else if (remaining > 2.0) {
    while (remaining > 2.0) {
      filters.push('atempo=2.0');
      remaining /= 2.0;
    }
    if (Math.abs(remaining - 1.0) > 0.01) {
      filters.push(`atempo=${remaining.toFixed(4)}`);
    }
  } else {
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
    if (Math.abs(remaining - 1.0) > 0.01) {
      filters.push(`atempo=${remaining.toFixed(4)}`);
    }
  }

  return filters;
}

function buildFilters(options: EditOptions): { videoFilters: string[]; audioFilters: string[] } {
  const videoFilters: string[] = [];
  const audioFilters: string[] = [];

  if (options.speed && options.speed !== 1.0) {
    videoFilters.push(`setpts=${(1.0 / options.speed).toFixed(4)}*PTS`);
    audioFilters.push(...buildAtempoFilter(options.speed));
  }

  if (options.color) {
    const { brightness = 0, contrast = 1, saturation = 1 } = options.color;
    videoFilters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`);
  }

  if (options.transform) {
    const {
      scale = 1, translateX = 0, translateY = 0,
      rotation = 0, targetRatio = 'Original',
      canvasWidth = 1, canvasHeight = 1
    } = options.transform;

    if (Math.abs(rotation) > 0.01) {
      videoFilters.push(`rotate=${rotation}:c=black:ow='rotw(${rotation})':oh='roth(${rotation})'`);
    }
    if (Math.abs(scale - 1) > 0.01) {
      videoFilters.push(`scale=iw*${scale}:ih*${scale}`);
    }
    if (targetRatio !== 'Original' || Math.abs(translateX) > 1 || Math.abs(translateY) > 1) {
      let ratioStr = 'dar';
      if (targetRatio === '16:9') ratioStr = '16/9';
      else if (targetRatio === '9:16') ratioStr = '9/16';
      else if (targetRatio === '1:1') ratioStr = '1/1';
      const normX = translateX / canvasWidth;
      const normY = translateY / canvasHeight;
      videoFilters.push(
        `pad=width='max(iw\\,ih*(${ratioStr}))':height='max(ih\\,iw/(${ratioStr}))':x='(ow-iw)/2+(${normX}*ow)':y='(oh-ih)/2+(${normY}*oh)':color=black`
      );
      videoFilters.push(
        `crop=w='min(iw\\,ih*(${ratioStr}))':h='min(ih\\,iw/(${ratioStr}))':x='(iw-ow)/2':y='(ih-oh)/2'`
      );
    }
  }

  return { videoFilters, audioFilters };
}

function buildPerClipFilters(
  options: EditOptions,
  _srcWidth: number,
  _srcHeight: number
): string {
  const targetRatio = options.transform?.targetRatio || 'Original';
  const { w: targetW, h: targetH } = getTargetDimensions(targetRatio);
  const parts: string[] = [];

  const scale = options.transform?.scale ?? 1;
  const rotation = options.transform?.rotation ?? 0;
  const translateX = options.transform?.translateX ?? 0;
  const translateY = options.transform?.translateY ?? 0;
  const canvasWidth = options.transform?.canvasWidth ?? 1;
  const canvasHeight = options.transform?.canvasHeight ?? 1;

  if (Math.abs(rotation) > 0.01) {
    parts.push(`rotate=${rotation}:c=black:ow='rotw(${rotation})':oh='roth(${rotation})'`);
  }
  if (Math.abs(scale - 1) > 0.01) {
    parts.push(`scale=iw*${scale}:ih*${scale}`);
  }

  parts.push(
    `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,` +
    `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
  );

  if (Math.abs(translateX) > 1 || Math.abs(translateY) > 1) {
    const normX = translateX / canvasWidth;
    const normY = translateY / canvasHeight;
    parts.push(
      `crop=w='${targetW}':h='${targetH}':x='(iw-ow)/2+(${normX}*ow)':y='(ih-oh)/2+(${normY}*oh)'`
    );
  }

  if (options.color) {
    const { brightness = 0, contrast = 1, saturation = 1 } = options.color;
    parts.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`);
  }

  if (options.speed && options.speed !== 1.0) {
    parts.push(`setpts=${(1.0 / options.speed).toFixed(4)}*PTS`);
  }

  return parts.join(',');
}

export const processVideo = async (
  inputUris: ClipInput[] | string[] | string,
  outputUri: string,
  options: EditOptions,
  onProgress?: (progress: ExportProgress) => void
): Promise<FFmpegResult> => {

  let clips: ClipInput[];
  if (typeof inputUris === 'string') {
    clips = [{ uri: inputUris }];
  } else if (Array.isArray(inputUris) && inputUris.length > 0 && typeof inputUris[0] === 'string') {
    clips = (inputUris as string[]).map(uri => ({ uri }));
  } else {
    clips = inputUris as ClipInput[];
  }

  const isMultiClip = clips.length > 1;
  const musicIndex = clips.length;

  const inputParts: string[] = clips.map(clip => {
    const trimOpt = clip.trim ? `-ss ${clip.trim.start.toFixed(3)} -to ${clip.trim.end.toFixed(3)}` : '';
    const rawPath = ensureRawPath(clip.uri);
    return `${trimOpt} -i "${rawPath}"`.trim();
  });
  if (options.musicUri) {
    const rawMusic = ensureRawPath(options.musicUri);
    inputParts.push(`-i "${rawMusic}"`);
  }
  const inputStr = inputParts.join(' ');

  let filterComplex = '';
  let mapArgs = '';

  if (isMultiClip) {
    let scaleFilters = '';
    let concatParts = '';

    for (let i = 0; i < clips.length; i++) {
      const clipFilters = buildPerClipFilters(options, 1920, 1080);
      scaleFilters += `[${i}:v]${clipFilters}[sv${i}];`;

      let segmentDuration = clips[i].duration || 0;
      if (clips[i].trim) {
        segmentDuration = clips[i].trim!.end - clips[i].trim!.start;
      }
      if (segmentDuration <= 0) segmentDuration = 5.0;

      if (clips[i].hasAudio === false) {
        scaleFilters += `anullsrc=channel_layout=stereo:sample_rate=44100:d=${segmentDuration.toFixed(3)}[sa${i}];`;
      } else {
        const clipAudioFilters: string[] = [];
        if (options.speed && options.speed !== 1.0) {
          clipAudioFilters.push(...buildAtempoFilter(options.speed));
        }
        if (clipAudioFilters.length > 0) {
          scaleFilters += `[${i}:a]${clipAudioFilters.join(',')}aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[sa${i}];`;
        } else {
          scaleFilters += `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[sa${i}];`;
        }
      }
      concatParts += `[sv${i}][sa${i}]`;
    }

    const concatFilter = `${concatParts}concat=n=${clips.length}:v=1:a=1[cv][ca]`;

    let aFilterStr = '';
    if (options.videoVolume !== undefined && options.videoVolume !== 1.0) {
      aFilterStr = `;[ca]volume=${options.videoVolume.toFixed(2)}[a0]`;
    } else {
      aFilterStr = `;[ca]anull[a0]`;
    }

    if (options.musicUri) {
      let musicAudio = `[${musicIndex}:a]`;
      if (options.musicVolume !== undefined && options.musicVolume !== 1.0) {
        scaleFilters += `[${musicIndex}:a]volume=${options.musicVolume.toFixed(2)}[mus0];`;
        musicAudio = '[mus0]';
      }
      const amix = `;[a0]${musicAudio}amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      filterComplex = `-filter_complex "${scaleFilters}${concatFilter}${aFilterStr}${amix}"`;
      mapArgs = `-map "[cv]" -map "[aout]"`;
    } else {
      filterComplex = `-filter_complex "${scaleFilters}${concatFilter};[cv]copy[vout]${aFilterStr}"`;
      mapArgs = `-map "[vout]" -map "[a0]"`;
    }

  } else if (options.speed !== undefined || options.color || options.transform || options.musicUri) {
    const { videoFilters, audioFilters } = buildFilters(options);
    let filterParts = '';
    let vMapSrc = '0:v';
    let aMapSrc = '0:a';

    const hasAudio = clips[0].hasAudio !== false;
    let segmentDuration = clips[0].duration || 0;
    if (clips[0].trim) {
      segmentDuration = clips[0].trim!.end - clips[0].trim!.start;
    }
    if (segmentDuration <= 0) segmentDuration = 5.0;

    if (!hasAudio && (audioFilters.length > 0 || options.musicUri)) {
      filterParts += `anullsrc=channel_layout=stereo:sample_rate=44100:d=${segmentDuration.toFixed(3)}[silence];`;
      aMapSrc = '[silence]';
    }

    if (videoFilters.length > 0) {
      filterParts += `[0:v]${videoFilters.join(',')}[vout];`;
      vMapSrc = '[vout]';
    }

    let musicAudio = `[${musicIndex}:a]`;
    if (options.musicUri && options.musicVolume !== undefined && options.musicVolume !== 1.0) {
      filterParts += `[${musicIndex}:a]volume=${options.musicVolume.toFixed(2)}[mus0];`;
      musicAudio = '[mus0]';
    }

    let videoAudio = aMapSrc;
    if (options.videoVolume !== undefined && options.videoVolume !== 1.0 && hasAudio) {
      filterParts += `[${aMapSrc}]volume=${options.videoVolume.toFixed(2)}[vidvol];`;
      videoAudio = '[vidvol]';
    }

    if (options.musicUri) {
      if (audioFilters.length > 0 && hasAudio) {
        filterParts += `[${videoAudio}]${audioFilters.join(',')}[avid];`;
        filterParts += `[avid]${musicAudio}amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      } else {
        filterParts += `[${videoAudio}]${musicAudio}amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      }
      aMapSrc = '[aout]';
    } else if (audioFilters.length > 0 && hasAudio) {
      filterParts += `[${videoAudio}]${audioFilters.join(',')}[aout]`;
      aMapSrc = '[aout]';
    } else if (videoAudio !== aMapSrc) {
      filterParts += `[${videoAudio}]anull[aout]`;
      aMapSrc = '[aout]';
    }

    if (filterParts) {
      if (filterParts.endsWith(';')) filterParts = filterParts.slice(0, -1);
      filterComplex = `-filter_complex "${filterParts}"`;
    }

    if (!hasAudio && !options.musicUri && audioFilters.length === 0) {
      mapArgs = `-map ${vMapSrc}`;
    } else {
      mapArgs = `-map ${vMapSrc} -map ${aMapSrc}`;
    }

  } else {
    if (clips[0].hasAudio === false) {
      mapArgs = `-map 0:v`;
    } else {
      mapArgs = `-map 0:v -map 0:a?`;
    }
  }

  let outputOptions = `-c:v libx264 -preset fast -crf 23`;
  if (options.resolution) outputOptions += ` -s ${options.resolution}`;
  if (options.fps) outputOptions += ` -r ${options.fps}`;
  outputOptions += ` -c:a aac -b:a 128k`;

  const rawOutput = ensureRawPath(outputUri);
  const finalCommand = `-y ${inputStr} ${filterComplex} ${mapArgs} ${outputOptions} "${rawOutput}"`
    .replace(/\s+/g, ' ')
    .trim();

  return executeFFmpeg(finalCommand, onProgress);
};
