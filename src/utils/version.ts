// Vite embeds the package version, including in offline desktop builds.
export async function getAppVersion(): Promise<string> {
  return __APP_VERSION__;
}
