declare module "node-audiorecorder" {
  interface AudioRecorderOptions {
    program?: string;
    device?: string | null;
    bits?: number;
    channels?: number;
    encoding?: string;
    format?: string;
    rate?: number;
    type?: string;
    silence?: number;
  }

  class AudioRecorder {
    constructor(options?: AudioRecorderOptions);
    start(): AudioRecorder;
    stop(): void;
    stream(): NodeJS.ReadableStream;
  }

  export = AudioRecorder;
}
