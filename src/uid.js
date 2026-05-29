// Short non-cryptographic id for layers and bullet items.
export function uid() {
  return Math.random().toString(36).slice(2, 9);
}
