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
  resolution?: string; // e.g. '1920x1080', '3840x2160'
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
}

export const getVideoMetadata = async (uri: string): Promise<VideoMetadata | null> => {
  try {
    const session = await FFprobeKit.getMediaInformation(uri);
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

export const executeFFmpeg = async (command: string): Promise<boolean> => {
  try {
    console.log(`Executing FFmpeg: ${command}`);
    const session = await FFmpegKit.execute(command);
    const returnCode = await session.getReturnCode();
    if (ReturnCode.isSuccess(returnCode)) {
      console.log('FFmpeg success.');
      return true;
    } else if (ReturnCode.isCancel(returnCode)) {
      console.log('FFmpeg cancelled.');
      return false;
    } else {
      const output = await session.getOutput();
      console.error('FFmpeg failed. Output:', output);
      return false;
    }
  } catch (error) {
    console.error('FFmpeg execution error:', error);
    return false;
  }
};

export const generateThumbnails = async (uri: string, duration: number, count: number): Promise<string[]> => {
  const fps = Math.max(0.1, count / Math.max(duration, 1));
  const outDirName = `thumbs_${Date.now()}`;
  const outDirPath = `${Paths.cache.uri}${outDirName}/`;
  await FileSystem.makeDirectoryAsync(outDirPath, { intermediates: true });
  const command = `-y -i "${uri}" -vf "fps=${fps},scale=120:-1" -q:v 2 "${outDirPath}thumb_%03d.jpg"`;
  const success = await executeFFmpeg(command);
  if (success) {
    const files = await FileSystem.readDirectoryAsync(outDirPath);
    return files.sort().map(f => `${outDirPath}${f}`);
  }
  return [];
};

/**
 * Build the video/audio filter chains from EditOptions.
 */
function buildFilters(options: EditOptions): { videoFilters: string[]; audioFilters: string[] } {
  const videoFilters: string[] = [];
  const audioFilters: string[] = [];

  if (options.speed && options.speed !== 1.0) {
    videoFilters.push(`setpts=${(1.0 / options.speed).toFixed(4)}*PTS`);
    // atempo is limited to [0.5, 2.0]; chain for extreme values
    const s = options.speed;
    if (s >= 0.5 && s <= 2.0) {
      audioFilters.push(`atempo=${s}`);
    } else if (s > 2.0) {
      audioFilters.push(`atempo=2.0`, `atempo=${(s / 2.0).toFixed(4)}`);
    } else {
      audioFilters.push(`atempo=0.5`, `atempo=${(s / 0.5).toFixed(4)}`);
    }
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

/**
 * Process one or more video clips with optional per-clip trim, effects, and music mixing.
 * Accepts ClipInput[] (with per-clip trim), string[] or a single string.
 */
export const processVideo = async (
  inputUris: ClipInput[] | string[] | string,
  outputUri: string,
  options: EditOptions
): Promise<boolean> => {

  // Normalize to ClipInput[]
  let clips: ClipInput[];
  if (typeof inputUris === 'string') {
    clips = [{ uri: inputUris }];
  } else if (Array.isArray(inputUris) && inputUris.length > 0 && typeof inputUris[0] === 'string') {
    clips = (inputUris as string[]).map(uri => ({ uri }));
  } else {
    clips = inputUris as ClipInput[];
  }

  const isMultiClip = clips.length > 1;
  const musicIndex = clips.length; // music input index (after all video clips)
  const { videoFilters, audioFilters } = buildFilters(options);

  // Build -i input string with per-clip trim as input options
  const inputParts: string[] = clips.map(clip => {
    const trimOpt = clip.trim ? `-ss ${clip.trim.start.toFixed(3)} -to ${clip.trim.end.toFixed(3)}` : '';
    return `${trimOpt} -i "${clip.uri}"`.trim();
  });
  if (options.musicUri) {
    inputParts.push(`-i "${options.musicUri}"`);
  }
  const inputStr = inputParts.join(' ');

  let filterComplex = '';
  let mapArgs = '';
  let extraOutputOpts = '';

  if (isMultiClip) {
    // ── Multi-clip path ──────────────────────────────────────────────────────
    // Scale every clip to the same canvas. Use anull to safely handle clips
    // that might not have an audio stream (the -map 0:a? pattern handles it,
    // but filter_complex needs explicit streams, so we use aevalsrc fallback).
    let scaleFilters = '';
    let concatParts = '';

    for (let i = 0; i < clips.length; i++) {
      // Video: scale + pad to 1080x1920 (portrait default), preserve AR
      scaleFilters += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[sv${i}];`;
      
      // Calculate active duration for silence track limit
      let segmentDuration = clips[i].duration || 0;
      if (clips[i].trim) {
        segmentDuration = clips[i].trim!.end - clips[i].trim!.start;
      }
      if (segmentDuration <= 0) segmentDuration = 5.0;

      // Audio: generate silent track if clip lacks audio, otherwise concat fails
      if (clips[i].hasAudio === false) {
        scaleFilters += `anullsrc=channel_layout=stereo:sample_rate=44100:d=${segmentDuration.toFixed(3)}[sa${i}];`;
      } else {
        scaleFilters += `[${i}:a]anull[sa${i}];`;
      }
      concatParts += `[sv${i}][sa${i}]`;
    }

    const concatFilter = `${concatParts}concat=n=${clips.length}:v=1:a=1[cv][ca]`;

    const vFilterStr = videoFilters.length > 0
      ? `;[cv]${videoFilters.join(',')}[vout]`
      : `;[cv]copy[vout]`;

    const aFilterStr = audioFilters.length > 0
      ? `;[ca]${audioFilters.join(',')}[a0]`
      : `;[ca]anull[a0]`;

    if (options.musicUri) {
      const amix = `;[a0][${musicIndex}:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      filterComplex = `-filter_complex "${scaleFilters}${concatFilter}${vFilterStr}${aFilterStr}${amix}"`;
      mapArgs = `-map "[vout]" -map "[aout]"`;
    } else {
      filterComplex = `-filter_complex "${scaleFilters}${concatFilter}${vFilterStr}${aFilterStr}"`;
      mapArgs = `-map "[vout]" -map "[a0]"`;
    }

  } else if (videoFilters.length > 0 || audioFilters.length > 0 || options.musicUri) {
    // ── Single clip with filters / music ────────────────────────────────────
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

    if (options.musicUri) {
      if (audioFilters.length > 0 && hasAudio) {
        filterParts += `[${aMapSrc}]${audioFilters.join(',')}[avid];`;
        filterParts += `[avid][${musicIndex}:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      } else {
        filterParts += `[${aMapSrc}][${musicIndex}:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      }
      aMapSrc = '[aout]';
    } else if (audioFilters.length > 0 && hasAudio) {
      filterParts += `[${aMapSrc}]${audioFilters.join(',')}[aout]`;
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
    // ── Single clip, no filters, no music ───────────────────────────────────
    // Just re-encode (trim already applied as input options above)
    if (clips[0].hasAudio === false) {
      mapArgs = `-map 0:v`;
    } else {
      mapArgs = `-map 0:v -map 0:a?`;
    }
  }

  // Output codec options
  let outputOptions = `-c:v libx264 -preset fast -crf 23`;
  if (options.resolution) outputOptions += ` -s ${options.resolution}`;
  if (options.fps) outputOptions += ` -r ${options.fps}`;
  outputOptions += ` -c:a aac -b:a 128k${extraOutputOpts}`;

  // Assemble final command (-y at the start, only once)
  const finalCommand = `-y ${inputStr} ${filterComplex} ${mapArgs} ${outputOptions} "${outputUri}"`
    .replace(/\s+/g, ' ')
    .trim();

  return executeFFmpeg(finalCommand);
};
