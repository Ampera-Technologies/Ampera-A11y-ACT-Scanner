import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { access, readFile, rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

function containsExecutableIdentifier(source, identifier) {
  let state = "code";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && nextCharacter === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "single-quote" || state === "double-quote" || state === "template") {
      if (character === "\\") {
        index += 1;
      } else if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"') ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (character === "'") {
      state = "single-quote";
      continue;
    }
    if (character === '"') {
      state = "double-quote";
      continue;
    }
    if (character === "`") {
      state = "template";
      continue;
    }

    if (
      source.startsWith(identifier, index) &&
      !/[A-Za-z0-9_$]/.test(source[index - 1] ?? "") &&
      !/[A-Za-z0-9_$]/.test(source[index + identifier.length] ?? "")
    ) {
      return true;
    }
  }

  return false;
}

function findIdentifierContext(source, identifier) {
  let state = "code";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && nextCharacter === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "single-quote" || state === "double-quote" || state === "template") {
      if (character === "\\") {
        index += 1;
      } else if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"') ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (character === "'") {
      state = "single-quote";
      continue;
    }
    if (character === '"') {
      state = "double-quote";
      continue;
    }
    if (character === "`") {
      state = "template";
      continue;
    }

    if (
      source.startsWith(identifier, index) &&
      !/[A-Za-z0-9_$]/.test(source[index - 1] ?? "") &&
      !/[A-Za-z0-9_$]/.test(source[index + identifier.length] ?? "")
    ) {
      return source.slice(Math.max(0, index - 140), index + identifier.length + 140);
    }
  }

  return null;
}

function hasIdentifierDeclaration(source, identifier) {
  const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b(?:var|let|const|function|class)\\s+${escapedIdentifier}\\b`,
  ).test(source);
}

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  // ── Browser bundle: runs inside Puppeteer's page context ──────────────────
  // Compile this first so the server bundle can embed a copy. The standalone
  // file is retained for diagnostics/backwards compatibility, but production
  // scans no longer depend on a sibling asset surviving deployment packaging.
  const browserBuildResult = await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/lib/browser/index.ts")],
    platform: "browser",
    bundle: true,
    format: "iife",
    outfile: path.join(distDir, "browser-bundle.js"),
    logLevel: "info",
    minify: process.env.NODE_ENV === "production",
    sourcemap: process.env.NODE_ENV === "production" ? "linked" : false,
    metafile: true,
    // No external — browser bundle must be fully self-contained. The browser
    // sources use only relative imports, so esbuild does not need a separate
    // tsconfig file here. Keeping this build independent of that optional
    // typecheck config also makes older Docker build contexts reproducible.
  });

  const browserBundlePath = path.join(distDir, "browser-bundle.js");
  await access(browserBundlePath);
  const browserBundleContents = await readFile(browserBundlePath, "utf8");
  const languageDetectorMarker = "language-detector-franc-min-v1";
  const hasBundledFrancInput = Object.keys(
    browserBuildResult.metafile.inputs,
  ).some((inputPath) =>
    inputPath.replaceAll("\\", "/").includes("/franc-min/"),
  );
  if (!hasBundledFrancInput || !browserBundleContents.includes(languageDetectorMarker)) {
    throw new Error(
      "Invalid browser bundle: franc-min language detection was not bundled. " +
      "Install workspace dependencies and rebuild before deploying.",
    );
  }

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "puppeteer-extra",
      "puppeteer-extra-plugin-stealth",
      "electron",
      "xlsx",
    ],
    sourcemap: process.env.NODE_ENV === "production" ? "linked" : false,
    // Embed the browser-side rule engine into the server bundle. Azure/App
    // Service and zip deployments can omit non-entrypoint sibling assets;
    // embedding keeps Puppeteer scans independent of that packaging behavior.
    define: {
      __AMPERA_BROWSER_BUNDLE__: JSON.stringify(browserBundleContents),
    },
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // Do not allow an old or partially generated project bundle to be packaged.
  // Azure App Service can preserve files from a previous zip deployment, and
  // the resulting stale bundle previously crashed GET /api/projects with:
  //   ReferenceError: projectSitesTable3 is not defined
  const serverBundlePath = path.join(distDir, "index.mjs");
  const serverBundleContents = await readFile(serverBundlePath, "utf8");
  const staleProjectSitesSymbol = ["project", "Sites", "Table3"].join("");
  const hasStaleProjectSitesReference = containsExecutableIdentifier(
    serverBundleContents,
    staleProjectSitesSymbol,
  );
  const hasStaleProjectSitesDeclaration = hasIdentifierDeclaration(
    serverBundleContents,
    staleProjectSitesSymbol,
  );
  if (hasStaleProjectSitesReference && !hasStaleProjectSitesDeclaration) {
    const context = findIdentifierContext(serverBundleContents, staleProjectSitesSymbol)
      ?.replace(/\s+/g, " ")
      .trim();
    throw new Error(
      "Invalid API bundle: unresolved stale project-sites reference found. " +
      "Clean the API dist directory and rebuild before deploying.\n" +
      `Generated bundle context: ${context ?? "(context unavailable)"}`,
    );
  }
  if (!serverBundleContents.includes("issues-attachments-r2-v1")) {
    throw new Error(
      "Invalid API bundle: issues-attachments-r2-v1 build marker is missing. " +
      "The Issue Management routes or health marker were not included in the build.",
    );
  }
  if (!serverBundleContents.includes(languageDetectorMarker)) {
    throw new Error(
      "Invalid API bundle: the embedded franc-min language-detector marker is missing. " +
      "Rebuild the API and browser bundles together before deploying.",
    );
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
