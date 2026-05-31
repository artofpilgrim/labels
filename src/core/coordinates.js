export function toScreen(value, fit) {
  return value * fit;
}

export function toLabel(value, fit) {
  return value / fit;
}

export function clientToLabel(clientX, clientY, rect, fit) {
  return {
    x: toLabel(clientX - rect.left, fit),
    y: toLabel(clientY - rect.top, fit),
  };
}

export function labelToClient(x, y, rect, fit) {
  return {
    x: rect.left + toScreen(x, fit),
    y: rect.top + toScreen(y, fit),
  };
}

export function scaleRect(box, fit) {
  return {
    left: toScreen(box.x, fit),
    top: toScreen(box.y, fit),
    width: toScreen(box.w, fit),
    height: toScreen(box.h, fit),
  };
}

export function screenThreshold(px, fit) {
  return toLabel(px, fit);
}
