import { FFmpegKit, FFprobeKit, ReturnCode } from '@wekor/react-native-ffmpeg';

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
      const duration = parseFloat(info.getDuration());
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
}

export const processVideo = async (inputUri: string, outputUri: string, options: EditOptions): Promise<boolean> => {
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

  // Construct filter strings
  if (videoFilters.length > 0) {
    filterGraph += `-vf "${videoFilters.join(',')}" `;
  }
  
  if (audioFilters.length > 0) {
    filterGraph += `-af "${audioFilters.join(',')}" `;
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

  const command = `-y ${inputOptions} -i "${inputUri}" ${filterGraph}${outputOptions} "${outputUri}"`;
  
  return await executeFFmpeg(command);
};
