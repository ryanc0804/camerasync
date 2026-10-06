export const SCALE_OPTIONS = [95, 105, 115, 125, 135];

export function getSavedScale() {
  try {
    const scale = Number(localStorage.getItem("appScale"));
    return SCALE_OPTIONS.includes(scale) ? scale : 115;
  } catch {
    return 115;
  }
}

export function applyScale(scale) {
  document.documentElement.style.fontSize = `${scale}%`;
}
