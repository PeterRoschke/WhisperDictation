declare module "node-microphone" {
  import { Readable } from "stream";

  interface MicrophoneOptions {
    rate?: string;
    channels?: string;
    device?: string;
    encoding?: string;
    bitwidth?: string;
  }

  class Microphone {
    constructor(options?: MicrophoneOptions);
    startRecording(): Readable;
    stopRecording(): void;
  }

  export = Microphone;
}
