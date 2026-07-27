import { ModelScanner } from '../electron/models';

const folder = process.argv[2];
if (!folder) {
  console.log('Usage: npx tsx scripts/scan-models.ts <folder-path>');
  process.exit(1);
}

async function run() {
  const scanner = new ModelScanner();
  console.log(`Scanning models in ${folder}...`);
  const models = await scanner.scanFolders([folder]);
  console.log(`Discovered ${models.length} GGUF models:`);
  console.log(JSON.stringify(models, null, 2));
}

run();
