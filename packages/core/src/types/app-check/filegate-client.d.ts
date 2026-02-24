declare module "@valentinkolb/filegate/client" {
  export class Filegate {
    constructor(config: { url: string; token?: string });
    [key: string]: any;
  }
}
