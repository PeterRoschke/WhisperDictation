declare module 'node-record-lpcm16' {
    interface RecordOptions {
        sampleRate?: number;
        channels?: number;
        audioType?: string;
        threshold?: number;
        thresholdStart?: number;
        thresholdEnd?: number;
        silence?: number;
        verbose?: boolean;
        recordProgram?: string;
    }

    interface RecordInstance {
        stream(): NodeJS.ReadableStream;
        stop(): void;
    }

    export function record(options?: RecordOptions): RecordInstance;
} 