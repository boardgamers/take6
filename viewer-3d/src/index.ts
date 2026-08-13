import launch from "./launch";

if (typeof window !== "undefined") {
  // Boardgamers iframe contract: window.<topLevelVariable>.launch(selector).
  // Use a dedicated global (take63d) so the 3D bundle never collides with the
  // default viewer's `window.take6`. The UMD build also assigns its module
  // namespace to `window.take63d`, which already carries `launch`.
  (window as any).take63d = { ...(window as any).take63d, launch };
}

export { GameController } from "./game";
export { launch };
export default launch;
