import { FFmpegKit, FFprobeKit, ReturnCode } from '@wekor/react-native-ffmpeg';
import { Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

export const getVideoMetadata = async (uri: string): Promise<VideoMetadata | null> => {
  try {
    const session = await FFprobeKit.getMediaInformation(uri);
    const info = await session.getMediaInformation();

    if (info) {
      const duration = Number(info.getDuration());
      const streams = info.getStreams();
      let width = 0;
      let height = 0;

      for (let i = 0; i < streams.length; i++) {
        const stream = streams[i];
        if (stream.getType() === 'video') {
          width = stream.getWidth();
          height = stream.getHeight();
          break;
        }
      }

      return { duration, width, height };
    }
  } catch (error) {
    console.error('Error getting video metadata:', error);
  }
  return null;
};

export const executeFFmpeg = async (command: string): Promise<boolean> => {
  try {
    console.log(`Executing FFmpeg command: ${command}`);
    const session = await FFmpegKit.execute(command);
    const returnCode = await session.getReturnCode();

    if (ReturnCode.isSuccess(returnCode)) {
      console.log('FFmpeg process completed successfully.');
      return true;
    } else if (ReturnCode.isCancel(returnCode)) {
      console.log('FFmpeg process cancelled.');
      return false;
    } else {
      console.error('FFmpeg process failed with return code', returnCode);
      const output = await session.getOutput();
      console.error('FFmpeg Output:', output);
      return false;
    }
  } catch (error) {
    console.error('FFmpeg execution error:', error);
    return false;
  }
};

export interface EditOptions {
  trim?: { start: number; end: number };
  speed?: number;
  color?: { brightness?: number; contrast?: number; saturation?: number };
  resolution?: string; // e.g. '1920x1080', '3840x2160'
  fps?: number; // e.g. 30, 60
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

export const processVideo = async (inputUris: string | string[], outputUri: string, options: EditOptions): Promise<boolean> => {
  const urisArray = Array.isArray(inputUris) ? inputUris : [inputUris];
  const isMultiClip = urisArray.length > 1;
  const primaryInput = urisArray[0];
  let filterGraph = '';
  let videoFilters: string[] = [];
  let audioFilters: string[] = [];

  // 1. Trimming (usually better to do this before filters to save processing time)
  let inputOptions = '';
  if (options.trim) {
    inputOptions = `-ss ${options.trim.start} -to ${options.trim.end}`;
  }

  // 2. Speed Control
  // Video: setpts
  // Audio: atempo
  if (options.speed && options.speed !== 1.0) {
    const videoPts = 1.0 / options.speed;
    videoFilters.push(`setpts=${videoPts}*PTS`);
    
    // atempo filter is limited to 0.5 to 2.0. If we need more, we have to chain it.
    audioFilters.push(`atempo=${options.speed}`);
  }

  // 3. Color Adjustments
  // eq filter: brightness (default 0, -1.0 to 1.0), contrast (default 1.0, -1000.0 to 1000.0), saturation (default 1.0, 0.0 to 3.0)
  if (options.color) {
    const { brightness = 0, contrast = 1, saturation = 1 } = options.color;
    // FFmpeg eq filter values: brightness [-1.0, 1.0], contrast [-1000.0, 1000.0], saturation [0.0, 3.0]
    // To make it simple, we assume the UI provides mapped values or we map them here.
    videoFilters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`);
  }

  // 4. Transform (Format, Scale, Rotate, Pan)
  if (options.transform) {
    const { 
      scale = 1, 
      translateX = 0, 
      translateY = 0, 
      rotation = 0, 
      targetRatio = 'Original', 
      canvasWidth = 1, 
      canvasHeight = 1 
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

      const padFilter = `pad=width='max(iw\\,ih*(${ratioStr}))':height='max(ih\\,iw/(${ratioStr}))':x='(ow-iw)/2+(${normX}*ow)':y='(oh-ih)/2+(${normY}*oh)':color=black`;
      videoFilters.push(padFilter);

      const cropFilter = `crop=w='min(iw\\,ih*(${ratioStr}))':h='min(ih\\,iw/(${ratioStr}))':x='(iw-ow)/2':y='(ih-oh)/2'`;
      videoFilters.push(cropFilter);
    }
  }

  // Construct filter strings
  let filterComplex = '';
  let mapArgs = '';
  
  if (isMultiClip) {
    // Multi-clip concatenation
    let videoScaleFilters = '';
    let concatParts = '';
    
    // Scale all clips to match the first clip's resolution roughly (we use 1080x1920 as standard vertical for safety, or 720p)
    // To be perfectly safe, we scale to 1080x1920 with padding to avoid concat failing due to different sizes
    for (let i = 0; i < urisArray.length; i++) {
      videoScaleFilters += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[v${i}]; `;
      concatParts += `[v${i}][${i}:a]`;
    }
    
    let concatMix = `${videoScaleFilters}${concatParts}concat=n=${urisArray.length}:v=1:a=1[vout_base][aout_base]; `;
    
    // Apply filters to concatenated result
    let finalVideoStr = videoFilters.length > 0 ? `[vout_base]${videoFilters.join(',')}[vout]; ` : '[vout_base]copy[vout]; ';
    let finalAudioStr = audioFilters.length > 0 ? `[aout_base]${audioFilters.join(',')}[a0]; ` : '[aout_base]anull[a0]; ';
    
    if (options.musicUri) {
      let audioMixStr = `[a0][${urisArray.length}:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      filterComplex = `-filter_complex "${concatMix}${finalVideoStr}${finalAudioStr}${audioMixStr}"`;
    } else {
      filterComplex = `-filter_complex "${concatMix}${finalVideoStr.replace('; ', '')}"`; // Simplified for MVP
      // Re-map [a0] to [aout]
      filterComplex = filterComplex.replace('[vout];', '[vout]; [aout_base]anull[aout]');
    }
    mapArgs = `-map "[vout]" -map "[aout]"`;
    
  } else if (options.musicUri) {
    let videoFilterStr = videoFilters.length > 0 ? `[0:v]${videoFilters.join(',')}[vout];` : '';
    let audioFilterStr = audioFilters.length > 0 ? `[0:a]${audioFilters.join(',')}[a0];` : '';
    
    let amixInput1 = audioFilters.length > 0 ? '[a0]' : '[0:a]';
    // amix duration=first ensures the audio stops when the original video ends
    let audioMixStr = `${amixInput1}[1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
    
    filterComplex = `-filter_complex "${videoFilterStr}${audioFilterStr}${audioMixStr}"`;
    mapArgs = `-map ${videoFilters.length > 0 ? '"[vout]"' : '0:v'} -map "[aout]"`;
  } else {
    if (videoFilters.length > 0) {
      filterGraph += `-vf "${videoFilters.join(',')}" `;
    }
    if (audioFilters.length > 0) {
      filterGraph += `-af "${audioFilters.join(',')}" `;
    }
  }

  // Construct full command
  // Overwrite output (-y), specify input, apply filters, set output
  let outputOptions = `-c:v libx264 -preset fast -crf 23`;
  
  if (options.resolution) {
    outputOptions += ` -s ${options.resolution}`;
  }
  
  if (options.fps) {
    outputOptions += ` -r ${options.fps}`;
  }
  
  outputOptions += ` -c:a aac`;

  let inputOptionsStr = '';
  if (isMultiClip) {
    inputOptionsStr = urisArray.map(uri => `-i "${uri}"`).join(' ');
  } else {
    inputOptionsStr = `-y ${inputOptions} -i "${primaryInput}"`;
  }
  
  if (options.musicUri) {
    inputOptionsStr += ` -i "${options.musicUri}"`;
  }

  let finalCommand = '';
  if (isMultiClip || options.musicUri) {
    finalCommand = `${inputOptionsStr} ${filterComplex} ${mapArgs} ${outputOptions} "${outputUri}"`;
  } else {
    finalCommand = `${inputOptionsStr} ${filterGraph}${outputOptions} "${outputUri}"`;
  }
  
  // ensure output options don't conflict, add -y to start
  finalCommand = `-y ${finalCommand}`;
  
  return await executeFFmpeg(finalCommand);
};
