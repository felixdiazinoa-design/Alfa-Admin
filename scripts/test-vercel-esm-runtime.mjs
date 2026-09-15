import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serverReachableModules = [
    'src/lib/adminApi.ts',
    'src/lib/observabilityService.ts',
    'src/lib/tenantProducts.ts',
    'src/lib/tenantProvisioning.ts',
    'src/lib/tenantService.ts',
];

for (const file of serverReachableModules) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const relativeImports = [...source.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)]
        .map((match) => match[1]);

    for (const specifier of relativeImports) {
        assert.match(
            specifier,
            /\.js$/,
            `${file} must use a .js extension for Vercel Node ESM imports: ${specifier}`,
        );
    }
}

console.log('Vercel Node ESM import checks passed.');
