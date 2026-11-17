import { useMemo, useSyncExternalStore, useState, type ReactNode } from "react";
import { Surface } from "../react";
import type { PreviewDefinitionInput } from "../core";
import { ScenePreview } from "./ScenePreview";
import {SceneModuleLibrary,type SceneModules} from "./modules";
export {SceneLibrary} from "./SceneLibrary";
export type {CameraLibraryOptions,SceneLibraryProps} from "./SceneLibrary";
import type {CameraLibraryOptions} from "./SceneLibrary";
export {CameraPreview} from "./camera/CameraPreview";
export type {CameraPreviewProps} from "./camera/CameraPreview";
export type {SceneModules} from "./modules";
import type { PreviewHot } from "./connection";
export { ScenePreview } from "./ScenePreview";
export type { ScenePreviewProps } from "./ScenePreview";
export type { PreviewHot } from "./connection";

/** SOURCE OF TRUTH: ProjectPreview installed application adapter.
 * WHAT: retain the explicit development/query guard around original host children.
 * WHY: the real product shell frames live UI without copying data or changing normal routes.
 * WHERE: CLI injects this adapter; ScenePreview owns all playback and chrome.
 */
export type ProjectPreviewProps = {children?: ReactNode; projectId: string; enabled: boolean; active?: boolean; hot?: PreviewHot; sceneModules?: SceneModules; camera?: false | CameraLibraryOptions};
const initialDefinition: PreviewDefinitionInput = {
  scene: {camera: {perspective:1800,rotateX:4,rotateY:-7},focus:{distance:1800,fStop:8,maxBlur:6},nodes:[{id:"flute-application"}]},
};
export function ProjectPreview({children, projectId, enabled, active, hot, sceneModules, camera}: ProjectPreviewProps): ReactNode {
  const [locationAtMount] = useState(() => typeof window === "undefined" ? "" : window.location.href);
  const location = useSyncExternalStore(() => () => {}, () => locationAtMount, () => "");
  const entry = useMemo(() => {
    if (!location) return null;
    const url = new URL(location);
    const requested = url.searchParams.get("flute-preview") === "1";
    url.searchParams.delete("flute-preview");
    url.searchParams.delete("flute-scene");
    return {requested, back: url.pathname + url.search + url.hash};
  }, [location]);
  const content = useMemo(() => <Surface id="flute-application" style={{width:"100%",minHeight:980}}>{children}</Surface>, [children]);
  if (!enabled || !(active ?? entry?.requested)) return children;
  if(sceneModules) return <div data-flute-project={projectId}><SceneModuleLibrary modules={sceneModules} hot={hot} backHref={entry?.back}
    camera={camera===false?undefined:{storagePrefix:`flute:${projectId}`,...camera}}/></div>;
  return <div data-flute-project={projectId}><ScenePreview title="Your application" definition={initialDefinition} backHref={entry?.back} hot={hot}>
    {content}
  </ScenePreview></div>;
}
