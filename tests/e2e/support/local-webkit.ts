// Local runs only: point WebKit at system libraries unpacked without root (E2E_WK_LIBS, see tests/e2e/README.md).
// CI installs them with `playwright install --with-deps`, so this is a no-op there.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function applyLocalWebKitLibs(libsRoot: string | undefined): void {
  if (!libsRoot) return;
  if (!existsSync(libsRoot)) throw new Error(`E2E_WK_LIBS does not exist: ${libsRoot}`);
  const libDirs = ['usr/lib/x86_64-linux-gnu', 'lib/x86_64-linux-gnu', 'usr/lib']
    .map((dir) => join(libsRoot, dir))
    .filter((dir) => existsSync(dir));
  process.env.LD_LIBRARY_PATH = [...libDirs, process.env.LD_LIBRARY_PATH ?? ''].filter(Boolean).join(':');
  // Playwright's host check can't see the unpacked libs; a real browser launch proves them.
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';
  process.env.LIBGL_ALWAYS_SOFTWARE = '1';
  process.env.__EGL_VENDOR_LIBRARY_DIRS = join(libsRoot, 'usr/share/glvnd/egl_vendor.d');
}
