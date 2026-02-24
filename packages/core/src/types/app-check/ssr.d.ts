declare module "@valentinkolb/ssr" {
  type TemplateArgs<TPageOptions> = {
    body: string;
    scripts: string;
    title?: string;
    description?: string;
  } & TPageOptions;

  export function createConfig<TPageOptions = Record<string, unknown>>(options: {
    dev?: boolean;
    verbose?: boolean;
    rootDir?: string;
    external?: string[];
    template?: (args: TemplateArgs<TPageOptions>) => string | Promise<string>;
  }): {
    config: {
      dev: boolean;
      verbose?: boolean;
      rootDir?: string;
    };
    plugin: any;
    html: any;
  };
}
