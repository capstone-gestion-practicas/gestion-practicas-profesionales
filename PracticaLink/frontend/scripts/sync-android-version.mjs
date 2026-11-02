import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendDirectory = resolve(scriptDirectory, '..');
const packagePath = resolve(frontendDirectory, 'package.json');
const packageLockPath = resolve(frontendDirectory, 'package-lock.json');
const gradlePath = resolve(frontendDirectory, 'android/app/build.gradle');

const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const versionName = packageJson.version;
const versionCode = packageJson.config?.androidVersionCode;

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(versionName)) {
  throw new Error(`La versión ${versionName} no utiliza formato semántico, por ejemplo 1.1.0.`);
}

if (!Number.isInteger(versionCode) || versionCode < 1) {
  throw new Error('config.androidVersionCode debe ser un entero positivo.');
}

const originalGradle = await readFile(gradlePath, 'utf8');
const updatedGradle = originalGradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);

if (updatedGradle === originalGradle && !originalGradle.includes(`versionName "${versionName}"`)) {
  throw new Error('No fue posible localizar versionCode y versionName en build.gradle.');
}

await writeFile(gradlePath, updatedGradle, 'utf8');

const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8'));
packageLock.version = versionName;
packageLock.packages[''].version = versionName;
await writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`, 'utf8');

console.log(`Versión Android sincronizada: ${versionName} (build ${versionCode}).`);
