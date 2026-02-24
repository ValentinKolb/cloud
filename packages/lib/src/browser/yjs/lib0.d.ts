declare module "lib0/encoding" {
  export type Encoder = unknown;
  export const createEncoder: () => Encoder;
  export const writeVarUint: (encoder: Encoder, num: number) => void;
  export const writeVarUint8Array: (encoder: Encoder, uint8Array: Uint8Array) => void;
  export const toUint8Array: (encoder: Encoder) => Uint8Array;
  export const length: (encoder: Encoder) => number;
}

declare module "lib0/decoding" {
  export type Decoder = unknown;
  export const createDecoder: (uint8Array: Uint8Array) => Decoder;
  export const readVarUint: (decoder: Decoder) => number;
  export const readVarUint8Array: (decoder: Decoder) => Uint8Array;
}
