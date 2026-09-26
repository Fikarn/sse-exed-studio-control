import { createReadStream, existsSync, realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function parseArgs(argv) {
  let port = 6007;
  let root = "storybook-static";

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--port") {
      port = Number(argv[index + 1] ?? port);
      index += 1;
      continue;
    }

    if (value === "--root") {
      root = argv[index + 1] ?? root;
      index += 1;
    }
  }

  return {
    port,
    root: resolve(root),
  };
}

function resolvePath(root, requestPath) {
  const decodedPath = decodeURIComponent(requestPath.split("?")[0] || "/");
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const relativePath = normalizedPath === "/" ? "index.html" : normalizedPath.replace(/^[/\\]+/, "");
  return join(root, relativePath);
}

async function getFilePath(root, requestPath) {
  const candidate = resolvePath(root, requestPath);
  const metadata = await stat(candidate).catch(() => null);

  if (metadata?.isDirectory()) {
    const indexPath = join(candidate, "index.html");
    const indexMetadata = await stat(indexPath).catch(() => null);
    if (indexMetadata?.isFile()) {
      return indexPath;
    }
  }

  if (metadata?.isFile()) {
    return candidate;
  }

  return null;
}

function main() {
  const { port, root } = parseArgs(process.argv.slice(2));

  if (!existsSync(root)) {
    console.error(`Static root does not exist: ${root}`);
    process.exit(1);
  }

  const server = createServer(async (request, response) => {
    const filePath = await getFilePath(root, request.url ?? "/");

    if (!filePath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const extension = extname(filePath);
    const contentType = mimeTypes[extension] ?? "application/octet-stream";

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    });

    createReadStream(filePath).pipe(response);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Serving Storybook static from ${root} on http://127.0.0.1:${port}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(() => {
        process.exit(0);
      });
    });
  }
}

// Runs only as `node scripts/frontend/storybook-static-server.mjs …`: an import
// does nothing (2026-09-26; the run opens a server on 127.0.0.1 and ends the
// process on a signal). The two paths are compared as real paths — through a
// directory junction or a short 8.3 name, `process.argv[1]` and
// `import.meta.url` spell the same file differently, and a plain comparison
// would skip the run without a word (scripts/dev-check-cli.mjs).
function isMainModule() {
  const started = process.argv[1];
  if (!started) {
    return false;
  }
  const self = fileURLToPath(import.meta.url);
  let same = false;
  try {
    same = realpathSync.native(started) === realpathSync.native(self);
  } catch {
    // Not a file the file system resolves: not this one.
  }
  if (!same && basename(started) === basename(self)) {
    throw new Error(`${started} was started, but it could not be matched to ${self}; nothing was done.`);
  }
  return same;
}

if (isMainModule()) {
  main();
}
