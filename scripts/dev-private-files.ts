import type { Plugin, ResolvedConfig } from "vite";

const PRIVATE_PATH = /(?:^|[/\\])(?:artifacts|\.runtime|\.tmuxhub|embeddings_lab_updated\.zip)(?:[/\\?#]|$)/i;
const PRIVATE_DENY = ["**/artifacts/**", "**/.runtime/**", "**/.tmuxhub/**", "**/embeddings_lab_updated.zip"];

function blockedPath(url: string) {
  let decoded = url;
  for (let depth = 0; depth < 5; depth++) {
    if (PRIVATE_PATH.test(decoded)) return true;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return false;
      decoded = next;
    } catch { return true; }
  }
  return true;
}

// Only the curated public/memories.json is public, not the raw archive or work files.
export function devPrivateFiles(): Plugin {
  return {
    name: "dev-private-files",
    enforce: "pre",
    apply: (_config, environment) => environment.command === "serve" && !environment.isPreview,
    configResolved(config) {
      config.server.fs.deny = [...config.server.fs.deny, ...PRIVATE_DENY];
      // Vite 7 compiles this matcher before configResolved. Keep its default denies.
      const access = config as ResolvedConfig & { fsDenyGlob: (path: string) => boolean };
      const previous = access.fsDenyGlob;
      if (typeof previous !== "function") throw new Error("Vite file access protection is unavailable.");
      access.fsDenyGlob = (path) => PRIVATE_PATH.test(path) || previous(path);
    },
    configureServer(server) {
      server.middlewares.stack.unshift({ route: "", handle(request, response, next) {
        if (!blockedPath(request.url ?? "")) return next();
        response.statusCode = 403;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("Forbidden");
      } });
    },
  };
}
