export function shouldShowLanding({ installedApp = false, standalone = false, hasWorkspace = false } = {}) {
  return !installedApp && !standalone && !hasWorkspace;
}
