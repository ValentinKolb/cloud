declare module "emoji-js" {
  class EmojiConvertor {
    replace_mode: string;
    allow_native: boolean;
    replace_colons(str: string): string;
  }
  export default EmojiConvertor;
}
