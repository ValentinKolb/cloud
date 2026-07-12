export const SEARCH_CHUNK_CHARACTERS = 64 * 1024;
export const SEARCH_CHUNK_OVERLAP_CHARACTERS = 512;

export const splitSearchText = (text: string): string[] => {
  if (!text) return [];
  const stride = SEARCH_CHUNK_CHARACTERS - SEARCH_CHUNK_OVERLAP_CHARACTERS;
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += stride) {
    chunks.push(text.slice(start, start + SEARCH_CHUNK_CHARACTERS));
    if (start + SEARCH_CHUNK_CHARACTERS >= text.length) break;
  }
  return chunks;
};
