import launch from "./launch";

if (typeof window !== "undefined") {
  (window as any).take6 = { ...(window as any).take6, launch3d: launch };
}

export { GameController } from "./game";
export { launch };
export default launch;
